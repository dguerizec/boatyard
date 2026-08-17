"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("terminal worktree tabs use a Git-listed directory and its worktree name", async () => {
  const childProcess = require("node:child_process");
  const { promisify } = require("node:util");
  const originalExecFile = childProcess.execFile;
  const commands: Array<{ args: string[]; command: string; cwd?: string }> = [];
  const worktreeOutput = [
    "worktree /workspace/project",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree /workspace/project-worktrees/Feature Review",
    "HEAD def",
    "branch refs/heads/feature/review",
    "",
    "worktree /workspace/project-worktrees/stale",
    "HEAD 123",
    "detached",
    "prunable gitdir file points to non-existent location",
    ""
  ].join("\n");

  const execFileMock = (() => {}) as (() => void) & Record<PropertyKey, unknown>;
  execFileMock[promisify.custom] = async (
    command: string,
    args: string[],
    options: { cwd?: string } = {}
  ) => {
    commands.push({ command, args, cwd: options.cwd });
    if (command === "git") {
      assert.deepEqual(args, ["worktree", "list", "--porcelain"]);
      return { stdout: worktreeOutput, stderr: "" };
    }
    if (args[0] === "list-windows") {
      return { stdout: "%0\t0\tmain\t/workspace/project\n", stderr: "" };
    }
    if (args[0] === "new-window") {
      return {
        stdout: "%1\t1\tFeature Review\t/workspace/project-worktrees/Feature Review\n",
        stderr: ""
      };
    }
    return { stdout: "", stderr: "" };
  };
  childProcess.execFile = execFileMock;

  try {
    const { TerminalService } = require(`${process.cwd()}/build/main/terminalService`);
    const service = new TerminalService({
      getProject: () => ({
        id: "project",
        name: "Project",
        slug: "project",
        sourcePath: "/workspace/project"
      }),
      sendToRenderer: () => {}
    });

    assert.deepEqual(await service.listWorktrees("project"), [
      {
        branch: "main",
        detached: false,
        name: "project",
        path: "/workspace/project"
      },
      {
        branch: "feature/review",
        detached: false,
        name: "Feature Review",
        path: "/workspace/project-worktrees/Feature Review"
      }
    ]);

    assert.deepEqual(
      await service.createWorktreeTab("project", "/workspace/project-worktrees/Feature Review"),
      {
        id: "%1",
        index: 1,
        name: "Feature Review",
        cwd: "/workspace/project-worktrees/Feature Review"
      }
    );
    const creation = commands.find(({ command, args }) => command === "tmux" && args[0] === "new-window");
    assert.ok(creation);
    assert.equal(creation?.args[creation.args.indexOf("-n") + 1], "Feature Review");
    assert.equal(creation?.args[creation.args.indexOf("-c") + 1], "/workspace/project-worktrees/Feature Review");

    await assert.rejects(
      service.createWorktreeTab("project", "/workspace/unrelated"),
      /no longer available for this project/
    );
    assert.equal(commands.filter(({ args }) => args[0] === "new-window").length, 1);
  } finally {
    childProcess.execFile = originalExecFile;
  }
});

export {};
