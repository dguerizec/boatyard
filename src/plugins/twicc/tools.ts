import { z } from "zod";
import type { PluginTools } from "../../shared/pluginTypes.js";
import {
  loadTwiccSessionFlow,
  updateTwiccSessionFlowLane,
  updateTwiccSessionFlowPosition
} from "./service.js";

type CommandOptions = NonNullable<Parameters<typeof loadTwiccSessionFlow>[1]>;
type ToolContext = {
  tools: PluginTools;
  getOptions(): CommandOptions;
  resolveProject(projectId: string): string;
};

const laneSchema = z.enum(["in_progress", "backlog", "done"]);
const projectSchema = z.string().trim().min(1).describe("Boatyard project ID returned by list_windows");
const sessionIdsSchema = z.array(z.string().trim().min(1)).min(1).max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Session IDs must be unique");

type Flow = Awaited<ReturnType<typeof loadTwiccSessionFlow>>;

function requireSessions(flow: Flow, ids: string[]): void {
  for (const id of ids) {
    if (!flow.some((session) => session.id === id)) {
      throw new Error(`Session is not on this project's visible, unarchived board: ${id}`);
    }
  }
}

export function registerTwiccTools({ tools, getOptions, resolveProject }: ToolContext): void {
  // Serialize MCP mutations in this configuration so their read/modify/write
  // sequences cannot interleave. TwiCC annotation writes are not transactional.
  let mutationQueue: Promise<unknown> = Promise.resolve();
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation);
    mutationQueue = result.catch(() => {});
    return result;
  }

  tools.register({
    id: "boatyard.twicc.list_sessions",
    title: "List TwiCC Kanban sessions",
    description: "Read a project's visible, unarchived sessions in Kanban order, optionally filtered by lane. Lane and processState are independent. This operation never writes annotations. Use list_windows to discover contextId and projectId.",
    inputSchema: z.object({ projectId: projectSchema, lane: laneSchema.optional() }).strict(),
    readOnly: true,
    async invoke(input) {
      const flow = await loadTwiccSessionFlow(resolveProject(String(input.projectId)), getOptions());
      const sessions = flow.filter((session) => !input.lane || session.lane === input.lane);
      return { sessions, total: sessions.length };
    }
  });

  tools.register({
    id: "boatyard.twicc.move_sessions",
    title: "Move TwiCC Kanban sessions",
    description: "Move explicit sessions from this project's board to in_progress, backlog or done. Does not archive or stop agents. Returns success or failure for each session. Use reorder_sessions to set visual priority.",
    inputSchema: z.object({ projectId: projectSchema, sessionIds: sessionIdsSchema, lane: laneSchema }).strict(),
    readOnly: false,
    destructive: false,
    invoke(input) {
      return mutate(async () => {
        const options = getOptions();
        const lane = laneSchema.parse(input.lane);
        const ids = sessionIdsSchema.parse(input.sessionIds);
        const flow = await loadTwiccSessionFlow(resolveProject(String(input.projectId)), options);
        requireSessions(flow, ids);
        const results = [];
        for (const sessionId of ids) {
          try {
            await updateTwiccSessionFlowLane(sessionId, lane, options);
            results.push({ sessionId, status: "updated", lane });
          } catch (error) {
            results.push({ sessionId, status: "failed", error: error instanceof Error ? error.message : String(error) });
          }
        }
        return { results, allSucceeded: results.every((result) => result.status === "updated") };
      });
    }
  });

  tools.register({
    id: "boatyard.twicc.reorder_sessions",
    title: "Prioritize TwiCC Kanban sessions",
    description: "Place sessions in input order at first, last, before or after an anchor in one lane. Selected sessions must already belong to that lane. Persists visual priority without changing agent activity. Writes are sequential, not atomic: on failure, returns completed writes and the failed session; re-list before retrying.",
    inputSchema: z.object({
      projectId: projectSchema,
      lane: laneSchema,
      sessionIds: sessionIdsSchema,
      position: z.enum(["first", "last", "before", "after"]),
      anchorSessionId: z.string().trim().min(1).optional()
    }).strict(),
    readOnly: false,
    destructive: false,
    invoke(input) {
      return mutate(async () => {
        const options = getOptions();
        const lane = laneSchema.parse(input.lane);
        const ids = sessionIdsSchema.parse(input.sessionIds);
        const flow = await loadTwiccSessionFlow(resolveProject(String(input.projectId)), options);
        const laneSessions = flow.filter((session) => session.lane === lane);
        requireSessions(laneSessions, ids);
        const relative = input.position === "before" || input.position === "after";
        const anchor = input.anchorSessionId as string | undefined;
        if (relative !== Boolean(anchor)) {
          throw new Error("anchorSessionId is required only for before/after positions.");
        }
        const remaining = laneSessions.map((session) => session.id).filter((id) => !ids.includes(id));
        if (anchor && !remaining.includes(anchor)) {
          throw new Error("The anchor must be another session in the same lane.");
        }
        const index = input.position === "first" ? 0
          : input.position === "last" ? remaining.length
            : remaining.indexOf(anchor!) + (input.position === "after" ? 1 : 0);
        remaining.splice(index, 0, ...ids);
        const results = [];
        for (const [order, sessionId] of remaining.entries()) {
          try {
            await updateTwiccSessionFlowPosition(sessionId, lane, order, options);
            results.push({ sessionId, status: "updated", order });
          } catch (error) {
            results.push({ sessionId, status: "failed", error: error instanceof Error ? error.message : String(error) });
            return { lane, results, allSucceeded: false };
          }
        }
        return { lane, sessionIds: remaining, results, allSucceeded: true };
      });
    }
  });
}
