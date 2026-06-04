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
const DEFAULT_HAWSER_API_URL = "http://127.0.0.1:60082/";
const MIN_WIDGET_RAIL_WIDTH = 240;

function createDefaultState() {
  return {
    settings: {
      projectsBasePath: "",
      blurWebAppOverlays: true,
      hawserApiUrl: DEFAULT_HAWSER_API_URL,
      hawserToken: "",
      widgetRailWidth: 340
    },
    projects: [],
    window: {
      bounds: DEFAULT_WINDOW_BOUNDS,
      isMaximized: false
    },
    navigation: {
      view: "global",
      projectId: null
    },
    webApps: {},
    paneLayouts: {},
    widgetLayouts: {}
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

function normalizeSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const widgetRailWidth = Number(source.widgetRailWidth);

  return {
    projectsBasePath: normalizeText(source.projectsBasePath),
    blurWebAppOverlays: source.blurWebAppOverlays !== false,
    hawserApiUrl: normalizeOptionalUrl(source.hawserApiUrl) || DEFAULT_HAWSER_API_URL,
    hawserToken: normalizeText(source.hawserToken),
    widgetRailWidth: Math.max(MIN_WIDGET_RAIL_WIDTH, Number.isFinite(widgetRailWidth) ? Math.round(widgetRailWidth) : 340)
  };
}

function normalizeNavigationState(navigation = {}) {
  const source = navigation && typeof navigation === "object" ? navigation : {};
  const allowedViews = new Set(["global", "global-settings", "project", "project-edit"]);
  const view = allowedViews.has(source.view) ? source.view : "global";
  const projectId = typeof source.projectId === "string" && source.projectId.trim()
    ? source.projectId.trim()
    : null;
  const isProjectView = view.startsWith("project");

  return {
    view: projectId || !isProjectView ? view : "global",
    projectId: isProjectView ? projectId : null
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

function normalizeWidgetLayout(layout = {}) {
  const source = layout && typeof layout === "object" ? layout : {};
  const seenIds = new Set();
  const order = Array.isArray(source.order)
    ? source.order
        .map((id) => String(id || "").trim())
        .filter((id) => {
          if (!id || seenIds.has(id)) {
            return false;
          }

          seenIds.add(id);
          return true;
        })
    : [];
  const seenHiddenIds = new Set();
  const hidden = Array.isArray(source.hidden)
    ? source.hidden
        .map((id) => String(id || "").trim())
        .filter((id) => {
          if (!id || seenHiddenIds.has(id)) {
            return false;
          }

          seenHiddenIds.add(id);
          return true;
        })
    : [];
  const rawSizes = source.sizes && typeof source.sizes === "object" && !Array.isArray(source.sizes)
    ? source.sizes
    : {};
  const rawPositions = source.positions && typeof source.positions === "object" && !Array.isArray(source.positions)
    ? source.positions
    : {};
  const sizes = {};
  const positions = {};

  for (const [widgetId, size] of Object.entries(rawSizes)) {
    if (!size || typeof size !== "object") {
      continue;
    }

    const columns = Number(size.columns);
    const rows = Number(size.rows);

    if (Number.isFinite(columns) && Number.isFinite(rows)) {
      sizes[String(widgetId)] = {
        columns: Math.max(1, Math.round(columns)),
        rows: Math.max(1, Math.round(rows))
      };
    }
  }

  for (const [widgetId, position] of Object.entries(rawPositions)) {
    if (!position || typeof position !== "object") {
      continue;
    }

    const x = Number(position.x);
    const y = Number(position.y);

    if (Number.isFinite(x) && Number.isFinite(y)) {
      positions[String(widgetId)] = {
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y))
      };
    }
  }

  return {
    order,
    hidden,
    sizes,
    positions,
    locked: source.locked !== false
  };
}

function normalizeWidgetLayouts(widgetLayouts = {}) {
  if (!widgetLayouts || typeof widgetLayouts !== "object" || Array.isArray(widgetLayouts)) {
    return {};
  }

  const normalized = {};
  for (const [projectId, layout] of Object.entries(widgetLayouts)) {
    normalized[String(projectId)] = normalizeWidgetLayout(layout);
  }

  return normalized;
}

function normalizeProjectUrls(urls = []) {
  if (!Array.isArray(urls)) {
    return [];
  }

  const seenIds = new Set();
  return urls
    .map((entry, index) => {
      const source = entry && typeof entry === "object" ? entry : {};
      const label = normalizeText(source.label);
      const rawUrl = normalizeText(source.url);

      if (!label && !rawUrl) {
        return null;
      }

      if (!label) {
        throw new Error("URL label is required.");
      }

      if (!rawUrl) {
        throw new Error("URL is required.");
      }

      const baseId = normalizeText(source.id) || slugify(label) || `url-${index + 1}`;
      let id = baseId;
      let suffix = 2;

      while (seenIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }

      seenIds.add(id);
      return {
        id,
        label,
        url: normalizeUrl(rawUrl)
      };
    })
    .filter(Boolean);
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
    urls: normalizeProjectUrls(project.urls),
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
        settings: normalizeSettings(parsed.settings),
        projects: projects.map((project, index) => normalizeProject(project, index)),
        window: normalizeWindowState(parsed.window),
        navigation: normalizeNavigationState(parsed.navigation),
        webApps: normalizeWebAppState(parsed.webApps),
        paneLayouts: normalizePaneLayouts(parsed.paneLayouts),
        widgetLayouts: normalizeWidgetLayouts(parsed.widgetLayouts)
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

  updateSettings(patch) {
    this.state.settings = normalizeSettings({
      ...this.state.settings,
      ...patch
    });
    this.save();
    return this.getState();
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

  updateNavigation(navigation) {
    this.state.navigation = normalizeNavigationState(navigation);
    this.save();
    return structuredClone(this.state.navigation);
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

  getWidgetLayout(projectId) {
    return structuredClone(this.state.widgetLayouts[String(projectId)] || null);
  }

  updateWidgetLayout(projectId, layout) {
    this.state.widgetLayouts[String(projectId)] = normalizeWidgetLayout(layout);
    this.save();
    return this.getWidgetLayout(projectId);
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

  reorderProjects(projectIds) {
    const order = Array.isArray(projectIds) ? projectIds.map(String) : [];
    const positionById = new Map(order.map((id, index) => [id, index]));
    this.state.projects = this.state.projects
      .map((project, index) => ({ project, index }))
      .sort((left, right) => {
        const leftPosition = positionById.has(left.project.id) ? positionById.get(left.project.id) : order.length + left.index;
        const rightPosition = positionById.has(right.project.id) ? positionById.get(right.project.id) : order.length + right.index;
        return leftPosition - rightPosition;
      })
      .map(({ project }) => project);
    this.save();
    return this.getState();
  }

  removeProject(id) {
    const projectId = String(id);
    this.state.projects = this.state.projects.filter((project) => project.id !== projectId);
    delete this.state.paneLayouts[projectId];
    delete this.state.widgetLayouts[projectId];
    if (this.state.navigation.projectId === projectId) {
      this.state.navigation = normalizeNavigationState({ view: "global" });
    }

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
  normalizeWidgetLayout,
  normalizeWidgetLayouts,
  normalizeProject,
  normalizeProjectUrls,
  normalizeSlug,
  deriveRepoUrl,
  normalizeSettings,
  normalizeNavigationState,
  normalizeWebAppState,
  normalizeWindowBounds,
  normalizeWindowState,
  ProjectStore,
  normalizeOptionalUrl,
  normalizeUrl
};
