"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAsyncRequestCache,
  createGitHubService,
  getGitHubProjectStatus,
  normalizeGitHubCommandError,
  normalizeWorkflowJob,
  normalizeWorkflowRun,
  parseGitHubRepositoryUrl,
  runGitHubApiJson,
  resolveGitHubRepository
} = require(`${process.cwd()}/build/plugins/github/service`);

type CommandError = Error & {
  code?: string;
  stderr?: string;
};

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

export {};
