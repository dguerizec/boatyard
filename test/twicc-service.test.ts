"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  aliasTwiccProjectProcessStatuses,
  archiveTwiccSession,
  archiveTwiccSessionFromRpc,
  buildTwiccProjectUrl,
  createTwiccSession,
  createTwiccSessionFromRpc,
  createTwiccProject,
  createTwiccProjectCache,
  findTwiccProjectForPath,
  findTwiccProjectMatchForPath,
  getTwiccProjectProcessStatuses,
  getTwiccSessionFlow,
  loadGitSessionCreationOptions,
  loadTwiccProcessesFromRpc,
  loadTwiccProcesses,
  loadTwiccProjectProcessStatuses,
  loadTwiccProjectsFromRpc,
  loadTwiccProjects,
  loadTwiccSessionsFromRpc,
  loadTwiccSessions,
  reorderTwiccSessionFlow,
  updateTwiccSessionFlowLaneFromRpc,
  updateTwiccSessionFlowLane,
  updateTwiccSessionFlowPositionFromRpc,
  updateTwiccSessionFlowPosition
} = require(`${process.cwd()}/build/plugins/twicc/service`);

type ExecCall = {
  args: string[];
  command: string;
};

function createRpcFetch(assertCall: (url: string, init: Record<string, unknown>) => unknown) {
  return async (url: string, init: Record<string, unknown>) => ({
    ok: true,
    status: 200,
    async json() {
      return assertCall(url, init);
    }
  });
}

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
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, ["projects", "--limit", "1000", "--include-archived"]);
      return {
        stdout: JSON.stringify([{ id: "project", directory: "/workspace/project" }])
      };
    }
  });

  assert.deepEqual(projects, [{ id: "project", directory: "/workspace/project" }]);
});

test("loadTwiccProjectsFromRpc returns JSON projects from configured Twicc URL", async () => {
  const projects = await loadTwiccProjectsFromRpc({
    globalConfig: {
      twiccBaseUrl: "https://twicc.example/base/",
      twiccApiToken: "secret-token"
    },
    fetch: createRpcFetch((url, init) => {
      assert.equal(url, "https://twicc.example/base/rpc/projects");
      assert.equal(init.method, "POST");
      assert.deepEqual(init.headers, {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token"
      });
      assert.deepEqual(JSON.parse(String(init.body)), {
        limit: 1000,
        include_archived: true
      });
      return {
        exit_code: 0,
        result: [{ id: "remote-project", directory: "/workspace/project" }],
        error: null
      };
    })
  });

  assert.deepEqual(projects, [{ id: "remote-project", directory: "/workspace/project" }]);
});

test("createTwiccProjectCache reuses projects until the TTL expires", async () => {
  let currentTime = 1000;
  const calls: number[] = [];
  const cache = createTwiccProjectCache({
    ttlMs: 600000,
    now: () => currentTime,
    loadProjects: async () => {
      calls.push(currentTime);
      return [{ id: `project-${calls.length}` }];
    }
  });

  assert.deepEqual(await cache.get(), [{ id: "project-1" }]);
  assert.deepEqual(await cache.get(), [{ id: "project-1" }]);
  currentTime += 599999;
  assert.deepEqual(await cache.get(), [{ id: "project-1" }]);
  currentTime += 1;
  assert.deepEqual(await cache.get(), [{ id: "project-2" }]);
  assert.deepEqual(calls, [1000, 601000]);
});

test("createTwiccProjectCache refreshes when processes reference unknown projects", async () => {
  let calls = 0;
  const cache = createTwiccProjectCache({
    loadProjects: async () => {
      calls += 1;
      return calls === 1
        ? [{ id: "known" }]
        : [{ id: "known" }, { id: "new-project" }];
    }
  });

  assert.deepEqual(await cache.get({}, { projectIds: ["known"] }), [{ id: "known" }]);
  assert.deepEqual(
    await cache.get({}, { projectIds: ["new-project"] }),
    [{ id: "known" }, { id: "new-project" }]
  );
  assert.equal(calls, 2);
});

test("createTwiccProjectCache supports explicit invalidation", async () => {
  let version = 0;
  const cache = createTwiccProjectCache({
    loadProjects: async () => [{ id: `project-${++version}` }]
  });

  assert.deepEqual(await cache.get(), [{ id: "project-1" }]);
  assert.deepEqual(await cache.get(), [{ id: "project-1" }]);
  cache.invalidate();
  assert.deepEqual(await cache.get(), [{ id: "project-2" }]);
});

test("loadTwiccProcesses returns JSON processes from the CLI", async () => {
  const processes = await loadTwiccProcesses({
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, ["processes", "--limit", "1000", "--include-hidden"]);
      return {
        stdout: JSON.stringify([{ project_id: "project", state: "assistant_turn" }])
      };
    }
  });

  assert.deepEqual(processes, [{ project_id: "project", state: "assistant_turn" }]);
});

test("loadTwiccProcessesFromRpc returns JSON processes from configured Twicc URL", async () => {
  const processes = await loadTwiccProcessesFromRpc({
    globalConfig: {
      twiccBaseUrl: "https://twicc.example",
      twiccApiToken: "secret-token"
    },
    fetch: createRpcFetch((url, init) => {
      assert.equal(url, "https://twicc.example/rpc/processes");
      assert.deepEqual(JSON.parse(String(init.body)), {
        limit: 1000,
        include_hidden: true
      });
      return {
        exit_code: 0,
        result: [{ project_id: "project", state: "assistant_turn" }],
        error: null
      };
    })
  });

  assert.deepEqual(processes, [{ project_id: "project", state: "assistant_turn" }]);
});

test("loadTwiccSessions returns project sessions from the CLI", async () => {
  const sessions = await loadTwiccSessions("/workspace/project", {
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, [
        "sessions",
        "--project",
        "/workspace/project",
        "--limit",
        "1000"
      ]);
      return {
        stdout: JSON.stringify([{ id: "session-1", title: "Implement feature" }])
      };
    }
  });

  assert.deepEqual(sessions, [{ id: "session-1", title: "Implement feature" }]);
});

test("loadTwiccSessionsFromRpc returns project sessions from configured Twicc URL", async () => {
  const sessions = await loadTwiccSessionsFromRpc("/workspace/project", {
    globalConfig: {
      twiccBaseUrl: "https://twicc.example",
      twiccApiToken: "secret-token"
    },
    fetch: createRpcFetch((url, init) => {
      assert.equal(url, "https://twicc.example/rpc/sessions");
      assert.deepEqual(JSON.parse(String(init.body)), {
        project: "/workspace/project",
        limit: 1000
      });
      return {
        exit_code: 0,
        result: [{ id: "session-1", title: "Implement feature" }],
        error: null
      };
    })
  });

  assert.deepEqual(sessions, [{ id: "session-1", title: "Implement feature" }]);
});

test("createTwiccSession creates a session in a new worktree through the CLI", async () => {
  const result = await createTwiccSession({
    project: "/workspace/project",
    prompt: "Implement the worktree feature",
    sessionFlowLane: "in_progress",
    title: "Worktree feature",
    worktreeBranch: "feature/worktree",
    worktreePath: "/workspace/project/worktrees/feature-worktree",
    worktreeStartFrom: "main"
  }, {
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, [
        "create-session",
        "--title",
        "Worktree feature",
        "--project",
        "/workspace/project",
        "--annotation",
        "boatyard.sessionFlowLane=in_progress",
        "--worktree-branch",
        "feature/worktree",
        "--worktree-path",
        "/workspace/project/worktrees/feature-worktree",
        "--worktree-start-from",
        "main",
        "--",
        "Implement the worktree feature"
      ]);
      return {
        stdout: JSON.stringify({
          status: "created",
          session_id: "session-1",
          project_id: "worktree-project",
          provider: "codex"
        })
      };
    }
  });

  assert.deepEqual(result, {
    projectId: "worktree-project",
    provider: "codex",
    sessionId: "session-1",
    status: "created",
    title: "Worktree feature"
  });
});

test("createTwiccSession derives an optional title from the first message", async () => {
  const result = await createTwiccSession({
    project: "/workspace/project",
    prompt: "Implement session creation without requiring a custom title from the user",
    title: ""
  }, {
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, [
        "create-session",
        "--title",
        "Implement session creation without requiring a custom",
        "--project",
        "/workspace/project",
        "--",
        "Implement session creation without requiring a custom title from the user"
      ]);
      return {
        stdout: JSON.stringify({
          status: "created",
          session_id: "session-1",
          project_id: "project-1",
          provider: "codex"
        })
      };
    }
  });

  assert.equal(result.title, "Implement session creation without requiring a custom");
});

test("createTwiccSessionFromRpc adopts an existing worktree", async () => {
  const result = await createTwiccSessionFromRpc({
    project: "/workspace/project",
    prompt: "Continue the existing worktree",
    sessionFlowLane: "in_progress",
    title: "Existing worktree",
    worktreePath: "/workspace/project/worktrees/existing"
  }, {
    globalConfig: {
      twiccBaseUrl: "https://twicc.example",
      twiccApiToken: "secret-token"
    },
    fetch: createRpcFetch((url, init) => {
      assert.equal(url, "https://twicc.example/rpc/create-session");
      assert.deepEqual(JSON.parse(String(init.body)), {
        project: "/workspace/project",
        prompt: "Continue the existing worktree",
        annotation: ["boatyard.sessionFlowLane=in_progress"],
        title: "Existing worktree",
        worktree_path: "/workspace/project/worktrees/existing"
      });
      return {
        exit_code: 0,
        result: {
          status: "created",
          session_id: "session-existing",
          project_id: "existing-project",
          provider: "claude_code"
        },
        error: null
      };
    })
  });

  assert.deepEqual(result, {
    projectId: "existing-project",
    provider: "claude_code",
    sessionId: "session-existing",
    status: "created",
    title: "Existing worktree"
  });
});

test("loadGitSessionCreationOptions lists branches and other worktrees from a nested project path", async () => {
  const result = await loadGitSessionCreationOptions("/workspace/project/packages/app", {
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "git");
      if (args[0] === "rev-parse") {
        return { stdout: "/workspace/project\n" };
      }
      if (args[0] === "branch") {
        return { stdout: "feature/existing\nmain\nfeature/new\n" };
      }
      assert.deepEqual(args, ["worktree", "list", "--porcelain"]);
      return {
        stdout: [
          "worktree /workspace/project",
          "HEAD abc",
          "branch refs/heads/main",
          "",
          "worktree /workspace/project/worktrees/feature-existing",
          "HEAD def",
          "branch refs/heads/feature/existing",
          "",
          "worktree /workspace/project/worktrees/stale",
          "HEAD 123",
          "detached",
          "prunable gitdir file points to non-existent location",
          ""
        ].join("\n")
      };
    }
  });

  assert.deepEqual(result, {
    branches: [
      { checkedOut: true, name: "main" },
      { checkedOut: true, name: "feature/existing" },
      { checkedOut: false, name: "feature/new" }
    ],
    defaultWorktreeBase: "/workspace/project/worktrees",
    gitRoot: "/workspace/project",
    worktrees: [
      {
        branch: "feature/existing",
        detached: false,
        path: "/workspace/project/worktrees/feature-existing",
        usable: true
      },
      {
        branch: "",
        detached: true,
        path: "/workspace/project/worktrees/stale",
        usable: false
      }
    ]
  });
});

test("getTwiccSessionFlow classifies every visible unarchived project session", () => {
  const sessions = getTwiccSessionFlow([
    {
      id: "active",
      title: "Active task",
      last_new_content_at: "2026-07-20T12:00:00Z"
    },
    {
      id: "pinned",
      title: "Planned task",
      pinned: "project",
      last_new_content_at: "2026-07-21T12:00:00Z"
    },
    {
      id: "recent",
      title: "Recently finished task",
      provider: "codex",
      git_branch: "feature/session-flow",
      context_usage: 42000,
      total_cost: 1.25,
      user_message_count: 7,
      last_new_content_at: "2026-08-01T11:00:00Z"
    },
    {
      id: "annotated",
      title: "Observed task",
      annotations: {
        boatyard: {
          sessionFlowLane: "testing"
        }
      },
      last_new_content_at: "2026-07-01T12:00:00Z"
    },
    {
      id: "old",
      title: "Older finished task",
      last_new_content_at: "2026-07-01T12:00:00Z"
    },
    {
      id: "archived",
      title: "Archived task",
      archived: true,
      last_new_content_at: "2026-08-01T11:30:00Z"
    }
  ], [
    {
      session_id: "active",
      state: "assistant_turn"
    }
  ]);

  assert.deepEqual(
    sessions.map((session: { id: string; lane: string }) => [session.id, session.lane]),
    [
      ["recent", "testing"],
      ["pinned", "backlog"],
      ["active", "in_progress"],
      ["annotated", "testing"],
      ["old", "testing"]
    ]
  );
  assert.deepEqual(sessions[0], {
    branch: "feature/session-flow",
    contextUsage: 42000,
    id: "recent",
    lane: "testing",
    lastActivityAt: "2026-08-01T11:00:00.000Z",
    order: null,
    processState: "",
    provider: "codex",
    title: "Recently finished task",
    totalCost: 1.25,
    userMessageCount: 7
  });
});

test("getTwiccSessionFlow lets persisted annotations override inferred lanes", () => {
  const sessions = getTwiccSessionFlow([{
    id: "active-backlog",
    title: "Paused active task",
    annotations: {
      boatyard: {
        sessionFlowLane: "backlog",
        sessionFlowOrder: "3"
      }
    }
  }], [{
    session_id: "active-backlog",
    state: "assistant_turn"
  }]);

  assert.equal(sessions[0].lane, "backlog");
  assert.equal(sessions[0].order, 3);
});

test("updateTwiccSessionFlowLane persists the lane through the CLI", async () => {
  const result = await updateTwiccSessionFlowLane("session-1", "backlog", {
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, [
        "update-session",
        "session-1",
        "annotations",
        "set:boatyard.sessionFlowLane=backlog"
      ]);
      return {
        stdout: JSON.stringify({ status: "updated", session_id: "session-1" })
      };
    }
  });

  assert.deepEqual(result, { status: "updated", session_id: "session-1" });
});

test("updateTwiccSessionFlowLaneFromRpc persists the lane through Twicc RPC", async () => {
  const result = await updateTwiccSessionFlowLaneFromRpc("session-1", "testing", {
    globalConfig: {
      twiccBaseUrl: "https://twicc.example",
      twiccApiToken: "secret-token"
    },
    fetch: createRpcFetch((url, init) => {
      assert.equal(url, "https://twicc.example/rpc/update-session/annotations");
      assert.deepEqual(JSON.parse(String(init.body)), {
        session_id: "session-1",
        operations: ["set:boatyard.sessionFlowLane=testing"]
      });
      return {
        exit_code: 0,
        result: { status: "updated", session_id: "session-1" },
        error: null
      };
    })
  });

  assert.deepEqual(result, { status: "updated", session_id: "session-1" });
});

test("updateTwiccSessionFlowLane rejects unknown lanes", async () => {
  await assert.rejects(
    updateTwiccSessionFlowLane("session-1", "done", {}),
    /Invalid TwiCC session flow lane/
  );
});

test("updateTwiccSessionFlowPosition persists a lane and order through the CLI", async () => {
  const result = await updateTwiccSessionFlowPosition("session-2", "in_progress", 2, {
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, [
        "update-session",
        "session-2",
        "annotations",
        "set:boatyard.sessionFlowLane=in_progress",
        "set:boatyard.sessionFlowOrder=2"
      ]);
      return {
        stdout: JSON.stringify({ status: "updated", session_id: "session-2" })
      };
    }
  });

  assert.deepEqual(result, { status: "updated", session_id: "session-2" });
});

test("reorderTwiccSessionFlow persists every ordered lane position", async () => {
  const calls: ExecCall[] = [];
  const result = await reorderTwiccSessionFlow(["session-2", "session-1"], "in_progress", {
    execFileAsync: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout: JSON.stringify({ status: "updated" })
      };
    }
  });

  assert.deepEqual(calls.map((call) => call.args), [
    [
      "update-session",
      "session-2",
      "annotations",
      "set:boatyard.sessionFlowLane=in_progress",
      "set:boatyard.sessionFlowOrder=0"
    ],
    [
      "update-session",
      "session-1",
      "annotations",
      "set:boatyard.sessionFlowLane=in_progress",
      "set:boatyard.sessionFlowOrder=1"
    ]
  ]);
  assert.deepEqual(result, {
    lane: "in_progress",
    sessionIds: ["session-2", "session-1"]
  });
});

test("updateTwiccSessionFlowPositionFromRpc persists one atomic lane position", async () => {
  const result = await updateTwiccSessionFlowPositionFromRpc("session-2", "testing", 512, {
    globalConfig: {
      twiccBaseUrl: "https://twicc.example",
      twiccApiToken: "secret-token"
    },
    fetch: createRpcFetch((url, init) => {
      assert.equal(url, "https://twicc.example/rpc/update-session/annotations");
      assert.deepEqual(JSON.parse(String(init.body)), {
        session_id: "session-2",
        operations: [
          "set:boatyard.sessionFlowLane=testing",
          "set:boatyard.sessionFlowOrder=512"
        ]
      });
      return {
        exit_code: 0,
        result: { status: "updated", session_id: "session-2" },
        error: null
      };
    })
  });

  assert.deepEqual(result, { status: "updated", session_id: "session-2" });
});

test("updateTwiccSessionFlowPosition rejects invalid positions", async () => {
  await assert.rejects(
    updateTwiccSessionFlowPosition("session-1", "testing", Number.NaN, {}),
    /Invalid TwiCC session flow order/
  );
});

test("archiveTwiccSession archives the session through the CLI", async () => {
  const result = await archiveTwiccSession("session-1", {
    execFileAsync: async (command: string, args: string[]) => {
      assert.equal(command, "twicc");
      assert.deepEqual(args, ["update-session", "session-1", "archive"]);
      return {
        stdout: JSON.stringify({ status: "updated", session_id: "session-1" })
      };
    }
  });

  assert.deepEqual(result, { status: "updated", session_id: "session-1" });
});

test("archiveTwiccSessionFromRpc archives the session through Twicc RPC", async () => {
  const result = await archiveTwiccSessionFromRpc("session-1", {
    globalConfig: {
      twiccBaseUrl: "https://twicc.example",
      twiccApiToken: "secret-token"
    },
    fetch: createRpcFetch((url, init) => {
      assert.equal(url, "https://twicc.example/rpc/update-session/archive");
      assert.deepEqual(JSON.parse(String(init.body)), {
        session_id: "session-1"
      });
      return {
        exit_code: 0,
        result: { status: "updated", session_id: "session-1" },
        error: null
      };
    })
  });

  assert.deepEqual(result, { status: "updated", session_id: "session-1" });
});

test("archiveTwiccSession requires a session id", async () => {
  await assert.rejects(archiveTwiccSession("", {}), /TwiCC session id is required/);
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

test("aliasTwiccProjectProcessStatuses aggregates root and worktree statuses by project", () => {
  const rootStatus = {
    state: "done",
    count: 1,
    sessions: [{
      id: "root-session",
      title: "Finished root session",
      state: "done"
    }]
  };
  const worktreeStatus = {
    state: "working",
    count: 1,
    sessions: [{
      id: "worktree-session",
      title: "Working worktree session",
      state: "working"
    }]
  };
  const aggregatedStatus = {
    state: "working",
    count: 2,
    sessions: [
      ...rootStatus.sessions,
      ...worktreeStatus.sessions
    ]
  };

  assert.deepEqual(
    aliasTwiccProjectProcessStatuses(
      {
        "twicc-parent": rootStatus,
        "twicc-worktree": worktreeStatus
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
      "twicc-parent": aggregatedStatus,
      "twicc-worktree": worktreeStatus,
      "boatyard-parent": aggregatedStatus
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
  const calls: ExecCall[] = [];
  const result = await createTwiccProject("/workspace/projects/app", {
    execFileAsync: async (command: string, args: string[]) => {
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

test("createTwiccProject can use Twicc RPC without the local CLI", async () => {
  const calls: Array<{ body: Record<string, unknown>; url: string }> = [];
  const result = await createTwiccProject("/workspace/projects/app", {
    globalConfig: {
      twiccBaseUrl: "https://twicc.example/root",
      twiccApiToken: "secret-token"
    },
    fetch: createRpcFetch((url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      if (url.endsWith("/rpc/create-project")) {
        return {
          exit_code: 0,
          result: null,
          error: null
        };
      }
      return {
        exit_code: 0,
        result: [{
          id: "-workspace-projects-app",
          directory: "/workspace/projects/app",
          git_root: "/workspace/projects/app"
        }],
        error: null
      };
    })
  });

  assert.deepEqual(calls, [
    {
      url: "https://twicc.example/root/rpc/create-project",
      body: { directory: "/workspace/projects/app" }
    },
    {
      url: "https://twicc.example/root/rpc/projects",
      body: {
        limit: 1000,
        include_archived: true
      }
    }
  ]);
  assert.equal(result.matchType, "exact");
  assert.equal(result.url, "https://twicc.example/project/-workspace-projects-app");
});

export {};
