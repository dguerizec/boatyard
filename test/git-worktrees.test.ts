"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseGitWorktrees } = require(`${process.cwd()}/build/main/gitWorktrees`);

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

export {};
