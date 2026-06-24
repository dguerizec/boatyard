"use strict";

const path = require("node:path");

/**
 * @typedef {import("../pluginTypes").ExecFileAsync} ExecFileAsync
 * @typedef {{ id?: string, directory?: string, git_root?: string, worktree_of?: string, worktrees?: string[] }} TwiccProject
 * @typedef {{ project_id?: string, state?: string, session_id?: string, session_title?: string, last_state_change_at?: string }} TwiccProcess
 * @typedef {"input" | "working" | "done"} TwiccNormalizedProcessState
 * @typedef {{ id: string, title: string, state: TwiccNormalizedProcessState, rawState: string, lastStateChangeAt: string }} TwiccSessionStatus
 * @typedef {{ state: TwiccNormalizedProcessState, count: number, sessions: TwiccSessionStatus[] }} TwiccProjectProcessStatus
 * @typedef {Record<string, TwiccProjectProcessStatus>} TwiccProjectProcessStatuses
 * @typedef {{ execFileAsync?: ExecFileAsync }} TwiccCommandOptions
 * @typedef {{ project?: TwiccProject, matchType: "exact" | "parent" }} TwiccProjectMatch
 * @typedef {{ loadProjects?: (options?: TwiccCommandOptions) => Promise<TwiccProject[]>, ttlMs?: number, now?: () => number }} TwiccProjectCacheOptions
 * @typedef {{ force?: boolean, projectIds?: string[] }} TwiccProjectCacheGetOptions
 * @typedef {{ id: string, matchType: "exact" | "parent", url: string }} TwiccProjectInspection
 * @typedef {{ id?: string, sourcePath?: string }} BoatyardProject
 */

const DEFAULT_TWICC_BASE_URL = "http://localhost:3500";
const TWICC_PROJECT_CACHE_TTL_MS = 600000;

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizePathForMatch(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? path.resolve(trimmed) : "";
}

/**
 * @param {unknown} project
 * @returns {string[]}
 */
function getProjectPaths(project) {
  if (!project || typeof project !== "object") {
    return [];
  }

  const source = /** @type {TwiccProject} */ (project);
  return [source.directory, source.git_root]
    .map(normalizePathForMatch)
    .filter(Boolean);
}

/**
 * @param {unknown} projects
 * @param {unknown} sourcePath
 * @returns {TwiccProject | null}
 */
function findTwiccProjectForPath(projects, sourcePath) {
  return findTwiccProjectMatchForPath(projects, sourcePath)?.project || null;
}

/**
 * @param {unknown} projects
 * @param {unknown} sourcePath
 * @returns {TwiccProjectMatch | null}
 */
function findTwiccProjectMatchForPath(projects, sourcePath) {
  if (!Array.isArray(projects)) {
    return null;
  }

  const projectList = /** @type {TwiccProject[]} */ (projects);
  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    return null;
  }

  const exactMatch = projectList.find((project) => getProjectPaths(project).includes(normalizedSourcePath));
  if (exactMatch) {
    return {
      project: exactMatch,
      matchType: /** @type {"exact"} */ ("exact")
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
      matchType: /** @type {"parent"} */ ("parent")
    }))[0] || null;
}

/**
 * @param {unknown} projectId
 * @param {string} baseUrl
 * @returns {string}
 */
function buildTwiccProjectUrl(projectId, baseUrl = DEFAULT_TWICC_BASE_URL) {
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

/**
 * @param {TwiccCommandOptions} options
 * @returns {Promise<TwiccProject[]>}
 */
async function loadTwiccProjects({ execFileAsync }: { execFileAsync?: import("../pluginTypes").ExecFileAsync } = {}) {
  if (typeof execFileAsync !== "function") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("twicc", ["projects", "--limit", "1000", "--include-archived"], {
      timeout: 5000,
      windowsHide: true
    });
    const projects = JSON.parse(stdout);
    return Array.isArray(projects) ? /** @type {TwiccProject[]} */ (projects) : [];
  } catch {
    return [];
  }
}

/**
 * @param {TwiccProjectCacheOptions} options
 */
function createTwiccProjectCache({
  loadProjects = loadTwiccProjects,
  ttlMs = TWICC_PROJECT_CACHE_TTL_MS,
  now = () => Date.now()
} = {}) {
  /** @type {TwiccProject[]} */
  let projects = [];
  let loadedAt = 0;
  let loaded = false;

  function invalidate() {
    projects = [];
    loadedAt = 0;
    loaded = false;
  }

  /**
   * @param {string[]} projectIds
   * @returns {boolean}
   */
  function hasUnknownProjectIds(projectIds = []) {
    const knownIds = new Set(projects.map((project) => String(project?.id || "").trim()).filter(Boolean));
    return projectIds.some((projectId) => !knownIds.has(String(projectId || "").trim()));
  }

  /**
   * @param {TwiccCommandOptions} options
   * @param {TwiccProjectCacheGetOptions} cacheOptions
   * @returns {Promise<TwiccProject[]>}
   */
  async function get(options = {}, { force = false, projectIds = [] } = {}) {
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

/**
 * @param {TwiccCommandOptions} options
 * @returns {Promise<TwiccProcess[]>}
 */
async function loadTwiccProcesses({ execFileAsync }: { execFileAsync?: import("../pluginTypes").ExecFileAsync } = {}) {
  if (typeof execFileAsync !== "function") {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("twicc", ["processes", "--limit", "1000", "--include-hidden"], {
      timeout: 5000,
      windowsHide: true
    });
    const processes = JSON.parse(stdout);
    return Array.isArray(processes) ? /** @type {TwiccProcess[]} */ (processes) : [];
  } catch {
    return [];
  }
}

/**
 * @param {unknown} state
 * @returns {TwiccNormalizedProcessState | ""}
 */
function normalizeTwiccProcessState(state) {
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

/**
 * @param {unknown} processes
 * @returns {TwiccProjectProcessStatuses}
 */
function getTwiccProjectProcessStatuses(processes) {
  if (!Array.isArray(processes)) {
    return {};
  }

  const processList = /** @type {TwiccProcess[]} */ (processes);
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
  }, /** @type {TwiccProjectProcessStatuses} */ ({}));
}

/**
 * @param {Array<TwiccProjectProcessStatus | null | undefined>} statuses
 * @returns {TwiccProjectProcessStatus | null}
 */
function mergeTwiccProjectProcessStatuses(statuses = []) {
  const priority = {
    input: 3,
    working: 2,
    done: 1
  };
  /** @type {{ state: TwiccNormalizedProcessState | "", count: number, sessions: TwiccSessionStatus[] }} */
  const merged = {
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

  return merged.state ? /** @type {TwiccProjectProcessStatus} */ (merged) : null;
}

/**
 * @param {TwiccProject | null | undefined} twiccProject
 * @param {TwiccProject[]} twiccProjects
 * @returns {string[]}
 */
function getRelatedTwiccProjectIds(twiccProject, twiccProjects = []) {
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

/**
 * @param {TwiccProjectProcessStatuses} statuses
 * @param {TwiccProject[]} twiccProjects
 * @param {BoatyardProject[]} boatyardProjects
 * @returns {TwiccProjectProcessStatuses}
 */
function aliasTwiccProjectProcessStatuses(statuses = {}, twiccProjects = [], boatyardProjects = []) {
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

/**
 * @param {TwiccCommandOptions} options
 * @returns {Promise<TwiccProjectProcessStatuses>}
 */
async function loadTwiccProjectProcessStatuses(options) {
  return getTwiccProjectProcessStatuses(await loadTwiccProcesses(options));
}

/**
 * @param {unknown} sourcePath
 * @param {TwiccCommandOptions} options
 * @returns {Promise<TwiccProjectInspection | null>}
 */
async function inspectTwiccProject(sourcePath, options) {
  const projects = await loadTwiccProjects(options);
  return inspectTwiccProjectFromProjects(sourcePath, projects);
}

/**
 * @param {unknown} sourcePath
 * @param {unknown} projects
 * @returns {TwiccProjectInspection | null}
 */
function inspectTwiccProjectFromProjects(sourcePath, projects) {
  const match = findTwiccProjectMatchForPath(projects, sourcePath);
  return match?.project?.id
    ? {
        id: match.project.id,
        matchType: match.matchType,
        url: buildTwiccProjectUrl(match.project.id)
      }
    : null;
}

/**
 * @param {unknown} sourcePath
 * @param {TwiccCommandOptions} options
 * @returns {Promise<TwiccProjectInspection | null>}
 */
async function createTwiccProject(sourcePath, { execFileAsync }) {
  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    throw new Error("Source path is required to create a TwiCC project.");
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
