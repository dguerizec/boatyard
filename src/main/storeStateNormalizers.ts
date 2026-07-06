import {
  DEFAULT_WINDOW_BOUNDS,
  normalizeMultilineText,
  normalizeText,
  normalizeUrl,
  normalizeWindowBounds,
  toRecord
} from "./storeUtils";
import type {
  AppState,
  NavigationState,
  OnboardingState,
  PasswordCredentialState,
  ProjectStoreState,
  SettingsState,
  StoredProject,
  WebAppHomeTab,
  WebAppState,
  WindowState
} from "./storeTypes";
import { normalizeWebAppHomeTabList, normalizeWebAppOpenRules } from "./storeProjectNormalizers";

const MIN_WIDGET_RAIL_WIDTH = 240;
const GLOBAL_WORKSPACE_ID = "__global__";
const STORE_SCHEMA_VERSION = 1;

export function createDefaultState(): ProjectStoreState {
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
      collapsedProjectGroups: [],
      pinnedProjectIds: []
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

export function normalizeWindowState(windowState: unknown = {}): WindowState {
  const source = toRecord(windowState);

  return {
    bounds: normalizeWindowBounds(source.bounds),
    isMaximized: source.isMaximized === true
  };
}

export function normalizeSettings(settings: unknown = {}): SettingsState {
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

export function normalizePasswordVault(vault: unknown = {}): Record<string, PasswordCredentialState> {
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

export function normalizeNavigationState(navigation: unknown = {}): NavigationState {
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
  const pinnedProjectIds: string[] = Array.isArray(source.pinnedProjectIds)
    ? [...new Set(source.pinnedProjectIds.map(normalizeText).filter(Boolean))]
    : [];

  return {
    view: projectId || !isProjectView ? view : "global",
    projectId: isProjectView ? projectId : null,
    collapsedProjectGroups,
    pinnedProjectIds
  };
}

export function normalizeAppState(appState: unknown = {}): AppState {
  const source = toRecord(appState);

  return {
    lastSeenVersion: normalizeText(source.lastSeenVersion),
    pendingChangelogFromVersion: normalizeText(source.pendingChangelogFromVersion),
    dismissedChangelogVersion: normalizeText(source.dismissedChangelogVersion)
  };
}

export function normalizeSchemaVersion(schemaVersion: unknown): number {
  const version = Number(schemaVersion);
  return Number.isInteger(version) && version > 0
    ? Math.min(version, STORE_SCHEMA_VERSION)
    : STORE_SCHEMA_VERSION;
}

export function normalizeOnboardingState(onboarding: unknown = {}): OnboardingState {
  const source = toRecord(onboarding);
  const completedVersion = Number(source.completedVersion);

  return {
    completedVersion: Math.max(0, Number.isFinite(completedVersion) ? Math.floor(completedVersion) : 0),
    completedAt: normalizeText(source.completedAt)
  };
}

export function normalizeWebAppState(webApps: unknown = {}): Record<string, WebAppState> {
  if (!webApps || typeof webApps !== "object" || Array.isArray(webApps)) {
    return {};
  }

  const normalized: Record<string, WebAppState> = {};
  for (const [key, webApp] of Object.entries(webApps)) {
    const source = webApp && typeof webApp === "object" && !Array.isArray(webApp)
      ? webApp as Record<string, unknown>
      : null;
    if (!source) {
      continue;
    }

    try {
      normalized[String(key)] = {
        url: normalizeUrl(source.url)
      };
    } catch {
      // Ignore invalid restored webapp URLs.
    }
  }

  return normalized;
}

export function normalizeWebAppHomeTabs(homeTabs: unknown = {}, projects: StoredProject[] = []): Record<string, WebAppHomeTab[]> {
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
