"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { activate } = require(`${process.cwd()}/build/plugins/system-resources/main`);

test("system resources cleans stale tmux client sessions automatically and on demand", async () => {
  const actions = new Map<string, (payload?: unknown) => Promise<unknown>>();
  const sessions = new Set([
    "boatyard-alpha",
    "boatyard-alpha-client-automatic"
  ]);
  const killedSessions: string[] = [];
  const execFileAsync = async (_command: string, args: string[]) => {
    if (args[0] === "list-sessions") {
      return {
        stdout: [...sessions].map((session) => (
          `${session}|boatyard-alpha|1000`
        )).join("\n")
      };
    }
    if (args[0] === "list-clients") {
      return { stdout: "" };
    }
    if (args[0] === "kill-session") {
      killedSessions.push(args[2]);
      sessions.delete(args[2]);
      return { stdout: "" };
    }
    throw new Error(`Unexpected tmux command: ${args.join(" ")}`);
  };

  activate({
    actions: {
      handle(name: string, handler: (payload?: unknown) => Promise<unknown>) {
        actions.set(name, handler);
      }
    },
    execFileAsync,
    getState: () => ({
      projects: [{ id: "alpha", name: "Alpha", slug: "alpha" }]
    }),
    plugin: { id: "boatyard.systemResources" },
    resources: {
      collectProviderSnapshots: async () => [],
      listWebContentsViews: () => []
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(killedSessions, ["boatyard-alpha-client-automatic"]);

  sessions.add("boatyard-alpha-client-manual01");
  const manualCleanup = actions.get("cleanupStaleTmuxSessions");
  if (!manualCleanup) {
    throw new Error("Manual tmux cleanup action was not registered.");
  }
  const report = await manualCleanup() as { mode: string; removedSessionNames: string[] };

  assert.equal(report.mode, "manual");
  assert.deepEqual(report.removedSessionNames, ["boatyard-alpha-client-manual01"]);
  assert.deepEqual(killedSessions, [
    "boatyard-alpha-client-automatic",
    "boatyard-alpha-client-manual01"
  ]);
});

export {};
