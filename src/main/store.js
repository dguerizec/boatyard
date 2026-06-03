"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_BOUNDS = {
  x: 48,
  y: 92,
  width: 720,
  height: 460
};

const DEFAULT_WINDOW_BOUNDS = {
  x: 80,
  y: 60,
  width: 1280,
  height: 820
};

const DEFAULT_TWICC_URL = "http://localhost:3500";

function createDefaultState() {
  return {
    projects: [],
    window: {
      bounds: DEFAULT_WINDOW_BOUNDS,
      isMaximized: false
    },
    webApps: {},
    paneLayouts: {}
  };
}

function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();

  if (!trimmed) {
    throw new Error("URL is required.");
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed);
  const isLocalhost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/.test(trimmed);
  const withProtocol = hasProtocol
    ? trimmed
    : `${isLocalhost ? "http" : "https"}://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  return parsed.toString();
}

function normalizeOptionalUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  return trimmed ? normalizeUrl(trimmed) : "";
}

function normalizeRequiredText(value, fieldName) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }

  return trimmed;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function stripGitSuffix(pathname) {
  return pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
}

function deriveRepoUrl(gitUrl) {
  const trimmed = normalizeText(gitUrl);

  if (!trimmed) {
    return "";
  }

  const scpLikeMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (scpLikeMatch) {
    return `https://${scpLikeMatch[1]}/${stripGitSuffix(scpLikeMatch[2])}`;
  }

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol === "ssh:" && parsed.username === "git") {
      return `https://${parsed.host}${stripGitSuffix(parsed.pathname)}`;
    }

    if (["http:", "https:"].includes(parsed.protocol)) {
      return `https://${parsed.host}${stripGitSuffix(parsed.pathname)}`;
    }
  } catch {
    return "";
  }

  return "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSlug(slug, name) {
  const normalized = slugify(slug || name);

  if (!normalized) {
    throw new Error("Slug is required.");
  }

  return normalized;
}

function normalizeBounds(bounds, fallback = DEFAULT_BOUNDS) {
  const source = bounds && typeof bounds === "object" ? bounds : {};
  const next = {
    x: Number.isFinite(source.x) ? source.x : fallback.x,
    y: Number.isFinite(source.y) ? source.y : fallback.y,
    width: Number.isFinite(source.width) ? source.width : fallback.width,
    height: Number.isFinite(source.height) ? source.height : fallback.height
  };

  return {
    x: Math.max(0, Math.round(next.x)),
    y: Math.max(0, Math.round(next.y)),
    width: Math.max(260, Math.round(next.width)),
    height: Math.max(200, Math.round(next.height))
  };
}

function normalizeWindowBounds(bounds, fallback = DEFAULT_WINDOW_BOUNDS) {
  const normalized = normalizeBounds(bounds, fallback);

  return {
    ...normalized,
    width: Math.max(920, normalized.width),
    height: Math.max(620, normalized.height)
  };
}

function normalizeWindowState(windowState = {}) {
  return {
    bounds: normalizeWindowBounds(windowState.bounds),
    isMaximized: windowState.isMaximized === true
  };
}

function normalizeWebAppState(webApps = {}) {
  if (!webApps || typeof webApps !== "object" || Array.isArray(webApps)) {
    return {};
  }

  const normalized = {};
  for (const [key, webApp] of Object.entries(webApps)) {
    if (!webApp || typeof webApp !== "object") {
      continue;
    }

    try {
      normalized[String(key)] = {
        url: normalizeUrl(webApp.url)
      };
    } catch {
      // Ignore invalid restored webapp URLs.
    }
  }

  return normalized;
}

function normalizePaneLayoutNode(node, seenIds = new Set()) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (node.type === "pane") {
    const id = String(node.id || "").trim();

    if (!id || seenIds.has(id)) {
      return null;
    }

    seenIds.add(id);
    const normalized = {
      type: "pane",
      id
    };

    if (typeof node.selectedWebAppId === "string" && node.selectedWebAppId.trim()) {
      normalized.selectedWebAppId = node.selectedWebAppId.trim();
    }

    return normalized;
  }

  if (node.type === "split") {
    const id = String(node.id || "").trim();
    const direction = node.direction === "horizontal" ? "horizontal" : "vertical";
    const first = normalizePaneLayoutNode(node.first, seenIds);
    const second = normalizePaneLayoutNode(node.second, seenIds);

    if (!id || seenIds.has(id) || !first || !second) {
      return null;
    }

    seenIds.add(id);
    return {
      type: "split",
      id,
      direction,
      ratio: Math.min(0.85, Math.max(0.15, Number.isFinite(node.ratio) ? node.ratio : 0.5)),
      first,
      second
    };
  }

  return null;
}

function normalizePaneLayouts(paneLayouts = {}) {
  if (!paneLayouts || typeof paneLayouts !== "object" || Array.isArray(paneLayouts)) {
    return {};
  }

  const normalized = {};
  for (const [projectId, layout] of Object.entries(paneLayouts)) {
    const normalizedLayout = normalizePaneLayoutNode(layout);
    if (normalizedLayout) {
      normalized[String(projectId)] = normalizedLayout;
    }
  }

  return normalized;
}

function normalizeProject(project, index = 0) {
  const id = String(project.id || crypto.randomUUID());
  const name = String(project.name || "").trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  const slug = normalizeSlug(project.slug, name);
  const previewUrl = normalizeOptionalUrl(project.previewUrl || project.url);
  const twiccUrl = normalizeUrl(project.twiccUrl || DEFAULT_TWICC_URL);
  const gitUrl = normalizeText(project.gitUrl);
  const repoUrl = normalizeOptionalUrl(project.repoUrl) || deriveRepoUrl(gitUrl);

  return {
    id,
    slug,
    name,
    sourcePath: normalizeText(project.sourcePath),
    gitUrl,
    repoUrl,
    devBranch: normalizeText(project.devBranch),
    previewUrl,
    twiccUrl,
    hawserMainSession: normalizeRequiredText(project.hawserMainSession || `${slug}:main`, "Hawser main session"),
    bounds: normalizeBounds(project.bounds, {
      x: 48 + index * 32,
      y: 92 + index * 28,
      width: DEFAULT_BOUNDS.width,
      height: DEFAULT_BOUNDS.height
    }),
    isOpen: project.isOpen !== false
  };
}

class ProjectStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = createDefaultState();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const projects = Array.isArray(parsed.projects)
        ? parsed.projects
        : Array.isArray(parsed.apps)
          ? parsed.apps
          : [];
      this.state = {
        projects: projects.map((project, index) => normalizeProject(project, index)),
        window: normalizeWindowState(parsed.window),
        webApps: normalizeWebAppState(parsed.webApps),
        paneLayouts: normalizePaneLayouts(parsed.paneLayouts)
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Could not load Dashtop state: ${error.message}`);
      }
      this.state = createDefaultState();
    }

    return this.getState();
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  getState() {
    return structuredClone(this.state);
  }

  getWindowState() {
    return structuredClone(this.state.window);
  }

  updateWindowState(windowState) {
    this.state.window = normalizeWindowState({
      ...this.state.window,
      ...windowState,
      bounds: windowState.bounds || this.state.window.bounds
    });
    this.save();
    return this.getWindowState();
  }

  getWebAppUrl(key) {
    return this.state.webApps[String(key)]?.url || null;
  }

  updateWebAppState(key, webAppState) {
    const normalized = normalizeWebAppState({
      [String(key)]: webAppState
    });

    if (!normalized[String(key)]) {
      delete this.state.webApps[String(key)];
    } else {
      this.state.webApps[String(key)] = normalized[String(key)];
    }

    this.save();
    return structuredClone(this.state.webApps[String(key)] || null);
  }

  getPaneLayout(projectId) {
    return structuredClone(this.state.paneLayouts[String(projectId)] || null);
  }

  updatePaneLayout(projectId, layout) {
    const normalized = normalizePaneLayoutNode(layout);

    if (!normalized) {
      delete this.state.paneLayouts[String(projectId)];
    } else {
      this.state.paneLayouts[String(projectId)] = normalized;
    }

    this.save();
    return this.getPaneLayout(projectId);
  }

  addProject(project) {
    const normalized = normalizeProject(
      {
        ...project,
        id: crypto.randomUUID(),
        isOpen: true
      },
      this.state.projects.length
    );
    this.state.projects.push(normalized);
    this.save();
    return this.getState();
  }

  updateProject(id, patch) {
    const index = this.state.projects.findIndex((project) => project.id === id);

    if (index === -1) {
      throw new Error(`Unknown project: ${id}`);
    }

    const current = this.state.projects[index];
    this.state.projects[index] = normalizeProject({
      ...current,
      ...patch,
      id: current.id,
      bounds: patch.bounds ? normalizeBounds(patch.bounds, current.bounds) : current.bounds
    }, index);
    this.save();
    return this.getState();
  }

  removeProject(id) {
    const projectId = String(id);
    this.state.projects = this.state.projects.filter((project) => project.id !== projectId);
    delete this.state.paneLayouts[projectId];

    for (const key of Object.keys(this.state.webApps)) {
      if (key.startsWith(`${projectId}:`)) {
        delete this.state.webApps[key];
      }
    }

    this.save();
    return this.getState();
  }
}

module.exports = {
  DEFAULT_BOUNDS,
  DEFAULT_WINDOW_BOUNDS,
  DEFAULT_TWICC_URL,
  normalizeBounds,
  normalizePaneLayoutNode,
  normalizePaneLayouts,
  normalizeProject,
  normalizeSlug,
  deriveRepoUrl,
  normalizeWebAppState,
  normalizeWindowBounds,
  normalizeWindowState,
  ProjectStore,
  normalizeOptionalUrl,
  normalizeUrl
};
