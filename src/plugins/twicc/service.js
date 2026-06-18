"use strict";

const path = require("node:path");

const DEFAULT_TWICC_BASE_URL = "http://localhost:3500";

function normalizePathForMatch(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? path.resolve(trimmed) : "";
}

function getProjectPaths(project) {
  if (!project || typeof project !== "object") {
    return [];
  }

  return [project.directory, project.git_root]
    .map(normalizePathForMatch)
    .filter(Boolean);
}

function findTwiccProjectForPath(projects, sourcePath) {
  return findTwiccProjectMatchForPath(projects, sourcePath)?.project || null;
}

function findTwiccProjectMatchForPath(projects, sourcePath) {
  if (!Array.isArray(projects)) {
    return null;
  }

  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    return null;
  }

  const exactMatch = projects.find((project) => getProjectPaths(project).includes(normalizedSourcePath));
  if (exactMatch) {
    return {
      project: exactMatch,
      matchType: "exact"
    };
  }

  return projects
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
      matchType: "parent"
    }))[0] || null;
}

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

async function loadTwiccProjects({ execFileAsync }) {
  try {
    const { stdout } = await execFileAsync("twicc", ["projects", "--limit", "1000", "--include-archived"], {
      timeout: 5000,
      windowsHide: true
    });
    const projects = JSON.parse(stdout);
    return Array.isArray(projects) ? projects : [];
  } catch {
    return [];
  }
}

async function loadTwiccProcesses({ execFileAsync }) {
  try {
    const { stdout } = await execFileAsync("twicc", ["processes", "--limit", "1000", "--include-hidden"], {
      timeout: 5000,
      windowsHide: true
    });
    const processes = JSON.parse(stdout);
    return Array.isArray(processes) ? processes : [];
  } catch {
    return [];
  }
}

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

function getTwiccProjectProcessStatuses(processes) {
  if (!Array.isArray(processes)) {
    return {};
  }

  const priority = {
    input: 3,
    working: 2,
    done: 1
  };

  return processes.reduce((statuses, process) => {
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

function mergeTwiccProjectProcessStatuses(statuses = []) {
  const priority = {
    input: 3,
    working: 2,
    done: 1
  };
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

  return merged.state ? merged : null;
}

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

async function loadTwiccProjectProcessStatuses(options) {
  return getTwiccProjectProcessStatuses(await loadTwiccProcesses(options));
}

async function inspectTwiccProject(sourcePath, options) {
  const projects = await loadTwiccProjects(options);
  const match = findTwiccProjectMatchForPath(projects, sourcePath);
  return match?.project?.id
    ? {
        id: match.project.id,
        matchType: match.matchType,
        url: buildTwiccProjectUrl(match.project.id)
      }
    : null;
}

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

module.exports = {
  aliasTwiccProjectProcessStatuses,
  buildTwiccProjectUrl,
  createTwiccProject,
  findTwiccProjectForPath,
  findTwiccProjectMatchForPath,
  getTwiccProjectProcessStatuses,
  inspectTwiccProject,
  loadTwiccProcesses,
  loadTwiccProjectProcessStatuses,
  loadTwiccProjects
};
