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
const STORE_SCHEMA_VERSION = 1;

type UnknownRecord = Record<string, unknown>;
type VersionParts = [number, number, number];

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type WindowState = {
  bounds: Bounds;
  isMaximized: boolean;
};

type WebAppOpenRule = {
  pattern: string;
  target: string;
  scope: string;
  label: string;
};

type SettingsState = {
  projectsBasePath: string;
  blurWebAppOverlays: boolean;
  passwordManagerEnabled: boolean;
  passwordManagerDisclaimerAccepted: boolean;
  widgetRailWidth: number;
  terminalEnv: string;
  webAppOpenRules: WebAppOpenRule[];
};

type NavigationState = {
  view: string;
  projectId: string | null;
  collapsedProjectGroups: string[];
};

type AppState = {
  lastSeenVersion: string;
  pendingChangelogFromVersion: string;
  dismissedChangelogVersion: string;
};

type OnboardingState = {
  completedVersion: number;
  completedAt: string;
};

type PasswordCredentialState = {
  username: string;
  encryptedPassword: string;
  updatedAt: string;
};

type WebAppState = {
  url: string;
};

type WebAppHomeTab = {
  id: string;
  parentWebAppId: string;
  parentLabel: string;
  label: string;
  url: string;
};

type PaneWebApp = WebAppHomeTab;

type PaneLayoutNode = {
  type: "pane";
  id: string;
  selectedWebAppId?: string;
  transientWebApp?: PaneWebApp;
} | {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: PaneLayoutNode;
  second: PaneLayoutNode;
  expandedChild?: "first" | "second";
};

type WidgetSize = {
  columns: number;
  rows: number;
};

type WidgetPosition = {
  x: number;
  y: number;
};

type WidgetLayout = {
  order: string[];
  hidden: string[];
  sizes: Record<string, WidgetSize>;
  positions: Record<string, WidgetPosition>;
  locked: boolean;
};

type ProjectWidgetLayout = {
  panes: Record<string, WidgetLayout>;
};

type PluginConfigValue = string | number | boolean;
type PluginConfigObject = Record<string, PluginConfigValue>;

type ProjectUrl = {
  id: string;
  label: string;
  url: string;
};

type ProjectWidgetPane = {
  id: string;
  label: string;
};

type StoredProject = {
  id: string;
  slug: string;
  name: string;
  group: string;
  sourcePath: string;
  gitUrl: string;
  repoUrl: string;
  devBranch: string;
  terminalEnv: string;
  previewUrl: string;
  urls: ProjectUrl[];
  webAppHomeTabs: WebAppHomeTab[];
  widgetPanes: ProjectWidgetPane[];
  bounds: Bounds;
  isOpen: boolean;
};

type ProjectStoreState = {
  app: AppState;
  globalUrls: ProjectUrl[];
  navigation: NavigationState;
  onboarding: OnboardingState;
  paneLayouts: Record<string, PaneLayoutNode>;
  passwordVault: Record<string, PasswordCredentialState>;
  pluginConfig: {
    global: Record<string, PluginConfigObject>;
    projects: Record<string, Record<string, PluginConfigObject>>;
  };
  plugins: {
    enabled: Record<string, boolean>;
  };
  projects: StoredProject[];
  schemaVersion: number;
  settings: SettingsState;
  terminalSelections: Record<string, Record<string, string>>;
  terminalTabOrders: Record<string, string[]>;
  webApps: Record<string, WebAppState>;
  widgetLayouts: Record<string, ProjectWidgetLayout>;
  window: WindowState;
};

function createDefaultState(): ProjectStoreState {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    settings: {
      projectsBasePath: "",
      blurWebAppOverlays: false,
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
      projectId: null,
      collapsedProjectGroups: []
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
    terminalTabOrders: {},
    onboarding: {
      completedVersion: 0,
      completedAt: ""
    },
    app: {
      lastSeenVersion: "",
      pendingChangelogFromVersion: "",
      dismissedChangelogVersion: ""
    }
  };
}

function normalizeUrl(rawUrl: unknown): string {
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

function normalizeOptionalUrl(rawUrl: unknown): string {
  const trimmed = String(rawUrl || "").trim();
  return trimmed ? normalizeUrl(trimmed) : "";
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeMultilineText(value: unknown): string {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function stripGitSuffix(pathname: string): string {
  return pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
}

function deriveRepoUrl(gitUrl: unknown): string {
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

function slugify(value: unknown): string {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSlug(slug: unknown, name: unknown): string {
  const normalized = slugify(slug || name);

  if (!normalized) {
    throw new Error("Slug is required.");
  }

  return normalized;
}

function normalizeBounds(
  bounds: unknown,
  fallback: Bounds = DEFAULT_BOUNDS
): Bounds {
  const source = toRecord(bounds);
  const x = Number(source.x);
  const y = Number(source.y);
  const width = Number(source.width);
  const height = Number(source.height);
  const next = {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    width: Number.isFinite(width) ? width : fallback.width,
    height: Number.isFinite(height) ? height : fallback.height
  };

  return {
    x: Math.max(0, Math.round(next.x)),
    y: Math.max(0, Math.round(next.y)),
    width: Math.max(260, Math.round(next.width)),
    height: Math.max(200, Math.round(next.height))
  };
}

function normalizeWindowBounds(bounds: unknown, fallback: Bounds = DEFAULT_WINDOW_BOUNDS): Bounds {
  const normalized = normalizeBounds(bounds, fallback);

  return {
    ...normalized,
    width: Math.max(920, normalized.width),
    height: Math.max(620, normalized.height)
  };
}

function normalizeWindowState(windowState: unknown = {}): WindowState {
  const source = toRecord(windowState);

  return {
    bounds: normalizeWindowBounds(source.bounds),
    isMaximized: source.isMaximized === true
  };
}

function normalizeSettings(settings: unknown = {}): SettingsState {
  const source = toRecord(settings);
  const widgetRailWidth = Number(source.widgetRailWidth);

  return {
    projectsBasePath: normalizeText(source.projectsBasePath),
    blurWebAppOverlays: source.blurWebAppOverlays === true,
    passwordManagerEnabled: source.passwordManagerEnabled === true && source.passwordManagerDisclaimerAccepted === true,
    passwordManagerDisclaimerAccepted: source.passwordManagerDisclaimerAccepted === true,
    widgetRailWidth: Math.max(MIN_WIDGET_RAIL_WIDTH, Number.isFinite(widgetRailWidth) ? Math.round(widgetRailWidth) : 340),
    terminalEnv: normalizeMultilineText(source.terminalEnv),
    webAppOpenRules: normalizeWebAppOpenRules(source.webAppOpenRules)
  };
}

function normalizeWebAppOpenRules(rules: unknown = []): WebAppOpenRule[] {
  const source = Array.isArray(rules) ? rules : [];
  const allowedTargets = new Set<string>(["same-pane", "split-pane", "external"]);
  const allowedScopes = new Set<string>(["exact", "host", "path-prefix"]);
  const normalized: WebAppOpenRule[] = [];

  for (const rule of source) {
    const entry = toRecord(rule);
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

function normalizePasswordVault(vault: unknown = {}): Record<string, PasswordCredentialState> {
  if (!vault || typeof vault !== "object" || Array.isArray(vault)) {
    return {};
  }

  const normalized: Record<string, PasswordCredentialState> = {};
  for (const [origin, entry] of Object.entries(vault)) {
    const source = toRecord(entry);
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

function normalizeNavigationState(navigation: unknown = {}): NavigationState {
  const source = toRecord(navigation);
  const allowedViews = new Set<string>(["global", "global-settings", "project", "project-edit"]);
  const requestedView = normalizeText(source.view);
  const view = allowedViews.has(requestedView) ? requestedView : "global";
  const projectId = typeof source.projectId === "string" && source.projectId.trim()
    ? source.projectId.trim()
    : null;
  const isProjectView = view.startsWith("project");
  const collapsedProjectGroups: string[] = Array.isArray(source.collapsedProjectGroups)
    ? [...new Set(source.collapsedProjectGroups.map(normalizeText).filter(Boolean))]
    : [];

  return {
    view: projectId || !isProjectView ? view : "global",
    projectId: isProjectView ? projectId : null,
    collapsedProjectGroups
  };
}

function normalizeAppState(appState: unknown = {}): AppState {
  const source = toRecord(appState);

  return {
    lastSeenVersion: normalizeText(source.lastSeenVersion),
    pendingChangelogFromVersion: normalizeText(source.pendingChangelogFromVersion),
    dismissedChangelogVersion: normalizeText(source.dismissedChangelogVersion)
  };
}

function normalizeSchemaVersion(schemaVersion: unknown): number {
  const version = Number(schemaVersion);
  return Number.isInteger(version) && version > 0
    ? Math.min(version, STORE_SCHEMA_VERSION)
    : STORE_SCHEMA_VERSION;
}

function parseVersion(version: unknown): VersionParts | null {
  const match = normalizeText(version).match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
  return match
    ? [
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10),
        Number.parseInt(match[3], 10)
      ]
    : null;
}

function compareVersions(left: unknown, right: unknown): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  if (!leftParts || !rightParts) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }

    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
  }

  return 0;
}

function normalizeOnboardingState(onboarding: unknown = {}): OnboardingState {
  const source = toRecord(onboarding);
  const completedVersion = Number(source.completedVersion);

  return {
    completedVersion: Math.max(0, Number.isFinite(completedVersion) ? Math.floor(completedVersion) : 0),
    completedAt: normalizeText(source.completedAt)
  };
}

function normalizeWebAppState(webApps: unknown = {}): Record<string, WebAppState> {
  if (!webApps || typeof webApps !== "object" || Array.isArray(webApps)) {
    return {};
  }

  const normalized: Record<string, WebAppState> = {};
  for (const [key, webApp] of Object.entries(webApps)) {
    if (!isRecord(webApp)) {
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

function normalizeWebAppHomeTabList(tabs: unknown = []): WebAppHomeTab[] {
  if (!Array.isArray(tabs)) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalized: WebAppHomeTab[] = [];
  for (const tab of tabs) {
    const source = toRecord(tab);
    const id = normalizeText(source.id);
    const parentWebAppId = normalizeText(source.parentWebAppId);
    const label = normalizeText(source.label);

    if (!id || seenIds.has(id) || !parentWebAppId || !label) {
      continue;
    }

    try {
      normalized.push({
        id,
        parentWebAppId,
        parentLabel: normalizeText(source.parentLabel),
        label,
        url: normalizeUrl(source.url)
      });
      seenIds.add(id);
    } catch {
      // Ignore invalid saved webapp home tabs.
    }
  }

  return normalized;
}

function normalizeWebAppHomeTabs(homeTabs: unknown = {}, projects: StoredProject[] = []): Record<string, WebAppHomeTab[]> {
  if (!homeTabs || typeof homeTabs !== "object" || Array.isArray(homeTabs)) {
    return {};
  }

  const projectIds = new Set<string>([GLOBAL_WORKSPACE_ID, ...projects.map((project) => project.id)]);
  const normalized: Record<string, WebAppHomeTab[]> = {};

  for (const [projectId, tabs] of Object.entries(homeTabs)) {
    const normalizedProjectId = normalizeText(projectId);
    if (!projectIds.has(normalizedProjectId)) {
      continue;
    }

    const projectTabs = normalizeWebAppHomeTabList(tabs);
    if (projectTabs.length) {
      normalized[normalizedProjectId] = projectTabs;
    }
  }

  return normalized;
}

function normalizePaneLayoutNode(node: unknown, seenIds = new Set<string>()): PaneLayoutNode | null {
  if (!isRecord(node)) {
    return null;
  }

  const source = node;

  if (source.type === "pane") {
    const id = String(source.id || "").trim();

    if (!id || seenIds.has(id)) {
      return null;
    }

    seenIds.add(id);
    const normalized: Extract<PaneLayoutNode, { type: "pane" }> = {
      type: "pane",
      id
    };

    if (typeof source.selectedWebAppId === "string" && source.selectedWebAppId.trim()) {
      normalized.selectedWebAppId = source.selectedWebAppId.trim();
    }

    const transientWebApp = isRecord(source.transientWebApp) ? source.transientWebApp : null;
    if (transientWebApp) {
      const transientId = normalizeText(transientWebApp.id);

      try {
        const transientUrl = normalizeUrl(transientWebApp.url);
        if (transientId) {
          normalized.transientWebApp = {
            id: transientId,
            label: normalizeText(transientWebApp.label),
            parentLabel: normalizeText(transientWebApp.parentLabel),
            parentWebAppId: normalizeText(transientWebApp.parentWebAppId),
            url: transientUrl
          };
        }
      } catch {
        // Ignore invalid transient pane URLs.
      }
    }

    return normalized;
  }

  if (source.type === "split") {
    const id = String(source.id || "").trim();
    const direction = source.direction === "horizontal" ? "horizontal" : "vertical";
    const first = normalizePaneLayoutNode(source.first, seenIds);
    const second = normalizePaneLayoutNode(source.second, seenIds);

    if (!id || seenIds.has(id) || !first || !second) {
      return null;
    }

    seenIds.add(id);
    const ratio = Number(source.ratio);
    const normalized: Extract<PaneLayoutNode, { type: "split" }> = {
      type: "split",
      id,
      direction,
      ratio: Math.min(0.85, Math.max(0.15, Number.isFinite(ratio) ? ratio : 0.5)),
      first,
      second
    };

    if (source.expandedChild === "first" || source.expandedChild === "second") {
      normalized.expandedChild = source.expandedChild;
    }

    return normalized;
  }

  return null;
}

function normalizePaneLayouts(paneLayouts: unknown = {}): Record<string, PaneLayoutNode> {
  if (!paneLayouts || typeof paneLayouts !== "object" || Array.isArray(paneLayouts)) {
    return {};
  }

  const normalized: Record<string, PaneLayoutNode> = {};
  for (const [projectId, layout] of Object.entries(paneLayouts)) {
    const normalizedLayout = normalizePaneLayoutNode(layout);
    if (normalizedLayout) {
      normalized[String(projectId)] = normalizedLayout;
    }
  }

  return normalized;
}

function normalizeTerminalSelections(terminalSelections: unknown = {}, projects: StoredProject[] = []): Record<string, Record<string, string>> {
  if (!terminalSelections || typeof terminalSelections !== "object" || Array.isArray(terminalSelections)) {
    return {};
  }

  const projectIds = new Set<string>(projects.map((project) => project.id));
  projectIds.add(GLOBAL_WORKSPACE_ID);
  const normalized: Record<string, Record<string, string>> = {};

  for (const [projectId, selections] of Object.entries(terminalSelections)) {
    const normalizedProjectId = normalizeText(projectId);
    if (!projectIds.has(normalizedProjectId) || !selections || typeof selections !== "object" || Array.isArray(selections)) {
      continue;
    }

    const normalizedSelections: Record<string, string> = {};
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

function normalizeTerminalTabOrders(terminalTabOrders: unknown = {}, projects: StoredProject[] = []): Record<string, string[]> {
  if (!terminalTabOrders || typeof terminalTabOrders !== "object" || Array.isArray(terminalTabOrders)) {
    return {};
  }

  const projectIds = new Set<string>(projects.map((project) => project.id));
  projectIds.add(GLOBAL_WORKSPACE_ID);
  const normalized: Record<string, string[]> = {};

  for (const [projectId, windowIds] of Object.entries(terminalTabOrders)) {
    const normalizedProjectId = normalizeText(projectId);
    if (!projectIds.has(normalizedProjectId) || !Array.isArray(windowIds)) {
      continue;
    }

    const seenWindowIds = new Set<string>();
    const normalizedWindowIds: string[] = [];
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

function normalizeWidgetLayout(layout: unknown = {}): WidgetLayout {
  const source = toRecord(layout);
  const normalizeWidgetId = (id: unknown) => String(id || "").trim();
  const seenIds = new Set<string>();
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
  const seenHiddenIds = new Set<string>();
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
  const sizes: Record<string, WidgetSize> = {};
  const positions: Record<string, WidgetPosition> = {};

  for (const [widgetId, size] of Object.entries(rawSizes)) {
    if (!isRecord(size)) {
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
    if (!isRecord(position)) {
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

function normalizeWidgetLayouts(widgetLayouts: unknown = {}): Record<string, ProjectWidgetLayout> {
  if (!widgetLayouts || typeof widgetLayouts !== "object" || Array.isArray(widgetLayouts)) {
    return {};
  }

  const normalized: Record<string, ProjectWidgetLayout> = {};
  for (const [projectId, layout] of Object.entries(widgetLayouts)) {
    normalized[String(projectId)] = normalizeProjectWidgetLayout(layout);
  }

  return normalized;
}

function normalizeProjectWidgetLayout(layout: unknown = {}): ProjectWidgetLayout {
  const source = toRecord(layout);
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

  const normalizedPanes: Record<string, WidgetLayout> = {};
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

function normalizePluginConfigObject(config: unknown = {}): PluginConfigObject {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {};
  }

  const normalized: PluginConfigObject = {};
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

function normalizePluginConfig(pluginConfig: unknown = {}, projects: StoredProject[] = []): ProjectStoreState["pluginConfig"] {
  const source = toRecord(pluginConfig);
  const normalized: ProjectStoreState["pluginConfig"] = {
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
  const projectIds = new Set<string>(projects.map((project) => project.id));

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

  return normalized;
}

function normalizePluginsState(plugins: unknown = {}): ProjectStoreState["plugins"] {
  const source = toRecord(plugins);
  const enabledSource = source.enabled && typeof source.enabled === "object" && !Array.isArray(source.enabled)
    ? source.enabled
    : {};
  const enabled: Record<string, boolean> = {};

  for (const [pluginId, value] of Object.entries(enabledSource)) {
    const normalizedPluginId = normalizeText(pluginId);
    if (normalizedPluginId && value === false) {
      enabled[normalizedPluginId] = false;
    }
  }

  return { enabled };
}

function normalizeProjectUrls(urls: unknown = []): ProjectUrl[] {
  if (!Array.isArray(urls)) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalized: ProjectUrl[] = [];
  urls.forEach((entry, index) => {
      const source = toRecord(entry);
      const label = normalizeText(source.label);
      const rawUrl = normalizeText(source.url);

      if (!label && !rawUrl) {
        return;
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
      normalized.push({
        id,
        label,
        url: normalizeUrl(rawUrl)
      });
    });
  return normalized;
}

function normalizeProjectWidgetPanes(widgetPanes: unknown = []): ProjectWidgetPane[] {
  const source = Array.isArray(widgetPanes) ? widgetPanes : [];
  const seenIds = new Set<string>();
  const normalized: ProjectWidgetPane[] = [];
  source.forEach((entry, index) => {
      const pane = toRecord(entry);
      const label = normalizeText(pane.label || pane.name);

      if (!label) {
        return;
      }

      const baseId = normalizeText(pane.id) || slugify(label) || `widgets-${index}`;
      let id = baseId;
      let suffix = 2;

      while (seenIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }

      seenIds.add(id);
      normalized.push({ id, label });
    });

  return normalized.length
    ? normalized
    : [{
        id: DEFAULT_WIDGET_PANE_ID,
        label: "Widgets"
      }];
}

function normalizeProject(project: unknown, index = 0): StoredProject {
  const source = toRecord(project);
  const id = String(source.id || crypto.randomUUID());
  const name = String(source.name || "").trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  const slug = normalizeSlug(source.slug, name);
  const previewUrl = normalizeOptionalUrl(source.previewUrl || source.url);
  const gitUrl = normalizeText(source.gitUrl);
  const repoUrl = normalizeOptionalUrl(source.repoUrl) || deriveRepoUrl(gitUrl);

  return {
    id,
    slug,
    name,
    group: normalizeText(source.group),
    sourcePath: normalizeText(source.sourcePath),
    gitUrl,
    repoUrl,
    devBranch: normalizeText(source.devBranch),
    terminalEnv: normalizeMultilineText(source.terminalEnv),
    previewUrl,
    urls: normalizeProjectUrls(source.urls),
    webAppHomeTabs: normalizeWebAppHomeTabList(source.webAppHomeTabs),
    widgetPanes: normalizeProjectWidgetPanes(source.widgetPanes),
    bounds: normalizeBounds(source.bounds, {
      x: 48 + index * 32,
      y: 92 + index * 28,
      width: DEFAULT_BOUNDS.width,
      height: DEFAULT_BOUNDS.height
    }),
    isOpen: source.isOpen !== false
  };
}

class ProjectStore {
  filePath: string;
  state: ProjectStoreState;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.state = createDefaultState();
  }

  load(): ProjectStoreState {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = toRecord(JSON.parse(raw));
      const projects = Array.isArray(parsed.projects)
        ? parsed.projects
        : Array.isArray(parsed.apps)
          ? parsed.apps
          : [];
      const normalizedProjects = projects.map((project, index) => normalizeProject(project, index));
      const legacyWebAppHomeTabs = normalizeWebAppHomeTabs(parsed.webAppHomeTabs, normalizedProjects);
      const projectsWithHomeTabs = normalizedProjects.map((project) => ({
        ...project,
        webAppHomeTabs: project.webAppHomeTabs.length
          ? project.webAppHomeTabs
          : legacyWebAppHomeTabs[project.id] || []
      }));
      this.state = {
        schemaVersion: normalizeSchemaVersion(parsed.schemaVersion),
        settings: normalizeSettings(parsed.settings),
        projects: projectsWithHomeTabs,
        window: normalizeWindowState(parsed.window),
        navigation: normalizeNavigationState(parsed.navigation),
        webApps: normalizeWebAppState(parsed.webApps),
        passwordVault: normalizePasswordVault(parsed.passwordVault),
        plugins: normalizePluginsState(parsed.plugins),
        pluginConfig: normalizePluginConfig(parsed.pluginConfig, projectsWithHomeTabs),
        globalUrls: normalizeProjectUrls(parsed.globalUrls),
        paneLayouts: normalizePaneLayouts(parsed.paneLayouts),
        widgetLayouts: normalizeWidgetLayouts(parsed.widgetLayouts),
        terminalSelections: normalizeTerminalSelections(parsed.terminalSelections, projectsWithHomeTabs),
        terminalTabOrders: normalizeTerminalTabOrders(parsed.terminalTabOrders, projectsWithHomeTabs),
        onboarding: normalizeOnboardingState(parsed.onboarding),
        app: normalizeAppState(parsed.app)
      };
    } catch (error: unknown) {
      const loadError = error as NodeJS.ErrnoException;
      if (loadError.code !== "ENOENT") {
        console.warn(`Could not load Boatyard state: ${loadError.message}`);
      }
      this.state = createDefaultState();
    }

    return this.getState();
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  getState(): ProjectStoreState {
    return structuredClone(this.state);
  }

  getWindowState(): WindowState {
    return structuredClone(this.state.window);
  }

  getAppState(): AppState {
    return structuredClone(this.state.app);
  }

  reconcileAppVersion(currentVersion: unknown): AppState {
    const current = normalizeText(currentVersion);
    const previous = normalizeText(this.state.app.lastSeenVersion);

    if (!current) {
      return this.getAppState();
    }

    const pendingChangelogFromVersion = previous && compareVersions(current, previous) > 0
      ? previous
      : this.state.app.pendingChangelogFromVersion;

    this.state.app = normalizeAppState({
      ...this.state.app,
      lastSeenVersion: current,
      pendingChangelogFromVersion
    });
    this.save();
    return this.getAppState();
  }

  dismissChangelog(version: unknown): AppState {
    const dismissedVersion = normalizeText(version);
    this.state.app = normalizeAppState({
      ...this.state.app,
      dismissedChangelogVersion: dismissedVersion,
      pendingChangelogFromVersion: ""
    });
    this.save();
    return this.getAppState();
  }

  updateSettings(patch: unknown): ProjectStoreState {
    this.state.settings = normalizeSettings({
      ...this.state.settings,
      ...toRecord(patch)
    });
    this.save();
    return this.getState();
  }

  updateWindowState(windowState: unknown): WindowState {
    const source = toRecord(windowState);
    this.state.window = normalizeWindowState({
      ...this.state.window,
      ...source,
      bounds: source.bounds || this.state.window.bounds
    });
    this.save();
    return this.getWindowState();
  }

  updateNavigation(navigation: unknown): NavigationState {
    this.state.navigation = normalizeNavigationState(navigation);
    this.save();
    return structuredClone(this.state.navigation);
  }

  updateOnboarding(onboarding: unknown): OnboardingState {
    this.state.onboarding = normalizeOnboardingState({
      ...this.state.onboarding,
      ...toRecord(onboarding)
    });
    this.save();
    return structuredClone(this.state.onboarding);
  }

  getWebAppUrl(key: unknown): string | null {
    return this.state.webApps[String(key)]?.url || null;
  }

  updateWebAppState(key: unknown, webAppState: unknown): WebAppState | null {
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

  updateGlobalUrls(urls: unknown): ProjectStoreState {
    this.state.globalUrls = normalizeProjectUrls(urls);
    this.save();
    return this.getState();
  }

  updateWebAppHomeTab(projectId: unknown, tab: unknown): ProjectStoreState {
    const normalizedProjectId = normalizeText(projectId);
    const projectIndex = this.state.projects.findIndex((project) => project.id === normalizedProjectId);
    if (projectIndex === -1) {
      throw new Error(`Unknown project: ${normalizedProjectId}`);
    }

    const normalized = normalizeWebAppHomeTabList([tab])[0];

    if (!normalized) {
      throw new Error("Invalid webapp home tab.");
    }

    const tabs = Array.isArray(this.state.projects[projectIndex].webAppHomeTabs)
      ? this.state.projects[projectIndex].webAppHomeTabs
      : [];
    this.state.projects[projectIndex] = {
      ...this.state.projects[projectIndex],
      webAppHomeTabs: [
        ...tabs.filter((entry) => entry.id !== normalized.id),
        normalized
      ]
    };
    this.save();
    return this.getState();
  }

  updateWebAppHomeTabs(projectId: unknown, tabs: unknown): ProjectStoreState {
    const normalizedProjectId = normalizeText(projectId);
    const projectIndex = this.state.projects.findIndex((project) => project.id === normalizedProjectId);
    if (projectIndex === -1) {
      throw new Error(`Unknown project: ${normalizedProjectId}`);
    }

    this.state.projects[projectIndex] = {
      ...this.state.projects[projectIndex],
      webAppHomeTabs: normalizeWebAppHomeTabList(tabs)
    };

    this.save();
    return this.getState();
  }

  getPasswordCredential(origin: unknown): PasswordCredentialState | null {
    return structuredClone(this.state.passwordVault[normalizeText(origin)] || null);
  }

  updatePasswordCredential(origin: unknown, credential: unknown): PasswordCredentialState | null {
    const normalizedOrigin = normalizeText(origin);
    const source = toRecord(credential);
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

  getPaneLayout(projectId: unknown): PaneLayoutNode | null {
    return structuredClone(this.state.paneLayouts[String(projectId)] || null);
  }

  updatePaneLayout(projectId: unknown, layout: unknown): PaneLayoutNode | null {
    const normalized = normalizePaneLayoutNode(layout);

    if (!normalized) {
      delete this.state.paneLayouts[String(projectId)];
    } else {
      this.state.paneLayouts[String(projectId)] = normalized;
    }

    this.save();
    return this.getPaneLayout(projectId);
  }

  getWidgetLayout(projectId: unknown): ProjectWidgetLayout | null {
    return structuredClone(this.state.widgetLayouts[String(projectId)] || null);
  }

  updateWidgetLayout(projectId: unknown, layout: unknown): ProjectWidgetLayout | null {
    this.state.widgetLayouts[String(projectId)] = normalizeProjectWidgetLayout(layout);
    this.save();
    return this.getWidgetLayout(projectId);
  }

  updateTerminalSelection(projectId: unknown, surfaceKey: unknown, windowId: unknown): Record<string, string> {
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

  updateTerminalTabOrder(projectId: unknown, windowIds: unknown): string[] {
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

  updatePluginEnabled(pluginId: unknown, enabled: unknown): ProjectStoreState {
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

  getGlobalPluginConfig(pluginId: unknown): PluginConfigObject {
    return structuredClone(this.state.pluginConfig.global[String(pluginId)] || {});
  }

  updateGlobalPluginConfig(pluginId: unknown, patch: unknown): ProjectStoreState {
    const normalizedPluginId = normalizeText(pluginId);

    if (!normalizedPluginId) {
      throw new Error("Plugin id is required.");
    }

    const current = this.state.pluginConfig.global[normalizedPluginId] || {};
    const normalized = normalizePluginConfigObject({
      ...current,
      ...toRecord(patch)
    });

    if (!Object.keys(normalized).length) {
      delete this.state.pluginConfig.global[normalizedPluginId];
    } else {
      this.state.pluginConfig.global[normalizedPluginId] = normalized;
    }

    this.save();
    return this.getState();
  }

  getProjectPluginConfig(projectId: unknown, pluginId: unknown): PluginConfigObject {
    return structuredClone(this.state.pluginConfig.projects[String(projectId)]?.[String(pluginId)] || {});
  }

  updateProjectPluginConfig(projectId: unknown, pluginId: unknown, patch: unknown): ProjectStoreState {
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
      ...toRecord(patch)
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

  addProject(project: unknown): ProjectStoreState {
    const normalized = normalizeProject(
      {
        ...toRecord(project),
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

  updateProject(id: unknown, patch: unknown): ProjectStoreState {
    const projectId = normalizeText(id);
    const patchRecord = toRecord(patch);
    const index = this.state.projects.findIndex((project) => project.id === projectId);

    if (index === -1) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    const current = this.state.projects[index];
    this.state.projects[index] = normalizeProject({
      ...current,
      ...patchRecord,
      id: current.id,
      bounds: patchRecord.bounds ? normalizeBounds(patchRecord.bounds, normalizeBounds(current.bounds)) : current.bounds
    }, index);
    this.state.pluginConfig = normalizePluginConfig(this.state.pluginConfig, this.state.projects);
    this.save();
    return this.getState();
  }

  reorderProjects(projectIds: unknown): ProjectStoreState {
    const order = Array.isArray(projectIds) ? projectIds.map(String) : [];
    const positionById = new Map(order.map((id, index) => [id, index]));
    this.state.projects = this.state.projects
      .map((project, index) => ({ project, index }))
      .sort((left, right) => {
        const leftId = normalizeText(left.project.id);
        const rightId = normalizeText(right.project.id);
        const leftPosition = positionById.has(leftId) ? positionById.get(leftId) ?? left.index : order.length + left.index;
        const rightPosition = positionById.has(rightId) ? positionById.get(rightId) ?? right.index : order.length + right.index;
        return leftPosition - rightPosition;
      })
      .map(({ project }) => project);
    this.save();
    return this.getState();
  }

  removeProject(id: unknown): ProjectStoreState {
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

export {
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
  normalizeOnboardingState,
  normalizeAppState,
  normalizePasswordVault,
  normalizeTerminalTabOrders,
  normalizeNavigationState,
  normalizeWebAppState,
  normalizeWebAppHomeTabs,
  normalizeWindowBounds,
  normalizeWindowState,
  ProjectStore,
  normalizeOptionalUrl,
  normalizeUrl
};
