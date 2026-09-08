import assert from "node:assert/strict";
import test from "node:test";
import type { PluginToolDefinition } from "../src/shared/pluginTypes.js";
import { registerTwiccTools } from "../src/plugins/twicc/tools.js";
import { migrateTwiccSessionFlowLanes, loadTwiccSessionFlow } from "../src/plugins/twicc/service.js";

type Session = {
  id: string;
  archived?: boolean;
  annotations?: { boatyard?: Record<string, unknown>; [key: string]: unknown };
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
  let failSession = "";
  const tools = new Map<string, PluginToolDefinition>();
  const options = {
    globalConfig: { twiccBaseUrl: "https://twicc.example" },
    async fetch(url: string, init?: Record<string, unknown>) {
      const command = url.split("/rpc/")[1];
      const body = JSON.parse(String(init?.body));
      calls.push({ command, body });
      let result: unknown;
      if (command === "sessions") {
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
      return { ok: true, json: async () => ({ exit_code: 0, result }) };
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
  return { sessions, calls, options, tools, call, fail: (id: string) => { failSession = id; } };
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
  assert.deepEqual(f.calls.map((call) => call.command).sort(), ["processes", "sessions"]);
  assert.equal(f.calls.find((call) => call.command === "sessions")?.body.project, "/workspace/example");
  await assert.rejects(f.call("list_sessions", { projectId: "unknown" }), /Unknown project/);
});

test("Kanban move validates scope before writes and reports partial failures", async () => {
  const f = fixture();
  await assert.rejects(f.call("move_sessions", { sessionIds: ["a", "outside"], lane: "done" }), /not on this project/);
  assert.equal(f.calls.some((call) => call.command.startsWith("update")), false);
  await assert.rejects(f.call("move_sessions", { sessionIds: ["a", "a"], lane: "done" }));
  await assert.rejects(f.call("move_sessions", { sessionIds: ["a"], lane: "testing" }));
  f.fail("b");
  const result = await f.call("move_sessions", { sessionIds: ["a", "b"], lane: "done" });
  assert.equal(result.allSucceeded, false);
  assert.deepEqual((result.results as Array<{ status: string }>).map((row) => row.status), ["updated", "failed"]);
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
    await assert.rejects(f.call("reorder_sessions", { lane: "backlog", sessionIds: ["a"], ...input }));
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
  f.sessions.push(...Array.from({ length: 1000 }, (_, i) => ({ id: `extra-${i}` })));
  const result = await f.call("list_sessions");
  assert.equal(result.total, 1005);
  assert.equal(f.calls.filter((call) => call.command === "sessions").length, 2);
  await assert.rejects(loadTwiccSessionFlow("/workspace/example", {
    fetch: async () => { throw new Error("backend offline"); }
  }), /backend offline/);
});
