"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  collectTwiccResourceProvider,
  collectTwiccResourceSnapshot,
  getConfiguredTwiccPort,
  isLocalTwiccUrl
} = require(`${process.cwd()}/build/plugins/twicc/resources`);

test("TwiCC resource URL classification accepts only local instances", () => {
  assert.equal(isLocalTwiccUrl(""), true);
  assert.equal(isLocalTwiccUrl("http://localhost:3500"), true);
  assert.equal(isLocalTwiccUrl("http://127.0.0.1:3500"), true);
  assert.equal(isLocalTwiccUrl("http://[::1]:3500"), true);
  assert.equal(isLocalTwiccUrl("https://twicc.example"), false);
  assert.equal(isLocalTwiccUrl("not a URL"), false);
  assert.equal(getConfiguredTwiccPort("http://localhost:3500"), 3500);
  assert.equal(getConfiguredTwiccPort("https://localhost"), 443);
});

test("TwiCC resources attribute each process to the nearest active session", async () => {
  const identities = [
    { pid: 100, parentPid: 1 },
    { pid: 101, parentPid: 100 },
    { pid: 200, parentPid: 100 },
    { pid: 201, parentPid: 200 },
    { pid: 202, parentPid: 200 },
    { pid: 203, parentPid: 202 },
    { pid: 300, parentPid: 100 },
    { pid: 400, parentPid: 1 }
  ];
  const memory = new Map([
    [100, { pssBytes: 10, rssBytes: 20, swapPssBytes: 0 }],
    [101, { pssBytes: 5, rssBytes: 10, swapPssBytes: 0 }],
    [200, { pssBytes: 20, rssBytes: 30, swapPssBytes: 0 }],
    [201, { pssBytes: 30, rssBytes: 40, swapPssBytes: 1 }],
    [202, { pssBytes: 40, rssBytes: 50, swapPssBytes: 0 }],
    [203, { pssBytes: 50, rssBytes: 60, swapPssBytes: 2 }],
    [300, { pssBytes: 60, rssBytes: 70, swapPssBytes: 0 }],
    [400, { pssBytes: 1000, rssBytes: 1000, swapPssBytes: 0 }]
  ]);
  const options = {
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, ["status"]);
      return { stdout: JSON.stringify({ status: "running", pid: 100, port: 3500 }) };
    },
    loadProcesses: async () => [
      {
        pid: 200,
        project_id: "alpha",
        provider: "codex",
        session_id: "session-a",
        session_title: "Alpha parent",
        state: "assistant_turn"
      },
      {
        pid: 202,
        project_id: "beta",
        provider: "claude_code",
        session_id: "session-b",
        session_title: "Nested child",
        state: "awaiting_user_input"
      },
      {
        pid: 300,
        project_id: "alpha",
        provider: "codex",
        session_id: "session-c",
        session_title: "Alpha sibling",
        state: "user_turn"
      }
    ],
    loadProjects: async () => [
      { id: "alpha", name: "Alpha", directory: "/workspace/alpha" },
      { id: "beta", name: "Beta", directory: "/workspace/beta" }
    ],
    platform: "linux",
    processSource: {
      async list() {
        return identities;
      },
      async readMemory(pid: number) {
        return memory.get(pid) || { pssBytes: 0, rssBytes: 0, swapPssBytes: 0 };
      }
    }
  };

  const snapshot = await collectTwiccResourceSnapshot(options);

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.serviceControlAvailable, true);
  assert.equal(snapshot.processCount, 7);
  assert.equal(snapshot.sessionCount, 3);
  assert.equal(snapshot.pssBytes, 215);
  assert.equal(snapshot.rssBytes, 280);
  assert.deepEqual(snapshot.backend, {
    pid: 100,
    processCount: 2,
    pssBytes: 15,
    rssBytes: 30,
    swapPssBytes: 0
  });
  assert.deepEqual(
    snapshot.projects.map((project: { projectName: string; pssBytes: number }) => [project.projectName, project.pssBytes]),
    [["Alpha", 110], ["Beta", 90]]
  );
  const alphaSessions = snapshot.projects[0].sessions;
  assert.deepEqual(
    alphaSessions.map((session: { sessionId: string; processCount: number; pssBytes: number }) => (
      [session.sessionId, session.processCount, session.pssBytes]
    )),
    [["session-c", 1, 60], ["session-a", 2, 50]]
  );
  assert.deepEqual(
    snapshot.projects[1].sessions.map((session: { sessionId: string; processCount: number; pssBytes: number }) => (
      [session.sessionId, session.processCount, session.pssBytes]
    )),
    [["session-b", 2, 90]]
  );

  const provider = await collectTwiccResourceProvider(options);
  assert.equal(provider.exclusiveMemoryBytes, 0);
  assert.equal((provider.data as { pssBytes: number }).pssBytes, 215);
});

test("TwiCC resources explain why remote process memory is unavailable", async () => {
  let commandCalled = false;
  const snapshot = await collectTwiccResourceSnapshot({
    execFileAsync: async () => {
      commandCalled = true;
      return { stdout: "" };
    },
    platform: "linux",
    state: {
      pluginConfig: {
        global: {
          "boatyard.twicc": { twiccBaseUrl: "https://twicc.example" }
        }
      }
    }
  });

  assert.equal(commandCalled, false);
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.serviceControlAvailable, false);
  assert.match(snapshot.error, /remote TwiCC instance/);
  assert.equal(snapshot.pssBytes, 0);
});

test("TwiCC resources keep local service controls available while the backend is stopped", async () => {
  const snapshot = await collectTwiccResourceSnapshot({
    execFileAsync: async () => ({
      stdout: JSON.stringify({ status: "stopped", pid: 0, port: 3500 })
    }),
    platform: "linux"
  });

  assert.equal(snapshot.available, false);
  assert.equal(snapshot.serviceControlAvailable, true);
  assert.match(snapshot.error, /not running/);
});

test("TwiCC resources reject a different local backend", async () => {
  const snapshot = await collectTwiccResourceSnapshot({
    execFileAsync: async () => ({
      stdout: JSON.stringify({ status: "running", pid: 100, port: 3500 })
    }),
    platform: "linux",
    state: {
      pluginConfig: {
        global: {
          "boatyard.twicc": { twiccBaseUrl: "http://localhost:4500" }
        }
      }
    }
  });

  assert.equal(snapshot.available, false);
  assert.equal(snapshot.serviceControlAvailable, true);
  assert.match(snapshot.error, /does not match/);
});

export {};
