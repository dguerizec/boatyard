import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { McpServerService } from "../src/main/mcpServer.js";
import type { ExecFileAsync, PluginToolDefinition } from "../src/shared/pluginTypes.js";
import { registerTwiccTools } from "../src/plugins/twicc/tools.js";
import { migrateTwiccSessionFlowLanes, loadTwiccSessionFlow, updateTwiccSessionFlowLane } from "../src/plugins/twicc/service.js";

type Session = {
  id: string;
  archived?: boolean;
  hidden?: boolean;
  project_id?: string;
  annotations?: { boatyard?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
};

function fixture() {
  const sessions: Session[] = [
    { id: "a", annotations: { boatyard: { sessionFlowLane: "backlog", sessionFlowOrder: 0 } } },
    { id: "b", annotations: { boatyard: { sessionFlowLane: "backlog", sessionFlowOrder: 1 } } },
    { id: "c", annotations: { boatyard: { sessionFlowLane: "backlog", sessionFlowOrder: 2 } } },
    { id: "d", annotations: { boatyard: { sessionFlowLane: "done" } } },
    { id: "inferred" }
  ];
  const calls: Array<{ command: string; body: Record<string, unknown> }> = [];
  for (const session of sessions) { session.project_id = "root"; }
  const projects: Array<Record<string, unknown>> = [{ id: "root", directory: "/workspace/example" }];
  let failSession = "";
  let intercept: ((command: string, body: Record<string, unknown>) => Promise<{
    ok: boolean; status?: number; json(): Promise<unknown>;
  } | void>) | undefined;
  const tools = new Map<string, PluginToolDefinition>();
  const options = {
    globalConfig: { twiccBaseUrl: "https://twicc.example" },
    async fetch(url: string, init?: Record<string, unknown>) {
      const command = url.split("/rpc/")[1];
      const body = JSON.parse(String(init?.body));
      calls.push({ command, body });
      const overridden = await intercept?.(command, body);
      if (overridden) { return overridden; }
      let result: unknown;
      if (command === "projects") {
        result = projects;
      } else if (command === "sessions") {
        result = sessions.slice(Number(body.offset || 0), Number(body.offset || 0) + Number(body.limit));
      } else if (command === "processes") {
        result = [{ session_id: "inferred", state: "awaiting_user_input" }];
      } else if (command === "update-session/annotations") {
        const session = sessions.find((row) => row.id === body.session_id);
        assert.ok(session);
        if (session.id === failSession) {
          return { ok: true, json: async () => ({ exit_code: 0, result: { status: "rejected" } }) };
        }
        session.annotations ||= {};
        session.annotations.boatyard ||= {};
        for (const operation of body.operations as string[]) {
          const match = /^set:boatyard\.([^=]+)=(.*)$/.exec(operation)!;
          session.annotations.boatyard[match[1]] = match[1] === "sessionFlowOrder" ? Number(match[2]) : match[2];
        }
        result = { status: "updated" };
      } else { throw new Error(`Unexpected command ${command}`); }
      return { ok: true, json: async () => ({ exit_code: 0, result: structuredClone(result) }) };
    }
  };
  registerTwiccTools({
    tools: { register: (tool) => { tools.set(tool.id, tool); } },
    getOptions: () => options,
    resolveProject: (id) => {
      if (id !== "project") { throw new Error("Unknown project"); }
      return "/workspace/example";
    }
  });
  async function call(name: string, input: Record<string, unknown> = {}) {
    const tool = tools.get(`boatyard.twicc.${name}`)!;
    return await tool.invoke(tool.inputSchema.parse({ projectId: "project", ...input })) as Record<string, unknown>;
  }
  return { sessions, projects, calls, options, tools, call, fail: (id: string) => { failSession = id; },
    intercept: (handler: NonNullable<typeof intercept>) => { intercept = handler; } };
}

test("Kanban tools list effective lanes and process state without writes", async () => {
  const f = fixture();
  const before = structuredClone(f.sessions);
  const result = await f.call("list_sessions", { lane: "in_progress" });
  assert.deepEqual((result.sessions as Array<{ id: string; processState: string }>).map((s) => [s.id, s.processState]), [
    ["inferred", "awaiting_user_input"]
  ]);
  assert.equal(f.tools.get("boatyard.twicc.list_sessions")?.readOnly, true);
  assert.deepEqual(f.sessions, before);
  assert.deepEqual(f.calls.map((call) => call.command), ["projects", "sessions", "processes", "projects", "sessions", "processes"]);
  assert.equal(f.calls.find((call) => call.command === "sessions")?.body.project, "root");
  await assert.rejects(f.call("list_sessions", { projectId: "unknown" }), /Unknown project/);
});

test("Kanban move validates scope before writes and reports partial failures", async () => {
  const f = fixture();
  assert.equal((await f.call("move_sessions", { sessionIds: ["a", "outside"], lane: "done" })).code, "INVALID_SCOPE");
  assert.equal(f.calls.some((call) => call.command.startsWith("update")), false);
  await assert.rejects(f.call("move_sessions", { sessionIds: ["a", "a"], lane: "done" }));
  await assert.rejects(f.call("move_sessions", { sessionIds: ["a"], lane: "testing" }));
  f.fail("b");
  const result = await f.call("move_sessions", { sessionIds: ["a", "b"], lane: "done" });
  assert.equal(result.allSucceeded, false);
  assert.deepEqual((result.results as Array<{ status: string }>).map((row) => row.status), ["updated", "rejected"]);
  assert.equal(f.sessions[0].annotations?.boatyard?.sessionFlowLane, "done");
  assert.equal(f.calls.some((call) => /archive|stop/.test(call.command)), false);
});

for (const [position, anchorSessionId, expected] of [
  ["first", undefined, ["b", "a", "c"]],
  ["last", undefined, ["a", "c", "b"]],
  ["before", "a", ["b", "a", "c"]],
  ["after", "c", ["a", "c", "b"]]
] as const) {
  test(`Kanban priority persists ${position} placement`, async () => {
    const f = fixture();
    const result = await f.call("reorder_sessions", { lane: "backlog", sessionIds: ["b"], position, anchorSessionId });
    assert.deepEqual(result.sessionIds, expected);
    const refreshed = await f.call("list_sessions", { lane: "backlog" });
    assert.deepEqual((refreshed.sessions as Session[]).map((s) => s.id), expected);
    assert.equal(f.sessions[3].annotations?.boatyard?.sessionFlowOrder, undefined);
  });
}

test("Kanban reorder preserves selected order, rejects bad anchors and stops on partial failure", async () => {
  const f = fixture();
  for (const input of [
    { position: "before" },
    { position: "first", anchorSessionId: "b" },
    { position: "before", anchorSessionId: "a" },
    { position: "after", anchorSessionId: "d" }
  ]) {
    assert.equal((await f.call("reorder_sessions", { lane: "backlog", sessionIds: ["a"], ...input })).code, "INVALID_ANCHOR");
  }
  assert.equal(f.calls.some((call) => call.command.startsWith("update")), false);
  const ordered = await f.call("reorder_sessions", { lane: "backlog", sessionIds: ["c", "a"], position: "first" });
  assert.deepEqual(ordered.sessionIds, ["c", "a", "b"]);
  f.calls.length = 0;
  f.fail("b");
  const result = await f.call("reorder_sessions", { lane: "backlog", sessionIds: ["b"], position: "first" });
  assert.equal(result.allSucceeded, false);
  assert.equal(f.calls.filter((call) => call.command.startsWith("update")).length, 1);
});

test("CLI migration reads pages larger than 1 MiB and migrates sessions on later pages", async () => {
  const execFileAsync = promisify(execFile);
  const offsets: number[] = [];
  const updated: string[] = [];
  const result = await migrateTwiccSessionFlowLanes({
    execFileAsync: (async (_command: string, args: string[], options: Record<string, unknown>) => {
      if (args[0] === "sessions") {
        const offsetIndex = args.indexOf("--offset");
        const offset = offsetIndex < 0 ? 0 : Number(args[offsetIndex + 1]);
        offsets.push(offset);
        if (!offset) {
          return execFileAsync(process.execPath, ["-e", `
            process.stdout.write(JSON.stringify(Array.from({ length: 1000 }, (_, id) => ({
              id: String(id), title: 'x'.repeat(2048)
            }))));
          `], options);
        }
        return { stdout: JSON.stringify([
          { id: "legacy", annotations: { boatyard: { sessionFlowLane: "testing" } } }
        ]) };
      }
      assert.equal(args[0], "update-session");
      assert.ok(args.includes("set:boatyard.sessionFlowLane=done"));
      updated.push(args[1]);
      return { stdout: JSON.stringify({ status: "updated" }) };
    }) as unknown as ExecFileAsync
  });
  assert.deepEqual(offsets, [0, 1000]);
  assert.deepEqual(updated, ["legacy"]);
  assert.equal(result.allSucceeded, true);
});

test("Legacy lane migration is separate, includes archived/hidden and preserves other annotations", async () => {
  const f = fixture();
  f.sessions.push({ id: "legacy", archived: true, annotations: {
    role: "reviewer", boatyard: { sessionFlowLane: "testing", sessionFlowOrder: 19 }
  } });
  const listed = await loadTwiccSessionFlow("/workspace/example", f.options);
  assert.equal(listed.some((s) => s.id === "legacy"), false);
  assert.equal(f.calls.some((call) => call.command.startsWith("update")), false);
  const result = await migrateTwiccSessionFlowLanes(f.options);
  assert.equal(result.allSucceeded, true);
  assert.deepEqual(f.sessions.at(-1)?.annotations, {
    role: "reviewer", boatyard: { sessionFlowLane: "done", sessionFlowOrder: 19 }
  });
  const request = f.calls.find((call) => call.body.include_archived === true);
  assert.equal(request?.body.include_hidden, true);
  assert.equal(request?.body.project, undefined);
  f.calls.length = 0;
  await migrateTwiccSessionFlowLanes(f.options);
  assert.equal(f.calls.some((call) => call.command.startsWith("update")), false);
});

test("Unmigrated legacy Done remains correctly classified and migration failures are reported", async () => {
  const f = fixture();
  f.sessions[0].annotations!.boatyard!.sessionFlowLane = "testing";
  f.fail("a");
  const migration = await migrateTwiccSessionFlowLanes(f.options);
  assert.equal(migration.allSucceeded, false);
  const listed = await f.call("list_sessions", { lane: "done" });
  assert.ok((listed.sessions as Session[]).some((s) => s.id === "a"));
});

test("Board reads paginate beyond 1000 and do not disguise backend errors as empty results", async () => {
  const f = fixture();
  f.sessions.push(...Array.from({ length: 1000 }, (_, i) => ({ id: `extra-${i}`, project_id: "root" })));
  const result = await f.call("list_sessions");
  assert.equal(result.total, 1005);
  assert.equal(f.calls.filter((call) => call.command === "sessions").length, 4);
  await assert.rejects(loadTwiccSessionFlow("/workspace/example", {
    fetch: async () => { throw new Error("backend offline"); }
  }), /backend offline/);
});

type Guard = { mode: string; version: number; atomic: boolean; complete: boolean; boardToken: string; laneToken?: string };
type Receipt = {
  status: string; code?: string; attemptedCount: number; confirmedCount: number; atomic: boolean;
  finalState: string; plannedSessionIds: string[]; allSucceeded: boolean;
  results: Array<{ sessionId: string; status: string; code?: string; lane: string; order?: number }>;
};
const rpcReceipt = (result: unknown, exit_code = 0) => ({ ok: true, json: async () => ({ exit_code, result }) });
async function guard(f: ReturnType<typeof fixture>, lane?: string): Promise<Guard> {
  return (await f.call("list_sessions", lane ? { lane } : {})).guard as Guard;
}
function assertRefusal(result: Record<string, unknown>, code: string) {
  assert.equal(result.status, "rejected");
  assert.equal(result.code, code);
  assert.equal(result.attemptedCount, 0);
  assert.equal(result.confirmedCount, 0);
  assert.equal(result.atomic, false);
  assert.equal(result.finalState, "not_observed");
  assert.equal(result.allSucceeded, false);
}
function writes(f: ReturnType<typeof fixture>) { return f.calls.filter((call) => call.command.startsWith("update")); }

test("Observed tokens preserve list input compatibility, are stable and exclude unrelated metadata", async () => {
  const f = fixture();
  const all = await guard(f);
  const lane = await guard(f, "backlog");
  assert.deepEqual(Object.keys(all).sort(), ["atomic", "boardToken", "complete", "mode", "version"]);
  assert.deepEqual([all.mode, all.version, all.atomic, all.complete], ["observed_snapshot", 1, false, true]);
  assert.match(all.boardToken, /^obs1:[a-f0-9]{64}$/);
  assert.match(lane.laneToken!, /^obs1:[a-f0-9]{64}$/);
  assert.equal(all.boardToken, lane.boardToken);
  f.sessions[0].title = "A new title";
  f.sessions[0].total_cost = 500;
  f.sessions[0].last_updated_at = "2026-10-04T11:00:00Z";
  f.sessions[0].annotations!.unrelated = { draft: "private" };
  assert.deepEqual(await guard(f), all);
  assert.deepEqual(await guard(f, "backlog"), lane);
  assert.equal(writes(f).length, 0);
  const schema = f.tools.get("boatyard.twicc.list_sessions")!.inputSchema;
  assert.deepEqual(schema.parse({ projectId: "project" }), { projectId: "project" });
  assert.throws(() => schema.parse({ projectId: "project", expectedBoardToken: all.boardToken }));
});

test("Raw order changes that preserve displayed order invalidate an observed token", async () => {
  const f = fixture();
  const previous = await guard(f, "backlog");
  f.sessions[0].annotations!.boatyard!.sessionFlowOrder = "0";
  const result = await f.call("reorder_sessions", {
    lane: "backlog", sessionIds: ["b"], position: "first", expectedLaneToken: previous.laneToken, maxAffectedSessions: 20
  });
  assertRefusal(result, "STALE_LANE");
  assert.equal(writes(f).length, 0);
});

test("Ordered membership and shadowed raw annotations affect tokens, other lanes do not affect lane tokens", async () => {
  const f = fixture();
  const before = await guard(f, "backlog");
  f.sessions[3].annotations!.boatyard!.sessionFlowOrder = 8;
  const afterOtherLane = await guard(f, "backlog");
  assert.equal(afterOtherLane.laneToken, before.laneToken);
  assert.notEqual(afterOtherLane.boardToken, before.boardToken);
  f.sessions[0].annotations!["boatyard.sessionFlowOrder"] = 99;
  assert.notEqual((await guard(f, "backlog")).laneToken, before.laneToken);
  delete f.sessions[0].annotations!["boatyard.sessionFlowOrder"];
  f.sessions[1].annotations!.boatyard!.sessionFlowOrder = 0;
  f.sessions[0].annotations!.boatyard!.sessionFlowOrder = 1;
  assert.notEqual((await guard(f, "backlog")).laneToken, before.laneToken);
});

test("Tokens bind the configured instance, Boatyard project and project/worktree scope even for empty worktrees", async () => {
  const f = fixture();
  const previous = await guard(f, "backlog");
  f.options.globalConfig.twiccBaseUrl = "https://another.example";
  assert.notEqual((await guard(f)).boardToken, previous.boardToken);
  f.options.globalConfig.twiccBaseUrl = "https://twicc.example";
  f.projects.push({ id: "empty-worktree", worktree_of: "root" });
  assert.notEqual((await guard(f, "backlog")).laneToken, previous.laneToken);
  f.sessions.push({ id: "child", project_id: "empty-worktree", annotations: { boatyard: { sessionFlowLane: "backlog" } } });
  assert.ok((await f.call("list_sessions")).sessions instanceof Array);
  const otherTools = new Map<string, PluginToolDefinition>();
  registerTwiccTools({ tools: { register: (tool) => { otherTools.set(tool.id, tool); } },
    getOptions: () => f.options, resolveProject: () => "/workspace/example" });
  const other = await otherTools.get("boatyard.twicc.list_sessions")!.invoke({ projectId: "other" }) as { guard: Guard };
  assert.notEqual(other.guard.boardToken, (await guard(f)).boardToken);
});

test("Effective inferred lanes invalidate the snapshot without writing inferred annotations", async () => {
  const f = fixture();
  const previous = await guard(f);
  f.intercept(async (command) => command === "processes" ? rpcReceipt([{ session_id: "inferred", state: "dead" }]) : undefined);
  assertRefusal(await f.call("move_sessions", { sessionIds: ["a"], lane: "done", expectedBoardToken: previous.boardToken }), "STALE_BOARD");
  assert.equal(f.sessions.at(-1)!.annotations, undefined);
  assert.equal(writes(f).length, 0);
});

test("Guard staleness is checked after waiting for a preceding MCP mutation", async () => {
  const f = fixture();
  const previous = await guard(f);
  let notifyEntered!: () => void;
  let allowWrite!: () => void;
  const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
  const release = new Promise<void>((resolve) => { allowWrite = resolve; });
  f.intercept(async (command, body) => {
    if (command === "update-session/annotations" && body.session_id === "a") { notifyEntered(); await release; }
  });
  const first = f.call("move_sessions", { sessionIds: ["a"], lane: "done" });
  await entered;
  const queued = f.call("move_sessions", { sessionIds: ["b"], lane: "done", expectedBoardToken: previous.boardToken, maxAffectedSessions: 20 });
  allowWrite();
  assert.equal((await first).allSucceeded, true);
  assertRefusal(await queued, "STALE_BOARD");
  assert.deepEqual(writes(f).map((call) => call.body.session_id), ["a"]);
});

test("Reorder caps the entire lane before any write even with one selected session", async () => {
  const f = fixture();
  for (let i = 3; i < 21; i++) {
    f.sessions.push({ id: `extra-${i}`, project_id: "root", annotations: { boatyard: { sessionFlowLane: "backlog", sessionFlowOrder: i } } });
  }
  const previous = await guard(f, "backlog");
  const result = await f.call("reorder_sessions", { lane: "backlog", sessionIds: ["a"], position: "last",
    expectedLaneToken: previous.laneToken, maxAffectedSessions: 20 });
  assertRefusal(result, "AFFECTED_LIMIT_EXCEEDED");
  assert.equal((result.plannedSessionIds as string[]).length, 21);
  assert.ok((result.results as Receipt["results"]).every((row) => row.status === "not_attempted"));
  assert.equal(writes(f).length, 0);
  assertRefusal(await f.call("move_sessions", { sessionIds: ["a", "b"], lane: "done", maxAffectedSessions: 1 }), "AFFECTED_LIMIT_EXCEEDED");
  assert.equal(writes(f).length, 0);
});

test("Reorder freezes affected IDs and order before external lane growth during writes", async () => {
  const f = fixture();
  const previous = await guard(f, "backlog");
  let grew = false;
  f.intercept(async (command) => {
    if (command === "update-session/annotations" && !grew) {
      grew = true;
      for (let i = 0; i < 25; i++) {
        f.sessions.push({ id: `external-${i}`, project_id: "root", annotations: { boatyard: { sessionFlowLane: "backlog" } } });
      }
    }
  });
  f.calls.length = 0;
  const result = await f.call("reorder_sessions", { lane: "backlog", sessionIds: ["b"], position: "first",
    expectedLaneToken: previous.laneToken, maxAffectedSessions: 3 }) as Receipt;
  assert.deepEqual(result.plannedSessionIds, ["b", "a", "c"]);
  assert.deepEqual(writes(f).map((call) => call.body.session_id), result.plannedSessionIds);
  assert.deepEqual(result.results.map((row) => row.order), [0, 1, 2]);
  assert.equal(result.attemptedCount, 3);
  assert.equal(result.confirmedCount, 3);
  assert.equal(result.finalState, "not_observed");
  assert.equal(f.calls.filter((call) => call.command === "sessions").length, 2);
  assert.ok(f.sessions.filter((session) => session.id.startsWith("external-")).every((session) => session.annotations?.boatyard?.sessionFlowOrder === undefined));
});

test("Hidden and archived rows are independently excluded and cannot be selected or anchored", async () => {
  const f = fixture();
  f.sessions[0].hidden = true;
  f.sessions[1].archived = true;
  const list = await f.call("list_sessions", { lane: "backlog" });
  assert.deepEqual((list.sessions as Session[]).map((row) => row.id), ["c"]);
  for (const id of ["a", "b", "outside"]) {
    assertRefusal(await f.call("move_sessions", { sessionIds: [id], lane: "done" }), "INVALID_SCOPE");
  }
  assertRefusal(await f.call("reorder_sessions", { lane: "backlog", sessionIds: ["c"], position: "before", anchorSessionId: "a" }), "INVALID_ANCHOR");
  assertRefusal(await f.call("move_sessions", { projectId: "outside", sessionIds: ["c"], lane: "done" }), "INVALID_SCOPE");
  assert.equal(writes(f).length, 0);
});

test("Foreign project rows and ambiguous project references refuse before writes", async () => {
  const f = fixture();
  f.sessions[0].project_id = "foreign";
  assertRefusal(await f.call("move_sessions", { sessionIds: ["b"], lane: "done" }), "INVALID_SCOPE");
  f.sessions[0].project_id = "root";
  f.projects.push({ id: "ambiguous", directory: "/workspace/example" });
  assertRefusal(await f.call("move_sessions", { sessionIds: ["b"], lane: "done" }), "INVALID_SCOPE");
  assert.equal(writes(f).length, 0);
});

test("Guarded moves stop on a definite rejection and include every remaining planned target", async () => {
  const f = fixture();
  const previous = await guard(f);
  f.fail("b");
  const result = await f.call("move_sessions", { sessionIds: ["a", "b", "c"], lane: "done",
    expectedBoardToken: previous.boardToken, maxAffectedSessions: 20 }) as Receipt;
  assert.equal(result.status, "partial");
  assert.equal(result.code, "UPDATE_REJECTED");
  assert.deepEqual(result.plannedSessionIds, ["a", "b", "c"]);
  assert.deepEqual(result.results.map((row) => row.status), ["updated", "rejected", "not_attempted"]);
  assert.equal(result.attemptedCount, 2);
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.atomic, false);
  assert.deepEqual(writes(f).map((call) => call.body.session_id), ["a", "b"]);
  const next = await f.call("move_sessions", { sessionIds: ["c"], lane: "done", maxAffectedSessions: 1 });
  assert.equal(next.allSucceeded, true);
});

for (const response of ["lost_after_commit", "malformed", "server_failed"] as const) {
  test(`Unknown ${response} receipt stops without retries and does not claim no effects`, async () => {
    const f = fixture();
    const previous = await guard(f, "backlog");
    f.intercept(async (command, body) => {
      if (command !== "update-session/annotations" || body.session_id !== "a") { return; }
      if (response === "lost_after_commit") {
        f.sessions[0].annotations!.boatyard!.sessionFlowOrder = 1;
        throw new Error("Private response and credential: must never escape");
      }
      return response === "malformed" ? { ok: true, json: async () => ({ unexpected: true }) }
        : rpcReceipt({ status: "failed" }, 4);
    });
    const result = await f.call("reorder_sessions", { lane: "backlog", sessionIds: ["b"], position: "first",
      expectedLaneToken: previous.laneToken, maxAffectedSessions: 20 }) as Receipt;
    assert.equal(result.code, "UPDATE_UNKNOWN");
    assert.deepEqual(result.results.map((row) => row.status), ["updated", "unknown", "not_attempted"]);
    assert.equal(result.attemptedCount, 2);
    assert.equal(result.confirmedCount, 1);
    assert.equal(result.finalState, "not_observed");
    assert.deepEqual(writes(f).map((call) => call.body.session_id), ["b", "a"]);
    assert.equal(JSON.stringify(result).includes("credential"), false);
    if (response === "lost_after_commit") { assert.equal(f.sessions[0].annotations!.boatyard!.sessionFlowOrder, 1); }
  });
}

test("Submitted noop acknowledgements count as attempted and confirmed", async () => {
  const f = fixture();
  f.intercept(async (command) => command === "update-session/annotations" ? rpcReceipt({ status: "noop" }) : undefined);
  const result = await f.call("move_sessions", { sessionIds: ["a", "b"], lane: "backlog", maxAffectedSessions: 2 }) as Receipt;
  assert.equal(result.status, "completed");
  assert.equal(result.attemptedCount, 2);
  assert.equal(result.confirmedCount, 2);
  assert.equal(result.allSucceeded, true);
  assert.deepEqual(result.results.map((row) => row.status), ["noop", "noop"]);
  assert.equal(writes(f).length, 2);
});

test("Legacy unguarded move continues after rejection with honest per-target receipts", async () => {
  const f = fixture();
  f.fail("b");
  const result = await f.call("move_sessions", { sessionIds: ["a", "b", "c"], lane: "done" }) as Receipt;
  assert.deepEqual(result.results.map((row) => row.status), ["updated", "rejected", "updated"]);
  assert.equal(result.attemptedCount, 3);
  assert.equal(result.confirmedCount, 2);
});

test("Malformed snapshots refuse writes, including duplicates, visibility flags and missing project IDs", async () => {
  for (const malformed of ["duplicate", "visibility", "project"] as const) {
    const f = fixture();
    if (malformed === "duplicate") { f.sessions.push(structuredClone(f.sessions[0])); }
    if (malformed === "visibility") { f.sessions[0].hidden = "false" as unknown as boolean; }
    if (malformed === "project") { delete f.sessions[0].project_id; }
    assertRefusal(await f.call("move_sessions", { sessionIds: ["b"], lane: "done" }), malformed === "project" ? "INVALID_SCOPE" : "INCOMPLETE_SNAPSHOT");
    assert.equal(writes(f).length, 0);
  }
});

test("Snapshot changes between collection passes refuse, with no automatic read retry", async () => {
  const f = fixture();
  let reads = 0;
  f.intercept(async (command) => {
    if (command === "sessions" && ++reads === 2) { f.sessions[0].annotations!.boatyard!.sessionFlowOrder = 9; }
  });
  assertRefusal(await f.call("move_sessions", { sessionIds: ["b"], lane: "done" }), "SNAPSHOT_CHANGED");
  assert.equal(reads, 2);
  assert.equal(writes(f).length, 0);
});

for (const drift of ["duplicate", "total", "truncated"] as const) {
  test(`Incomplete ${drift} pagination refuses before writes`, async () => {
    const f = fixture();
    f.intercept(async (command, body) => {
      if (command !== "sessions") { return; }
      const offset = Number(body.offset || 0);
      return rpcReceipt({ items: [structuredClone(f.sessions[drift === "duplicate" ? 0 : offset])], pagination: {
        limit: 1, offset, total: drift === "total" && offset ? 3 : 2,
        has_more: drift === "truncated" ? false : offset === 0
      } });
    });
    assertRefusal(await f.call("move_sessions", { sessionIds: ["a"], lane: "done" }), "INCOMPLETE_SNAPSHOT");
    assert.equal(writes(f).length, 0);
  });
}

test("Malformed token, duplicate targets and unsafe bounds fail schema validation without reads", async () => {
  const f = fixture();
  for (const input of [
    { sessionIds: ["a", "a"] }, { expectedBoardToken: "obs1:INVALID" },
    { maxAffectedSessions: 0 }, { maxAffectedSessions: 1.5 }, { maxAffectedSessions: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    await assert.rejects(f.call("move_sessions", { sessionIds: ["a"], lane: "done", ...input }));
  }
  assert.equal(f.calls.length, 0);
  const result = await f.tools.get("boatyard.twicc.move_sessions")!.invoke({ projectId: "project", sessionIds: ["a", "a"], lane: "done" }) as Record<string, unknown>;
  assertRefusal(result, "INVALID_INPUT");
});

test("Version 1 token encoding has a stable independent digest definition", async () => {
  const f = fixture();
  const result = await f.call("list_sessions", { lane: "backlog" });
  const snapshot = result.guard as Guard;
  const absent = [false, null, false, null];
  const projection = ["a", "b", "c"].map((id, order) => [id, "root", "backlog", order,
    [[true, "backlog", false, null], [true, order, false, null], absent], null, null]);
  const scope = ["rpc", "https://twicc.example", "project", "/workspace/example", "root", [["root", null]]];
  const encoded = JSON.stringify(["boatyard.twicc.kanban", 1, scope, "backlog", projection]);
  assert.equal(snapshot.laneToken, `obs1:${createHash("sha256").update(encoded).digest("hex")}`);
});

test("Captured connection settings cannot retarget the middle of a write plan", async () => {
  const f = fixture();
  const urls: string[] = [];
  const originalFetch = f.options.fetch;
  f.options.fetch = async (url, init) => { urls.push(url); return originalFetch(url, init); };
  f.intercept(async (command) => {
    if (command === "update-session/annotations") { f.options.globalConfig.twiccBaseUrl = "https://changed.example"; }
  });
  const result = await f.call("move_sessions", { sessionIds: ["a", "b"], lane: "done", maxAffectedSessions: 2 });
  assert.equal(result.allSucceeded, true);
  assert.ok(urls.every((url) => url.startsWith("https://twicc.example/")));
});

test("Nonzero RPC rejection receipts remain definitive while transport errors stay unknown", async () => {
  const f = fixture();
  f.intercept(async (command) => command === "update-session/annotations"
    ? rpcReceipt({ status: "rejected", errors: [{ message: "private backend detail" }] }, 3) : undefined);
  const result = await f.call("move_sessions", { sessionIds: ["a", "b"], lane: "done", maxAffectedSessions: 2 }) as Receipt;
  assert.deepEqual(result.results.map((row) => row.status), ["rejected", "not_attempted"]);
  assert.equal(result.attemptedCount, 1);
  assert.equal(result.confirmedCount, 0);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

for (const status of ["rejected", "validation_error", "failed"] as const) {
  test(`CLI ${status} error classification uses a structured receipt and never retries`, async () => {
    let attempts = 0;
    await assert.rejects(updateTwiccSessionFlowLane("a", "done", {
      execFileAsync: (async () => {
        attempts++;
        throw Object.assign(new Error("private CLI stderr"), {
          code: status === "validation_error" ? 1 : status === "rejected" ? 3 : 4,
          stdout: JSON.stringify({ status })
        });
      }) as unknown as ExecFileAsync
    }), (error: unknown) => {
      assert.equal((error as { mutationRejected?: boolean }).mutationRejected === true, status !== "failed");
      return true;
    });
    assert.equal(attempts, 1);
  });
}

test("Kanban observed guards and refusal receipts round-trip through an isolated MCP HTTP server", async () => {
  const f = fixture();
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const token = "isolated-kanban-mcp-test-token";
  const service = new McpServerService({
    api: {
      listWindows: () => ({ windows: [] }),
      requestPane: async () => { throw new Error("Unrelated pane actions must not run"); },
      capturePane: async () => { throw new Error("Unrelated capture must not run"); },
      listPluginTools: () => [...f.tools.values()],
      invokePluginTool: async (contextId, id, input) => {
        assert.equal(contextId, "context");
        return f.tools.get(id)!.invoke(input);
      }
    },
    getSettings: () => ({ enabled: true, port, token, managedClientTokens: {} }), version: "test"
  });
  try {
    const server = await service.configure();
    assert.equal(server.listening, true);
    let id = 0;
    async function request(method: string, params: Record<string, unknown>) {
      const response = await fetch(server.endpoint, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
          Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      return JSON.parse(body.startsWith("event:") ? body.split("\n").find((line) => line.startsWith("data: "))!.slice(6) : body);
    }
    const listed = await request("tools/list", {});
    const schema = listed.result.tools.find((tool: { name: string }) => tool.name === "boatyard.twicc.move_sessions").inputSchema;
    assert.deepEqual(schema.required, ["projectId", "sessionIds", "lane", "contextId"]);
    assert.equal(schema.properties.expectedBoardToken.pattern, "^obs1:[a-f0-9]{64}$");
    assert.equal(schema.properties.maxAffectedSessions.exclusiveMinimum, 0);
    async function call(name: string, input: Record<string, unknown>) {
      const response = await request("tools/call", { name: `boatyard.twicc.${name}`,
        arguments: { contextId: "context", projectId: "project", ...input } });
      assert.equal(response.result.isError, undefined);
      return JSON.parse(response.result.content[0].text);
    }
    const previous = await call("list_sessions", { lane: "backlog" });
    assert.equal(previous.guard.mode, "observed_snapshot");
    const result = await call("reorder_sessions", { lane: "backlog", sessionIds: ["b"], position: "first",
      expectedLaneToken: previous.guard.laneToken, maxAffectedSessions: 2 });
    assertRefusal(result, "AFFECTED_LIMIT_EXCEEDED");
    assert.deepEqual(result.plannedSessionIds, ["b", "a", "c"]);
    assert.equal(writes(f).length, 0);
  } finally { await service.stop(); }
});
