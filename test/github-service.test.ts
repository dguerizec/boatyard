"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GITHUB_PULL_REQUESTS_QUERY,
  createAsyncRequestCache,
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
  parseGitHubRepositoryUrl,
  runGitHubApiJson,
  runGitHubGraphQlJson,
  resolveGitHubRepository
} = require(`${process.cwd()}/build/plugins/github/service`);

type CommandError = Error & {
  code?: string;
  stderr?: string;
};

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
  error.stderr = "secondary rate limit; private detail";
  const normalized = normalizeGitHubCommandError(error);

  assert.equal(normalized.code, "rateLimited");
  assert.equal(normalized.message, "GitHub API rate limit reached. Refresh will resume later.");
  assert.doesNotMatch(normalized.message, /secret|private/);
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

export {};
