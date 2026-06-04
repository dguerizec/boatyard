"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildTwiccProjectUrl,
  findTwiccProjectForPath,
  loadTwiccProjects
} = require("../src/main/twiccService");

test("findTwiccProjectForPath matches exact directories first", () => {
  const projects = [
    {
      id: "parent",
      directory: "/workspace/project",
      git_root: "/workspace/project"
    },
    {
      id: "worktree",
      directory: "/workspace/project/worktrees/feature",
      git_root: "/workspace/project/worktrees/feature"
    }
  ];

  assert.equal(findTwiccProjectForPath(projects, "/workspace/project")?.id, "parent");
  assert.equal(findTwiccProjectForPath(projects, "/workspace/project/worktrees/feature")?.id, "worktree");
});

test("findTwiccProjectForPath falls back to the deepest parent path", () => {
  const projects = [
    {
      id: "parent",
      directory: "/workspace/project",
      git_root: "/workspace/project"
    },
    {
      id: "nested",
      directory: "/workspace/project/packages/app",
      git_root: "/workspace/project/packages/app"
    }
  ];

  assert.equal(findTwiccProjectForPath(projects, "/workspace/project/packages/app/src")?.id, "nested");
});

test("buildTwiccProjectUrl points to the project route", () => {
  assert.equal(
    buildTwiccProjectUrl("project-id", "http://localhost:3500/base"),
    "http://localhost:3500/project/project-id"
  );
});

test("loadTwiccProjects returns JSON projects from the CLI", async () => {
  const projects = await loadTwiccProjects({
    execFileAsync: async (command, args) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, ["projects", "--limit", "1000", "--include-archived"]);
      return {
        stdout: JSON.stringify([{ id: "project", directory: "/workspace/project" }])
      };
    }
  });

  assert.deepEqual(projects, [{ id: "project", directory: "/workspace/project" }]);
});
