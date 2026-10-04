import { z } from "zod";
import type { PluginTools } from "../../shared/pluginTypes.js";
import {
  loadTwiccSessionFlowSnapshot,
  resolveTwiccSession,
  updateTwiccSessionFlowLane,
  updateTwiccSessionFlowPosition
} from "./service.js";

type CommandOptions = NonNullable<Parameters<typeof loadTwiccSessionFlowSnapshot>[2]>;
type ToolContext = {
  tools: PluginTools;
  getOptions(): CommandOptions;
  resolveProject(projectId: string): string;
};

const laneSchema = z.enum(["in_progress", "backlog", "done"]);
const projectSchema = z.string().trim().min(1).describe("Boatyard project ID returned by list_windows");
const sessionIdsSchema = z.array(z.string().trim().min(1)).min(1).max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Session IDs must be unique");
const tokenSchema = z.string().regex(/^obs1:[a-f0-9]{64}$/)
  .describe("Opaque observed-snapshot token from list_sessions; not an authoritative TwiCC revision");
const affectedLimitSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  .describe("Maximum distinct session targets attempted by this operation, including the entire lane for reorder");
const moveSchema = z.object({
  projectId: projectSchema, sessionIds: sessionIdsSchema, lane: laneSchema,
  expectedBoardToken: tokenSchema.optional(), maxAffectedSessions: affectedLimitSchema.optional()
}).strict();
const reorderSchema = z.object({
  projectId: projectSchema, lane: laneSchema, sessionIds: sessionIdsSchema,
  position: z.enum(["first", "last", "before", "after"]),
  anchorSessionId: z.string().trim().min(1).optional(),
  expectedLaneToken: tokenSchema.optional(), maxAffectedSessions: affectedLimitSchema.optional()
}).strict();

type Flow = Awaited<ReturnType<typeof loadTwiccSessionFlowSnapshot>>["flow"];
type PlanItem = Readonly<{ sessionId: string; lane: z.infer<typeof laneSchema>; order?: number }>;
type Outcome = "updated" | "noop" | "rejected" | "unknown" | "not_attempted";
type Result = PlanItem & { status: Outcome; code?: string };

function refuse(code: string): never { throw Object.assign(new Error(code), { refusalCode: code }); }

function requireSessions(flow: Flow, ids: string[]): void {
  if (ids.some((id) => !flow.some((session) => session.id === id))) { refuse("INVALID_SCOPE"); }
}

function receipt(plan: readonly PlanItem[], results: Result[], code?: string) {
  const attemptedCount = results.filter((item) => item.status !== "not_attempted").length;
  const confirmedCount = results.filter((item) => item.status === "updated" || item.status === "noop").length;
  const allSucceeded = !code && results.length === plan.length && confirmedCount === plan.length;
  return {
    status: attemptedCount === 0 && code ? "rejected" : allSucceeded ? "completed" : "partial",
    ...(code ? { code } : {}),
    plannedSessionIds: plan.map((item) => item.sessionId), attemptedCount, confirmedCount,
    atomic: false, finalState: "not_observed", results, allSucceeded
  };
}

function preWriteRefusal(plan: readonly PlanItem[], error: unknown) {
  // Do not copy upstream error messages: CLI stderr/responses can contain private data.
  const detail = error as { refusalCode?: string; code?: string } | null;
  const knownCodes = new Set(["STALE_BOARD", "STALE_LANE", "AFFECTED_LIMIT_EXCEEDED", "INVALID_SCOPE",
    "INVALID_ANCHOR", "INCOMPLETE_SNAPSHOT", "SNAPSHOT_CHANGED"]);
  const candidate = detail?.refusalCode || detail?.code;
  const code = error instanceof z.ZodError ? "INVALID_INPUT"
    : knownCodes.has(String(candidate)) ? candidate! : "SNAPSHOT_UNAVAILABLE";
  return receipt(plan, plan.map((item) => ({ ...item, status: "not_attempted" })), code);
}

async function executePlan(plan: readonly PlanItem[], options: CommandOptions, stopOnFailure: boolean) {
  const results: Result[] = [];
  let stopped = false;
  let code: string | undefined;
  for (const item of plan) {
    if (stopped) { results.push({ ...item, status: "not_attempted" }); continue; }
    try {
      const response = item.order === undefined
        ? await updateTwiccSessionFlowLane(item.sessionId, item.lane, options)
        : await updateTwiccSessionFlowPosition(item.sessionId, item.lane, item.order, options);
      const status = (response as { status: string }).status === "noop" ? "noop" : "updated";
      results.push({ ...item, status });
    } catch (error) {
      const rejected = (error as { mutationRejected?: boolean } | null)?.mutationRejected === true;
      const itemCode = rejected ? "UPDATE_REJECTED" : "UPDATE_UNKNOWN";
      results.push({ ...item, status: rejected ? "rejected" : "unknown", code: itemCode });
      code = code === "UPDATE_UNKNOWN" || !rejected ? "UPDATE_UNKNOWN" : itemCode;
      stopped = stopOnFailure;
    }
  }
  return receipt(plan, results, code);
}

function freezePlan(plan: PlanItem[]): readonly PlanItem[] {
  return Object.freeze(plan.map((item) => Object.freeze(item)));
}

export function registerTwiccTools({ tools, getOptions, resolveProject }: ToolContext): void {
  tools.register({
    id: "boatyard.twicc.resolve_session",
    title: "Resolve TwiCC session",
    description: "Resolve an exact session ID, including archived or hidden sessions, to its title, live state and conversation URL. Does not open or mutate the session. Use open_twicc_session to display it in a Boatyard TwiCC pane.",
    inputSchema: z.object({ sessionId: z.string().trim().min(1).max(200) }).strict(),
    readOnly: true,
    invoke: (input) => resolveTwiccSession(input.sessionId, getOptions())
  });

  // This queue covers this configuration's MCP tools only. UI actions, other
  // configurations and independent TwiCC writers bypass it; batches are not atomic.
  let mutationQueue: Promise<unknown> = Promise.resolve();
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation);
    mutationQueue = result.catch(() => {});
    return result;
  }
  function captureOptions(): CommandOptions {
    const options = getOptions();
    return { ...options, globalConfig: { ...options.globalConfig } };
  }

  tools.register({
    id: "boatyard.twicc.list_sessions",
    title: "List TwiCC Kanban sessions",
    description: "Read visible, unarchived sessions in Kanban order and observed-snapshot guard tokens. Listing never writes annotations. Tokens are state fingerprints, not backend revisions; complete means collected and checked, not atomic. Discover contextId/projectId with list_windows.",
    inputSchema: z.object({ projectId: projectSchema, lane: laneSchema.optional() }).strict(),
    readOnly: true,
    async invoke(input) {
      const projectId = String(input.projectId);
      const snapshot = await loadTwiccSessionFlowSnapshot(resolveProject(projectId), projectId, captureOptions());
      const lane = input.lane as z.infer<typeof laneSchema> | undefined;
      const sessions = snapshot.flow.filter((session) => !lane || session.lane === lane);
      return { sessions, total: sessions.length, guard: {
        mode: "observed_snapshot", version: 1, atomic: false, complete: true,
        boardToken: snapshot.boardToken, ...(lane ? { laneToken: snapshot.laneTokens[lane] } : {})
      } };
    }
  });

  tools.register({
    id: "boatyard.twicc.move_sessions",
    title: "Move TwiCC Kanban sessions",
    description: "Move explicit visible sessions without archiving or stopping agents. Optional expectedBoardToken and maxAffectedSessions are checked inside the local MCP queue before writes. Guarded calls stop on rejection or unknown acknowledgement. Receipts are non-atomic; external writers can race. Never automatically replay.",
    inputSchema: moveSchema,
    readOnly: false,
    destructive: false,
    invoke(input) {
      return mutate(async () => {
        let plan: readonly PlanItem[] = [];
        let options: CommandOptions;
        let parsed: z.infer<typeof moveSchema>;
        try {
          parsed = moveSchema.parse(input);
          options = captureOptions();
          let project: string;
          try { project = resolveProject(parsed.projectId); } catch { refuse("INVALID_SCOPE"); }
          const snapshot = await loadTwiccSessionFlowSnapshot(project, parsed.projectId, options);
          if (parsed.expectedBoardToken && parsed.expectedBoardToken !== snapshot.boardToken) { refuse("STALE_BOARD"); }
          requireSessions(snapshot.flow, parsed.sessionIds);
          plan = freezePlan(parsed.sessionIds.map((sessionId) => ({ sessionId, lane: parsed.lane })));
          if (parsed.maxAffectedSessions !== undefined && plan.length > parsed.maxAffectedSessions) { refuse("AFFECTED_LIMIT_EXCEEDED"); }
        } catch (error) { return preWriteRefusal(plan, error); }
        return executePlan(plan, options, parsed.expectedBoardToken !== undefined || parsed.maxAffectedSessions !== undefined);
      });
    }
  });

  tools.register({
    id: "boatyard.twicc.reorder_sessions",
    title: "Prioritize TwiCC Kanban sessions",
    description: "Place selected sessions first/last/before/after an anchor in their lane. Rewrites EVERY visible session in that lane. Optional expectedLaneToken and maxAffectedSessions validate a frozen plan inside the local MCP queue. Sequential non-atomic receipts stop at first failure; UI/other TwiCC writers can race. Never automatically replay.",
    inputSchema: reorderSchema,
    readOnly: false,
    destructive: false,
    invoke(input) {
      return mutate(async () => {
        let plan: readonly PlanItem[] = [];
        let options: CommandOptions;
        let parsed: z.infer<typeof reorderSchema>;
        try {
          parsed = reorderSchema.parse(input);
          options = captureOptions();
          let project: string;
          try { project = resolveProject(parsed.projectId); } catch { refuse("INVALID_SCOPE"); }
          const snapshot = await loadTwiccSessionFlowSnapshot(project, parsed.projectId, options);
          if (parsed.expectedLaneToken && parsed.expectedLaneToken !== snapshot.laneTokens[parsed.lane]) { refuse("STALE_LANE"); }
          const laneSessions = snapshot.flow.filter((session) => session.lane === parsed.lane);
          requireSessions(laneSessions, parsed.sessionIds);
          const relative = parsed.position === "before" || parsed.position === "after";
          const anchor = parsed.anchorSessionId;
          if (relative !== Boolean(anchor)) { refuse("INVALID_ANCHOR"); }
          const remaining = laneSessions.map((session) => session.id).filter((id) => !parsed.sessionIds.includes(id));
          if (anchor && !remaining.includes(anchor)) { refuse("INVALID_ANCHOR"); }
          const index = parsed.position === "first" ? 0 : parsed.position === "last" ? remaining.length
            : remaining.indexOf(anchor!) + (parsed.position === "after" ? 1 : 0);
          remaining.splice(index, 0, ...parsed.sessionIds);
          plan = freezePlan(remaining.map((sessionId, order) => ({ sessionId, lane: parsed.lane, order })));
          if (parsed.maxAffectedSessions !== undefined && plan.length > parsed.maxAffectedSessions) { refuse("AFFECTED_LIMIT_EXCEEDED"); }
        } catch (error) { return preWriteRefusal(plan, error); }
        const result = await executePlan(plan, options, true);
        return { lane: parsed.lane, ...result, ...(result.allSucceeded ? { sessionIds: result.plannedSessionIds } : {}) };
      });
    }
  });
}
