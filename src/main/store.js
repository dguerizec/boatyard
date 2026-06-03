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

function createDefaultState() {
  return {
    projects: [],
    window: {
      bounds: DEFAULT_WINDOW_BOUNDS,
      isMaximized: false
    },
    webApps: {}
  };
}

function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();

  if (!trimmed) {
    throw new Error("URL is required.");
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  return parsed.toString();
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

function normalizeProject(project, index = 0) {
  const id = String(project.id || crypto.randomUUID());
  const name = String(project.name || "").trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  return {
    id,
    name,
    url: normalizeUrl(project.url),
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
        webApps: normalizeWebAppState(parsed.webApps)
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
    this.state.projects = this.state.projects.filter((project) => project.id !== id);
    this.save();
    return this.getState();
  }
}

module.exports = {
  DEFAULT_BOUNDS,
  DEFAULT_WINDOW_BOUNDS,
  normalizeBounds,
  normalizeProject,
  normalizeWebAppState,
  normalizeWindowBounds,
  normalizeWindowState,
  ProjectStore,
  normalizeUrl
};
