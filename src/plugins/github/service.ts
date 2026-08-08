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
const GITHUB_PULL_REQUESTS_CACHE_TTL_MS = 30 * 1000;
const GITHUB_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;

const GITHUB_PULL_REQUESTS_QUERY = `
query BoatyardPullRequests($owner: String!, $name: String!, $searchQuery: String!) {
  viewer {
    login
  }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        updatedAt
        isDraft
        mergeStateStatus
        reviewDecision
        headRefName
        baseRefName
        author {
          login
        }
        reviewRequests(first: 50) {
          nodes {
            requestedReviewer {
              __typename
              ... on User {
                login
              }
              ... on Team {
                name
                slug
              }
            }
          }
        }
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
                detailsUrl
              }
              ... on StatusContext {
                context
                state
                targetUrl
              }
            }
          }
        }
      }
    }
  }
  search(query: $searchQuery, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number
        repository {
          nameWithOwner
        }
      }
    }
  }
}
`;

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

type GitHubRequestPriority = "background" | "foreground" | "interactive";

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
  now?: () => number;
  priority?: GitHubRequestPriority;
  scheduler?: GitHubRequestScheduler;
  timeoutMs?: number;
};

type GitHubGraphQlVariables = Record<string, string>;

type GitHubServiceOptions = GitHubCommandOptions & {
  cache?: ReturnType<typeof createAsyncRequestCache>;
  now?: () => number;
  scheduler?: GitHubRequestScheduler;
};

type GitHubServiceRequestOptions = {
  force?: boolean;
  priority?: GitHubRequestPriority;
};

type GitHubRequestSchedulerOptions = {
  cooldownMs?: number;
  now?: () => number;
};

type GitHubScheduledRequestOptions = {
  priority?: GitHubRequestPriority;
};

type GitHubScheduledRequest<T> = {
  load: () => Promise<T>;
  priority: GitHubRequestPriority;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
  sequence: number;
};

type GitHubRequestScheduler = {
  pause(delayMs: number): void;
  schedule<T>(load: () => Promise<T>, options?: GitHubScheduledRequestOptions): Promise<T>;
};

type GitHubApiOutput = {
  payload: unknown;
  rateLimitDelayMs: number;
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

type GitHubPullRequestCheck = {
  conclusion: string;
  name: string;
  status: string;
  url: string;
};

type GitHubPullRequestCiState = "blocked" | "failed" | "none" | "passed" | "running";
type GitHubPullRequestMergeState = "blocked" | "clean" | "conflicting" | "unknown";
type GitHubPullRequestReviewState = "approved" | "changesRequested" | "none" | "required";

type GitHubPullRequestSummary = {
  authorLogin: string;
  baseRefName: string;
  checks: GitHubPullRequestCheck[];
  ciState: GitHubPullRequestCiState;
  headRefName: string;
  isAuthoredByViewer: boolean;
  isDraft: boolean;
  isReadyToMerge: boolean;
  isReviewRequestedFromViewer: boolean;
  mergeState: GitHubPullRequestMergeState;
  number: number;
  reviewState: GitHubPullRequestReviewState;
  title: string;
  updatedAt: string;
  url: string;
};

type GitHubPullRequestsSnapshot = {
  pullRequests: GitHubPullRequestSummary[];
  refreshedAt: string;
  repository: GitHubRepositoryRef | null;
  status: GitHubProjectStatus;
  viewerLogin: string;
};

class GitHubServiceError extends Error {
  code: GitHubServiceErrorCode;
  retryAfterMs: number;

  constructor(
    code: GitHubServiceErrorCode,
    message: string,
    { retryAfterMs = 0 }: { retryAfterMs?: number } = {}
  ) {
    super(message);
    this.name = "GitHubServiceError";
    this.code = code;
    this.retryAfterMs = Math.max(0, retryAfterMs);
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

function getRateLimitDelayMs(error: unknown, now = Date.now): number {
  const output = getErrorOutput(error);
  const retryAfter = output.match(/retry[- ]after\s*:?\s*(\d+)/i);
  if (retryAfter) {
    return Number(retryAfter[1]) * 1000;
  }

  const reset = output.match(/x-ratelimit-reset\s*:\s*(\d+)/i);
  if (reset) {
    return Math.max(0, Number(reset[1]) * 1000 - now());
  }

  const wait = output.match(/(?:please\s+)?wait\s+(\d+)\s+(second|minute|hour)s?/i);
  if (!wait) {
    return 0;
  }
  const multipliers: Record<string, number> = {
    hour: 60 * 60 * 1000,
    minute: 60 * 1000,
    second: 1000
  };
  return Number(wait[1]) * multipliers[wait[2].toLowerCase()];
}

function normalizeGitHubCommandError(
  error: unknown,
  { now = Date.now }: { now?: () => number } = {}
): GitHubServiceError {
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
    return new GitHubServiceError(
      "rateLimited",
      "GitHub API rate limit reached. Refresh will resume later.",
      { retryAfterMs: getRateLimitDelayMs(error, now) }
    );
  }

  return new GitHubServiceError("unknown", "GitHub request failed.");
}

function normalizeGitHubRequestPriority(value: unknown): GitHubRequestPriority {
  return value === "interactive" || value === "foreground"
    ? value
    : "background";
}

function createRateLimitError(): GitHubServiceError {
  return new GitHubServiceError(
    "rateLimited",
    "GitHub API rate limit reached. Refresh will resume later."
  );
}

function createGitHubRequestScheduler({
  cooldownMs = GITHUB_RATE_LIMIT_COOLDOWN_MS,
  now = Date.now
}: GitHubRequestSchedulerOptions = {}): GitHubRequestScheduler {
  const queue: Array<GitHubScheduledRequest<unknown>> = [];
  const priorityWeights: Record<GitHubRequestPriority, number> = {
    background: 0,
    foreground: 1,
    interactive: 2
  };
  let active = false;
  let blockedUntil = 0;
  let nextSequence = 0;

  function isRateLimited(): boolean {
    return blockedUntil > now();
  }

  function rejectQueued(error: unknown): void {
    for (const request of queue.splice(0)) {
      request.reject(error);
    }
  }

  function pause(delayMs: number): void {
    const normalizedDelay = Math.max(0, delayMs);
    if (!normalizedDelay) {
      return;
    }
    blockedUntil = Math.max(blockedUntil, now() + normalizedDelay);
    rejectQueued(createRateLimitError());
  }

  function sortQueue(): void {
    queue.sort((left, right) => (
      priorityWeights[right.priority] - priorityWeights[left.priority]
      || left.sequence - right.sequence
    ));
  }

  async function drain(): Promise<void> {
    if (active || !queue.length) {
      return;
    }
    if (isRateLimited()) {
      rejectQueued(createRateLimitError());
      return;
    }

    const request = queue.shift();
    if (!request) {
      return;
    }
    active = true;
    try {
      request.resolve(await request.load());
    } catch (error) {
      request.reject(error);
      if (error instanceof GitHubServiceError && error.code === "rateLimited") {
        blockedUntil = now() + Math.max(error.retryAfterMs, cooldownMs);
        rejectQueued(error);
      }
    } finally {
      active = false;
      void drain();
    }
  }

  function schedule<T>(
    load: () => Promise<T>,
    { priority = "background" }: GitHubScheduledRequestOptions = {}
  ): Promise<T> {
    if (isRateLimited()) {
      return Promise.reject(createRateLimitError());
    }

    return new Promise<T>((resolve, reject) => {
      queue.push({
        load,
        priority: normalizeGitHubRequestPriority(priority),
        reject,
        resolve,
        sequence: nextSequence
      } as GitHubScheduledRequest<unknown>);
      nextSequence += 1;
      sortQueue();
      void drain();
    });
  }

  return Object.freeze({ pause, schedule });
}

function parseJsonOutput(stdout: unknown): unknown {
  try {
    return JSON.parse(String(stdout || ""));
  } catch {
    throw new GitHubServiceError("invalidResponse", "GitHub CLI returned invalid JSON.");
  }
}

function parseGitHubApiOutput(stdout: unknown, now = Date.now): GitHubApiOutput {
  const source = String(stdout || "").replace(/\r\n/g, "\n");
  const responseStart = source.startsWith("HTTP/")
    ? 0
    : source.lastIndexOf("\nHTTP/") + 1;
  if (responseStart < 0 || !source.slice(responseStart).startsWith("HTTP/")) {
    return {
      payload: parseJsonOutput(source),
      rateLimitDelayMs: 0
    };
  }

  const headerEnd = source.indexOf("\n\n", responseStart);
  if (headerEnd < 0) {
    return {
      payload: parseJsonOutput(source),
      rateLimitDelayMs: 0
    };
  }
  const headers = source.slice(responseStart, headerEnd);
  const body = source.slice(headerEnd + 2);
  const retryAfter = headers.match(/^retry-after\s*:\s*(\d+)/im);
  const remaining = headers.match(/^x-ratelimit-remaining\s*:\s*(\d+)/im);
  const reset = headers.match(/^x-ratelimit-reset\s*:\s*(\d+)/im);
  let rateLimitDelayMs = retryAfter
    ? Number(retryAfter[1]) * 1000
    : 0;
  if (!rateLimitDelayMs && remaining?.[1] === "0" && reset) {
    rateLimitDelayMs = Math.max(0, Number(reset[1]) * 1000 - now());
  }

  return {
    payload: parseJsonOutput(body),
    rateLimitDelayMs
  };
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
    now = Date.now,
    priority = "background",
    scheduler,
    timeoutMs = GITHUB_API_TIMEOUT_MS
  }: GitHubApiOptions = {}
): Promise<unknown> {
  const load = async () => {
    try {
      const { stdout } = await execFileAsync("gh", [
        "api",
        "--hostname",
        repository.host,
        "--include",
        endpoint
      ], {
        timeout: timeoutMs,
        windowsHide: true
      });
      const output = parseGitHubApiOutput(stdout, now);
      scheduler?.pause(output.rateLimitDelayMs);
      return output.payload;
    } catch (error) {
      throw normalizeGitHubCommandError(error, { now });
    }
  };
  return scheduler
    ? scheduler.schedule(load, { priority })
    : load();
}

async function runGitHubGraphQlJson(
  repository: GitHubRepositoryRef,
  query: string,
  variables: GitHubGraphQlVariables,
  {
    execFileAsync = runExecFile,
    now = Date.now,
    priority = "background",
    scheduler,
    timeoutMs = GITHUB_API_TIMEOUT_MS
  }: GitHubApiOptions = {}
): Promise<unknown> {
  const variableArgs = Object.entries(variables).flatMap(([key, value]) => [
    "-f",
    `${key}=${value}`
  ]);
  const load = async () => {
    try {
      const { stdout } = await execFileAsync("gh", [
        "api",
        "graphql",
        "--hostname",
        repository.host,
        "--include",
        "-f",
        `query=${query}`,
        ...variableArgs
      ], {
        timeout: timeoutMs,
        windowsHide: true
      });
      const output = parseGitHubApiOutput(stdout, now);
      scheduler?.pause(output.rateLimitDelayMs);
      return output.payload;
    } catch (error) {
      throw normalizeGitHubCommandError(error, { now });
    }
  };
  return scheduler
    ? scheduler.schedule(load, { priority })
    : load();
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

function normalizePullRequestCheck(value: unknown): GitHubPullRequestCheck | null {
  if (!isRecord(value)) {
    return null;
  }
  const isCheckRun = normalizeText(value.__typename) === "CheckRun";
  return {
    conclusion: normalizeText(isCheckRun ? value.conclusion : value.state).toUpperCase(),
    name: normalizeText(isCheckRun ? value.name : value.context) || "Unnamed check",
    status: normalizeText(isCheckRun ? value.status : value.state).toUpperCase(),
    url: normalizeText(isCheckRun ? value.detailsUrl : value.targetUrl)
  };
}

function normalizePullRequestCiState(
  statusCheckRollup: unknown
): GitHubPullRequestCiState {
  if (!isRecord(statusCheckRollup)) {
    return "none";
  }
  const contexts = isRecord(statusCheckRollup.contexts) && Array.isArray(statusCheckRollup.contexts.nodes)
    ? statusCheckRollup.contexts.nodes.map(normalizePullRequestCheck).filter((check): check is GitHubPullRequestCheck => !!check)
    : [];
  const rollupState = normalizeText(statusCheckRollup.state).toUpperCase();
  const conclusions = contexts.map((check) => check.conclusion);
  const statuses = contexts.map((check) => check.status);

  if (conclusions.some((conclusion) => ["ACTION_REQUIRED", "STALE"].includes(conclusion))) {
    return "blocked";
  }
  if (
    conclusions.some((conclusion) => [
      "CANCELLED",
      "ERROR",
      "FAILURE",
      "STARTUP_FAILURE",
      "TIMED_OUT"
    ].includes(conclusion))
    || rollupState === "ERROR"
    || rollupState === "FAILURE"
  ) {
    return "failed";
  }
  if (
    statuses.some((status) => [
      "EXPECTED",
      "IN_PROGRESS",
      "PENDING",
      "QUEUED",
      "REQUESTED",
      "WAITING"
    ].includes(status))
    || rollupState === "EXPECTED"
    || rollupState === "PENDING"
  ) {
    return "running";
  }
  if (rollupState === "SUCCESS" || contexts.length) {
    return "passed";
  }
  return "blocked";
}

function normalizePullRequestReviewState(value: unknown): GitHubPullRequestReviewState {
  switch (normalizeText(value).toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changesRequested";
    case "REVIEW_REQUIRED":
      return "required";
    default:
      return "none";
  }
}

function normalizePullRequestMergeState(value: unknown): GitHubPullRequestMergeState {
  switch (normalizeText(value).toUpperCase()) {
    case "CLEAN":
    case "HAS_HOOKS":
      return "clean";
    case "DIRTY":
      return "conflicting";
    case "BEHIND":
    case "BLOCKED":
    case "DRAFT":
    case "UNSTABLE":
      return "blocked";
    default:
      return "unknown";
  }
}

function normalizePullRequest(
  value: unknown,
  {
    requestedReviewNumbers = new Set<number>(),
    viewerLogin = ""
  }: {
    requestedReviewNumbers?: Set<number>;
    viewerLogin?: string;
  } = {}
): GitHubPullRequestSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const author = isRecord(value.author) ? value.author : {};
  const authorLogin = normalizeText(author.login);
  const reviewState = normalizePullRequestReviewState(value.reviewDecision);
  const mergeState = normalizePullRequestMergeState(value.mergeStateStatus);
  const rollup = isRecord(value.statusCheckRollup) ? value.statusCheckRollup : null;
  const contexts = rollup && isRecord(rollup.contexts) && Array.isArray(rollup.contexts.nodes)
    ? rollup.contexts.nodes.map(normalizePullRequestCheck).filter((check): check is GitHubPullRequestCheck => !!check)
    : [];
  const ciState = normalizePullRequestCiState(rollup);
  const isDraft = Boolean(value.isDraft);
  const normalizedViewerLogin = viewerLogin.toLowerCase();
  const isAuthoredByViewer = !!normalizedViewerLogin && authorLogin.toLowerCase() === normalizedViewerLogin;
  const number = normalizeNumber(value.number);
  const isReadyToMerge = !isDraft
    && mergeState === "clean"
    && ["approved", "none"].includes(reviewState)
    && ["none", "passed"].includes(ciState);

  return {
    authorLogin,
    baseRefName: normalizeText(value.baseRefName),
    checks: contexts,
    ciState,
    headRefName: normalizeText(value.headRefName),
    isAuthoredByViewer,
    isDraft,
    isReadyToMerge,
    isReviewRequestedFromViewer: requestedReviewNumbers.has(number),
    mergeState,
    number,
    reviewState,
    title: normalizeText(value.title) || `Pull request #${number}`,
    updatedAt: normalizeText(value.updatedAt),
    url: normalizeText(value.url)
  };
}

function normalizePullRequestsGraphQl(
  value: unknown
): Pick<GitHubPullRequestsSnapshot, "pullRequests" | "viewerLogin"> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new GitHubServiceError("invalidResponse", "GitHub returned an invalid pull request response.");
  }
  const data = value.data;
  const viewer = isRecord(data.viewer) ? data.viewer : {};
  const viewerLogin = normalizeText(viewer.login);
  const repository = isRecord(data.repository) ? data.repository : {};
  const pullRequestConnection = isRecord(repository.pullRequests) ? repository.pullRequests : {};
  if (!Array.isArray(pullRequestConnection.nodes)) {
    throw new GitHubServiceError("invalidResponse", "GitHub returned an invalid pull request list.");
  }
  const search = isRecord(data.search) ? data.search : {};
  const requestedReviewNumbers = new Set(
    Array.isArray(search.nodes)
      ? search.nodes
        .filter(isRecord)
        .map((node) => normalizeNumber(node.number))
        .filter(Boolean)
      : []
  );
  return {
    pullRequests: pullRequestConnection.nodes
      .map((pullRequest) => normalizePullRequest(pullRequest, {
        requestedReviewNumbers,
        viewerLogin
      }))
      .filter((pullRequest): pullRequest is GitHubPullRequestSummary => !!pullRequest),
    viewerLogin
  };
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
  now = Date.now,
  scheduler: schedulerOverride
}: GitHubServiceOptions = {}) {
  const scheduler = schedulerOverride || createGitHubRequestScheduler({ now });

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
    {
      force = false,
      priority = "background"
    }: GitHubServiceRequestOptions = {}
  ): Promise<GitHubRawRun[]> {
    const repositoryKey = getRepositoryKey(repository);
    return cache.get(
      `actions:runs:${repositoryKey}`,
      async () => {
        const payload = await runGitHubApiJson(
          repository,
          `repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/actions/runs?per_page=20`,
          {
            execFileAsync,
            now,
            priority,
            scheduler
          }
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
    {
      force = false,
      priority = "background"
    }: GitHubServiceRequestOptions = {}
  ): Promise<GitHubWorkflowJob[]> {
    const repositoryKey = getRepositoryKey(repository);
    return cache.get(
      `actions:jobs:${repositoryKey}:${runId}`,
      async () => {
        const payload = await runGitHubApiJson(
          repository,
          `repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
          {
            execFileAsync,
            now,
            priority,
            scheduler
          }
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
    {
      force = false,
      priority = "background"
    }: GitHubServiceRequestOptions = {}
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

    const rawRuns = await loadWorkflowRuns(repository, { force, priority });
    const runs: GitHubWorkflowRun[] = [];
    for (const rawRun of rawRuns) {
      const run = normalizeWorkflowRun(rawRun);
      if (!run) {
        continue;
      }
      const jobs = isActiveWorkflowStatus(run.status)
        ? await loadWorkflowJobs(repository, run.id, { force, priority })
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

  async function pullRequestsSnapshotForProject(
    project: GitHubProject = {},
    {
      force = false,
      priority = "background"
    }: GitHubServiceRequestOptions = {}
  ): Promise<GitHubPullRequestsSnapshot> {
    const repository = resolveGitHubRepository(project);
    const status = await statusForProject(project);
    if (!repository || status.state !== "ready") {
      return {
        pullRequests: [],
        refreshedAt: new Date(now()).toISOString(),
        repository,
        status,
        viewerLogin: ""
      };
    }

    const repositoryKey = getRepositoryKey(repository);
    const normalized = await cache.get(
      `pullRequests:${repositoryKey}`,
      async () => {
        const payload = await runGitHubGraphQlJson(
          repository,
          GITHUB_PULL_REQUESTS_QUERY,
          {
            name: repository.repo,
            owner: repository.owner,
            searchQuery: `repo:${repository.owner}/${repository.repo} is:pr is:open review-requested:@me`
          },
          {
            execFileAsync,
            now,
            priority,
            scheduler
          }
        );
        return normalizePullRequestsGraphQl(payload);
      },
      {
        force,
        ttlMs: GITHUB_PULL_REQUESTS_CACHE_TTL_MS
      }
    );

    return {
      ...normalized,
      refreshedAt: new Date(now()).toISOString(),
      repository,
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
    if (!domain || domain === "pullRequests") {
      cache.invalidate(`pullRequests:${repositoryKey}`);
    }
  }

  return Object.freeze({
    actionsSnapshotForProject,
    invalidateProject,
    pullRequestsSnapshotForProject,
    statusForProject
  });
}

module.exports = {
  DEFAULT_GITHUB_HOST,
  GITHUB_PULL_REQUESTS_QUERY,
  GitHubServiceError,
  createAsyncRequestCache,
  createGitHubRequestScheduler,
  createGitHubService,
  getGitHubProjectStatus,
  isActiveWorkflowStatus,
  isSupportedGitHubHost,
  normalizeGitHubHost,
  normalizeGitHubCommandError,
  normalizePullRequest,
  normalizePullRequestCiState,
  normalizePullRequestMergeState,
  normalizePullRequestReviewState,
  normalizePullRequestsGraphQl,
  normalizeWorkflowJob,
  normalizeWorkflowRun,
  normalizeWorkflowStep,
  parseGitHubApiOutput,
  parseGitHubRepositoryUrl,
  runGitHubApiJson,
  runGitHubGraphQlJson,
  resolveGitHubRepository
};

export {};
