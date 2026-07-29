"use strict";

import type { ExecFileAsync } from "../../shared/pluginTypes";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const runExecFile = promisify(execFile);
const DEFAULT_GITHUB_HOST = "github.com";
const GITHUB_COMMAND_TIMEOUT_MS = 5000;
const GITHUB_API_TIMEOUT_MS = 15000;
const GITHUB_AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_RUNS_CACHE_TTL_MS = 10 * 1000;
const GITHUB_ACTIVE_JOBS_CACHE_TTL_MS = 4 * 1000;

type UnknownRecord = Record<string, unknown>;

type GitHubProject = {
  gitUrl?: unknown;
  repoUrl?: unknown;
};

type GitHubRepositoryRef = {
  host: string;
  owner: string;
  repo: string;
};

type GitHubProjectStatus = {
  state: "ready" | "notConfigured" | "unavailable" | "error";
  summary: string;
  details: {
    authenticated: boolean;
    host: string;
    owner: string;
    repo: string;
  };
};

type GitHubCommandOptions = {
  execFileAsync?: ExecFileAsync;
};

type GitHubServiceErrorCode =
  | "authentication"
  | "invalidResponse"
  | "notConfigured"
  | "rateLimited"
  | "unavailable"
  | "unknown";

type AsyncCacheEntry = {
  expiresAt: number;
  promise: Promise<unknown> | null;
  value?: unknown;
};

type AsyncRequestCacheOptions = {
  now?: () => number;
};

type AsyncRequestOptions = {
  force?: boolean;
  ttlMs?: number;
};

type GitHubApiOptions = GitHubCommandOptions & {
  timeoutMs?: number;
};

type GitHubServiceOptions = GitHubCommandOptions & {
  cache?: ReturnType<typeof createAsyncRequestCache>;
  now?: () => number;
};

type GitHubServiceRequestOptions = {
  force?: boolean;
};

type GitHubRawStep = {
  completed_at?: unknown;
  conclusion?: unknown;
  name?: unknown;
  number?: unknown;
  started_at?: unknown;
  status?: unknown;
};

type GitHubRawJob = {
  completed_at?: unknown;
  conclusion?: unknown;
  html_url?: unknown;
  id?: unknown;
  labels?: unknown;
  name?: unknown;
  runner_name?: unknown;
  started_at?: unknown;
  status?: unknown;
  steps?: unknown;
};

type GitHubRawRun = {
  actor?: unknown;
  conclusion?: unknown;
  created_at?: unknown;
  display_title?: unknown;
  event?: unknown;
  head_branch?: unknown;
  head_sha?: unknown;
  html_url?: unknown;
  id?: unknown;
  name?: unknown;
  run_attempt?: unknown;
  run_started_at?: unknown;
  status?: unknown;
  updated_at?: unknown;
};

type GitHubWorkflowStep = {
  completedAt: string;
  conclusion: string;
  name: string;
  number: number;
  startedAt: string;
  status: string;
};

type GitHubWorkflowJob = {
  completedAt: string;
  conclusion: string;
  htmlUrl: string;
  id: number;
  labels: string[];
  name: string;
  runnerName: string;
  startedAt: string;
  status: string;
  steps: GitHubWorkflowStep[];
};

type GitHubWorkflowRun = {
  actorLogin: string;
  conclusion: string;
  createdAt: string;
  displayTitle: string;
  event: string;
  headBranch: string;
  headSha: string;
  htmlUrl: string;
  id: number;
  jobs: GitHubWorkflowJob[];
  name: string;
  runAttempt: number;
  startedAt: string;
  status: string;
  updatedAt: string;
};

type GitHubActionsSnapshot = {
  activeRunCount: number;
  refreshedAt: string;
  repository: GitHubRepositoryRef | null;
  runs: GitHubWorkflowRun[];
  status: GitHubProjectStatus;
};

class GitHubServiceError extends Error {
  code: GitHubServiceErrorCode;

  constructor(code: GitHubServiceErrorCode, message: string) {
    super(message);
    this.name = "GitHubServiceError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeGitHubHost(value: unknown): string {
  const host = normalizeText(value).toLowerCase().replace(/\.$/, "");
  return host === "www.github.com" ? DEFAULT_GITHUB_HOST : host;
}

function isSupportedGitHubHost(value: unknown): boolean {
  return normalizeGitHubHost(value) === DEFAULT_GITHUB_HOST;
}

function normalizeRepositoryPath(pathname: unknown): Pick<GitHubRepositoryRef, "owner" | "repo"> | null {
  const parts = normalizeText(pathname)
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function parseGitHubRepositoryUrl(value: unknown): GitHubRepositoryRef | null {
  const source = normalizeText(value);
  if (!source) {
    return null;
  }

  const scpMatch = source.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/);
  if (scpMatch && !source.includes("://")) {
    const host = normalizeGitHubHost(scpMatch[1]);
    const repository = normalizeRepositoryPath(scpMatch[2]);
    return isSupportedGitHubHost(host) && repository
      ? { host, ...repository }
      : null;
  }

  try {
    const parsed = new URL(source);
    const host = normalizeGitHubHost(parsed.hostname);
    const repository = normalizeRepositoryPath(parsed.pathname);
    return isSupportedGitHubHost(host) && repository
      ? { host, ...repository }
      : null;
  } catch {
    return null;
  }
}

function resolveGitHubRepository(project: GitHubProject = {}): GitHubRepositoryRef | null {
  return parseGitHubRepositoryUrl(project.repoUrl)
    || parseGitHubRepositoryUrl(project.gitUrl);
}

function getErrorCode(error: unknown): string {
  return isRecord(error) ? normalizeText(error.code) : "";
}

function getErrorOutput(error: unknown): string {
  if (!isRecord(error)) {
    return error instanceof Error ? error.message : normalizeText(error);
  }

  return [
    error.stderr,
    error.stdout,
    error.message
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join("\n");
}

function isAuthenticationError(error: unknown): boolean {
  return /not logged in|authentication failed|authenticate|no accounts/i.test(getErrorOutput(error));
}

function isRateLimitError(error: unknown): boolean {
  return /rate limit|secondary rate|abuse detection|retry-after/i.test(getErrorOutput(error));
}

function normalizeGitHubCommandError(error: unknown): GitHubServiceError {
  if (error instanceof GitHubServiceError) {
    return error;
  }

  if (getErrorCode(error) === "ENOENT") {
    return new GitHubServiceError("unavailable", "GitHub CLI was not found in PATH.");
  }

  if (isAuthenticationError(error)) {
    return new GitHubServiceError("authentication", "GitHub CLI is not authenticated for this repository.");
  }

  if (isRateLimitError(error)) {
    return new GitHubServiceError("rateLimited", "GitHub API rate limit reached. Refresh will resume later.");
  }

  return new GitHubServiceError("unknown", "GitHub request failed.");
}

function parseJsonOutput(stdout: unknown): unknown {
  try {
    return JSON.parse(String(stdout || ""));
  } catch {
    throw new GitHubServiceError("invalidResponse", "GitHub CLI returned invalid JSON.");
  }
}

function getRepositoryKey(repository: GitHubRepositoryRef): string {
  return `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
}

function createAsyncRequestCache({ now = Date.now }: AsyncRequestCacheOptions = {}) {
  const entries = new Map<string, AsyncCacheEntry>();

  async function get<T>(
    key: string,
    loader: () => Promise<T>,
    { force = false, ttlMs = 0 }: AsyncRequestOptions = {}
  ): Promise<T> {
    const existing = entries.get(key);
    if (existing?.promise) {
      return existing.promise as Promise<T>;
    }
    if (!force && existing && existing.value !== undefined && existing.expiresAt > now()) {
      return existing.value as T;
    }

    const entry: AsyncCacheEntry = existing || {
      expiresAt: 0,
      promise: null
    };
    const promise = loader();
    entry.promise = promise;
    entries.set(key, entry);

    try {
      const value = await promise;
      entry.value = value;
      entry.expiresAt = now() + Math.max(0, ttlMs);
      return value;
    } finally {
      entry.promise = null;
      if (entry.value === undefined) {
        entries.delete(key);
      }
    }
  }

  function invalidate(prefix = ""): void {
    for (const key of entries.keys()) {
      if (!prefix || key.startsWith(prefix)) {
        const entry = entries.get(key);
        if (!entry?.promise) {
          entries.delete(key);
        } else {
          entry.expiresAt = 0;
          entry.value = undefined;
        }
      }
    }
  }

  return Object.freeze({
    get,
    invalidate
  });
}

async function runGitHubApiJson(
  repository: GitHubRepositoryRef,
  endpoint: string,
  {
    execFileAsync = runExecFile,
    timeoutMs = GITHUB_API_TIMEOUT_MS
  }: GitHubApiOptions = {}
): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      "--hostname",
      repository.host,
      endpoint
    ], {
      timeout: timeoutMs,
      windowsHide: true
    });
    return parseJsonOutput(stdout);
  } catch (error) {
    throw normalizeGitHubCommandError(error);
  }
}

function normalizeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(normalizeText).filter(Boolean)
    : [];
}

function normalizeWorkflowStep(value: unknown): GitHubWorkflowStep | null {
  if (!isRecord(value)) {
    return null;
  }
  const step = value as GitHubRawStep;
  return {
    completedAt: normalizeText(step.completed_at),
    conclusion: normalizeText(step.conclusion),
    name: normalizeText(step.name) || "Unnamed step",
    number: normalizeNumber(step.number),
    startedAt: normalizeText(step.started_at),
    status: normalizeText(step.status) || "unknown"
  };
}

function normalizeWorkflowJob(value: unknown): GitHubWorkflowJob | null {
  if (!isRecord(value)) {
    return null;
  }
  const job = value as GitHubRawJob;
  return {
    completedAt: normalizeText(job.completed_at),
    conclusion: normalizeText(job.conclusion),
    htmlUrl: normalizeText(job.html_url),
    id: normalizeNumber(job.id),
    labels: normalizeStringArray(job.labels),
    name: normalizeText(job.name) || "Unnamed job",
    runnerName: normalizeText(job.runner_name),
    startedAt: normalizeText(job.started_at),
    status: normalizeText(job.status) || "unknown",
    steps: Array.isArray(job.steps)
      ? job.steps.map(normalizeWorkflowStep).filter((step): step is GitHubWorkflowStep => !!step)
      : []
  };
}

function normalizeWorkflowRun(value: unknown, jobs: GitHubWorkflowJob[] = []): GitHubWorkflowRun | null {
  if (!isRecord(value)) {
    return null;
  }
  const run = value as GitHubRawRun;
  const actor = isRecord(run.actor) ? run.actor : {};
  return {
    actorLogin: normalizeText(actor.login),
    conclusion: normalizeText(run.conclusion),
    createdAt: normalizeText(run.created_at),
    displayTitle: normalizeText(run.display_title),
    event: normalizeText(run.event),
    headBranch: normalizeText(run.head_branch),
    headSha: normalizeText(run.head_sha),
    htmlUrl: normalizeText(run.html_url),
    id: normalizeNumber(run.id),
    jobs,
    name: normalizeText(run.name) || "Unnamed workflow",
    runAttempt: Math.max(1, normalizeNumber(run.run_attempt)),
    startedAt: normalizeText(run.run_started_at),
    status: normalizeText(run.status) || "unknown",
    updatedAt: normalizeText(run.updated_at)
  };
}

function isActiveWorkflowStatus(value: unknown): boolean {
  return [
    "in_progress",
    "pending",
    "queued",
    "requested",
    "waiting"
  ].includes(normalizeText(value));
}

function emptyStatusDetails(repository: GitHubRepositoryRef | null): GitHubProjectStatus["details"] {
  return {
    authenticated: false,
    host: repository?.host || "",
    owner: repository?.owner || "",
    repo: repository?.repo || ""
  };
}

async function getGitHubProjectStatus(
  project: GitHubProject = {},
  { execFileAsync = runExecFile }: GitHubCommandOptions = {}
): Promise<GitHubProjectStatus> {
  const repository = resolveGitHubRepository(project);
  if (!repository) {
    return {
      state: "notConfigured",
      summary: "This project does not have a supported GitHub repository.",
      details: emptyStatusDetails(null)
    };
  }

  try {
    await execFileAsync("gh", ["auth", "status", "--hostname", repository.host], {
      timeout: GITHUB_COMMAND_TIMEOUT_MS,
      windowsHide: true
    });
    return {
      state: "ready",
      summary: `Authenticated for ${repository.owner}/${repository.repo}.`,
      details: {
        ...emptyStatusDetails(repository),
        authenticated: true
      }
    };
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {
        state: "unavailable",
        summary: "GitHub CLI was not found in PATH.",
        details: emptyStatusDetails(repository)
      };
    }

    if (isAuthenticationError(error)) {
      return {
        state: "notConfigured",
        summary: `Authenticate GitHub CLI for ${repository.host}.`,
        details: emptyStatusDetails(repository)
      };
    }

    return {
      state: "error",
      summary: "Could not verify GitHub CLI authentication.",
      details: emptyStatusDetails(repository)
    };
  }
}

function requireGitHubRepository(project: GitHubProject): GitHubRepositoryRef {
  const repository = resolveGitHubRepository(project);
  if (!repository) {
    throw new GitHubServiceError(
      "notConfigured",
      "This project does not have a supported GitHub repository."
    );
  }
  return repository;
}

function createGitHubService({
  execFileAsync = runExecFile,
  cache = createAsyncRequestCache(),
  now = Date.now
}: GitHubServiceOptions = {}) {
  async function statusForProject(
    project: GitHubProject = {},
    { force = false }: GitHubServiceRequestOptions = {}
  ): Promise<GitHubProjectStatus> {
    const repository = resolveGitHubRepository(project);
    if (!repository) {
      return getGitHubProjectStatus(project, { execFileAsync });
    }
    const key = `auth:${getRepositoryKey(repository)}`;
    return cache.get(
      key,
      () => getGitHubProjectStatus(project, { execFileAsync }),
      {
        force,
        ttlMs: GITHUB_AUTH_CACHE_TTL_MS
      }
    );
  }

  async function loadWorkflowRuns(
    repository: GitHubRepositoryRef,
    { force = false }: GitHubServiceRequestOptions = {}
  ): Promise<GitHubRawRun[]> {
    const repositoryKey = getRepositoryKey(repository);
    return cache.get(
      `actions:runs:${repositoryKey}`,
      async () => {
        const payload = await runGitHubApiJson(
          repository,
          `repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/actions/runs?per_page=20`,
          { execFileAsync }
        );
        if (!isRecord(payload) || !Array.isArray(payload.workflow_runs)) {
          throw new GitHubServiceError("invalidResponse", "GitHub returned an invalid workflow run list.");
        }
        return payload.workflow_runs.filter(isRecord) as GitHubRawRun[];
      },
      {
        force,
        ttlMs: GITHUB_RUNS_CACHE_TTL_MS
      }
    );
  }

  async function loadWorkflowJobs(
    repository: GitHubRepositoryRef,
    runId: number,
    { force = false }: GitHubServiceRequestOptions = {}
  ): Promise<GitHubWorkflowJob[]> {
    const repositoryKey = getRepositoryKey(repository);
    return cache.get(
      `actions:jobs:${repositoryKey}:${runId}`,
      async () => {
        const payload = await runGitHubApiJson(
          repository,
          `repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
          { execFileAsync }
        );
        if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
          throw new GitHubServiceError("invalidResponse", "GitHub returned an invalid workflow job list.");
        }
        return payload.jobs
          .map(normalizeWorkflowJob)
          .filter((job): job is GitHubWorkflowJob => !!job);
      },
      {
        force,
        ttlMs: GITHUB_ACTIVE_JOBS_CACHE_TTL_MS
      }
    );
  }

  async function actionsSnapshotForProject(
    project: GitHubProject = {},
    { force = false }: GitHubServiceRequestOptions = {}
  ): Promise<GitHubActionsSnapshot> {
    const repository = resolveGitHubRepository(project);
    const status = await statusForProject(project);
    if (!repository || status.state !== "ready") {
      return {
        activeRunCount: 0,
        refreshedAt: new Date(now()).toISOString(),
        repository,
        runs: [],
        status
      };
    }

    const rawRuns = await loadWorkflowRuns(repository, { force });
    const runs: GitHubWorkflowRun[] = [];
    for (const rawRun of rawRuns) {
      const run = normalizeWorkflowRun(rawRun);
      if (!run) {
        continue;
      }
      const jobs = isActiveWorkflowStatus(run.status)
        ? await loadWorkflowJobs(repository, run.id, { force })
        : [];
      runs.push({
        ...run,
        jobs
      });
    }

    return {
      activeRunCount: runs.filter((run) => isActiveWorkflowStatus(run.status)).length,
      refreshedAt: new Date(now()).toISOString(),
      repository,
      runs,
      status
    };
  }

  function invalidateProject(project: GitHubProject = {}, domain = ""): void {
    const repository = requireGitHubRepository(project);
    const repositoryKey = getRepositoryKey(repository);
    if (!domain || domain === "auth") {
      cache.invalidate(`auth:${repositoryKey}`);
    }
    if (!domain || domain === "actions") {
      cache.invalidate(`actions:runs:${repositoryKey}`);
      cache.invalidate(`actions:jobs:${repositoryKey}:`);
    }
  }

  return Object.freeze({
    actionsSnapshotForProject,
    invalidateProject,
    statusForProject
  });
}

module.exports = {
  DEFAULT_GITHUB_HOST,
  GitHubServiceError,
  createAsyncRequestCache,
  createGitHubService,
  getGitHubProjectStatus,
  isActiveWorkflowStatus,
  isSupportedGitHubHost,
  normalizeGitHubHost,
  normalizeGitHubCommandError,
  normalizeWorkflowJob,
  normalizeWorkflowRun,
  normalizeWorkflowStep,
  parseGitHubRepositoryUrl,
  runGitHubApiJson,
  resolveGitHubRepository
};

export {};
