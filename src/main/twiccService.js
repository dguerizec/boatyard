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
  buildTwiccProjectUrl,
  createTwiccProject,
  findTwiccProjectForPath,
  findTwiccProjectMatchForPath,
  inspectTwiccProject,
  loadTwiccProjects
};
