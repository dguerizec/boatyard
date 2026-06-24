"use strict";

import type { ExecFileAsync } from "../pluginTypes";

const path = require("node:path");

const DEFAULT_TWICC_BASE_URL = "http://localhost:3500";
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
type TwiccCommandOptions = { execFileAsync?: ExecFileAsync };
type TwiccProjectMatch = { project?: TwiccProject; matchType: "exact" | "parent" };
type TwiccProjectCacheOptions = {
  loadProjects?: (options?: TwiccCommandOptions) => Promise<TwiccProject[]>;
  now?: () => number;
  ttlMs?: number;
};
type TwiccProjectCacheGetOptions = { force?: boolean; projectIds?: string[] };
type TwiccProjectInspection = { id: string; matchType: "exact" | "parent"; url: string };
type BoatyardProject = { id?: string; sourcePath?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTwiccProject(value: unknown): value is TwiccProject {
  return isRecord(value);
}

function isTwiccProcess(value: unknown): value is TwiccProcess {
  return isRecord(value);
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

async function loadTwiccProjects({ execFileAsync }: TwiccCommandOptions = {}): Promise<TwiccProject[]> {
  if (typeof execFileAsync !== "function") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("twicc", ["projects", "--limit", "1000", "--include-archived"], {
      timeout: 5000,
      windowsHide: true
    });
    const projects = JSON.parse(stdout);
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
  let projects = [];
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

async function loadTwiccProcesses({ execFileAsync }: TwiccCommandOptions = {}): Promise<TwiccProcess[]> {
  if (typeof execFileAsync !== "function") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("twicc", ["processes", "--limit", "1000", "--include-hidden"], {
      timeout: 5000,
      windowsHide: true
    });
    const processes = JSON.parse(stdout);
    return Array.isArray(processes) ? processes.filter(isTwiccProcess) : [];
  } catch {
    return [];
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

  return processList.reduce((statuses, process) => {
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
  }, {} as TwiccProjectProcessStatuses);
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
    if (project?.worktree_of === twiccProject.id) {
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

  for (const project of Array.isArray(boatyardProjects) ? boatyardProjects : []) {
    const twiccProject = findTwiccProjectForPath(twiccProjects, project?.sourcePath);
    const twiccStatus = mergeTwiccProjectProcessStatuses(
      getRelatedTwiccProjectIds(twiccProject, twiccProjects).map((projectId) => statuses[projectId])
    );
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
  return inspectTwiccProjectFromProjects(sourcePath, projects);
}

function inspectTwiccProjectFromProjects(sourcePath: unknown, projects: unknown): TwiccProjectInspection | null {
  const match = findTwiccProjectMatchForPath(projects, sourcePath);
  return match?.project?.id
    ? {
        id: match.project.id,
        matchType: match.matchType,
        url: buildTwiccProjectUrl(match.project.id)
      }
    : null;
}

async function createTwiccProject(sourcePath: unknown, { execFileAsync }: TwiccCommandOptions): Promise<TwiccProjectInspection | null> {
  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    throw new Error("Source path is required to create a TwiCC project.");
  }

  if (typeof execFileAsync !== "function") {
    throw new Error("TwiCC command runner is required.");
  }

  await execFileAsync("twicc", ["create-project", normalizedSourcePath], {
    timeout: 30000,
    windowsHide: true
  });

  return inspectTwiccProject(normalizedSourcePath, { execFileAsync });
}

export {
  aliasTwiccProjectProcessStatuses,
  buildTwiccProjectUrl,
  createTwiccProjectCache,
  createTwiccProject,
  findTwiccProjectForPath,
  findTwiccProjectMatchForPath,
  getTwiccProjectProcessStatuses,
  inspectTwiccProjectFromProjects,
  inspectTwiccProject,
  loadTwiccProcesses,
  loadTwiccProjectProcessStatuses,
  loadTwiccProjects,
  TWICC_PROJECT_CACHE_TTL_MS
};
