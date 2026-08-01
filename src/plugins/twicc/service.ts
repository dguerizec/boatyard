"use strict";

import type { ExecFileAsync } from "../../shared/pluginTypes";

const path = require("node:path");

const DEFAULT_TWICC_BASE_URL = "http://localhost:3500";
const TWICC_SESSION_FLOW_ANNOTATION = "sessionFlowLane";
const TWICC_PROJECT_CACHE_TTL_MS = 600000;

type TwiccProject = {
  directory?: string;
  git_root?: string;
  id?: string;
  worktree_of?: string;
  worktrees?: string[];
};

type TwiccProcess = {
  last_state_change_at?: string;
  project_id?: string;
  session_id?: string;
  session_title?: string;
  state?: string;
};

type TwiccSession = {
  annotations?: Record<string, unknown>;
  archived?: unknown;
  context_usage?: number;
  created_at?: string;
  git_branch?: string;
  id?: string;
  last_new_content_at?: string;
  last_updated_at?: string;
  mtime?: number;
  pinned?: unknown;
  project_id?: string;
  provider?: string;
  title?: string;
  total_cost?: number;
  user_message_count?: number;
};

type TwiccSessionFlowLane = "backlog" | "in_progress" | "testing";
type TwiccSessionFlowItem = {
  branch: string;
  contextUsage: number;
  id: string;
  lane: TwiccSessionFlowLane;
  lastActivityAt: string;
  processState: string;
  provider: string;
  title: string;
  totalCost: number;
  userMessageCount: number;
};

type TwiccNormalizedProcessState = "input" | "working" | "done";
type TwiccSessionStatus = {
  id: string;
  lastStateChangeAt: string;
  rawState: string;
  state: TwiccNormalizedProcessState;
  title: string;
};
type TwiccProjectProcessStatus = {
  count: number;
  sessions: TwiccSessionStatus[];
  state: TwiccNormalizedProcessState;
};
type TwiccProjectProcessStatuses = Record<string, TwiccProjectProcessStatus>;
type TwiccGlobalConfig = {
  twiccApiToken?: unknown;
  twiccBaseUrl?: unknown;
};
type TwiccFetchResponse = {
  json(): Promise<unknown>;
  ok?: boolean;
  status?: number;
};
type TwiccFetch = (url: string, init?: Record<string, unknown>) => Promise<TwiccFetchResponse>;
type TwiccCommandOptions = {
  execFileAsync?: ExecFileAsync;
  fetch?: TwiccFetch;
  globalConfig?: TwiccGlobalConfig;
};
type TwiccProjectMatch = { project?: TwiccProject; matchType: "exact" | "parent" };
type TwiccProjectCacheOptions = {
  loadProjects?: (options?: TwiccCommandOptions) => Promise<TwiccProject[]>;
  now?: () => number;
  ttlMs?: number;
};
type TwiccProjectCacheGetOptions = { force?: boolean; projectIds?: string[] };
type TwiccProjectInspection = { id: string; matchType: "exact" | "parent"; url: string };
type BoatyardProject = { id?: string; sourcePath?: string };
type TwiccSessionCreationInput = {
  project?: unknown;
  prompt?: unknown;
  sessionFlowLane?: unknown;
  title?: unknown;
  worktreeBranch?: unknown;
  worktreePath?: unknown;
  worktreeStartFrom?: unknown;
};
type TwiccCreatedSession = {
  projectId: string;
  provider: string;
  sessionId: string;
  status: string;
  title: string;
};
type GitWorktreeEntry = {
  branch: string;
  detached: boolean;
  path: string;
  usable: boolean;
};
type GitSessionCreationOptions = {
  branches: Array<{ checkedOut: boolean; name: string }>;
  defaultWorktreeBase: string;
  gitRoot: string;
  worktrees: GitWorktreeEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTwiccProject(value: unknown): value is TwiccProject {
  return isRecord(value) && typeof value.id === "string" && value.id.trim() !== "";
}

function isTwiccProcess(value: unknown): value is TwiccProcess {
  return isRecord(value);
}

function isTwiccSession(value: unknown): value is TwiccSession {
  return isRecord(value) && typeof value.id === "string" && value.id.trim() !== "";
}

function normalizePathForMatch(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? path.resolve(trimmed) : "";
}

function getProjectPaths(project: unknown): string[] {
  if (!isTwiccProject(project)) {
    return [];
  }

  return [project.directory, project.git_root]
    .map(normalizePathForMatch)
    .filter(Boolean);
}

function findTwiccProjectForPath(projects: unknown, sourcePath: unknown): TwiccProject | null {
  return findTwiccProjectMatchForPath(projects, sourcePath)?.project || null;
}

function findTwiccProjectMatchForPath(projects: unknown, sourcePath: unknown): TwiccProjectMatch | null {
  if (!Array.isArray(projects)) {
    return null;
  }

  const projectList = projects.filter(isTwiccProject);
  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    return null;
  }

  const exactMatch = projectList.find((project) => getProjectPaths(project).includes(normalizedSourcePath));
  if (exactMatch) {
    return {
      project: exactMatch,
      matchType: "exact"
    };
  }

  return projectList
    .map((project) => ({
      project,
      matchedPath: getProjectPaths(project)
        .filter((projectPath) => normalizedSourcePath.startsWith(`${projectPath}${path.sep}`))
        .sort((left, right) => right.length - left.length)[0] || ""
    }))
    .filter((match) => match.matchedPath)
    .sort((left, right) => right.matchedPath.length - left.matchedPath.length)
    .map((match) => ({
      project: match.project,
      matchType: "parent" as const
    }))[0] || null;
}

function buildTwiccProjectUrl(projectId: unknown, baseUrl = DEFAULT_TWICC_BASE_URL): string {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id) {
    return "";
  }

  try {
    const parsed = new URL(baseUrl || DEFAULT_TWICC_BASE_URL);
    parsed.pathname = `/project/${encodeURIComponent(id)}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeBaseUrl(value: unknown): string {
  return String(value || DEFAULT_TWICC_BASE_URL).replace(/\/+$/g, "");
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeCommandError(error: unknown, fallback: string): string {
  const commandError = isRecord(error) ? error : {};
  return normalizeText(commandError.stderr)
    || normalizeText(commandError.stdout)
    || normalizeText(commandError.message)
    || fallback;
}

function getFetch(fetchOverride?: TwiccFetch): TwiccFetch | null {
  if (typeof fetchOverride === "function") {
    return fetchOverride;
  }

  const globalFetch = globalThis.fetch;
  return typeof globalFetch === "function"
    ? (globalFetch.bind(globalThis) as TwiccFetch)
    : null;
}

function shouldUseRpc({ fetch: fetchOverride, globalConfig = {} }: TwiccCommandOptions = {}): boolean {
  return typeof fetchOverride === "function" || String(globalConfig.twiccBaseUrl || "").trim() !== "";
}

async function rpcCommand(
  commandPath: string,
  body: Record<string, unknown>,
  { fetch: fetchOverride, globalConfig = {} }: TwiccCommandOptions = {}
): Promise<unknown> {
  const request = getFetch(fetchOverride);
  if (!request) {
    throw new Error("Fetch is unavailable.");
  }

  const token = String(globalConfig.twiccApiToken || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await request(`${normalizeBaseUrl(globalConfig.twiccBaseUrl)}/rpc/${commandPath.replace(/^\/+/g, "")}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response?.ok) {
    throw new Error(`TwiCC RPC ${commandPath} failed with HTTP ${response?.status || "error"}.`);
  }

  const payload = await response.json();
  if (!isRecord(payload)) {
    throw new Error(`TwiCC RPC ${commandPath} returned an invalid response.`);
  }
  if (payload.exit_code && payload.exit_code !== 0) {
    throw new Error(String(payload.error || `TwiCC RPC ${commandPath} failed.`));
  }
  if (payload.error) {
    throw new Error(String(payload.error));
  }

  return payload.result;
}

async function loadTwiccProjectsFromRpc(options: TwiccCommandOptions = {}): Promise<TwiccProject[]> {
  const projects = await rpcCommand("projects", {
    limit: 1000,
    include_archived: true
  }, options);
  return Array.isArray(projects) ? projects.filter(isTwiccProject) : [];
}

async function loadTwiccProjects({ execFileAsync, ...options }: TwiccCommandOptions = {}): Promise<TwiccProject[]> {
  if (shouldUseRpc(options)) {
    try {
      return await loadTwiccProjectsFromRpc(options);
    } catch {
      // Fall back for older/local setups where only the CLI is available.
    }
  }

  if (typeof execFileAsync !== "function") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("twicc", ["projects", "--limit", "1000", "--include-archived"], {
      timeout: 5000,
      windowsHide: true
    });
    const projects = JSON.parse(String(stdout || "[]"));
    return Array.isArray(projects) ? projects.filter(isTwiccProject) : [];
  } catch {
    return [];
  }
}

function createTwiccProjectCache({
  loadProjects = loadTwiccProjects,
  ttlMs = TWICC_PROJECT_CACHE_TTL_MS,
  now = () => Date.now()
}: TwiccProjectCacheOptions = {}) {
  let projects: TwiccProject[] = [];
  let loadedAt = 0;
  let loaded = false;

  function invalidate(): void {
    projects = [];
    loadedAt = 0;
    loaded = false;
  }

  function hasUnknownProjectIds(projectIds: string[] = []): boolean {
    const knownIds = new Set(projects.map((project) => String(project?.id || "").trim()).filter(Boolean));
    return projectIds.some((projectId) => !knownIds.has(String(projectId || "").trim()));
  }

  async function get(options: TwiccCommandOptions = {}, { force = false, projectIds = [] }: TwiccProjectCacheGetOptions = {}): Promise<TwiccProject[]> {
    const expired = !loaded || now() - loadedAt >= ttlMs;
    if (force || expired || hasUnknownProjectIds(projectIds)) {
      projects = await loadProjects(options);
      loadedAt = now();
      loaded = true;
    }

    return projects;
  }

  return Object.freeze({
    get,
    invalidate
  });
}

async function loadTwiccProcessesFromRpc(options: TwiccCommandOptions = {}): Promise<TwiccProcess[]> {
  const processes = await rpcCommand("processes", {
    limit: 1000,
    include_hidden: true
  }, options);
  return Array.isArray(processes) ? processes.filter(isTwiccProcess) : [];
}

async function loadTwiccProcesses({ execFileAsync, ...options }: TwiccCommandOptions = {}): Promise<TwiccProcess[]> {
  if (shouldUseRpc(options)) {
    try {
      return await loadTwiccProcessesFromRpc(options);
    } catch {
      // Fall back for older/local setups where only the CLI is available.
    }
  }

  if (typeof execFileAsync !== "function") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("twicc", ["processes", "--limit", "1000", "--include-hidden"], {
      timeout: 5000,
      windowsHide: true
    });
    const processes = JSON.parse(String(stdout || "[]"));
    return Array.isArray(processes) ? processes.filter(isTwiccProcess) : [];
  } catch {
    return [];
  }
}

async function loadTwiccSessionsFromRpc(
  project: unknown,
  options: TwiccCommandOptions = {}
): Promise<TwiccSession[]> {
  const projectReference = String(project || "").trim();
  if (!projectReference) {
    return [];
  }

  const sessions = await rpcCommand("sessions", {
    project: projectReference,
    limit: 1000
  }, options);
  return Array.isArray(sessions) ? sessions.filter(isTwiccSession) : [];
}

async function loadTwiccSessions(
  project: unknown,
  { execFileAsync, ...options }: TwiccCommandOptions = {}
): Promise<TwiccSession[]> {
  const projectReference = String(project || "").trim();
  if (!projectReference) {
    return [];
  }

  if (shouldUseRpc(options)) {
    try {
      return await loadTwiccSessionsFromRpc(projectReference, options);
    } catch {
      // Fall back for older/local setups where only the CLI is available.
    }
  }

  if (typeof execFileAsync !== "function") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("twicc", [
      "sessions",
      "--project",
      projectReference,
      "--limit",
      "1000"
    ], {
      timeout: 10000,
      windowsHide: true
    });
    const sessions = JSON.parse(String(stdout || "[]"));
    return Array.isArray(sessions) ? sessions.filter(isTwiccSession) : [];
  } catch {
    return [];
  }
}

function asSessionFlowLane(value: unknown): TwiccSessionFlowLane | "" {
  return value === "backlog" || value === "in_progress" || value === "testing"
    ? value
    : "";
}

function getAnnotatedSessionFlowLane(session: TwiccSession): TwiccSessionFlowLane | "" {
  const annotations = isRecord(session.annotations) ? session.annotations : {};
  const boatyard = isRecord(annotations.boatyard) ? annotations.boatyard : {};
  return asSessionFlowLane(
    boatyard[TWICC_SESSION_FLOW_ANNOTATION]
      ?? annotations[`boatyard.${TWICC_SESSION_FLOW_ANNOTATION}`]
  );
}

function getSessionActivityTime(session: TwiccSession): number {
  const timestamps = [session.last_new_content_at, session.last_updated_at, session.created_at]
    .map((value) => Date.parse(String(value || "")))
    .filter(Number.isFinite);
  const mtime = Number(session.mtime);
  if (Number.isFinite(mtime)) {
    timestamps.push(mtime * 1000);
  }
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function getTwiccSessionFlow(
  sessions: unknown,
  processes: unknown
): TwiccSessionFlowItem[] {
  const processBySessionId = new Map(
    (Array.isArray(processes) ? processes : [])
      .filter(isTwiccProcess)
      .map((process) => [String(process.session_id || "").trim(), process] as const)
      .filter(([sessionId]) => sessionId)
  );
  const activeStates = new Set(["assistant_turn", "awaiting_user_input", "starting"]);

  return (Array.isArray(sessions) ? sessions : [])
    .filter(isTwiccSession)
    .filter((session) => session.archived !== true)
    .map((session) => {
      const sessionId = String(session.id || "").trim();
      const process = processBySessionId.get(sessionId);
      const processState = String(process?.state || "").trim();
      const annotatedLane = getAnnotatedSessionFlowLane(session);
      const activityTime = getSessionActivityTime(session);
      const lane = annotatedLane
        || (activeStates.has(processState)
          ? "in_progress"
          : session.pinned
            ? "backlog"
            : "testing");

      return {
        branch: String(session.git_branch || "").trim(),
        contextUsage: Number(session.context_usage) || 0,
        id: sessionId,
        lane,
        lastActivityAt: activityTime ? new Date(activityTime).toISOString() : "",
        processState,
        provider: String(session.provider || "").trim(),
        title: String(session.title || "Untitled session").trim() || "Untitled session",
        totalCost: Number(session.total_cost) || 0,
        userMessageCount: Number(session.user_message_count) || 0,
        activityTime
      };
    })
    .sort((left, right) => right.activityTime - left.activityTime)
    .map(({ activityTime: _activityTime, ...session }) => session);
}

async function loadTwiccSessionFlow(
  project: unknown,
  options: TwiccCommandOptions = {}
): Promise<TwiccSessionFlowItem[]> {
  const [sessions, processes] = await Promise.all([
    loadTwiccSessions(project, options),
    loadTwiccProcesses(options)
  ]);
  return getTwiccSessionFlow(sessions, processes);
}

async function updateTwiccSessionFlowLaneFromRpc(
  sessionId: string,
  lane: TwiccSessionFlowLane,
  options: TwiccCommandOptions = {}
): Promise<unknown> {
  return rpcCommand("update-session/annotations", {
    session_id: sessionId,
    operations: [`set:boatyard.${TWICC_SESSION_FLOW_ANNOTATION}=${lane}`]
  }, options);
}

async function updateTwiccSessionFlowLane(
  sessionId: unknown,
  lane: unknown,
  { execFileAsync, ...options }: TwiccCommandOptions = {}
): Promise<unknown> {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedLane = asSessionFlowLane(lane);
  if (!normalizedSessionId) {
    throw new Error("TwiCC session id is required.");
  }
  if (!normalizedLane) {
    throw new Error(`Invalid TwiCC session flow lane: ${String(lane || "")}`);
  }

  if (shouldUseRpc(options)) {
    try {
      return await updateTwiccSessionFlowLaneFromRpc(normalizedSessionId, normalizedLane, options);
    } catch {
      // The annotation write is idempotent, so a local fallback is safe.
    }
  }

  if (typeof execFileAsync !== "function") {
    throw new Error("TwiCC command runner is required.");
  }

  const { stdout } = await execFileAsync("twicc", [
    "update-session",
    normalizedSessionId,
    "annotations",
    `set:boatyard.${TWICC_SESSION_FLOW_ANNOTATION}=${normalizedLane}`
  ], {
    timeout: 30000,
    windowsHide: true
  });
  return JSON.parse(String(stdout || "null"));
}

async function archiveTwiccSessionFromRpc(
  sessionId: string,
  options: TwiccCommandOptions = {}
): Promise<unknown> {
  return rpcCommand("update-session/archive", {
    session_id: sessionId
  }, options);
}

async function archiveTwiccSession(
  sessionId: unknown,
  { execFileAsync, ...options }: TwiccCommandOptions = {}
): Promise<unknown> {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    throw new Error("TwiCC session id is required.");
  }

  if (shouldUseRpc(options)) {
    try {
      return await archiveTwiccSessionFromRpc(normalizedSessionId, options);
    } catch {
      // Archiving is idempotent, so a local fallback is safe.
    }
  }

  if (typeof execFileAsync !== "function") {
    throw new Error("TwiCC command runner is required.");
  }

  const { stdout } = await execFileAsync("twicc", [
    "update-session",
    normalizedSessionId,
    "archive"
  ], {
    timeout: 30000,
    windowsHide: true
  });
  return JSON.parse(String(stdout || "null"));
}

function normalizeCreatedSession(value: unknown, title: string): TwiccCreatedSession {
  const source = isRecord(value) ? value : {};
  const sessionId = normalizeText(source.session_id || source.sessionId);
  if (!sessionId) {
    throw new Error("TwiCC did not return the created session id.");
  }

  return {
    projectId: normalizeText(source.project_id || source.projectId),
    provider: normalizeText(source.provider),
    sessionId,
    status: normalizeText(source.status) || "created",
    title: normalizeText(source.title) || title
  };
}

function deriveSessionTitle(prompt: string): string {
  return prompt.split(/\s+/).slice(0, 7).join(" ").slice(0, 200);
}

function normalizeSessionCreationInput(input: TwiccSessionCreationInput = {}) {
  const project = normalizeText(input.project);
  const prompt = normalizeText(input.prompt);
  const title = normalizeText(input.title) || deriveSessionTitle(prompt);
  const requestedSessionFlowLane = normalizeText(input.sessionFlowLane);
  const sessionFlowLane = asSessionFlowLane(requestedSessionFlowLane);
  const worktreeBranch = normalizeText(input.worktreeBranch);
  const worktreePath = normalizeText(input.worktreePath);
  const worktreeStartFrom = normalizeText(input.worktreeStartFrom);

  if (!project) {
    throw new Error("TwiCC project is required.");
  }
  if (!prompt) {
    throw new Error("Session prompt is required.");
  }
  if (requestedSessionFlowLane && !sessionFlowLane) {
    throw new Error(`Invalid TwiCC session flow lane: ${requestedSessionFlowLane}`);
  }
  if (worktreeBranch && !worktreePath) {
    throw new Error("Worktree path is required for a new worktree.");
  }
  if (worktreeStartFrom && !worktreeBranch) {
    throw new Error("Worktree start ref requires a new worktree branch.");
  }

  return {
    project,
    prompt,
    sessionFlowLane,
    title,
    worktreeBranch,
    worktreePath,
    worktreeStartFrom
  };
}

async function createTwiccSessionFromRpc(
  input: TwiccSessionCreationInput,
  options: TwiccCommandOptions = {}
): Promise<TwiccCreatedSession> {
  const normalized = normalizeSessionCreationInput(input);
  const body: Record<string, unknown> = {
    project: normalized.project,
    prompt: normalized.prompt,
    title: normalized.title
  };
  if (normalized.sessionFlowLane) {
    body.annotation = [`boatyard.${TWICC_SESSION_FLOW_ANNOTATION}=${normalized.sessionFlowLane}`];
  }
  if (normalized.worktreeBranch) {
    body.worktree_branch = normalized.worktreeBranch;
    body.worktree_path = normalized.worktreePath;
    if (normalized.worktreeStartFrom) {
      body.worktree_start_from = normalized.worktreeStartFrom;
    }
  } else if (normalized.worktreePath) {
    body.worktree_path = normalized.worktreePath;
  }

  return normalizeCreatedSession(await rpcCommand("create-session", body, options), normalized.title);
}

async function createTwiccSession(
  input: TwiccSessionCreationInput,
  { execFileAsync, ...options }: TwiccCommandOptions = {}
): Promise<TwiccCreatedSession> {
  const normalized = normalizeSessionCreationInput(input);
  if (shouldUseRpc(options)) {
    // Session creation is not idempotent. Never retry through the CLI after an
    // ambiguous RPC failure, because that could create a duplicate session.
    return createTwiccSessionFromRpc(normalized, options);
  }
  if (typeof execFileAsync !== "function") {
    throw new Error("TwiCC command runner is required.");
  }

  const args = [
    "create-session",
    "--title",
    normalized.title,
    "--project",
    normalized.project
  ];
  if (normalized.sessionFlowLane) {
    args.push(
      "--annotation",
      `boatyard.${TWICC_SESSION_FLOW_ANNOTATION}=${normalized.sessionFlowLane}`
    );
  }
  if (normalized.worktreeBranch) {
    args.push("--worktree-branch", normalized.worktreeBranch, "--worktree-path", normalized.worktreePath);
    if (normalized.worktreeStartFrom) {
      args.push("--worktree-start-from", normalized.worktreeStartFrom);
    }
  } else if (normalized.worktreePath) {
    args.push("--worktree-path", normalized.worktreePath);
  }
  args.push("--", normalized.prompt);

  try {
    const { stdout } = await execFileAsync("twicc", args, {
      timeout: 120000,
      windowsHide: true
    });
    return normalizeCreatedSession(JSON.parse(String(stdout || "null")), normalized.title);
  } catch (error) {
    throw new Error(normalizeCommandError(error, "Could not create the TwiCC session."));
  }
}

function parseGitWorktrees(output: unknown): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: Partial<GitWorktreeEntry> | null = null;

  function flush(): void {
    if (current?.path) {
      entries.push({
        branch: current.branch || "",
        detached: current.detached === true,
        path: current.path,
        usable: current.usable !== false
      });
    }
    current = null;
  }

  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ").trim();
    if (key === "worktree") {
      flush();
      current = { path: value, usable: true };
    } else if (current && key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (current && key === "detached") {
      current.detached = true;
    } else if (current && key === "prunable") {
      current.usable = false;
    }
  }
  flush();
  return entries;
}

async function loadGitSessionCreationOptions(
  sourcePath: unknown,
  { execFileAsync }: TwiccCommandOptions = {}
): Promise<GitSessionCreationOptions> {
  const source = normalizePathForMatch(sourcePath);
  if (!source) {
    throw new Error("Project source path is required.");
  }
  if (typeof execFileAsync !== "function") {
    throw new Error("Git command runner is required.");
  }

  try {
    const { stdout: rootOutput } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: source,
      timeout: 10000,
      windowsHide: true
    });
    const gitRoot = normalizePathForMatch(rootOutput);
    if (!gitRoot) {
      throw new Error("Project is not a Git repository.");
    }

    const [{ stdout: branchOutput }, { stdout: worktreeOutput }] = await Promise.all([
      execFileAsync("git", ["branch", "--format=%(refname:short)"], {
        cwd: gitRoot,
        timeout: 10000,
        windowsHide: true
      }),
      execFileAsync("git", ["worktree", "list", "--porcelain"], {
        cwd: gitRoot,
        timeout: 10000,
        windowsHide: true
      })
    ]);
    const allWorktrees = parseGitWorktrees(worktreeOutput);
    const checkedOut = new Set(allWorktrees.map((entry) => entry.branch).filter(Boolean));
    const currentPath = gitRoot;
    const currentBranch = allWorktrees.find((entry) => normalizePathForMatch(entry.path) === currentPath)?.branch || "";
    const branchNames = String(branchOutput || "")
      .split(/\r?\n/)
      .map(normalizeText)
      .filter(Boolean)
      .sort((left, right) => left === currentBranch ? -1 : right === currentBranch ? 1 : left.localeCompare(right));

    return {
      branches: branchNames.map((name) => ({ checkedOut: checkedOut.has(name), name })),
      defaultWorktreeBase: path.join(gitRoot, "worktrees"),
      gitRoot,
      worktrees: allWorktrees.filter((entry) => normalizePathForMatch(entry.path) !== currentPath)
    };
  } catch (error) {
    throw new Error(normalizeCommandError(error, "Could not inspect Git worktrees."));
  }
}

function normalizeTwiccProcessState(state: unknown): TwiccNormalizedProcessState | "" {
  if (state === "assistant_turn") {
    return "working";
  }

  if (state === "awaiting_user_input") {
    return "input";
  }

  if (state === "user_turn") {
    return "done";
  }

  return "";
}

function getTwiccProjectProcessStatuses(processes: unknown): TwiccProjectProcessStatuses {
  if (!Array.isArray(processes)) {
    return {};
  }

  const processList = processes.filter(isTwiccProcess);
  const priority = {
    input: 3,
    working: 2,
    done: 1
  };

  return processList.reduce<TwiccProjectProcessStatuses>((statuses, process) => {
    const projectId = String(process?.project_id || "").trim();
    const state = normalizeTwiccProcessState(process?.state);

    if (!projectId || !state) {
      return statuses;
    }

    const current = statuses[projectId] || {
      state,
      count: 0,
      sessions: []
    };
    current.count += 1;
    current.sessions.push({
      id: process.session_id || "",
      title: process.session_title || "",
      state,
      rawState: process.state || "",
      lastStateChangeAt: process.last_state_change_at || ""
    });

    if (priority[state] > priority[current.state]) {
      current.state = state;
    }

    statuses[projectId] = current;
    return statuses;
  }, {});
}

function mergeTwiccProjectProcessStatuses(statuses: Array<TwiccProjectProcessStatus | null | undefined> = []): TwiccProjectProcessStatus | null {
  const priority = {
    input: 3,
    working: 2,
    done: 1
  };
  const merged: {
    count: number;
    sessions: TwiccSessionStatus[];
    state: TwiccNormalizedProcessState | "";
  } = {
    state: "",
    count: 0,
    sessions: []
  };

  for (const status of statuses) {
    if (!status?.state) {
      continue;
    }

    merged.count += Number(status.count) || 0;
    merged.sessions.push(...(Array.isArray(status.sessions) ? status.sessions : []));

    if (!merged.state || priority[status.state] > priority[merged.state]) {
      merged.state = status.state;
    }
  }

  return merged.state
    ? {
        count: merged.count,
        sessions: merged.sessions,
        state: merged.state
      }
    : null;
}

function getRelatedTwiccProjectIds(twiccProject: TwiccProject | null | undefined, twiccProjects: TwiccProject[] = []): string[] {
  if (!twiccProject?.id) {
    return [];
  }

  const relatedIds = new Set([twiccProject.id]);
  for (const project of twiccProjects) {
    if (project?.id && project.worktree_of === twiccProject.id) {
      relatedIds.add(project.id);
    }
  }

  for (const worktreeId of Array.isArray(twiccProject.worktrees) ? twiccProject.worktrees : []) {
    relatedIds.add(worktreeId);
  }

  return [...relatedIds];
}

function aliasTwiccProjectProcessStatuses(
  statuses: TwiccProjectProcessStatuses = {},
  twiccProjects: TwiccProject[] = [],
  boatyardProjects: BoatyardProject[] = []
): TwiccProjectProcessStatuses {
  const aliased = { ...statuses };
  const projectList = Array.isArray(twiccProjects) ? twiccProjects : [];

  for (const twiccProject of projectList) {
    if (!twiccProject?.id || twiccProject.worktree_of) {
      continue;
    }

    const twiccStatus = mergeTwiccProjectProcessStatuses(
      getRelatedTwiccProjectIds(twiccProject, projectList).map((projectId) => statuses[projectId])
    );
    if (twiccStatus) {
      aliased[twiccProject.id] = twiccStatus;
    }
  }

  for (const project of Array.isArray(boatyardProjects) ? boatyardProjects : []) {
    const twiccProject = findTwiccProjectForPath(projectList, project?.sourcePath);
    const twiccStatus = twiccProject?.id ? aliased[twiccProject.id] : null;
    if (project?.id && twiccStatus && !aliased[project.id]) {
      aliased[project.id] = twiccStatus;
    }
  }

  return aliased;
}

async function loadTwiccProjectProcessStatuses(options: TwiccCommandOptions): Promise<TwiccProjectProcessStatuses> {
  return getTwiccProjectProcessStatuses(await loadTwiccProcesses(options));
}

async function inspectTwiccProject(sourcePath: unknown, options: TwiccCommandOptions): Promise<TwiccProjectInspection | null> {
  const projects = await loadTwiccProjects(options);
  return inspectTwiccProjectFromProjects(sourcePath, projects, options.globalConfig?.twiccBaseUrl);
}

function inspectTwiccProjectFromProjects(
  sourcePath: unknown,
  projects: unknown,
  baseUrl: unknown = DEFAULT_TWICC_BASE_URL
): TwiccProjectInspection | null {
  const match = findTwiccProjectMatchForPath(projects, sourcePath);
  return match?.project?.id
    ? {
        id: match.project.id,
        matchType: match.matchType,
        url: buildTwiccProjectUrl(match.project.id, normalizeBaseUrl(baseUrl))
      }
    : null;
}

async function createTwiccProjectFromRpc(sourcePath: string, options: TwiccCommandOptions): Promise<TwiccProjectInspection | null> {
  await rpcCommand("create-project", {
    directory: sourcePath
  }, options);
  const projects = await loadTwiccProjectsFromRpc(options);
  return inspectTwiccProjectFromProjects(sourcePath, projects, options.globalConfig?.twiccBaseUrl);
}

async function createTwiccProject(sourcePath: unknown, { execFileAsync, ...options }: TwiccCommandOptions): Promise<TwiccProjectInspection | null> {
  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    throw new Error("Source path is required to create a TwiCC project.");
  }

  if (shouldUseRpc(options)) {
    try {
      return await createTwiccProjectFromRpc(normalizedSourcePath, options);
    } catch {
      // Fall back for older/local setups where only the CLI is available.
    }
  }

  if (typeof execFileAsync !== "function") {
    throw new Error("TwiCC command runner is required.");
  }

  await execFileAsync("twicc", ["create-project", normalizedSourcePath], {
    timeout: 30000,
    windowsHide: true
  });

  return inspectTwiccProject(normalizedSourcePath, { execFileAsync, ...options });
}

export {
  aliasTwiccProjectProcessStatuses,
  archiveTwiccSession,
  archiveTwiccSessionFromRpc,
  buildTwiccProjectUrl,
  createTwiccSession,
  createTwiccSessionFromRpc,
  createTwiccProjectCache,
  createTwiccProject,
  findTwiccProjectForPath,
  findTwiccProjectMatchForPath,
  getTwiccProjectProcessStatuses,
  getTwiccSessionFlow,
  inspectTwiccProjectFromProjects,
  inspectTwiccProject,
  loadTwiccProcessesFromRpc,
  loadTwiccProcesses,
  loadTwiccProjectProcessStatuses,
  loadTwiccProjectsFromRpc,
  loadTwiccProjects,
  loadGitSessionCreationOptions,
  loadTwiccSessionFlow,
  loadTwiccSessionsFromRpc,
  loadTwiccSessions,
  updateTwiccSessionFlowLaneFromRpc,
  updateTwiccSessionFlowLane,
  parseGitWorktrees,
  TWICC_SESSION_FLOW_ANNOTATION,
  TWICC_PROJECT_CACHE_TTL_MS
};
