"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  addSessionRefsToMessages,
  buildHawserProjectUrl,
  createHawserProject,
  findHawserProjectMatchForPath,
  getHawserStatus,
  getMessageSessionTarget,
  getTwiccSessionIdFromRefs,
  isActiveTask,
  isQueuedRemoteMessage,
  isRunningTask,
  normalizeMessage,
  parseHawserProjectList,
  parseHawserProjectName,
  parseHawserSessionName,
  shouldShowWidgetMessage,
  summarizeMessages
} = require(`${process.cwd()}/build/plugins/hawser/service`);

type MockResponseOptions = {
  body?: unknown;
  ok: boolean;
  status: number;
};

type ExecCall = {
  args: string[];
  command: string;
  cwd?: string;
};

function makeResponse({ ok, status, body = {} }: MockResponseOptions) {
  return {
    ok,
    status,
    json: async () => body
  };
}

test("parseHawserProjectName derives the project from the configured main session", () => {
  assert.equal(parseHawserProjectName({
    slug: "fallback",
    hawserMainSession: "boatyard:main"
  }), "boatyard");
  assert.equal(parseHawserProjectName({
    slug: "fallback",
    hawserMainSession: ""
  }), "fallback");
});

test("getHawserStatus reports ready when CLI and service are available", async () => {
  const status = await getHawserStatus({}, {
    execFileAsync: async () => ({ stdout: "hawser 0.1.0\n" }),
    fetchImpl: async () => makeResponse({
      ok: true,
      status: 200,
      body: { ok: true }
    })
  });

  assert.equal(status.state, "ready");
  assert.equal(status.details.cliAvailable, true);
  assert.equal(status.details.cliVersion, "hawser 0.1.0");
  assert.equal(status.details.ok, true);
});

test("getHawserStatus reports unavailable when CLI and service are missing", async () => {
  const missingCli = new Error("spawn hawser ENOENT") as Error & { code?: string };
  missingCli.code = "ENOENT";
  const status = await getHawserStatus({}, {
    execFileAsync: async () => {
      throw missingCli;
    },
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:60082");
    }
  });

  assert.equal(status.state, "unavailable");
  assert.equal(status.summary, "Hawser CLI was not found in PATH.");
  assert.equal(status.details.cliAvailable, false);
});

test("getHawserStatus asks for configuration when service rejects auth", async () => {
  const status = await getHawserStatus({}, {
    execFileAsync: async () => ({ stdout: "hawser 0.1.0\n" }),
    fetchImpl: async () => makeResponse({
      ok: false,
      status: 401
    })
  });

  assert.equal(status.state, "notConfigured");
  assert.equal(status.summary, "Hawser service is running. Configure the API token.");
  assert.equal(status.details.cliAvailable, true);
});

test("parseHawserProjectList reads registered projects", () => {
  const projects = parseHawserProjectList(`
boatyard                 -                /workspace/boatyard
boatyard.dev-web         web              /workspace/boatyard.dev-web
  `);

  assert.deepEqual(projects, [
    {
      name: "boatyard",
      workspace: "",
      path: "/workspace/boatyard"
    },
    {
      name: "boatyard.dev-web",
      workspace: "web",
      path: "/workspace/boatyard.dev-web"
    }
  ]);
  assert.equal(
    findHawserProjectMatchForPath(projects, "/workspace/boatyard.dev-web")?.project.name,
    "boatyard.dev-web"
  );
});

test("createHawserProject registers source path with runtime", async () => {
  const calls: ExecCall[] = [];
  const result = await createHawserProject("/workspace/app", "claude", {
    execFileAsync: async (command: string, args: string[], options: { cwd?: string } = {}) => {
      calls.push({ command, args, cwd: (options as { cwd?: string }).cwd });
      if (args[0] === "list") {
        return { stdout: "app - /workspace/app\n" };
      }

      return { stdout: "" };
    }
  });

  assert.deepEqual(calls[0], {
    command: "hawser",
    args: ["init", "--here", "--runtime", "claude"],
    cwd: "/workspace/app"
  });
  assert.deepEqual(calls[1], {
    command: "hawser",
    args: ["list"],
    cwd: undefined
  });
  assert.equal(result.name, "app");
  assert.equal(result.url, buildHawserProjectUrl("app"));
});

test("parseHawserSessionName derives the session from the configured main session", () => {
  assert.equal(parseHawserSessionName({
    hawserMainSession: "boatyard:main"
  }), "main");
  assert.equal(parseHawserSessionName({
    hawserMainSession: "boatyard:feature:one"
  }), "feature:one");
  assert.equal(parseHawserSessionName({
    hawserMainSession: "boatyard"
  }), "");
});

test("summarizeMessages counts inbox and active Hawser tasks", () => {
  assert.deepEqual(summarizeMessages([
    {
      direction: "in",
      kind: "reply",
      status: "unread"
    },
    {
      direction: "in",
      kind: "task",
      status: "processing"
    },
    {
      direction: "out",
      kind: "task",
      status: "unread"
    },
    {
      direction: "out",
      kind: "reply",
      status: "done"
    }
  ]), {
    unread: 1,
    queued: 1,
    processing: 1,
    activeTasks: 2
  });
});

test("message state predicates distinguish remote queued, running, and history messages", () => {
  assert.equal(isQueuedRemoteMessage({
    direction: "out",
    kind: "task",
    status: "unread"
  }), true);
  assert.equal(isQueuedRemoteMessage({
    direction: "in",
    kind: "reply",
    status: "unread"
  }), false);
  assert.equal(isRunningTask({
    kind: "task",
    status: "processing"
  }), true);
  assert.equal(isActiveTask({
    kind: "task",
    status: "processing",
    twiccSessionId: "019e8578-4195-7553-9d18-1e01bf765656"
  }), true);
  assert.equal(isQueuedRemoteMessage({
    direction: "out",
    kind: "task",
    status: "done",
    twiccSessionId: "019e8578-4195-7553-9d18-1e01bf765656"
  }), false);
  assert.equal(isRunningTask({
    kind: "task",
    status: "done",
    twiccSessionId: "019e8578-4195-7553-9d18-1e01bf765656"
  }), false);
  assert.equal(isActiveTask({
    kind: "task",
    status: "done",
    twiccSessionId: "019e8578-4195-7553-9d18-1e01bf765656"
  }), false);
});

test("normalizeMessage extracts the Twicc session id from Hawser envelopes", () => {
  assert.equal(normalizeMessage({
    id: "message-1",
    body: JSON.stringify({
      twicc_session_id: "019e9d00-6985-7ce0-b903-ba343e968483",
      codex_session_id: "019e8578-4195-7553-9d18-1e01bf765656",
      runtime_session_id: "7e521d86-db79-4112-b498-8e99ce969c5c",
      content: "Done."
    }),
    from_project: "hawser",
    to_project: "boatyard"
  }, "boatyard").twiccSessionId, "019e9d00-6985-7ce0-b903-ba343e968483");
});

test("getMessageSessionTarget resolves sent and received Hawser session endpoints", () => {
  assert.deepEqual(getMessageSessionTarget({
    direction: "out",
    fromProject: "boatyard",
    fromSession: "",
    toProject: "twicc",
    toSession: "main"
  }), {
    project: "twicc",
    session: "main"
  });
  assert.deepEqual(getMessageSessionTarget({
    direction: "in",
    fromProject: "hawser",
    fromSession: "test",
    toProject: "boatyard",
    toSession: ""
  }), {
    project: "hawser",
    session: "test"
  });
});

test("getTwiccSessionIdFromRefs finds typed Hawser external refs", () => {
  assert.equal(getTwiccSessionIdFromRefs([
    {
      kind: "log-file",
      id: "/tmp/session.log"
    },
    {
      kind: "twicc-session",
      id: "019e9d00-6985-7ce0-b903-ba343e968483"
    }
  ]), "019e9d00-6985-7ce0-b903-ba343e968483");
});

test("addSessionRefsToMessages enriches sent tasks before replies arrive", async () => {
  const messages = await addSessionRefsToMessages([
    {
      direction: "out",
      status: "processing",
      toProject: "twicc",
      toSession: "main",
      twiccSessionId: ""
    }
  ], {}, async (project: string, session: string) => {
    assert.equal(project, "twicc");
    assert.equal(session, "main");
    return [
      {
        kind: "twicc-session",
        id: "019e9d00-6985-7ce0-b903-ba343e968483"
      }
    ];
  });

  assert.equal(messages[0].twiccSessionId, "019e9d00-6985-7ce0-b903-ba343e968483");
});

test("shouldShowWidgetMessage keeps read messages with Twicc sessions", () => {
  assert.equal(shouldShowWidgetMessage({
    kind: "reply",
    status: "done",
    twiccSessionId: "019e8578-4195-7553-9d18-1e01bf765656"
  }), true);
  assert.equal(shouldShowWidgetMessage({
    kind: "reply",
    status: "done",
    twiccSessionId: ""
  }), false);
});

export {};
