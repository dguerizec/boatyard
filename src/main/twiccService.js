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
  if (!Array.isArray(projects)) {
    return null;
  }

  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    return null;
  }

  const exactMatch = projects.find((project) => getProjectPaths(project).includes(normalizedSourcePath));
  if (exactMatch) {
    return exactMatch;
  }

  return projects
    .map((project) => ({
      project,
      matchedPath: getProjectPaths(project)
        .filter((projectPath) => normalizedSourcePath.startsWith(`${projectPath}${path.sep}`))
        .sort((left, right) => right.length - left.length)[0] || ""
    }))
    .filter((match) => match.matchedPath)
    .sort((left, right) => right.matchedPath.length - left.matchedPath.length)[0]?.project || null;
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

async function inspectTwiccProject(sourcePath, options) {
  const projects = await loadTwiccProjects(options);
  const project = findTwiccProjectForPath(projects, sourcePath);
  return project?.id
    ? {
        id: project.id,
        url: buildTwiccProjectUrl(project.id)
      }
    : null;
}

module.exports = {
  buildTwiccProjectUrl,
  findTwiccProjectForPath,
  inspectTwiccProject,
  loadTwiccProjects
};
