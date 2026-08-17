"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseGitWorktrees } = require(`${process.cwd()}/build/main/gitWorktrees`);
const { listProjectGitWorktrees } = require(`${process.cwd()}/build/plugins/git-worktrees/main`);

test("Git worktree parsing preserves usable linked paths and marks stale entries", () => {
  assert.deepEqual(parseGitWorktrees([
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
  ].join("\n")), [
    {
      branch: "main",
      detached: false,
      path: "/workspace/project",
      usable: true
    },
    {
      branch: "feature/review",
      detached: false,
      path: "/workspace/project-worktrees/Feature Review",
      usable: true
    },
    {
      branch: "",
      detached: true,
      path: "/workspace/project-worktrees/stale",
      usable: false
    }
  ]);
});

test("Git worktree inspection marks the project and primary worktrees without Pier", async () => {
  const calls: Array<{ args: string[]; cwd: string; file: string }> = [];
  const execFileAsync = async (file: string, args: string[], options: { cwd: string }) => {
    calls.push({ file, args, cwd: options.cwd });
    if (args[0] === "rev-parse") {
      return { stdout: "/workspace/example-feature\n" };
    }
    return {
      stdout: [
        "worktree /workspace/example",
        "HEAD abc",
        "branch refs/heads/main",
        "",
        "worktree /workspace/example-feature",
        "HEAD def",
        "branch refs/heads/feature/worktrees",
        "",
        "worktree /workspace/example-stale",
        "HEAD 123",
        "detached",
        "prunable gitdir file points to non-existent location",
        ""
      ].join("\n")
    };
  };

  assert.deepEqual(
    await listProjectGitWorktrees("/workspace/example-feature", { execFileAsync }),
    {
      currentPath: "/workspace/example-feature",
      linkedCount: 2,
      worktrees: [
        {
          branch: "main",
          current: false,
          detached: false,
          name: "example",
          path: "/workspace/example",
          primary: true,
          usable: true
        },
        {
          branch: "feature/worktrees",
          current: true,
          detached: false,
          name: "example-feature",
          path: "/workspace/example-feature",
          primary: false,
          usable: true
        },
        {
          branch: "",
          current: false,
          detached: true,
          name: "example-stale",
          path: "/workspace/example-stale",
          primary: false,
          usable: false
        }
      ]
    }
  );
  assert.deepEqual(calls, [
    {
      file: "git",
      args: ["rev-parse", "--show-toplevel"],
      cwd: "/workspace/example-feature"
    },
    {
      file: "git",
      args: ["worktree", "list", "--porcelain"],
      cwd: "/workspace/example-feature"
    }
  ]);
});

test("Git worktree inspection reports a useful Git error", async () => {
  await assert.rejects(
    listProjectGitWorktrees("/workspace/not-a-repository", {
      execFileAsync: async () => {
        throw { stderr: "fatal: not a git repository" };
      }
    }),
    /Could not inspect Git worktrees: fatal: not a git repository/
  );
});

export {};
