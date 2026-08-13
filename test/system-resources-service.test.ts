"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  cleanupStaleTmuxClientSessions,
  collectSystemResources,
  parseProcessMemory
} = require(`${process.cwd()}/build/plugins/system-resources/service`);

test("system resource parser normalizes Linux memory values", () => {
  assert.deepEqual(parseProcessMemory(`
Rss:                2048 kB
Pss:                1536 kB
SwapPss:             128 kB
  `), {
    pssBytes: 1536 * 1024,
    rssBytes: 2048 * 1024,
    swapPssBytes: 128 * 1024
  });
});

test("system snapshot deduplicates WCV, linked tmux panes, and Boatyard process overlap", async () => {
  const identities = [
    { pid: 100, parentPid: 1 },
    { pid: 101, parentPid: 100 },
    { pid: 102, parentPid: 100 },
    { pid: 103, parentPid: 100 },
    { pid: 200, parentPid: 1 },
    { pid: 201, parentPid: 200 },
    { pid: 202, parentPid: 201 },
    { pid: 300, parentPid: 200 }
  ];
  const memory = new Map([
    [100, { pssBytes: 10, rssBytes: 20, swapPssBytes: 0 }],
    [101, { pssBytes: 30, rssBytes: 50, swapPssBytes: 1 }],
    [102, { pssBytes: 5, rssBytes: 10, swapPssBytes: 0 }],
    [103, { pssBytes: 2, rssBytes: 4, swapPssBytes: 0 }],
    [200, { pssBytes: 3, rssBytes: 6, swapPssBytes: 0 }],
    [201, { pssBytes: 7, rssBytes: 12, swapPssBytes: 0 }],
    [202, { pssBytes: 11, rssBytes: 15, swapPssBytes: 0 }],
    [300, { pssBytes: 100, rssBytes: 120, swapPssBytes: 0 }]
  ]);
  const execFileAsync = async (_command: string, args: string[]) => {
    if (args[0] === "list-sessions") {
      return {
        stdout: [
          "boatyard-alpha|boatyard-alpha|1000",
          "boatyard-alpha-client-12345678|boatyard-alpha|1000",
          "boatyard-alpha-client-deadbeef|boatyard-alpha|1000",
          "capture-alpha|capture-alpha|1000"
        ].join("\n")
      };
    }
    if (args[0] === "list-panes") {
      return {
        stdout: [
          "boatyard-alpha|%1|201",
          "boatyard-alpha|%1|201",
          "capture-alpha|%2|300"
        ].join("\n")
      };
    }
    if (args[0] === "list-clients") {
      return { stdout: "boatyard-alpha-client-12345678|103\n" };
    }
    return { stdout: "200\n" };
  };
  const pierBytes = 192 * (1024 ** 2);

  const snapshot = await collectSystemResources({
    collectResourceProviders: async () => [{
      data: { memoryBytes: pierBytes },
      error: "",
      exclusiveMemoryBytes: pierBytes,
      id: "boatyard.pier.systemResources",
      pluginId: "boatyard.pier"
    }],
    execFileAsync,
    now: () => 2_000_000,
    platform: "linux",
    processSource: {
      async list() {
        return identities;
      },
      async readMemory(pid: number) {
        return memory.get(pid) || { pssBytes: 0, rssBytes: 0, swapPssBytes: 0 };
      }
    },
    rootPid: 100,
    state: {
      projects: [{ id: "alpha", name: "Alpha", slug: "alpha", sourcePath: "/workspace/alpha" }]
    },
    webContentsViews: {
      count: 1,
      entries: [{
        key: "pane-1:alpha",
        label: "Alpha dashboard",
        pid: 101,
        projectId: "alpha",
        url: "https://alpha.example.test/dashboard",
        windowId: "window-1"
      }]
    }
  });

  assert.equal(snapshot.boatyard.pssBytes, 47);
  assert.equal(
    snapshot.accounting.note,
    "Web app memory is included in Boatyard. tmux processes already inside Boatyard and shared tmux server memory are excluded from the estimated total."
  );
  assert.equal(snapshot.wcv.count, 1);
  assert.equal(snapshot.wcv.pssBytes, 30);
  assert.deepEqual(snapshot.wcv.entries[0], {
    key: "pane-1:alpha",
    label: "Alpha dashboard",
    pid: 101,
    projectId: "alpha",
    projectName: "Alpha",
    pssBytes: 30,
    rssBytes: 50,
    sharedProcessViews: 1,
    url: "https://alpha.example.test/dashboard",
    windowId: "window-1"
  });
  assert.equal(snapshot.tmux.groupCount, 1);
  assert.equal(snapshot.tmux.sessionCount, 3);
  assert.equal(snapshot.tmux.linkedSessionCount, 2);
  assert.equal(snapshot.tmux.activeClientSessionCount, 1);
  assert.equal(snapshot.tmux.staleSessionCount, 1);
  assert.equal(snapshot.tmux.paneCount, 1);
  assert.equal(snapshot.tmux.pssBytes, 23);
  assert.equal(snapshot.tmux.exclusivePssBytes, 18);
  assert.equal(snapshot.tmux.sharedServerPssBytes, 3);
  assert.equal(snapshot.tmux.groups[0].projectName, "Alpha");
  assert.deepEqual(snapshot.tmux.groups[0].panes, [{
    id: "%1",
    pid: 201,
    processCount: 2,
    pssBytes: 18,
    rssBytes: 27,
    swapPssBytes: 0
  }]);
  assert.deepEqual(
    snapshot.tmux.groups[0].sessions.map((session: { name: string; state: string }) => [session.name, session.state]),
    [
      ["boatyard-alpha", "primary"],
      ["boatyard-alpha-client-12345678", "active"],
      ["boatyard-alpha-client-deadbeef", "stale"]
    ]
  );
  assert.equal(snapshot.tmux.groups[0].pssBytes, 20);
  assert.deepEqual(snapshot.providers, [{
    data: { memoryBytes: pierBytes },
    error: "",
    exclusiveMemoryBytes: pierBytes,
    id: "boatyard.pier.systemResources",
    pluginId: "boatyard.pier"
  }]);
  assert.equal(snapshot.total.estimatedBytes, 47 + 18 + pierBytes);
});

test("tmux cleanup removes only stale managed client sessions", async () => {
  const killedSessions: string[] = [];
  const execFileAsync = async (_command: string, args: string[]) => {
    if (args[0] === "list-sessions") {
      return {
        stdout: [
          "boatyard-alpha|boatyard-alpha|1000",
          "boatyard-alpha-client-active001|boatyard-alpha|1000",
          "boatyard-alpha-client-deadbeef|boatyard-alpha|1000",
          "boatyard-alpha-client-starting|boatyard-alpha|1990",
          "another-alpha-client-deadbeef|another-alpha|1000"
        ].join("\n")
      };
    }
    if (args[0] === "list-clients") {
      return { stdout: "boatyard-alpha-client-active001|501\n" };
    }
    if (args[0] === "kill-session") {
      killedSessions.push(args[2]);
      return { stdout: "" };
    }
    throw new Error(`Unexpected tmux command: ${args.join(" ")}`);
  };

  const report = await cleanupStaleTmuxClientSessions({
    execFileAsync,
    mode: "manual",
    now: () => 2_000_000,
    state: {
      projects: [{ id: "alpha", name: "Alpha", slug: "alpha" }]
    }
  });

  assert.deepEqual(killedSessions, ["boatyard-alpha-client-deadbeef"]);
  assert.deepEqual(report.removedSessionNames, ["boatyard-alpha-client-deadbeef"]);
  assert.deepEqual(report.failed, []);
  assert.equal(report.mode, "manual");
  assert.equal(report.error, "");
});

test("system snapshot degrades cleanly outside Linux", async () => {
  const snapshot = await collectSystemResources({
    execFileAsync: async () => ({ stdout: "" }),
    platform: "darwin"
  });

  assert.equal(snapshot.supported, false);
  assert.match(snapshot.error, /Linux only/);
});

export {};
