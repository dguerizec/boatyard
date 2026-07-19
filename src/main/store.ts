const fs = require("node:fs");
const path = require("node:path");

import {
  normalizeProject,
  normalizeProjectUrls,
  normalizeProjectWidgetPanes,
  normalizeWebAppHomeTabList,
  normalizeWebAppOpenRules
} from "./storeProjectNormalizers";
import {
  createDefaultState,
  normalizeAppState,
  normalizeNavigationState,
  normalizeOnboardingState,
  normalizePasswordVault,
  normalizeSchemaVersion,
  normalizeSettings,
  normalizeWebAppHomeTabs,
  normalizeWebAppState,
  normalizeWindowState,
  normalizeWorkspaceSession
} from "./storeStateNormalizers";
import {
  DEFAULT_BOUNDS,
  DEFAULT_WINDOW_BOUNDS,
  compareVersions,
  deriveRepoUrl,
  getErrorCode,
  getErrorMessage,
  isRecord,
  normalizeBounds,
  normalizeOptionalUrl,
  normalizeSlug,
  normalizeText,
  normalizeUrl,
  normalizeWindowBounds,
  toRecord
} from "./storeUtils";
import type {
  AppState,
  NavigationState,
  OnboardingState,
  PaneLayoutNode,
  PasswordCredentialState,
  PluginConfigObject,
  ProjectStoreState,
  ProjectWidgetLayout,
  StoredProject,
  TopbarWidgetsState,
  WebAppOpenRule,
  WebAppState,
  WidgetLayout,
  WidgetPosition,
  WidgetSize,
  WindowState,
  WorkspaceWindowState
} from "./storeTypes";

const DEFAULT_WIDGET_PANE_ID = "widgets-0";
const GLOBAL_WORKSPACE_ID = "__global__";
type UnknownRecord = Record<string, unknown>;

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

function normalizeTopbarWidgetsState(topbarWidgets: unknown = {}): TopbarWidgetsState {
  const source = toRecord(topbarWidgets);
  const order = (Array.isArray(source.order) ? source.order : [])
    .map((id) => String(id || "").trim())
    .filter((id, index, values) => id && values.indexOf(id) === index);

  return { order };
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

function isProjectSpecificWebAppOpenRule(rule: WebAppOpenRule) {
  return Boolean(rule.projectId || rule.target?.startsWith("pane:"));
}

function normalizeWorkspaceSessionState(workspaceSession: unknown, projects: StoredProject[]) {
  const normalized = normalizeWorkspaceSession(workspaceSession);
  const rawWindows = toRecord(toRecord(workspaceSession).windows);

  for (const [id, window] of Object.entries(normalized.windows)) {
    const source = toRecord(rawWindows[id]);
    normalized.windows[id] = {
      ...window,
      paneLayouts: normalizePaneLayouts(source.paneLayouts),
      widgetLayouts: normalizeWidgetLayouts(source.widgetLayouts),
      terminalSelections: normalizeTerminalSelections(source.terminalSelections, projects),
      terminalTabOrders: normalizeTerminalTabOrders(source.terminalTabOrders, projects)
    };
    if (!normalized.groups[window.syncGroupId]) {
      normalized.groups[window.syncGroupId] = { id: window.syncGroupId, activeProjectId: window.navigation.projectId };
    }
  }

  return normalized;
}

class ProjectStore {
  configDirectory: string;
  legacyFilePath: string | null;
  settingsFilePath: string;
  projectsFilePath: string;
  workspaceSessionFilePath: string;
  state: ProjectStoreState;

  constructor(location: string | { configDirectory: string; legacyFilePath?: string | null }) {
    if (typeof location === "string") {
      this.configDirectory = path.join(path.dirname(location), ".boatyard");
      this.legacyFilePath = location;
    } else {
      this.configDirectory = location.configDirectory;
      this.legacyFilePath = location.legacyFilePath || null;
    }

    this.settingsFilePath = path.join(this.configDirectory, "settings.json");
    this.projectsFilePath = path.join(this.configDirectory, "projects.json");
    this.workspaceSessionFilePath = path.join(this.configDirectory, "workspace-session.json");
    this.state = createDefaultState();
  }

  load(): ProjectStoreState {
    try {
      this.migrateLegacyStateIfNeeded();
      this.state = this.normalizeState(this.readSplitState());
    } catch (error: unknown) {
      if (getErrorCode(error) !== "ENOENT") {
        console.warn(`Could not load Boatyard state: ${getErrorMessage(error)}`);
      }
      this.state = createDefaultState();
    }

    return this.getState();
  }

  save(): void {
    fs.mkdirSync(this.configDirectory, { recursive: true });
    this.writeJsonAtomically(this.settingsFilePath, {
      schemaVersion: this.state.schemaVersion,
      settings: this.state.settings,
      passwordVault: this.state.passwordVault,
      plugins: this.state.plugins,
      globalPluginConfig: this.state.pluginConfig.global,
      topbarWidgets: this.state.topbarWidgets,
      onboarding: this.state.onboarding,
      app: this.state.app
    });
    this.writeJsonAtomically(this.projectsFilePath, {
      schemaVersion: this.state.schemaVersion,
      projects: this.state.projects,
      globalUrls: this.state.globalUrls,
      projectPluginConfig: this.state.pluginConfig.projects
    });
    this.writeJsonAtomically(this.workspaceSessionFilePath, {
      schemaVersion: this.state.schemaVersion,
      window: this.state.window,
      navigation: this.state.navigation,
      webApps: this.state.webApps,
      paneLayouts: this.state.paneLayouts,
      widgetLayouts: this.state.widgetLayouts,
      terminalSelections: this.state.terminalSelections,
      terminalTabOrders: this.state.terminalTabOrders,
      workspaceSession: this.state.workspaceSession
    });
  }

  private hasSplitState(): boolean {
    return fs.existsSync(this.settingsFilePath) ||
      fs.existsSync(this.projectsFilePath) ||
      fs.existsSync(this.workspaceSessionFilePath);
  }

  private readJsonFile(filePath: string): UnknownRecord {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    return toRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  private readSplitState(): UnknownRecord {
    const settings = this.readJsonFile(this.settingsFilePath);
    const projects = this.readJsonFile(this.projectsFilePath);
    const workspaceSession = this.readJsonFile(this.workspaceSessionFilePath);

    return {
      ...settings,
      ...projects,
      ...workspaceSession,
      schemaVersion: Math.max(
        Number(settings.schemaVersion) || 0,
        Number(projects.schemaVersion) || 0,
        Number(workspaceSession.schemaVersion) || 0
      ),
      pluginConfig: {
        global: settings.globalPluginConfig,
        projects: projects.projectPluginConfig
      }
    };
  }

  private normalizeState(parsed: UnknownRecord): ProjectStoreState {
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects
      : Array.isArray(parsed.apps)
        ? parsed.apps
        : [];
    const normalizedProjects = projects.map((project, index) => normalizeProject(project, index));
    const legacyWebAppHomeTabs = normalizeWebAppHomeTabs(parsed.webAppHomeTabs, normalizedProjects);
    const normalizedSettings = normalizeSettings(parsed.settings);
    const projectsWithHomeTabs = normalizedProjects.map((project) => ({
      ...project,
      webAppHomeTabs: project.webAppHomeTabs.length
        ? project.webAppHomeTabs
        : legacyWebAppHomeTabs[project.id] || [],
      webAppOpenRules: normalizeWebAppOpenRules(project.webAppOpenRules || [])
    }));

    return {
      schemaVersion: normalizeSchemaVersion(parsed.schemaVersion),
      settings: {
        ...normalizedSettings,
        webAppOpenRules: normalizedSettings.webAppOpenRules.filter((rule) => (
          !rule.projectId && !isProjectSpecificWebAppOpenRule(rule)
        ))
      },
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
      topbarWidgets: normalizeTopbarWidgetsState(parsed.topbarWidgets),
      onboarding: normalizeOnboardingState(parsed.onboarding),
      app: normalizeAppState(parsed.app),
      workspaceSession: normalizeWorkspaceSessionState(parsed.workspaceSession, projectsWithHomeTabs)
    };
  }

  private getLegacyMigrationSource(): string | null {
    if (this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
      return this.legacyFilePath;
    }

    if (!this.legacyFilePath) {
      return null;
    }

    const directory = path.dirname(this.legacyFilePath);
    const baseName = path.basename(this.legacyFilePath, path.extname(this.legacyFilePath));
    const backup = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry: { isFile(): boolean; name: string }) => entry.isFile() && entry.name.startsWith(`${baseName}.legacy-`) && entry.name.endsWith(".json"))
      .sort((left: { name: string }, right: { name: string }) => right.name.localeCompare(left.name))[0];

    return backup ? path.join(directory, backup.name) : null;
  }

  private migrateLegacyStateIfNeeded(): void {
    if (this.hasSplitState()) {
      return;
    }

    const source = this.getLegacyMigrationSource();
    if (!source) {
      return;
    }

    const legacyState = toRecord(JSON.parse(fs.readFileSync(source, "utf8")));
    let backupPath = source;

    if (source === this.legacyFilePath) {
      const extension = path.extname(source) || ".json";
      const baseName = path.basename(source, extension);
      backupPath = path.join(path.dirname(source), `${baseName}.legacy-${Date.now()}${extension}`);
      fs.renameSync(source, backupPath);
    }

    this.state = this.normalizeState(legacyState);
    try {
      this.save();
    } catch (error) {
      throw new Error(`Could not migrate legacy configuration from ${backupPath}: ${getErrorMessage(error)}`);
    }
  }

  private writeJsonAtomically(filePath: string, value: unknown): void {
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
  }

  getState(): ProjectStoreState {
    return structuredClone(this.state);
  }

  getStateForWorkspaceWindow(windowId: unknown): ProjectStoreState {
    const workspaceWindow = this.state.workspaceSession.windows[normalizeText(windowId)];
    if (!workspaceWindow) {
      return this.getState();
    }

    return structuredClone({
      ...this.state,
      window: workspaceWindow.window,
      navigation: workspaceWindow.navigation,
      webApps: workspaceWindow.webApps,
      paneLayouts: workspaceWindow.paneLayouts,
      widgetLayouts: workspaceWindow.widgetLayouts,
      terminalSelections: workspaceWindow.terminalSelections,
      terminalTabOrders: workspaceWindow.terminalTabOrders
    });
  }

  getWorkspaceWindowStates(): WorkspaceWindowState[] {
    return structuredClone(Object.values(this.state.workspaceSession.windows));
  }

  ensureWorkspaceWindow(windowId: unknown, syncGroupId: unknown, sourceWindowId: unknown = null): WorkspaceWindowState {
    const id = normalizeText(windowId);
    const groupId = normalizeText(syncGroupId);
    if (!id || !groupId) {
      throw new Error("Workspace window and sync group ids are required.");
    }
    if (this.state.workspaceSession.windows[id]) {
      return structuredClone(this.state.workspaceSession.windows[id]);
    }

    const source = this.state.workspaceSession.windows[normalizeText(sourceWindowId)];
    const fallback: WorkspaceWindowState = {
      id,
      syncGroupId: groupId,
      window: structuredClone(this.state.window),
      navigation: structuredClone(this.state.navigation),
      webApps: structuredClone(this.state.webApps),
      paneLayouts: structuredClone(this.state.paneLayouts),
      widgetLayouts: structuredClone(this.state.widgetLayouts),
      terminalSelections: structuredClone(this.state.terminalSelections),
      terminalTabOrders: structuredClone(this.state.terminalTabOrders)
    };
    this.state.workspaceSession.windows[id] = {
      ...(source ? structuredClone(source) : fallback),
      id,
      syncGroupId: groupId
    };
    if (!this.state.workspaceSession.groups[groupId]) {
      this.state.workspaceSession.groups[groupId] = {
        id: groupId,
        activeProjectId: this.state.workspaceSession.windows[id].navigation.projectId
      };
    }
    this.save();
    return structuredClone(this.state.workspaceSession.windows[id]);
  }

  removeWorkspaceWindow(windowId: unknown): void {
    const id = normalizeText(windowId);
    const workspaceWindow = this.state.workspaceSession.windows[id];
    if (!workspaceWindow) {
      return;
    }
    delete this.state.workspaceSession.windows[id];
    if (!Object.values(this.state.workspaceSession.windows).some((entry) => entry.syncGroupId === workspaceWindow.syncGroupId)) {
      delete this.state.workspaceSession.groups[workspaceWindow.syncGroupId];
    }
    this.save();
  }

  updateWorkspaceWindowState(windowId: unknown, windowState: unknown): WindowState {
    const workspaceWindow = this.state.workspaceSession.windows[normalizeText(windowId)];
    if (!workspaceWindow) {
      return this.updateWindowState(windowState);
    }
    const source = toRecord(windowState);
    workspaceWindow.window = normalizeWindowState({
      ...workspaceWindow.window,
      ...source,
      bounds: source.bounds || workspaceWindow.window.bounds
    });
    this.save();
    return structuredClone(workspaceWindow.window);
  }

  updateWorkspaceNavigation(windowId: unknown, navigation: unknown): Record<string, NavigationState> {
    const workspaceWindow = this.state.workspaceSession.windows[normalizeText(windowId)];
    if (!workspaceWindow) {
      return { "": this.updateNavigation(navigation) };
    }
    const nextNavigation = normalizeNavigationState(navigation);
    const group = this.state.workspaceSession.groups[workspaceWindow.syncGroupId];
    const projectId = nextNavigation.view.startsWith("project") ? nextNavigation.projectId : null;
    if (!projectId || !group) {
      workspaceWindow.navigation = nextNavigation;
      this.save();
      return { [workspaceWindow.id]: structuredClone(nextNavigation) };
    }

    group.activeProjectId = projectId;
    const updated: Record<string, NavigationState> = {};
    for (const entry of Object.values(this.state.workspaceSession.windows)) {
      if (entry.syncGroupId !== workspaceWindow.syncGroupId) {
        continue;
      }
      entry.navigation = normalizeNavigationState({
        ...entry.navigation,
        ...nextNavigation,
        view: "project",
        projectId
      });
      updated[entry.id] = structuredClone(entry.navigation);
    }
    this.save();
    return updated;
  }

  updateWorkspacePaneLayout(windowId: unknown, projectId: unknown, layout: unknown): PaneLayoutNode | null {
    const workspaceWindow = this.state.workspaceSession.windows[normalizeText(windowId)];
    if (!workspaceWindow) {
      return this.updatePaneLayout(projectId, layout);
    }
    const normalized = normalizePaneLayoutNode(layout);
    if (!normalized) {
      delete workspaceWindow.paneLayouts[String(projectId)];
    } else {
      workspaceWindow.paneLayouts[String(projectId)] = normalized;
    }
    this.save();
    return structuredClone(workspaceWindow.paneLayouts[String(projectId)] || null);
  }

  updateWorkspaceWidgetLayout(windowId: unknown, projectId: unknown, layout: unknown): ProjectWidgetLayout | null {
    const workspaceWindow = this.state.workspaceSession.windows[normalizeText(windowId)];
    if (!workspaceWindow) {
      return this.updateWidgetLayout(projectId, layout);
    }
    workspaceWindow.widgetLayouts[String(projectId)] = normalizeProjectWidgetLayout(layout);
    this.save();
    return structuredClone(workspaceWindow.widgetLayouts[String(projectId)] || null);
  }

  updateWorkspaceWebAppState(windowId: unknown, key: unknown, webAppState: unknown): WebAppState | null {
    const workspaceWindow = this.state.workspaceSession.windows[normalizeText(windowId)];
    if (!workspaceWindow) {
      return this.updateWebAppState(String(key), webAppState) as WebAppState | null;
    }
    const normalized = normalizeWebAppState({ [String(key)]: webAppState });
    if (!normalized[String(key)]) {
      delete workspaceWindow.webApps[String(key)];
    } else {
      workspaceWindow.webApps[String(key)] = normalized[String(key)];
    }
    this.save();
    return structuredClone(workspaceWindow.webApps[String(key)] || null);
  }

  getWorkspaceWebAppUrl(windowId: unknown, key: unknown): string | null {
    const workspaceWindow = this.state.workspaceSession.windows[normalizeText(windowId)];
    return workspaceWindow?.webApps[String(key)]?.url || this.getWebAppUrl(key);
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

  getTopbarWidgets(): TopbarWidgetsState {
    return structuredClone(this.state.topbarWidgets);
  }

  updateTopbarWidgets(topbarWidgets: unknown): TopbarWidgetsState {
    this.state.topbarWidgets = normalizeTopbarWidgetsState(topbarWidgets);
    this.save();
    return this.getTopbarWidgets();
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
    const pinnedProjectIds = this.state.navigation.pinnedProjectIds.filter((pinnedProjectId) => pinnedProjectId !== projectId);
    if (this.state.navigation.projectId === projectId) {
      this.state.navigation = normalizeNavigationState({
        view: "global",
        pinnedProjectIds,
        sidebarCollapsed: this.state.navigation.sidebarCollapsed
      });
    } else if (pinnedProjectIds.length !== this.state.navigation.pinnedProjectIds.length) {
      this.state.navigation = normalizeNavigationState({
        ...this.state.navigation,
        pinnedProjectIds
      });
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
