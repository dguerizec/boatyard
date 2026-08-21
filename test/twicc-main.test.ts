"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { activate } = require(`${process.cwd()}/build/plugins/twicc/main`);

test("TwiCC main plugin registers its system resource provider", () => {
  const resourceProviders: string[] = [];
  activate({
    actions: { handle() {} },
    execFileAsync: async () => ({ stdout: "[]" }),
    getState: () => ({}),
    projectInspectors: { register() {} },
    resources: {
      registerProvider(id: string) {
        resourceProviders.push(id);
      }
    }
  });

  assert.deepEqual(resourceProviders, ["boatyard.twicc.systemResources"]);
});

test("TwiCC service upgrade and restart actions execute separate commands", async () => {
  const handlers = new Map<string, () => Promise<unknown>>();
  const commands: Array<{ args: string[]; command: string; options: Record<string, unknown> }> = [];
  activate({
    actions: {
      handle(name: string, handler: () => Promise<unknown>) {
        handlers.set(name, handler);
      }
    },
    execFileAsync: async (command: string, args: string[], options: Record<string, unknown>) => {
      commands.push({ args, command, options });
      return { stdout: "" };
    },
    getState: () => ({}),
    projectInspectors: { register() {} },
    resources: { registerProvider() {} }
  });

  await handlers.get("upgradeService")?.();
  assert.deepEqual(commands, [{
    args: ["tool", "upgrade", "twicc"],
    command: "uv",
    options: { timeout: 300000, windowsHide: true }
  }]);

  await handlers.get("restartService")?.();
  assert.deepEqual(commands[1], {
    args: ["--user", "restart", "twicc"],
    command: "systemctl",
    options: { timeout: 30000, windowsHide: true }
  });
});

test("TwiCC restart readiness blocks non-idle sessions and includes hidden processes", async () => {
  const handlers = new Map<string, () => Promise<unknown>>();
  const commands: string[][] = [];
  let processes = [
    { state: "user_turn" },
    { state: "assistant_turn" },
    { state: "awaiting_user_input" },
    { state: "starting" }
  ];
  activate({
    actions: {
      handle(name: string, handler: () => Promise<unknown>) {
        handlers.set(name, handler);
      }
    },
    execFileAsync: async (_command: string, args: string[]) => {
      commands.push(args);
      return { stdout: JSON.stringify(processes) };
    },
    getState: () => ({}),
    projectInspectors: { register() {} },
    resources: { registerProvider() {} }
  });

  assert.deepEqual(await handlers.get("serviceRestartReadiness")?.(), {
    blockingCount: 3,
    processCount: 4,
    ready: false,
    states: {
      assistant_turn: 1,
      awaiting_user_input: 1,
      starting: 1,
      user_turn: 1
    }
  });
  assert.deepEqual(commands[0], [
    "processes",
    "--limit",
    "1000",
    "--offset",
    "0",
    "--include-hidden"
  ]);

  processes = [{ state: "user_turn" }, { state: "user_turn" }];
  assert.deepEqual(await handlers.get("serviceRestartReadiness")?.(), {
    blockingCount: 0,
    processCount: 2,
    ready: true,
    states: { user_turn: 2 }
  });
});

test("TwiCC main resolves session navigation from the cached process snapshot", async () => {
  const handlers = new Map<string, (payload?: Record<string, unknown>) => Promise<unknown>>();
  const commands: string[][] = [];
  activate({
    actions: {
      handle(name: string, handler: (payload?: Record<string, unknown>) => Promise<unknown>) {
        handlers.set(name, handler);
      }
    },
    execFileAsync: async (_command: string, args: string[]) => {
      commands.push(args);
      if (args[0] === "processes") {
        return {
          stdout: JSON.stringify([{
            project_id: "twicc-project",
            session_id: "session-1",
            session_title: "Finished task",
            state: "user_turn"
          }])
        };
      }
      if (args[0] === "projects") {
        return {
          stdout: JSON.stringify([{
            id: "twicc-project",
            directory: "/workspace/example",
            git_root: "/workspace/example"
          }])
        };
      }
      throw new Error(`Unexpected TwiCC command: ${args.join(" ")}`);
    },
    getState: () => ({
      pluginConfig: {
        projects: {
          "boatyard-project": {
            "boatyard.twicc": {
              twiccProjectUrl: "http://localhost:3500/project/twicc-project"
            }
          }
        }
      },
      projects: [{ id: "boatyard-project", sourcePath: "/workspace/example" }]
    }),
    projectInspectors: { register() {} },
    resources: { registerProvider() {} }
  });

  await handlers.get("projectProcessStatuses")?.({});
  const target = await handlers.get("resolveSessionNavigationTarget")?.({
    sessionId: "session-1",
    sourceTwiccProjectId: "twicc-project"
  });

  assert.deepEqual(target, {
    boatyardProjectId: "boatyard-project",
    sessionId: "session-1",
    sourceBoatyardProjectId: "boatyard-project",
    twiccProjectId: "twicc-project",
    url: "http://localhost:3500/project/twicc-project/session/session-1"
  });
  assert.deepEqual(commands.map((args) => args[0]), ["processes", "projects"]);
});

test("TwiCC main resolves session navigation through the session fallback on a cache miss", async () => {
  const handlers = new Map<string, (payload?: Record<string, unknown>) => Promise<unknown>>();
  const commands: string[][] = [];
  activate({
    actions: {
      handle(name: string, handler: (payload?: Record<string, unknown>) => Promise<unknown>) {
        handlers.set(name, handler);
      }
    },
    execFileAsync: async (_command: string, args: string[]) => {
      commands.push(args);
      if (args[0] === "session") {
        return {
          stdout: JSON.stringify({
            id: "session-1",
            project_id: "twicc-project"
          })
        };
      }
      if (args[0] === "projects") {
        return {
          stdout: JSON.stringify([{
            id: "twicc-project",
            directory: "/workspace/example",
            git_root: "/workspace/example"
          }])
        };
      }
      throw new Error(`Unexpected TwiCC command: ${args.join(" ")}`);
    },
    getState: () => ({
      projects: [{ id: "boatyard-project", sourcePath: "/workspace/example" }]
    }),
    projectInspectors: { register() {} },
    resources: { registerProvider() {} }
  });

  const target = await handlers.get("resolveSessionNavigationTarget")?.({
    sessionId: "session-1"
  });

  assert.deepEqual(target, {
    boatyardProjectId: "boatyard-project",
    sessionId: "session-1",
    twiccProjectId: "twicc-project",
    url: "http://localhost:3500/project/twicc-project/session/session-1"
  });
  assert.deepEqual(commands.map((args) => args[0]), ["session", "projects"]);
});

export {};
