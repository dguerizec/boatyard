"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  aliasTwiccProjectProcessStatuses,
  buildTwiccProjectUrl,
  createTwiccProject,
  findTwiccProjectForPath,
  findTwiccProjectMatchForPath,
  getTwiccProjectProcessStatuses,
  loadTwiccProcesses,
  loadTwiccProjectProcessStatuses,
  loadTwiccProjects
} = require("../src/plugins/twicc/service");

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

test("findTwiccProjectMatchForPath reports exact and parent matches", () => {
  const projects = [
    {
      id: "parent",
      directory: "/workspace/project",
      git_root: null
    },
    {
      id: "nested",
      directory: "/workspace/project/packages/app",
      git_root: "/workspace/project/packages/app"
    }
  ];

  assert.deepEqual(
    findTwiccProjectMatchForPath(projects, "/workspace/project/packages/app"),
    {
      project: projects[1],
      matchType: "exact"
    }
  );
  assert.deepEqual(
    findTwiccProjectMatchForPath(projects, "/workspace/project/packages/app/src"),
    {
      project: projects[1],
      matchType: "parent"
    }
  );
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

test("loadTwiccProcesses returns JSON processes from the CLI", async () => {
  const processes = await loadTwiccProcesses({
    execFileAsync: async (command, args) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, ["processes", "--limit", "1000", "--include-hidden"]);
      return {
        stdout: JSON.stringify([{ project_id: "project", state: "assistant_turn" }])
      };
    }
  });

  assert.deepEqual(processes, [{ project_id: "project", state: "assistant_turn" }]);
});

test("getTwiccProjectProcessStatuses groups processes by project with state priority", () => {
  const statuses = getTwiccProjectProcessStatuses([
    {
      project_id: "project-a",
      session_id: "done-session",
      session_title: "Finished task",
      state: "user_turn",
      last_state_change_at: "2026-06-08T12:00:00+00:00"
    },
    {
      project_id: "project-a",
      session_id: "input-session",
      session_title: "Needs input",
      state: "awaiting_user_input",
      last_state_change_at: "2026-06-08T12:01:00+00:00"
    },
    {
      project_id: "project-b",
      session_id: "work-session",
      session_title: "Working",
      state: "assistant_turn"
    }
  ]);

  assert.equal(statuses["project-a"].state, "input");
  assert.equal(statuses["project-a"].count, 2);
  assert.equal(statuses["project-a"].sessions[0].state, "done");
  assert.equal(statuses["project-a"].sessions[1].state, "input");
  assert.equal(statuses["project-b"].state, "working");
});

test("aliasTwiccProjectProcessStatuses exposes statuses by Boatyard project id", () => {
  const status = {
    state: "working",
    count: 1,
    sessions: [{
      id: "session-id",
      title: "Working session",
      state: "working"
    }]
  };

  assert.deepEqual(
    aliasTwiccProjectProcessStatuses(
      {
        "twicc-project": status
      },
      [{
        id: "twicc-project",
        directory: "/workspace/project",
        git_root: "/workspace/project"
      }],
      [{
        id: "boatyard-project",
        sourcePath: "/workspace/project"
      }]
    ),
    {
      "twicc-project": status,
      "boatyard-project": status
    }
  );
});

test("aliasTwiccProjectProcessStatuses rolls worktree statuses up to Boatyard parent projects", () => {
  const status = {
    state: "working",
    count: 1,
    sessions: [{
      id: "session-id",
      title: "Working session",
      state: "working"
    }]
  };

  assert.deepEqual(
    aliasTwiccProjectProcessStatuses(
      {
        "twicc-worktree": status
      },
      [
        {
          id: "twicc-parent",
          directory: "/workspace/project",
          git_root: "/workspace/project",
          worktrees: ["twicc-worktree"]
        },
        {
          id: "twicc-worktree",
          directory: "/workspace/project/worktrees/feature",
          git_root: "/workspace/project/worktrees/feature",
          worktree_of: "twicc-parent"
        }
      ],
      [{
        id: "boatyard-parent",
        sourcePath: "/workspace/project"
      }]
    ),
    {
      "twicc-worktree": status,
      "boatyard-parent": status
    }
  );
});

test("loadTwiccProjectProcessStatuses returns grouped process statuses", async () => {
  const statuses = await loadTwiccProjectProcessStatuses({
    execFileAsync: async () => ({
      stdout: JSON.stringify([
        {
          project_id: "project",
          session_id: "session",
          session_title: "Done",
          state: "user_turn"
        }
      ])
    })
  });

  assert.equal(statuses.project.state, "done");
  assert.equal(statuses.project.count, 1);
});

test("loadTwiccProjects can feed source path URL detection", async () => {
  const projects = await loadTwiccProjects({
    execFileAsync: async () => ({
      stdout: JSON.stringify([{
        id: "-workspace-projects-app",
        directory: "/workspace/projects/app",
        git_root: "/workspace/projects/app"
      }])
    })
  });
  const project = findTwiccProjectForPath(projects, "/workspace/projects/app");

  assert.equal(project?.id, "-workspace-projects-app");
  assert.equal(
    buildTwiccProjectUrl(project.id),
    "http://localhost:3500/project/-workspace-projects-app"
  );
});

test("createTwiccProject registers the source path and returns the exact project", async () => {
  const calls = [];
  const result = await createTwiccProject("/workspace/projects/app", {
    execFileAsync: async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "create-project") {
        return { stdout: "" };
      }
      return {
        stdout: JSON.stringify([{
          id: "-workspace-projects-app",
          directory: "/workspace/projects/app",
          git_root: "/workspace/projects/app"
        }])
      };
    }
  });

  assert.deepEqual(calls, [
    {
      command: "twicc",
      args: ["create-project", "/workspace/projects/app"]
    },
    {
      command: "twicc",
      args: ["projects", "--limit", "1000", "--include-archived"]
    }
  ]);
  assert.equal(result.matchType, "exact");
  assert.equal(result.url, "http://localhost:3500/project/-workspace-projects-app");
});
