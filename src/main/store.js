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

const MIN_WIDGET_RAIL_WIDTH = 240;
const DEFAULT_WIDGET_PANE_ID = "widgets-0";
const GLOBAL_WORKSPACE_ID = "__global__";
const LEGACY_WIDGET_IDS = new Map([
  ["project-preview", "boatyard.pier.urls"],
  ["pier-urls", "boatyard.pier.urls"]
]);

function createDefaultState() {
  return {
    settings: {
      projectsBasePath: "",
      blurWebAppOverlays: true,
      passwordManagerEnabled: false,
      passwordManagerDisclaimerAccepted: false,
      widgetRailWidth: 340,
      terminalEnv: "",
      webAppOpenRules: []
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
    passwordVault: {},
    plugins: {
      enabled: {}
    },
    pluginConfig: {
      global: {},
      projects: {}
    },
    globalUrls: [],
    paneLayouts: {},
    widgetLayouts: {},
    terminalSelections: {},
    terminalTabOrders: {}
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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeMultilineText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
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
    passwordManagerEnabled: source.passwordManagerEnabled === true && source.passwordManagerDisclaimerAccepted === true,
    passwordManagerDisclaimerAccepted: source.passwordManagerDisclaimerAccepted === true,
    widgetRailWidth: Math.max(MIN_WIDGET_RAIL_WIDTH, Number.isFinite(widgetRailWidth) ? Math.round(widgetRailWidth) : 340),
    terminalEnv: normalizeMultilineText(source.terminalEnv),
    webAppOpenRules: normalizeWebAppOpenRules(source.webAppOpenRules)
  };
}

function normalizeWebAppOpenRules(rules = []) {
  const source = Array.isArray(rules) ? rules : [];
  const allowedTargets = new Set(["same-pane", "external"]);
  const allowedScopes = new Set(["exact", "host", "path-prefix"]);
  const normalized = [];

  for (const rule of source) {
    const entry = rule && typeof rule === "object" ? rule : {};
    const pattern = normalizeText(entry.pattern || entry.match);
    const target = normalizeText(entry.target);
    const scope = normalizeText(entry.scope || "exact");

    if (!pattern || !allowedTargets.has(target) || !allowedScopes.has(scope)) {
      continue;
    }

    normalized.push({
      pattern,
      target,
      scope,
      label: normalizeText(entry.label)
    });
  }

  return normalized;
}

function normalizePasswordVault(vault = {}) {
  if (!vault || typeof vault !== "object" || Array.isArray(vault)) {
    return {};
  }

  const normalized = {};
  for (const [origin, entry] of Object.entries(vault)) {
    const source = entry && typeof entry === "object" ? entry : {};
    const normalizedOrigin = normalizeText(origin);
    const username = normalizeText(source.username);
    const encryptedPassword = normalizeText(source.encryptedPassword);

    if (!normalizedOrigin || !username || !encryptedPassword) {
      continue;
    }

    normalized[normalizedOrigin] = {
      username,
      encryptedPassword,
      updatedAt: normalizeText(source.updatedAt)
    };
  }

  return normalized;
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

function normalizeTerminalSelections(terminalSelections = {}, projects = []) {
  if (!terminalSelections || typeof terminalSelections !== "object" || Array.isArray(terminalSelections)) {
    return {};
  }

  const projectIds = new Set(projects.map((project) => project.id));
  projectIds.add(GLOBAL_WORKSPACE_ID);
  const normalized = {};

  for (const [projectId, selections] of Object.entries(terminalSelections)) {
    const normalizedProjectId = normalizeText(projectId);
    if (!projectIds.has(normalizedProjectId) || !selections || typeof selections !== "object" || Array.isArray(selections)) {
      continue;
    }

    const normalizedSelections = {};
    for (const [surfaceKey, windowId] of Object.entries(selections)) {
      const normalizedSurfaceKey = normalizeText(surfaceKey);
      const normalizedWindowId = normalizeText(windowId);
      if (normalizedSurfaceKey && normalizedWindowId) {
        normalizedSelections[normalizedSurfaceKey] = normalizedWindowId;
      }
    }

    if (Object.keys(normalizedSelections).length) {
      normalized[normalizedProjectId] = normalizedSelections;
    }
  }

  return normalized;
}

function normalizeTerminalTabOrders(terminalTabOrders = {}, projects = []) {
  if (!terminalTabOrders || typeof terminalTabOrders !== "object" || Array.isArray(terminalTabOrders)) {
    return {};
  }

  const projectIds = new Set(projects.map((project) => project.id));
  projectIds.add(GLOBAL_WORKSPACE_ID);
  const normalized = {};

  for (const [projectId, windowIds] of Object.entries(terminalTabOrders)) {
    const normalizedProjectId = normalizeText(projectId);
    if (!projectIds.has(normalizedProjectId) || !Array.isArray(windowIds)) {
      continue;
    }

    const seenWindowIds = new Set();
    const normalizedWindowIds = [];
    for (const windowId of windowIds) {
      const normalizedWindowId = normalizeText(windowId);
      if (normalizedWindowId && !seenWindowIds.has(normalizedWindowId)) {
        seenWindowIds.add(normalizedWindowId);
        normalizedWindowIds.push(normalizedWindowId);
      }
    }

    if (normalizedWindowIds.length) {
      normalized[normalizedProjectId] = normalizedWindowIds;
    }
  }

  return normalized;
}

function normalizeWidgetLayout(layout = {}) {
  const source = layout && typeof layout === "object" ? layout : {};
  const normalizeWidgetId = (id) => LEGACY_WIDGET_IDS.get(String(id || "").trim()) || String(id || "").trim();
  const seenIds = new Set();
  const order = Array.isArray(source.order)
    ? source.order
        .map(normalizeWidgetId)
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
        .map(normalizeWidgetId)
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
      sizes[normalizeWidgetId(widgetId)] = {
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
      positions[normalizeWidgetId(widgetId)] = {
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
    normalized[String(projectId)] = normalizeProjectWidgetLayout(layout);
  }

  return normalized;
}

function normalizeProjectWidgetLayout(layout = {}) {
  const source = layout && typeof layout === "object" && !Array.isArray(layout)
    ? layout
    : {};
  const paneLayouts = source.panes && typeof source.panes === "object" && !Array.isArray(source.panes)
    ? source.panes
    : null;

  if (!paneLayouts) {
    return {
      panes: {
        [DEFAULT_WIDGET_PANE_ID]: normalizeWidgetLayout(source)
      }
    };
  }

  const normalizedPanes = {};
  for (const [paneId, paneLayout] of Object.entries(paneLayouts)) {
    const normalizedPaneId = normalizeText(paneId);
    if (normalizedPaneId) {
      normalizedPanes[normalizedPaneId] = normalizeWidgetLayout(paneLayout);
    }
  }

  return {
    panes: Object.keys(normalizedPanes).length
      ? normalizedPanes
      : {
          [DEFAULT_WIDGET_PANE_ID]: normalizeWidgetLayout()
        }
  };
}

function normalizePluginConfigObject(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(config)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      continue;
    }

    if (typeof value === "string") {
      const normalizedValue = normalizeText(value);
      if (normalizedValue) {
        normalized[normalizedKey] = normalizedValue;
      }
    } else if (["number", "boolean"].includes(typeof value)) {
      normalized[normalizedKey] = value;
    }
  }

  return normalized;
}

function normalizePluginConfig(pluginConfig = {}, projects = [], { migrateLegacyPreview = false } = {}) {
  const source = pluginConfig && typeof pluginConfig === "object" && !Array.isArray(pluginConfig)
    ? pluginConfig
    : {};
  const normalized = {
    global: {},
    projects: {}
  };

  const globalConfig = source.global && typeof source.global === "object" && !Array.isArray(source.global)
    ? source.global
    : {};
  for (const [pluginId, config] of Object.entries(globalConfig)) {
    const normalizedPluginId = normalizeText(pluginId);
    const normalizedConfig = normalizePluginConfigObject(config);
    if (normalizedPluginId && Object.keys(normalizedConfig).length) {
      normalized.global[normalizedPluginId] = normalizedConfig;
    }
  }

  const projectConfig = source.projects && typeof source.projects === "object" && !Array.isArray(source.projects)
    ? source.projects
    : {};
  const projectIds = new Set(projects.map((project) => project.id));

  for (const [projectId, pluginConfigs] of Object.entries(projectConfig)) {
    const normalizedProjectId = normalizeText(projectId);
    if (!projectIds.has(normalizedProjectId) || !pluginConfigs || typeof pluginConfigs !== "object" || Array.isArray(pluginConfigs)) {
      continue;
    }

    for (const [pluginId, config] of Object.entries(pluginConfigs)) {
      const normalizedPluginId = normalizeText(pluginId);
      const normalizedConfig = normalizePluginConfigObject(config);
      if (!normalizedPluginId || !Object.keys(normalizedConfig).length) {
        continue;
      }

      normalized.projects[normalizedProjectId] = {
        ...(normalized.projects[normalizedProjectId] || {}),
        [normalizedPluginId]: normalizedConfig
      };
    }
  }

  if (migrateLegacyPreview) {
    for (const project of projects) {
      if (!project.previewUrl) {
        continue;
      }

      const pierConfig = normalized.projects[project.id]?.["boatyard.pier"] || {};
      if (!normalizeText(pierConfig.pierPreviewUrl)) {
        normalized.projects[project.id] = {
          ...(normalized.projects[project.id] || {}),
          "boatyard.pier": {
            ...pierConfig,
            pierPreviewUrl: project.previewUrl
          }
        };
      }
    }
  }

  return normalized;
}

function normalizePluginsState(plugins = {}) {
  const source = plugins && typeof plugins === "object" && !Array.isArray(plugins)
    ? plugins
    : {};
  const enabledSource = source.enabled && typeof source.enabled === "object" && !Array.isArray(source.enabled)
    ? source.enabled
    : {};
  const enabled = {};

  for (const [pluginId, value] of Object.entries(enabledSource)) {
    const normalizedPluginId = normalizeText(pluginId);
    if (normalizedPluginId && value === false) {
      enabled[normalizedPluginId] = false;
    }
  }

  return { enabled };
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

function normalizeProjectWidgetPanes(widgetPanes = []) {
  const source = Array.isArray(widgetPanes) ? widgetPanes : [];
  const seenIds = new Set();
  const normalized = source
    .map((entry, index) => {
      const pane = entry && typeof entry === "object" ? entry : {};
      const label = normalizeText(pane.label || pane.name);

      if (!label) {
        return null;
      }

      const baseId = normalizeText(pane.id) || slugify(label) || `widgets-${index}`;
      let id = baseId;
      let suffix = 2;

      while (seenIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }

      seenIds.add(id);
      return { id, label };
    })
    .filter(Boolean);

  return normalized.length
    ? normalized
    : [{
        id: DEFAULT_WIDGET_PANE_ID,
        label: "Widgets"
      }];
}

function normalizeProject(project, index = 0) {
  const id = String(project.id || crypto.randomUUID());
  const name = String(project.name || "").trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  const slug = normalizeSlug(project.slug, name);
  const previewUrl = normalizeOptionalUrl(project.previewUrl || project.url);
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
    terminalEnv: normalizeMultilineText(project.terminalEnv),
    previewUrl,
    urls: normalizeProjectUrls(project.urls),
    widgetPanes: normalizeProjectWidgetPanes(project.widgetPanes),
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
      const normalizedProjects = projects.map((project, index) => normalizeProject(project, index));
      this.state = {
        settings: normalizeSettings(parsed.settings),
        projects: normalizedProjects,
        window: normalizeWindowState(parsed.window),
        navigation: normalizeNavigationState(parsed.navigation),
        webApps: normalizeWebAppState(parsed.webApps),
        passwordVault: normalizePasswordVault(parsed.passwordVault),
        plugins: normalizePluginsState(parsed.plugins),
        pluginConfig: normalizePluginConfig(parsed.pluginConfig, normalizedProjects, { migrateLegacyPreview: true }),
        globalUrls: normalizeProjectUrls(parsed.globalUrls),
        paneLayouts: normalizePaneLayouts(parsed.paneLayouts),
        widgetLayouts: normalizeWidgetLayouts(parsed.widgetLayouts),
        terminalSelections: normalizeTerminalSelections(parsed.terminalSelections, normalizedProjects),
        terminalTabOrders: normalizeTerminalTabOrders(parsed.terminalTabOrders, normalizedProjects)
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Could not load Boatyard state: ${error.message}`);
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

  updateGlobalUrls(urls) {
    this.state.globalUrls = normalizeProjectUrls(urls);
    this.save();
    return this.getState();
  }

  getPasswordCredential(origin) {
    return structuredClone(this.state.passwordVault[normalizeText(origin)] || null);
  }

  updatePasswordCredential(origin, credential) {
    const normalizedOrigin = normalizeText(origin);
    const source = credential && typeof credential === "object" ? credential : {};
    const username = normalizeText(source.username);
    const encryptedPassword = normalizeText(source.encryptedPassword);

    if (!normalizedOrigin) {
      throw new Error("Password origin is required.");
    }

    if (!username || !encryptedPassword) {
      delete this.state.passwordVault[normalizedOrigin];
    } else {
      this.state.passwordVault[normalizedOrigin] = {
        username,
        encryptedPassword,
        updatedAt: new Date().toISOString()
      };
    }

    this.save();
    return this.getPasswordCredential(normalizedOrigin);
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
    this.state.widgetLayouts[String(projectId)] = normalizeProjectWidgetLayout(layout);
    this.save();
    return this.getWidgetLayout(projectId);
  }

  updateTerminalSelection(projectId, surfaceKey, windowId) {
    const normalizedProjectId = normalizeText(projectId);
    const normalizedSurfaceKey = normalizeText(surfaceKey);
    const normalizedWindowId = normalizeText(windowId);

    if (normalizedProjectId !== GLOBAL_WORKSPACE_ID && !this.state.projects.some((project) => project.id === normalizedProjectId)) {
      throw new Error(`Unknown project: ${normalizedProjectId}`);
    }

    if (!normalizedSurfaceKey) {
      throw new Error("Terminal surface key is required.");
    }

    if (!normalizedWindowId) {
      if (this.state.terminalSelections[normalizedProjectId]) {
        delete this.state.terminalSelections[normalizedProjectId][normalizedSurfaceKey];
        if (!Object.keys(this.state.terminalSelections[normalizedProjectId]).length) {
          delete this.state.terminalSelections[normalizedProjectId];
        }
      }
    } else {
      this.state.terminalSelections[normalizedProjectId] = {
        ...(this.state.terminalSelections[normalizedProjectId] || {}),
        [normalizedSurfaceKey]: normalizedWindowId
      };
    }

    this.save();
    return structuredClone(this.state.terminalSelections[normalizedProjectId] || {});
  }

  updateTerminalTabOrder(projectId, windowIds) {
    const normalizedProjectId = normalizeText(projectId);

    if (normalizedProjectId !== GLOBAL_WORKSPACE_ID && !this.state.projects.some((project) => project.id === normalizedProjectId)) {
      throw new Error(`Unknown project: ${normalizedProjectId}`);
    }

    const normalizedOrders = normalizeTerminalTabOrders({
      [normalizedProjectId]: windowIds
    }, this.state.projects);
    const normalizedWindowIds = normalizedOrders[normalizedProjectId] || [];

    if (!normalizedWindowIds.length) {
      delete this.state.terminalTabOrders[normalizedProjectId];
    } else {
      this.state.terminalTabOrders[normalizedProjectId] = normalizedWindowIds;
    }

    this.save();
    return structuredClone(this.state.terminalTabOrders[normalizedProjectId] || []);
  }

  updatePluginEnabled(pluginId, enabled) {
    const normalizedPluginId = normalizeText(pluginId);

    if (!normalizedPluginId) {
      throw new Error("Plugin id is required.");
    }

    if (enabled === false) {
      this.state.plugins.enabled[normalizedPluginId] = false;
    } else {
      delete this.state.plugins.enabled[normalizedPluginId];
    }

    this.save();
    return this.getState();
  }

  getGlobalPluginConfig(pluginId) {
    return structuredClone(this.state.pluginConfig.global[String(pluginId)] || {});
  }

  updateGlobalPluginConfig(pluginId, patch) {
    const normalizedPluginId = normalizeText(pluginId);

    if (!normalizedPluginId) {
      throw new Error("Plugin id is required.");
    }

    const current = this.state.pluginConfig.global[normalizedPluginId] || {};
    const normalized = normalizePluginConfigObject({
      ...current,
      ...patch
    });

    if (!Object.keys(normalized).length) {
      delete this.state.pluginConfig.global[normalizedPluginId];
    } else {
      this.state.pluginConfig.global[normalizedPluginId] = normalized;
    }

    this.save();
    return this.getState();
  }

  getProjectPluginConfig(projectId, pluginId) {
    return structuredClone(this.state.pluginConfig.projects[String(projectId)]?.[String(pluginId)] || {});
  }

  updateProjectPluginConfig(projectId, pluginId, patch) {
    const normalizedProjectId = normalizeText(projectId);
    const normalizedPluginId = normalizeText(pluginId);

    if (!this.state.projects.some((project) => project.id === normalizedProjectId)) {
      throw new Error(`Unknown project: ${normalizedProjectId}`);
    }

    if (!normalizedPluginId) {
      throw new Error("Plugin id is required.");
    }

    const current = this.state.pluginConfig.projects[normalizedProjectId]?.[normalizedPluginId] || {};
    const normalized = normalizePluginConfigObject({
      ...current,
      ...patch
    });

    if (!Object.keys(normalized).length) {
      if (this.state.pluginConfig.projects[normalizedProjectId]) {
        delete this.state.pluginConfig.projects[normalizedProjectId][normalizedPluginId];
      }
    } else {
      this.state.pluginConfig.projects[normalizedProjectId] = {
        ...(this.state.pluginConfig.projects[normalizedProjectId] || {}),
        [normalizedPluginId]: normalized
      };
    }

    if (this.state.pluginConfig.projects[normalizedProjectId] && !Object.keys(this.state.pluginConfig.projects[normalizedProjectId]).length) {
      delete this.state.pluginConfig.projects[normalizedProjectId];
    }

    this.save();
    return this.getState();
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
    this.state.pluginConfig = normalizePluginConfig(this.state.pluginConfig, this.state.projects);
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
    this.state.pluginConfig = normalizePluginConfig(this.state.pluginConfig, this.state.projects);
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
    delete this.state.terminalSelections[projectId];
    delete this.state.terminalTabOrders[projectId];
    delete this.state.pluginConfig.projects[projectId];
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
  normalizeBounds,
  normalizePaneLayoutNode,
  normalizePaneLayouts,
  normalizeWidgetLayout,
  normalizeWidgetLayouts,
  normalizeProjectWidgetLayout,
  normalizeProjectWidgetPanes,
  normalizeProject,
  normalizeProjectUrls,
  normalizeSlug,
  deriveRepoUrl,
  normalizeSettings,
  normalizeWebAppOpenRules,
  normalizePluginsState,
  normalizePluginConfig,
  normalizePasswordVault,
  normalizeTerminalTabOrders,
  normalizeNavigationState,
  normalizeWebAppState,
  normalizeWindowBounds,
  normalizeWindowState,
  ProjectStore,
  normalizeOptionalUrl,
  normalizeUrl
};
