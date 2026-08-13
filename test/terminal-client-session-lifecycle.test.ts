"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  cleanupOrphanedTerminalClientSessions,
  getTerminalClientSessionCreationArgs
} = require(`${process.cwd()}/build/main/terminalClientSessionLifecycle`);

test("terminal client sessions record their owning Boatyard process", () => {
  assert.deepEqual(
    getTerminalClientSessionCreationArgs("boatyard-alpha", "boatyard-alpha-client-12345678", 4321),
    [
      "new-session",
      "-d",
      "-t",
      "boatyard-alpha",
      "-s",
      "boatyard-alpha-client-12345678",
      "-e",
      "BOATYARD_CLIENT_OWNER_PID=4321"
    ]
  );
});

test("startup recovery removes only orphaned terminal client sessions", async () => {
  const killedSessions: string[] = [];
  const commands: string[][] = [];
  const execFileAsync = async (_command: string, args: string[]) => {
    commands.push(args);
    if (args[0] === "list-sessions") {
      return {
        stdout: [
          "boatyard-alpha|boatyard-alpha|",
          "boatyard-alpha-client-dead0001|boatyard-alpha|111",
          "boatyard-alpha-client-live0001|boatyard-alpha|222",
          "boatyard-alpha-client-active01|boatyard-alpha|333",
          "boatyard-alpha-client-legacy01|boatyard-alpha|",
          "boatyard-alpha-linked-session|boatyard-alpha|",
          "another-alpha-client-dead0001|another-alpha|111"
        ].join("\n")
      };
    }
    if (args[0] === "list-clients") {
      return { stdout: "boatyard-alpha-client-active01\n" };
    }
    if (args[0] === "kill-session") {
      killedSessions.push(args[2]);
      return { stdout: "" };
    }
    throw new Error(`Unexpected tmux command: ${args.join(" ")}`);
  };

  const report = await cleanupOrphanedTerminalClientSessions({
    execFileAsync,
    isProcessAlive: (pid: number) => pid === 222,
    sessionPrefix: "boatyard"
  });

  assert.match(commands[0][2], /#\{E:BOATYARD_CLIENT_OWNER_PID\}/);
  assert.deepEqual(killedSessions, [
    "boatyard-alpha-client-dead0001",
    "boatyard-alpha-client-legacy01"
  ]);
  assert.deepEqual(report, {
    error: "",
    failed: [],
    removedSessionNames: killedSessions
  });
});

test("startup recovery tolerates an absent tmux server", async () => {
  const report = await cleanupOrphanedTerminalClientSessions({
    execFileAsync: async () => {
      const error = new Error("failed to connect to server");
      throw error;
    }
  });

  assert.deepEqual(report, { error: "", failed: [], removedSessionNames: [] });
});

export {};
