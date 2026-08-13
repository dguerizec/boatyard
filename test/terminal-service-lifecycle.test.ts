"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("terminal detach waits for its owned tmux session to be destroyed", async () => {
  const childProcess = require("node:child_process");
  const pty = require("node-pty");
  const { promisify } = require("node:util");
  const originalExecFile = childProcess.execFile;
  const originalSpawn = pty.spawn;
  const commands: string[][] = [];
  let finishKillSession: () => void = () => {
    throw new Error("tmux kill-session did not start.");
  };
  let exitHandler: ((event: { exitCode: number }) => void) | null = null;

  const execFileMock = (() => {}) as (() => void) & Record<PropertyKey, unknown>;
  execFileMock[promisify.custom] = async (_command: string, args: string[]) => {
    commands.push(args);
    if (args[0] === "list-windows") {
      return { stdout: "%0\t0\tmain\t/workspace\n", stderr: "" };
    }
    if (args[0] === "list-clients") {
      return { stdout: "/dev/pts/test\n", stderr: "" };
    }
    if (args[0] === "kill-session") {
      return new Promise((resolve) => {
        finishKillSession = () => resolve({ stdout: "", stderr: "" });
      });
    }
    return { stdout: "", stderr: "" };
  };
  childProcess.execFile = execFileMock;
  pty.spawn = () => ({
    cols: 100,
    rows: 30,
    kill() {
      exitHandler?.({ exitCode: 0 });
    },
    onData() {},
    onExit(handler: (event: { exitCode: number }) => void) {
      exitHandler = handler;
    },
    resize() {},
    write() {}
  });

  try {
    const { TerminalService } = require(`${process.cwd()}/build/main/terminalService`);
    const service = new TerminalService({
      getProject: () => ({ id: "alpha", name: "Alpha", slug: "alpha", sourcePath: "/workspace" }),
      sendToRenderer: () => {}
    });
    const attachment = await service.attach("alpha", "%0", { cols: 100, rows: 30 });
    const ownerCommand = commands.find((args) => args.some((arg) => arg.startsWith("BOATYARD_CLIENT_OWNER_PID=")));

    assert.ok(ownerCommand);
    assert.equal(ownerCommand?.[5], `boatyard-alpha-client-${attachment.terminalId.slice(0, 8)}`);
    assert.equal(ownerCommand?.[7], `BOATYARD_CLIENT_OWNER_PID=${process.pid}`);

    let detached = false;
    const detachPromise = service.detach(attachment.terminalId).then(() => {
      detached = true;
    });
    await Promise.resolve();

    assert.equal(detached, false);
    finishKillSession();
    await detachPromise;

    assert.equal(detached, true);
    assert.equal(commands.filter((args) => args[0] === "kill-session").length, 1);
  } finally {
    childProcess.execFile = originalExecFile;
    pty.spawn = originalSpawn;
  }
});

export {};
