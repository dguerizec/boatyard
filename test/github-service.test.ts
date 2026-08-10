"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GITHUB_PULL_REQUESTS_QUERY,
  GITHUB_PULL_REQUESTS_SUMMARY_QUERY,
  GitHubServiceError,
  createAsyncRequestCache,
  createGitHubRequestScheduler,
  createGitHubService,
  getGitHubProjectStatus,
  normalizeGitHubCommandError,
  normalizePullRequest,
  normalizePullRequestCiState,
  normalizePullRequestMergeState,
  normalizePullRequestReviewState,
  normalizePullRequestsGraphQl,
  normalizeWorkflowJob,
  normalizeWorkflowRun,
  parseGitHubApiOutput,
  parseGitHubRepositoryUrl,
  runGitHubApiJson,
  runGitHubGraphQlJson,
  resolveGitHubRepository
} = require(`${process.cwd()}/build/plugins/github/service`);
const {
  createGitHubPollingCoordinator
} = require(`${process.cwd()}/build/plugins/github/polling`);
const { activate: activateGitHubPlugin } = require(`${process.cwd()}/build/plugins/github/main`);

type CommandError = Error & {
  code?: string;
  stderr?: string;
  stdout?: string;
};

function createPollingClock(initialTime = 1000) {
  const timers = new Map<number, { callback: () => void; dueAt: number }>();
  let currentTime = initialTime;
  let nextTimerId = 1;

  async function runNext() {
    const next = [...timers.entries()]
      .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
    if (!next) {
      throw new Error("No polling timer is scheduled.");
    }
    timers.delete(next[0]);
    currentTime = Math.max(currentTime, next[1].dueAt);
    next[1].callback();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    clearTimer(timer: number) {
      timers.delete(timer);
    },
    now: () => currentTime,
    runNext,
    setTimer(callback: () => void, delayMs: number) {
      const timer = nextTimerId++;
      timers.set(timer, {
        callback,
        dueAt: currentTime + Math.max(0, delayMs)
      });
      return timer;
    },
    timers
  };
}

function createPullRequestGraphQlResponse() {
  return {
    data: {
      viewer: {
        login: "octocat"
      },
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 12,
              title: "Review this change",
              url: "https://github.com/octo-org/example/pull/12",
              updatedAt: "2026-07-29T11:00:00Z",
              isDraft: false,
              mergeStateStatus: "BLOCKED",
              reviewDecision: "REVIEW_REQUIRED",
              headRefName: "feature/review",
              baseRefName: "main",
              author: { login: "contributor" },
              statusCheckRollup: {
                state: "PENDING",
                contexts: {
                  nodes: [{
                    __typename: "CheckRun",
                    name: "Test",
                    status: "IN_PROGRESS",
                    conclusion: null,
                    detailsUrl: "https://github.com/octo-org/example/actions/runs/1"
                  }]
                }
              }
            },
            {
              number: 11,
              title: "Ready change",
              url: "https://github.com/octo-org/example/pull/11",
              updatedAt: "2026-07-29T10:00:00Z",
              isDraft: false,
              mergeStateStatus: "CLEAN",
              reviewDecision: "APPROVED",
              headRefName: "feature/ready",
              baseRefName: "main",
              author: { login: "octocat" },
              statusCheckRollup: {
                state: "SUCCESS",
                contexts: {
                  nodes: [{
                    __typename: "StatusContext",
                    context: "ci/build",
                    state: "SUCCESS",
                    targetUrl: "https://ci.example/build/1"
                  }]
                }
              }
            }
          ]
        }
      },
      search: {
        nodes: [{
          number: 12,
          repository: {
            nameWithOwner: "octo-org/example"
          }
        }]
      }
    }
  };
}

test("parseGitHubRepositoryUrl normalizes supported GitHub remote formats", () => {
  const expected = {
    host: "github.com",
    owner: "octo-org",
    repo: "example"
  };

  for (const value of [
    "https://github.com/octo-org/example",
    "https://www.github.com/octo-org/example.git",
    "https://github.com/octo-org/example/tree/main/src",
    "git@github.com:octo-org/example.git",
    "ssh://git@github.com/octo-org/example.git"
  ]) {
    assert.deepEqual(parseGitHubRepositoryUrl(value), expected);
  }
});

test("parseGitHubRepositoryUrl rejects malformed and unsupported repository URLs", () => {
  for (const value of [
    "",
    "github.com/octo-org/example",
    "https://github.com/octo-org",
    "https://gitlab.com/octo-org/example",
    "git@gitlab.com:octo-org/example.git",
    "not a repository"
  ]) {
    assert.equal(parseGitHubRepositoryUrl(value), null);
  }
});

test("resolveGitHubRepository prefers repoUrl and falls back to gitUrl", () => {
  assert.deepEqual(resolveGitHubRepository({
    repoUrl: "https://github.com/octo-org/from-repo-url/tree/main/docs",
    gitUrl: "git@github.com:octo-org/from-git-url.git"
  }), {
    host: "github.com",
    owner: "octo-org",
    repo: "from-repo-url"
  });

  assert.deepEqual(resolveGitHubRepository({
    repoUrl: "https://gitlab.com/octo-org/example",
    gitUrl: "git@github.com:octo-org/from-git-url.git"
  }), {
    host: "github.com",
    owner: "octo-org",
    repo: "from-git-url"
  });
});

test("GitHub plugin migrates legacy Repo panes only for GitHub projects", () => {
  let migrationRegistered = false;
  let migrateState = (_payload: { state: unknown }): unknown => null;
  activateGitHubPlugin({
    actions: { handle() {} },
    execFileAsync: async () => ({ stdout: "" }),
    stateMigrations: {
      register(handler: (payload: { state: unknown }) => unknown) {
        migrationRegistered = true;
        migrateState = handler;
      }
    }
  });

  assert.equal(migrationRegistered, true);
  assert.deepEqual(migrateState({
    state: {
      projects: [{
        id: "github-project",
        repoUrl: "https://github.com/octo-org/example"
      }, {
        id: "gitlab-project",
        repoUrl: "https://gitlab.com/octo-org/example"
      }]
    }
  }), {
    webAppMigrations: [{
      projectId: "github-project",
      sourceKey: "repo",
      sourceWebAppId: "repo",
      targetKey: "github",
      targetWebAppId: "boatyard.github.repository"
    }]
  });
});

test("getGitHubProjectStatus reports authenticated GitHub CLI state", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const status = await getGitHubProjectStatus({
    repoUrl: "https://github.com/octo-org/example"
  }, {
    execFileAsync: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: "" };
    }
  });

  assert.deepEqual(calls, [{
    command: "gh",
    args: ["auth", "status", "--hostname", "github.com"]
  }]);
  assert.deepEqual(status, {
    state: "ready",
    summary: "Authenticated for octo-org/example.",
    details: {
      authenticated: true,
      host: "github.com",
      owner: "octo-org",
      repo: "example"
    }
  });
});

test("getGitHubProjectStatus distinguishes missing repositories, CLI, and authentication", async () => {
  assert.equal((await getGitHubProjectStatus({})).state, "notConfigured");

  const missingCli = new Error("spawn gh ENOENT") as CommandError;
  missingCli.code = "ENOENT";
  const unavailable = await getGitHubProjectStatus({
    repoUrl: "https://github.com/octo-org/example"
  }, {
    execFileAsync: async () => {
      throw missingCli;
    }
  });
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.summary, "GitHub CLI was not found in PATH.");

  const missingAuth = new Error("authentication failed") as CommandError;
  missingAuth.stderr = "You are not logged into any GitHub hosts. Run gh auth login.";
  const notConfigured = await getGitHubProjectStatus({
    repoUrl: "https://github.com/octo-org/example"
  }, {
    execFileAsync: async () => {
      throw missingAuth;
    }
  });
  assert.equal(notConfigured.state, "notConfigured");
  assert.equal(notConfigured.summary, "Authenticate GitHub CLI for github.com.");
});

test("getGitHubProjectStatus does not expose command errors in renderer details", async () => {
  const commandError = new Error("secret command detail") as CommandError;
  commandError.stderr = "sensitive stderr";
  const status = await getGitHubProjectStatus({
    repoUrl: "https://github.com/octo-org/example"
  }, {
    execFileAsync: async () => {
      throw commandError;
    }
  });

  assert.equal(status.state, "error");
  assert.doesNotMatch(JSON.stringify(status), /secret|sensitive/);
});

test("createAsyncRequestCache deduplicates in-flight work and honors TTL and force refresh", async () => {
  let currentTime = 1000;
  let resolveLoad!: (value: string) => void;
  let calls = 0;
  const cache = createAsyncRequestCache({ now: () => currentTime });
  const loader = () => {
    calls += 1;
    return new Promise<string>((resolve) => {
      resolveLoad = resolve;
    });
  };

  const first = cache.get("key", loader, { ttlMs: 100 });
  const duplicate = cache.get("key", loader, { ttlMs: 100 });
  assert.equal(calls, 1);
  resolveLoad("first");
  assert.equal(await first, "first");
  assert.equal(await duplicate, "first");
  assert.equal(await cache.get("key", async () => "unexpected", { ttlMs: 100 }), "first");

  currentTime += 100;
  assert.equal(await cache.get("key", async () => {
    calls += 1;
    return "expired";
  }, { ttlMs: 100 }), "expired");
  assert.equal(await cache.get("key", async () => {
    calls += 1;
    return "forced";
  }, { force: true, ttlMs: 100 }), "forced");
  assert.equal(calls, 3);
});

test("createGitHubRequestScheduler serializes requests and promotes foreground work", async () => {
  const scheduler = createGitHubRequestScheduler();
  const started: string[] = [];
  let resolveFirst!: (value: string) => void;
  const first = scheduler.schedule(async () => {
    started.push("first");
    return new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
  }, { priority: "background" });
  const background = scheduler.schedule(async () => {
    started.push("background");
    return "background";
  }, { priority: "background" });
  const foreground = scheduler.schedule(async () => {
    started.push("foreground");
    return "foreground";
  }, { priority: "foreground" });
  const interactive = scheduler.schedule(async () => {
    started.push("interactive");
    return "interactive";
  }, { priority: "interactive" });

  assert.deepEqual(started, ["first"]);
  resolveFirst("first");
  assert.equal(await first, "first");
  assert.equal(await interactive, "interactive");
  assert.equal(await foreground, "foreground");
  assert.equal(await background, "background");
  assert.deepEqual(started, ["first", "interactive", "foreground", "background"]);
});

test("createGitHubRequestScheduler applies one shared retry delay after a rate limit", async () => {
  let currentTime = 1000;
  let queuedCalls = 0;
  const scheduler = createGitHubRequestScheduler({
    cooldownMs: 60_000,
    now: () => currentTime
  });
  const limited = scheduler.schedule(async () => {
    throw new GitHubServiceError(
      "rateLimited",
      "GitHub API rate limit reached. Refresh will resume later.",
      { retryAfterMs: 120_000 }
    );
  });
  const queued = scheduler.schedule(async () => {
    queuedCalls += 1;
    return "queued";
  });

  await assert.rejects(limited, { code: "rateLimited" });
  await assert.rejects(queued, { code: "rateLimited" });
  await assert.rejects(
    scheduler.schedule(async () => {
      queuedCalls += 1;
      return "blocked";
    }),
    { code: "rateLimited", retryAfterMs: 120_000 }
  );
  assert.equal(queuedCalls, 0);

  currentTime += 60_000;
  await assert.rejects(
    scheduler.schedule(async () => "still blocked"),
    { code: "rateLimited", retryAfterMs: 60_000 }
  );
  currentTime += 60_000;
  assert.equal(await scheduler.schedule(async () => {
    queuedCalls += 1;
    return "resumed";
  }), "resumed");
  assert.equal(queuedCalls, 1);
});

test("runGitHubApiJson uses hostname-aware gh API arguments and rejects invalid JSON safely", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const repository = {
    host: "github.com",
    owner: "octo-org",
    repo: "example"
  };
  const result = await runGitHubApiJson(repository, "repos/octo-org/example/actions/runs", {
    execFileAsync: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: "{\"ok\":true}" };
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{
    command: "gh",
    args: [
      "api",
      "--hostname",
      "github.com",
      "--include",
      "repos/octo-org/example/actions/runs"
    ]
  }]);

  await assert.rejects(
    runGitHubApiJson(repository, "repos/octo-org/example", {
      execFileAsync: async () => ({ stdout: "not json" })
    }),
    (error: Error & { code?: string }) => (
      error.message === "GitHub CLI returned invalid JSON."
      && error.code === "invalidResponse"
    )
  );
});

test("normalizeGitHubCommandError maps rate limits without exposing raw command output", () => {
  const error = new Error("API rate limit exceeded for secret account") as CommandError;
  error.stderr = "secondary rate limit; private detail\nRetry-After: 120";
  const normalized = normalizeGitHubCommandError(error, { now: () => 1000 });

  assert.equal(normalized.code, "rateLimited");
  assert.equal(normalized.message, "GitHub API rate limit reached. Refresh will resume later.");
  assert.equal(normalized.retryAfterMs, 120_000);
  assert.doesNotMatch(normalized.message, /secret|private/);
});

test("parseGitHubApiOutput keeps JSON separate from rate-limit headers", () => {
  const output = parseGitHubApiOutput([
    "HTTP/2.0 200 OK",
    "Content-Type: application/json",
    "X-RateLimit-Remaining: 0",
    "X-RateLimit-Reset: 70",
    "",
    '{"ok":true}'
  ].join("\r\n"), () => 10_000);

  assert.deepEqual(output.payload, { ok: true });
  assert.equal(output.rateLimitDelayMs, 60_000);
});

test("runGitHubApiJson pauses the shared scheduler at primary quota exhaustion", async () => {
  let calls = 0;
  const scheduler = createGitHubRequestScheduler({
    now: () => 10_000
  });
  const repository = {
    host: "github.com",
    owner: "octo-org",
    repo: "example"
  };
  const execFileAsync = async () => {
    calls += 1;
    return {
      stdout: [
        "HTTP/2.0 200 OK",
        "X-RateLimit-Remaining: 0",
        "X-RateLimit-Reset: 70",
        "",
        '{"ok":true}'
      ].join("\n")
    };
  };

  assert.deepEqual(await runGitHubApiJson(repository, "repos/octo-org/example", {
    execFileAsync,
    now: () => 10_000,
    scheduler
  }), { ok: true });
  await assert.rejects(
    runGitHubApiJson(repository, "repos/octo-org/example", {
      execFileAsync,
      now: () => 10_000,
      scheduler
    }),
    { code: "rateLimited" }
  );
  assert.equal(calls, 1);
});

test("workflow normalizers preserve authoritative run, job, and step status", () => {
  const job = normalizeWorkflowJob({
    id: 22,
    name: "Linux",
    status: "in_progress",
    conclusion: null,
    html_url: "https://github.com/octo-org/example/actions/runs/11/job/22",
    runner_name: "GitHub Actions 1",
    labels: ["ubuntu-latest"],
    started_at: "2026-07-29T10:01:00Z",
    steps: [
      {
        number: 1,
        name: "Checkout",
        status: "completed",
        conclusion: "success",
        started_at: "2026-07-29T10:01:00Z",
        completed_at: "2026-07-29T10:01:02Z"
      },
      {
        number: 2,
        name: "Test",
        status: "in_progress",
        conclusion: null,
        started_at: "2026-07-29T10:01:02Z"
      }
    ]
  });
  const run = normalizeWorkflowRun({
    id: 11,
    name: "CI",
    display_title: "Run tests",
    status: "in_progress",
    conclusion: null,
    event: "push",
    head_branch: "main",
    head_sha: "abcdef123456",
    run_attempt: 2,
    run_started_at: "2026-07-29T10:01:00Z",
    html_url: "https://github.com/octo-org/example/actions/runs/11",
    actor: { login: "octocat" }
  }, [job]);

  assert.equal(run.status, "in_progress");
  assert.equal(run.runAttempt, 2);
  assert.equal(run.actorLogin, "octocat");
  assert.equal(run.jobs[0].steps[0].conclusion, "success");
  assert.equal(run.jobs[0].steps[1].status, "in_progress");
});

test("createGitHubService loads active jobs, keeps completed runs compact, and caches snapshots", async () => {
  const calls: string[][] = [];
  const execFileAsync = async (_command: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "auth") {
      return { stdout: "" };
    }
    if (args.at(-1)?.includes("/actions/runs?")) {
      return {
        stdout: JSON.stringify({
          workflow_runs: [
            {
              id: 11,
              name: "CI",
              status: "in_progress",
              conclusion: null,
              head_branch: "main",
              run_attempt: 1,
              run_started_at: "2026-07-29T10:01:00Z",
              html_url: "https://github.com/octo-org/example/actions/runs/11"
            },
            {
              id: 10,
              name: "Release",
              status: "completed",
              conclusion: "success",
              head_branch: "v1.0.0",
              run_attempt: 1,
              run_started_at: "2026-07-29T09:00:00Z",
              updated_at: "2026-07-29T09:02:00Z",
              html_url: "https://github.com/octo-org/example/actions/runs/10"
            }
          ]
        })
      };
    }
    if (args.at(-1)?.includes("/actions/runs/11/jobs?")) {
      return {
        stdout: JSON.stringify({
          jobs: [{
            id: 22,
            name: "Linux",
            status: "in_progress",
            steps: [{
              number: 1,
              name: "Test",
              status: "in_progress"
            }]
          }]
        })
      };
    }
    throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  };
  const service = createGitHubService({
    execFileAsync,
    now: () => Date.parse("2026-07-29T10:02:00Z")
  });
  const project = {
    repoUrl: "https://github.com/octo-org/example"
  };

  const snapshot = await service.actionsSnapshotForProject(project);
  assert.equal(snapshot.status.state, "ready");
  assert.equal(snapshot.activeRunCount, 1);
  assert.equal(snapshot.runs.length, 2);
  assert.equal(snapshot.runs[0].jobs[0].name, "Linux");
  assert.deepEqual(snapshot.runs[1].jobs, []);
  assert.equal(snapshot.refreshedAt, "2026-07-29T10:02:00.000Z");
  assert.equal(calls.length, 3);

  await service.actionsSnapshotForProject(project);
  assert.equal(calls.length, 3);

  await service.actionsSnapshotForProject(project, { force: true });
  assert.equal(calls.length, 5);
  assert.equal(calls.filter((args) => args[0] === "auth").length, 1);
});

test("createGitHubService serializes REST and GraphQL API work across projects", async () => {
  let activeApiCalls = 0;
  let maxActiveApiCalls = 0;
  const service = createGitHubService({
    execFileAsync: async (_command: string, args: string[]) => {
      if (args[0] === "auth") {
        return { stdout: "" };
      }

      activeApiCalls += 1;
      maxActiveApiCalls = Math.max(maxActiveApiCalls, activeApiCalls);
      await new Promise((resolve) => setImmediate(resolve));
      activeApiCalls -= 1;

      if (args[0] === "api" && args[1] === "graphql") {
        return { stdout: JSON.stringify(createPullRequestGraphQlResponse()) };
      }
      if (args.at(-1)?.includes("/actions/runs?")) {
        return { stdout: JSON.stringify({ workflow_runs: [] }) };
      }
      throw new Error(`Unexpected arguments: ${args.join(" ")}`);
    }
  });

  await Promise.all([
    service.actionsSnapshotForProject({
      repoUrl: "https://github.com/octo-org/actions-example"
    }, { priority: "background" }),
    service.pullRequestsSnapshotForProject({
      repoUrl: "https://github.com/octo-org/example"
    }, { priority: "foreground" })
  ]);

  assert.equal(maxActiveApiCalls, 1);
});

test("createGitHubService skips workflow jobs for summary-only Actions snapshots", async () => {
  const calls: string[][] = [];
  const service = createGitHubService({
    execFileAsync: async (_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "auth") {
        return { stdout: "" };
      }
      if (args.at(-1)?.includes("/actions/runs?")) {
        return {
          stdout: JSON.stringify({
            workflow_runs: [{
              id: 11,
              name: "CI",
              status: "in_progress",
              run_attempt: 1
            }]
          })
        };
      }
      if (args.at(-1)?.includes("/actions/runs/11/jobs?")) {
        return { stdout: JSON.stringify({ jobs: [] }) };
      }
      throw new Error(`Unexpected arguments: ${args.join(" ")}`);
    }
  });
  const project = { repoUrl: "https://github.com/octo-org/example" };

  const summary = await service.actionsSnapshotForProject(project, { detail: "summary" });
  assert.equal(summary.activeRunCount, 1);
  assert.deepEqual(summary.runs[0].jobs, []);
  assert.equal(calls.length, 2);

  await service.actionsSnapshotForProject(project, { detail: "full" });
  assert.equal(calls.length, 3);
  assert.ok(calls[2].at(-1)?.includes("/actions/runs/11/jobs?"));
});

test("GitHub polling channels merge subscribers and coalesce manual refreshes", async () => {
  const clock = createPollingClock();
  const calls: Array<Record<string, unknown>> = [];
  const emitted: Array<Record<string, unknown>> = [];
  const snapshot = {
    activeRunCount: 0,
    refreshedAt: "2026-08-10T10:00:00.000Z",
    repository: { host: "github.com", owner: "octo-org", repo: "example" },
    runs: [],
    status: { state: "ready", summary: "Authenticated." }
  };
  const coordinator = createGitHubPollingCoordinator({
    clearTimer: clock.clearTimer,
    emit: (state: Record<string, unknown>) => emitted.push(state),
    minimumPollGapMs: 1000,
    now: clock.now,
    random: () => 0.5,
    service: {
      async actionsSnapshotForProject(_project: unknown, options: Record<string, unknown>) {
        calls.push(options);
        return snapshot;
      },
      async pullRequestsSnapshotForProject() {
        throw new Error("Unexpected pull request poll.");
      }
    },
    setTimer: clock.setTimer
  });
  const project = { repoUrl: "https://github.com/octo-org/example" };

  coordinator.syncClient("sidebar", [{
    channel: "actions",
    detail: "summary",
    priority: "background",
    project
  }]);
  coordinator.syncClient("workspace", [{
    channel: "actions",
    detail: "full",
    priority: "foreground",
    project
  }]);

  assert.deepEqual(coordinator.inspect(), {
    channels: [{
      channel: "actions",
      channelKey: "github:github.com/octo-org/example:actions",
      detail: "full",
      nextDueAt: 1000,
      priority: "foreground",
      subscriberCount: 2
    }],
    clientCount: 2
  });

  await clock.runNext();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].detail, "full");
  assert.equal(calls[0].priority, "foreground");
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].loading, true);
  assert.equal(emitted[1].revision, 1);

  const firstRefresh = coordinator.refresh("actions", project);
  const secondRefresh = coordinator.refresh("actions", project);
  await clock.runNext();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].force, true);
  assert.equal(calls[1].priority, "interactive");
  assert.equal((await firstRefresh).revision, 2);
  assert.equal((await secondRefresh).revision, 2);
});

test("GitHub polling channels stagger background repositories from one global planner", async () => {
  const clock = createPollingClock();
  const repositories: string[] = [];
  const coordinator = createGitHubPollingCoordinator({
    backgroundStaggerMs: 2500,
    clearTimer: clock.clearTimer,
    emit: () => {},
    minimumPollGapMs: 1000,
    now: clock.now,
    random: () => 0.5,
    service: {
      async actionsSnapshotForProject(project: { repoUrl: string }) {
        repositories.push(project.repoUrl);
        return {
          activeRunCount: 0,
          refreshedAt: new Date(clock.now()).toISOString(),
          repository: null,
          runs: [],
          status: { state: "ready", summary: "Authenticated." }
        };
      },
      async pullRequestsSnapshotForProject() {
        throw new Error("Unexpected pull request poll.");
      }
    },
    setTimer: clock.setTimer
  });

  coordinator.syncClient("sidebar", ["one", "two", "three"].map((repo) => ({
    channel: "actions",
    detail: "summary",
    priority: "background",
    project: { repoUrl: `https://github.com/octo-org/${repo}` }
  })));

  assert.deepEqual(
    (coordinator.inspect().channels as Array<{ nextDueAt: number }>).map((channel) => channel.nextDueAt),
    [1000, 3500, 6000]
  );
  await clock.runNext();
  assert.deepEqual(repositories, ["https://github.com/octo-org/one"]);
  await clock.runNext();
  assert.deepEqual(repositories, [
    "https://github.com/octo-org/one",
    "https://github.com/octo-org/two"
  ]);
});

test("GitHub polling channels publish a structured retry time after rate limiting", async () => {
  const clock = createPollingClock(10_000);
  const emitted: Array<Record<string, unknown>> = [];
  const coordinator = createGitHubPollingCoordinator({
    clearTimer: clock.clearTimer,
    emit: (state: Record<string, unknown>) => emitted.push(state),
    now: clock.now,
    service: {
      async actionsSnapshotForProject() {
        throw new GitHubServiceError(
          "rateLimited",
          "GitHub API rate limit reached. Refresh will resume later.",
          { retryAfterMs: 120_000 }
        );
      },
      async pullRequestsSnapshotForProject() {
        throw new Error("Unexpected pull request poll.");
      }
    },
    setTimer: clock.setTimer
  });

  coordinator.syncClient("workspace", [{
    channel: "actions",
    detail: "full",
    priority: "foreground",
    project: { repoUrl: "https://github.com/octo-org/example" }
  }]);
  await clock.runNext();

  const state = emitted.at(-1) as {
    error: { code: string; retryAt: string };
    stale: boolean;
  };
  assert.equal(state.error.code, "rateLimited");
  assert.equal(state.error.retryAt, new Date(130_000).toISOString());
  assert.equal(state.stale, false);
  assert.equal(
    (coordinator.inspect().channels as Array<{ nextDueAt: number }>)[0].nextDueAt,
    130_000
  );
});

test("runGitHubGraphQlJson passes the query and variables as safe gh arguments", async () => {
  const calls: string[][] = [];
  const repository = {
    host: "github.com",
    owner: "octo-org",
    repo: "example"
  };
  const result = await runGitHubGraphQlJson(
    repository,
    "query Example($owner: String!) { repository(owner: $owner, name: \"example\") { id } }",
    { owner: "octo-org" },
    {
      execFileAsync: async (_command: string, args: string[]) => {
        calls.push(args);
        return { stdout: "{\"data\":{\"repository\":{\"id\":\"repo-id\"}}}" };
      }
    }
  );

  assert.equal(result.data.repository.id, "repo-id");
  assert.deepEqual(calls[0].slice(0, 4), [
    "api",
    "graphql",
    "--hostname",
    "github.com"
  ]);
  assert.ok(calls[0].includes("owner=octo-org"));
  assert.ok(calls[0].some((argument) => argument.startsWith("query=query Example")));
});

test("pull request status normalizers keep review, CI, and merge state independent", () => {
  assert.equal(normalizePullRequestReviewState("APPROVED"), "approved");
  assert.equal(normalizePullRequestReviewState("CHANGES_REQUESTED"), "changesRequested");
  assert.equal(normalizePullRequestReviewState("REVIEW_REQUIRED"), "required");
  assert.equal(normalizePullRequestMergeState("CLEAN"), "clean");
  assert.equal(normalizePullRequestMergeState("DIRTY"), "conflicting");
  assert.equal(normalizePullRequestMergeState("BLOCKED"), "blocked");

  assert.equal(normalizePullRequestCiState(null), "none");
  assert.equal(normalizePullRequestCiState({
    state: "PENDING",
    contexts: {
      nodes: [{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null }]
    }
  }), "running");
  assert.equal(normalizePullRequestCiState({
    state: "SUCCESS",
    contexts: {
      nodes: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" }]
    }
  }), "passed");
  assert.equal(normalizePullRequestCiState({
    state: "FAILURE",
    contexts: {
      nodes: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "TIMED_OUT" }]
    }
  }), "failed");
  assert.equal(normalizePullRequestCiState({
    state: "FAILURE",
    contexts: {
      nodes: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "ACTION_REQUIRED" }]
    }
  }), "blocked");
});

test("normalizePullRequest marks readiness only after independent requirements pass", () => {
  const ready = normalizePullRequest({
    number: 11,
    title: "Ready",
    url: "https://github.com/octo-org/example/pull/11",
    author: { login: "octocat" },
    isDraft: false,
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: {
      state: "SUCCESS",
      contexts: { nodes: [] }
    }
  }, {
    requestedReviewNumbers: new Set([11]),
    viewerLogin: "octocat"
  });
  assert.equal(ready.isAuthoredByViewer, true);
  assert.equal(ready.isReviewRequestedFromViewer, true);
  assert.equal(ready.reviewState, "approved");
  assert.equal(ready.ciState, "passed");
  assert.equal(ready.isReadyToMerge, true);

  const pending = normalizePullRequest({
    ...ready,
    number: 12,
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: {
      state: "PENDING",
      contexts: { nodes: [] }
    }
  }, {
    viewerLogin: "octocat"
  });
  assert.equal(pending.reviewState, "approved");
  assert.equal(pending.ciState, "running");
  assert.equal(pending.isReadyToMerge, false);
});

test("normalizePullRequestsGraphQl identifies viewer review requests and authored ready PRs", () => {
  const normalized = normalizePullRequestsGraphQl(createPullRequestGraphQlResponse());

  assert.equal(normalized.viewerLogin, "octocat");
  assert.equal(normalized.pullRequests.length, 2);
  assert.deepEqual({
    reviewRequested: normalized.pullRequests[0].isReviewRequestedFromViewer,
    reviewState: normalized.pullRequests[0].reviewState,
    ciState: normalized.pullRequests[0].ciState,
    mergeState: normalized.pullRequests[0].mergeState
  }, {
    reviewRequested: true,
    reviewState: "required",
    ciState: "running",
    mergeState: "blocked"
  });
  assert.deepEqual({
    authored: normalized.pullRequests[1].isAuthoredByViewer,
    reviewState: normalized.pullRequests[1].reviewState,
    ciState: normalized.pullRequests[1].ciState,
    ready: normalized.pullRequests[1].isReadyToMerge
  }, {
    authored: true,
    reviewState: "approved",
    ciState: "passed",
    ready: true
  });
});

test("createGitHubService loads and caches project pull requests with one GraphQL request", async () => {
  const calls: string[][] = [];
  const service = createGitHubService({
    execFileAsync: async (_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "auth") {
        return { stdout: "" };
      }
      if (args[0] === "api" && args[1] === "graphql") {
        assert.ok(args.some((argument) => argument === "owner=octo-org"));
        assert.ok(args.some((argument) => argument === "name=example"));
        assert.ok(args.some((argument) => argument.includes("review-requested:@me")));
        assert.ok(args.some((argument) => argument.includes(GITHUB_PULL_REQUESTS_QUERY.trim())));
        return { stdout: JSON.stringify(createPullRequestGraphQlResponse()) };
      }
      throw new Error(`Unexpected arguments: ${args.join(" ")}`);
    },
    now: () => Date.parse("2026-07-29T12:00:00Z")
  });
  const project = {
    repoUrl: "https://github.com/octo-org/example"
  };

  const snapshot = await service.pullRequestsSnapshotForProject(project);
  assert.equal(snapshot.status.state, "ready");
  assert.equal(snapshot.viewerLogin, "octocat");
  assert.equal(snapshot.pullRequests.length, 2);
  assert.equal(snapshot.refreshedAt, "2026-07-29T12:00:00.000Z");
  assert.equal(calls.length, 2);

  await service.pullRequestsSnapshotForProject(project);
  assert.equal(calls.length, 2);
  await service.pullRequestsSnapshotForProject(project, { force: true });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((args) => args[0] === "auth").length, 1);
});

test("createGitHubService uses a lightweight pull request query for summary channels", async () => {
  const calls: string[][] = [];
  const service = createGitHubService({
    execFileAsync: async (_command: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "auth") {
        return { stdout: "" };
      }
      if (args[0] === "api" && args[1] === "graphql") {
        assert.ok(args.some((argument) => argument.includes(GITHUB_PULL_REQUESTS_SUMMARY_QUERY.trim())));
        assert.equal(args.some((argument) => argument.includes("review-requested:@me")), false);
        return {
          stdout: JSON.stringify({
            data: {
              viewer: { login: "octocat" },
              repository: {
                pullRequests: {
                  nodes: [{
                    author: { login: "octocat" },
                    isDraft: true,
                    number: 7,
                    title: "Draft summary",
                    updatedAt: "2026-08-10T10:00:00Z",
                    url: "https://github.com/octo-org/example/pull/7"
                  }]
                }
              }
            }
          })
        };
      }
      throw new Error(`Unexpected arguments: ${args.join(" ")}`);
    }
  });

  const snapshot = await service.pullRequestsSnapshotForProject({
    repoUrl: "https://github.com/octo-org/example"
  }, { detail: "summary" });
  assert.equal(snapshot.pullRequests.length, 1);
  assert.equal(snapshot.pullRequests[0].isDraft, true);
  assert.equal(snapshot.pullRequests[0].title, "Draft summary");
  assert.equal(calls.length, 2);
});

export {};
