"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseGitWorktrees,
  parseGitWorktreesWithHead
} = require(`${process.cwd()}/build/main/gitWorktrees`);
const { parseGitStatus } = require(`${process.cwd()}/build/main/gitStatus`);
const {
  getProjectGitStatus,
  getProjectGitWorkspace,
  getWorktreeDisplayPath,
  inspectGitPairConflicts,
  listProjectGitWorktrees
} = require(`${process.cwd()}/build/plugins/git-worktrees/main`);

test("Git worktree display paths prefer the project path before the projects base path", () => {
  assert.equal(
    getWorktreeDisplayPath(
      "/workspace/projects/private/example/worktrees/assistant",
      "/workspace/projects/private/example",
      "/workspace/projects"
    ),
    "worktrees/assistant"
  );
  assert.equal(
    getWorktreeDisplayPath(
      "/workspace/projects/private/example",
      "/workspace/projects/private/example",
      "/workspace/projects"
    ),
    "private/example"
  );
  assert.equal(
    getWorktreeDisplayPath(
      "/workspace/projects-copy/example",
      "/workspace/projects/private/example",
      "/workspace/projects"
    ),
    "/workspace/projects-copy/example"
  );
});

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
  assert.deepEqual(parseGitWorktreesWithHead([
    "worktree /workspace/project",
    "HEAD abc",
    "branch refs/heads/main",
    ""
  ].join("\n")), [{
    branch: "main",
    detached: false,
    head: "abc",
    path: "/workspace/project",
    usable: true
  }]);
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
          displayPath: "/workspace/example",
          head: "abc",
          name: "example",
          path: "/workspace/example",
          primary: true,
          usable: true
        },
        {
          branch: "feature/worktrees",
          current: true,
          detached: false,
          displayPath: "/workspace/example-feature",
          head: "def",
          name: "example-feature",
          path: "/workspace/example-feature",
          primary: false,
          usable: true
        },
        {
          branch: "",
          current: false,
          detached: true,
          displayPath: "/workspace/example-stale",
          head: "123",
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

test("Git status parsing preserves staged, modified, renamed, untracked, and conflicted files", () => {
  const output = [
    "# branch.oid abc",
    "# branch.head feature/git-pane",
    "# branch.upstream origin/feature/git-pane",
    "# branch.ab +2 -1",
    "1 M. N... 100644 100644 100644 abc def src/staged file.ts",
    "1 .M N... 100644 100644 100644 abc abc src/modified.ts",
    "1 MM N... 100644 100644 100644 abc def src/both.ts",
    "2 R. N... 100644 100644 100644 abc def R100 src/renamed.ts",
    "src/old name.ts",
    "u UU N... 100644 100644 100644 100644 abc def 123 src/conflict.ts",
    "? src/new file.ts",
    ""
  ].join("\0");

  assert.deepEqual(parseGitStatus(output), {
    ahead: 2,
    behind: 1,
    branch: "feature/git-pane",
    changes: [
      {
        indexStatus: "M",
        kind: "modified",
        originalPath: "",
        path: "src/both.ts",
        staged: true,
        workingTreeStatus: "M"
      },
      {
        indexStatus: "U",
        kind: "conflict",
        originalPath: "",
        path: "src/conflict.ts",
        staged: true,
        workingTreeStatus: "U"
      },
      {
        indexStatus: ".",
        kind: "modified",
        originalPath: "",
        path: "src/modified.ts",
        staged: false,
        workingTreeStatus: "M"
      },
      {
        indexStatus: "?",
        kind: "untracked",
        originalPath: "",
        path: "src/new file.ts",
        staged: false,
        workingTreeStatus: "?"
      },
      {
        indexStatus: "R",
        kind: "staged",
        originalPath: "src/old name.ts",
        path: "src/renamed.ts",
        staged: true,
        workingTreeStatus: "."
      },
      {
        indexStatus: "M",
        kind: "staged",
        originalPath: "",
        path: "src/staged file.ts",
        staged: true,
        workingTreeStatus: "."
      }
    ]
  });
});

test("Git status inspection uses a read-only porcelain command", async () => {
  const calls: Array<{ args: string[]; cwd: string; file: string }> = [];
  const snapshot = await getProjectGitStatus("/workspace/example", {
    execFileAsync: async (file: string, args: string[], options: { cwd: string }) => {
      calls.push({ file, args, cwd: options.cwd });
      return {
        stdout: [
          "# branch.head main",
          "# branch.ab +0 -0",
          "? README draft.md",
          ""
        ].join("\0")
      };
    }
  });

  assert.deepEqual(snapshot, {
    ahead: 0,
    behind: 0,
    branch: "main",
    changes: [{
      indexStatus: "?",
      kind: "untracked",
      originalPath: "",
      path: "README draft.md",
      staged: false,
      workingTreeStatus: "?"
    }]
  });
  assert.deepEqual(calls, [{
    file: "git",
    args: ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
    cwd: "/workspace/example"
  }]);
});

test("Git pair conflict inspection treats merge conflicts as data without touching a worktree", async () => {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const snapshot = await inspectGitPairConflicts(
    "/workspace/example",
    "aaaaaaaa",
    "bbbbbbbb",
    {
      execFileAsync: async (_file: string, args: string[], options: { cwd: string }) => {
        calls.push({ args, cwd: options.cwd });
        throw {
          code: 1,
          stdout: "treeoid\0src/conflict 10.ts\0src/conflict 2.ts\0"
        };
      }
    }
  );

  assert.deepEqual(snapshot, {
    conflicted: true,
    paths: ["src/conflict 2.ts", "src/conflict 10.ts"]
  });
  assert.deepEqual(calls, [{
    args: [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      "-z",
      "aaaaaaaa",
      "bbbbbbbb"
    ],
    cwd: "/workspace/example"
  }]);
});

test("Git pair conflict inspection distinguishes command failures from merge conflicts", async () => {
  await assert.rejects(
    inspectGitPairConflicts("/workspace/example", "aaaaaaaa", "bbbbbbbb", {
      execFileAsync: async () => {
        throw { code: 128, stderr: "fatal: refusing to merge unrelated histories" };
      }
    }),
    /Could not inspect potential conflicts: fatal: refusing to merge unrelated histories/
  );
});

test("Git workspace inspection attaches changed files to every usable worktree", async () => {
  const statusPaths: string[] = [];
  const execFileAsync = async (_file: string, args: string[], options: { cwd: string }) => {
    if (args[0] === "rev-parse") {
      return { stdout: "/workspace/example-feature\n" };
    }
    if (args[0] === "worktree") {
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
    }

    statusPaths.push(options.cwd);
    return {
      stdout: options.cwd === "/workspace/example"
        ? ["# branch.head main", "? README draft.md", ""].join("\0")
        : [
            "# branch.head feature/worktrees",
            "# branch.ab +1 -0",
            "1 .M N... 100644 100644 100644 abc abc src/feature.ts",
            ""
          ].join("\0")
    };
  };

  const snapshot = await getProjectGitWorkspace("/workspace/example-feature", { execFileAsync });

  assert.equal(snapshot.currentPath, "/workspace/example-feature");
  assert.equal(snapshot.linkedCount, 2);
  assert.equal(snapshot.totalChangeCount, 2);
  assert.deepEqual(statusPaths, ["/workspace/example", "/workspace/example-feature"]);
  assert.deepEqual(
    snapshot.worktrees.map((worktree: Record<string, unknown>) => ({
      branch: worktree.branch,
      current: worktree.current,
      path: worktree.path,
      status: worktree.status,
      statusError: worktree.statusError,
      usable: worktree.usable
    })),
    [
      {
        branch: "main",
        current: false,
        path: "/workspace/example",
        status: {
          ahead: 0,
          behind: 0,
          branch: "main",
          changes: [{
            indexStatus: "?",
            kind: "untracked",
            originalPath: "",
            path: "README draft.md",
            staged: false,
            workingTreeStatus: "?"
          }]
        },
        statusError: "",
        usable: true
      },
      {
        branch: "feature/worktrees",
        current: true,
        path: "/workspace/example-feature",
        status: {
          ahead: 1,
          behind: 0,
          branch: "feature/worktrees",
          changes: [{
            indexStatus: ".",
            kind: "modified",
            originalPath: "",
            path: "src/feature.ts",
            staged: false,
            workingTreeStatus: "M"
          }]
        },
        statusError: "",
        usable: true
      },
      {
        branch: "",
        current: false,
        path: "/workspace/example-stale",
        status: null,
        statusError: "Worktree is unavailable.",
        usable: false
      }
    ]
  );
});

test("Git workspace inspection isolates a status failure to its worktree", async () => {
  const snapshot = await getProjectGitWorkspace("/workspace/example", {
    execFileAsync: async (_file: string, args: string[]) => {
      if (args[0] === "rev-parse") {
        return { stdout: "/workspace/example\n" };
      }
      if (args[0] === "worktree") {
        return {
          stdout: [
            "worktree /workspace/example",
            "HEAD abc",
            "branch refs/heads/main",
            ""
          ].join("\n")
        };
      }
      throw { stderr: "fatal: index is unavailable" };
    }
  });

  assert.equal(snapshot.totalChangeCount, 0);
  assert.equal(snapshot.worktrees[0].status, null);
  assert.equal(
    snapshot.worktrees[0].statusError,
    "Could not inspect Git changes: fatal: index is unavailable"
  );
});

test("Git workspace inspection projects pairwise conflicts onto checked-out branches", async () => {
  const mergeCalls: string[][] = [];
  const conflictCache = new Map();
  const execFileAsync = async (_file: string, args: string[], options: { cwd: string }) => {
    if (args[0] === "rev-parse") {
      return { stdout: "/workspace/example\n" };
    }
    if (args[0] === "worktree") {
      return {
        stdout: [
          "worktree /workspace/example",
          "HEAD aaa",
          "branch refs/heads/main",
          "",
          "worktree /workspace/example-a",
          "HEAD bbb",
          "branch refs/heads/feature/a",
          "",
          "worktree /workspace/example-b",
          "HEAD ccc",
          "branch refs/heads/feature/b",
          "",
          "worktree /workspace/example-detached",
          "HEAD ddd",
          "detached",
          "",
          "worktree /workspace/example-stale",
          "HEAD eee",
          "branch refs/heads/feature/stale",
          "prunable gitdir file points to non-existent location",
          ""
        ].join("\n")
      };
    }
    if (args[0] === "status") {
      return { stdout: "# branch.head main\0" };
    }
    if (args[0] === "merge-tree") {
      mergeCalls.push(args);
      const pair = args.slice(-2).join(":");
      if (pair === "aaa:bbb") {
        return { stdout: "tree-main-a\0" };
      }
      if (pair === "aaa:ccc") {
        throw { code: 1, stdout: "tree-main-b\0src/shared.ts\0" };
      }
      if (pair === "bbb:ccc") {
        throw {
          code: 1,
          stdout: "tree-a-b\0src/renderer.ts\0src/shared.ts\0"
        };
      }
    }
    throw new Error(`Unexpected Git call in ${options.cwd}: ${args.join(" ")}`);
  };

  const options = { conflictCache, execFileAsync };
  const snapshot = await getProjectGitWorkspace("/workspace/example", options, true);
  await getProjectGitWorkspace("/workspace/example", options, true);

  assert.equal(snapshot.totalPotentialConflictCount, 3);
  assert.equal(mergeCalls.length, 3);
  assert.deepEqual(
    snapshot.worktrees.map((worktree: Record<string, unknown>) => ({
      branch: worktree.branch,
      errors: worktree.potentialConflictErrors,
      conflicts: worktree.potentialConflicts
    })),
    [
      {
        branch: "main",
        errors: [],
        conflicts: [{ path: "src/shared.ts", peers: ["feature/b"] }]
      },
      {
        branch: "feature/a",
        errors: [],
        conflicts: [
          { path: "src/renderer.ts", peers: ["feature/b"] },
          { path: "src/shared.ts", peers: ["feature/b"] }
        ]
      },
      {
        branch: "feature/b",
        errors: [],
        conflicts: [
          { path: "src/renderer.ts", peers: ["feature/a"] },
          { path: "src/shared.ts", peers: ["feature/a", "main"] }
        ]
      },
      { branch: "", errors: [], conflicts: [] },
      { branch: "feature/stale", errors: [], conflicts: [] }
    ]
  );
});

test("Git workspace conflict inspection isolates pair failures and pathless conflicts", async () => {
  const snapshot = await getProjectGitWorkspace("/workspace/example", {
    execFileAsync: async (_file: string, args: string[]) => {
      if (args[0] === "rev-parse") {
        return { stdout: "/workspace/example\n" };
      }
      if (args[0] === "worktree") {
        return {
          stdout: [
            "worktree /workspace/example",
            "HEAD aaa",
            "branch refs/heads/main",
            "",
            "worktree /workspace/example-a",
            "HEAD bbb",
            "branch refs/heads/feature/a",
            "",
            "worktree /workspace/example-b",
            "HEAD ccc",
            "branch refs/heads/feature/b",
            ""
          ].join("\n")
        };
      }
      if (args[0] === "status") {
        return { stdout: "# branch.head main\0" };
      }
      const pair = args.slice(-2).join(":");
      if (pair === "aaa:bbb") {
        throw { code: 1, stdout: "tree-main-a\0" };
      }
      if (pair === "aaa:ccc") {
        throw { code: 129, stderr: "error: unknown option `write-tree'" };
      }
      return { stdout: "tree-a-b\0" };
    }
  }, true);

  assert.equal(snapshot.totalPotentialConflictCount, 1);
  assert.deepEqual(snapshot.worktrees[0].potentialConflictErrors, [
    {
      message: "Git reported a potential conflict without a file path.",
      peer: "feature/a"
    },
    {
      message: "Could not inspect potential conflicts: error: unknown option `write-tree'",
      peer: "feature/b"
    }
  ]);
  assert.deepEqual(snapshot.worktrees[1].potentialConflictErrors, [{
    message: "Git reported a potential conflict without a file path.",
    peer: "main"
  }]);
  assert.deepEqual(snapshot.worktrees[2].potentialConflictErrors, [{
    message: "Could not inspect potential conflicts: error: unknown option `write-tree'",
    peer: "main"
  }]);
});

export {};
