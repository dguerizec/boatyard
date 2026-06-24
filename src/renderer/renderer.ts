import { createGlobalSettingsViews } from "./globalSettingsViews.js";
import { createHawserWidget } from "./hawserWidget.js";
import { createManualViews } from "./manualViews.js";
import { createOnboardingTour } from "./onboardingTour.js";
import { createPaneLayoutState } from "./paneLayoutState.js";
import { createPaneLayoutView } from "./paneLayoutView.js";
import { createPluginLoader } from "./pluginLoader.js";
import { registerPluginRegistry } from "./pluginRegistry.js";
import { registerPluginSettingsFields } from "./pluginSettingsFields.js";
import { createProjectPageViews } from "./projectPageViews.js";
import { createProjectSidebar } from "./projectSidebar.js";
import { createProjectSettingsViews } from "./projectSettingsViews.js";
import { createProjectWebApps } from "./projectWebApps.js";
import {
  deriveProjectNameFromPath,
  deriveRepoUrl,
  formatProjectNameFromPath,
  normalizeProjectSearchText,
  projectMatchesSearch,
  slugify
} from "./projectUtils.js";
import { toUnknownRecord, type UnknownRecord } from "./rendererRecords.js";
import type {
  GlobalSettingsViewsInstance,
  PaneLayoutStateInstance,
  PaneLayoutViewInstance,
  ProjectNavBadgeRenderOptions,
  ProjectSettingsViewsInstance,
  RendererCreateModule,
  RendererModuleInstance,
  RendererPaneLayoutNode,
  RendererProject,
  RendererState,
  UpdateViewsInstance,
  WebAppMenusInstance,
  WidgetSurfacesInstance
} from "./rendererTypes.js";
import { createTerminalSurfaces } from "./terminalSurfaces.js";
import { createToolIcon } from "./toolIcons.js";
import { createUpdateViews } from "./updateViews.js";
import { createWebAppMenus } from "./webAppMenus.js";
import { createWebAppSurfaces } from "./webAppSurfaces.js";
import { registerWidgetRegistry } from "./widgetRegistry.js";
import { createWidgetSurfaces } from "./widgetSurfaces.js";
import { createWorkspaceDashboardViews } from "./workspaceDashboardViews.js";

const boatyardWindow = window;
registerWidgetRegistry(window);
registerPluginRegistry(window);
registerPluginSettingsFields(window);

const globalNav = document.querySelector<HTMLElement>("#global-nav");
const globalNavRow = document.querySelector<HTMLElement>("#global-nav-row");
const globalSettingsButton = document.querySelector<HTMLButtonElement>("#global-settings");
const globalViewButton = document.querySelector<HTMLButtonElement>("#global-view");
const manualTourButton = document.querySelector<HTMLButtonElement>("#manual-tour");
const sidebarUpdateNotice = document.querySelector<HTMLElement>("#sidebar-update-notice");
const addProjectButton = document.querySelector<HTMLButtonElement>("#add-project");
const projectCount = document.querySelector<HTMLElement>("#project-count");
const projectSearchInput = document.querySelector<HTMLInputElement>("#project-search");
const projectList = document.querySelector<HTMLElement>("#project-list");
const workspace = document.querySelector<HTMLElement>(".workspace");
const dashboardGrid = document.querySelector<HTMLElement>("#dashboard-grid");
const workspaceKicker = document.querySelector<HTMLElement>("#workspace-kicker");
const workspaceTitle = document.querySelector<HTMLElement>("#workspace-title");
const workspaceSummary = document.querySelector<HTMLElement>("#workspace-summary");

const MIN_WIDGET_RAIL_WIDTH = 240;
const DEFAULT_WIDGET_PANE_ID = "widgets-0";
const GLOBAL_WORKSPACE_ID = "__global__";
const WIDGET_GRID_MIN_COLUMN_WIDTH = 100;
const WIDGET_GRID_MAX_COLUMN_WIDTH = 200;
const WIDGET_GRID_ROW_HEIGHT = 84;
const WIDGET_GRID_GAP = 12;
const WIDGET_GRID_SCROLL_GUARD = 10;
const WEBAPP_SPLIT_RESIZER_SIZE = 6;
const WEBAPP_OPEN_SPLIT_RATIO = 2 / 3;
const ONBOARDING_VERSION = boatyardWindow.BoatyardManual?.version || 1;
const LEGACY_WIDGET_IDS = new Map([
  ["project-shell", "terminal-shell"],
  ["global-shell", "terminal-shell"]
]);

let state: RendererState = { projects: [] };
let currentView = "global";
let currentProjectId = null;
let returnView = { view: "global", projectId: null };
const loadedWebAppKeys = new Set<string>();
const currentWebAppUrlsByKey = new Map<string, string>();
const loadedWebAppUrlsByKey = new Map<string, string>();
const webAppLoadWaiters = new Set<(payload: unknown) => void>();
const webAppAutofillEnabledByKey = new Map<string, boolean>();
let visibleWebAppHosts = new Map();
let pierWorkloadPaneRefreshFrame = null;
const UPDATE_POLL_INTERVAL_MS = 10 * 60 * 1000;

function getProjects() {
  return state.projects;
}

function getProjectGroups() {
  const groups = [...new Set(getProjects()
    .map((project) => String(project.group || "").trim())
    .filter((group): group is string => Boolean(group)))];
  return groups.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function getCollapsedProjectGroups() {
  return new Set(Array.isArray(state.navigation?.collapsedProjectGroups)
    ? state.navigation.collapsedProjectGroups
    : []);
}

function getProjectGroupsByName(projects = getProjects()) {
  const groups = new Map();

  for (const project of projects) {
    const groupName = String(project.group || "").trim();
    if (!groupName) {
      continue;
    }

    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }
    groups.get(groupName).push(project);
  }

  return groups;
}

function getSettings() {
  return {
    projectsBasePath: "",
    blurWebAppOverlays: false,
    passwordManagerDisclaimerAccepted: false,
    passwordManagerEnabled: false,
    webAppOpenRules: [],
    widgetRailWidth: 340,
    terminalEnv: "",
    ...(state.settings || {})
  };
}

function getManual() {
  return boatyardWindow.BoatyardManual || {
    title: "Boatyard Manual",
    description: "",
    sections: [],
    onboarding: []
  };
}

function getCurrentProject() {
  return getProjects().find((project) => project.id === currentProjectId) || null;
}

function getProjectById(projectId) {
  return getProjects().find((project) => project.id === projectId) || null;
}

function getGlobalWorkspace() {
  return {
    id: GLOBAL_WORKSPACE_ID,
    name: "Global",
    slug: "global",
    urls: state.globalUrls || [],
    widgetPanes: [{
      id: DEFAULT_WIDGET_PANE_ID,
      label: "Widgets"
    }],
    isGlobalWorkspace: true
  };
}

function isGlobalWorkspace(project) {
  return project?.isGlobalWorkspace === true || project?.id === GLOBAL_WORKSPACE_ID;
}

function getProjectPluginConfig(projectId, pluginId) {
  return state.pluginConfig?.projects?.[projectId]?.[pluginId] || {};
}

function getGlobalPluginConfig(pluginId) {
  return state.pluginConfig?.global?.[pluginId] || {};
}

function applyFormControl(control) {
  control.classList.add("form-control");
  return control;
}

function applyFormControls(root) {
  root
    .querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), textarea')
    .forEach(applyFormControl);
}

function getPluginPaneDefinitions(filter = {}) {
  return boatyardWindow.BoatyardPluginRegistry?.listPanes(filter) || [];
}

function getPluginProjectNavBadgeDefinitions() {
  return boatyardWindow.BoatyardPluginRegistry?.listProjectNavBadges() || [];
}

function getPluginProjectSettingsSections() {
  return boatyardWindow.BoatyardPluginRegistry?.listProjectSettingsSections() || [];
}

function getPluginGlobalSettingsSections() {
  return boatyardWindow.BoatyardPluginRegistry?.listGlobalSettingsSections() || [];
}

function getPluginEnabledState() {
  return state.plugins?.enabled || {};
}

function getProjectSummaryTarget(project) {
  return project.sourcePath ||
    project.slug;
}

function renderProjectNavBadges(project, container, options: ProjectNavBadgeRenderOptions = {}) {
  for (const badge of getPluginProjectNavBadgeDefinitions()) {
    try {
      const element = badge.render({
        project,
        projectConfig: getProjectPluginConfig(project.id, badge.pluginId),
        globalConfig: getGlobalPluginConfig(badge.pluginId),
        isActiveProject: options.isActiveProject === true,
        currentView
      });

      if (element && typeof element === "object" && typeof element.nodeType === "number") {
        container.append(element);
      }
    } catch (error) {
      console.error(`Could not render project nav badge ${badge.id}:`, error);
    }
  }
}

async function persistProjectPluginConfig(projectId, pluginConfig = {}) {
  let nextState = state;

  for (const [pluginId, config] of Object.entries(toUnknownRecord(pluginConfig))) {
    nextState = await boatyardWindow.boatyard.updateProjectPluginConfig(projectId, pluginId, toUnknownRecord(config));
  }

  return nextState;
}

function readPluginSettingsFieldValue(field, input) {
  return boatyardWindow.BoatyardPluginSettingsFields.readFieldValue(field, input, {
    normalizeUrl: normalizeAddressInput
  });
}

function isRestorableView(view) {
  return ["global", "global-settings", "project", "project-edit"].includes(view);
}

function persistNavigation() {
  if (!isRestorableView(currentView)) {
    return;
  }

  boatyardWindow.boatyard.updateNavigation({
    view: currentView,
    projectId: currentProjectId,
    collapsedProjectGroups: [...getCollapsedProjectGroups()]
  }).catch((error) => {
    console.error("Could not persist navigation:", error);
  });
}

function setCurrentView(view, projectId = null, { persist = true } = {}) {
  if (view !== currentView || projectId !== currentProjectId) {
    closeProjectGroupMenu();
    closeTerminalTabMenu();
  }

  currentView = view;
  currentProjectId = projectId;

  if (persist) {
    persistNavigation();
  }
}

function restoreNavigation() {
  const navigation = state.navigation || {};
  const projectExists = getProjects().some((project) => project.id === navigation.projectId);

  if (navigation.view === "global-settings") {
    setCurrentView("global-settings", null, { persist: false });
  } else if ((navigation.view === "project" || navigation.view === "project-edit") && projectExists) {
    setCurrentView(navigation.view, navigation.projectId, { persist: false });
  } else {
    setCurrentView("global", null, { persist: false });
  }
}

function createCard({ title, eyebrow, body, meta, action }) {
  const card = document.createElement("article");
  card.className = "widget-card";

  const content = document.createElement("div");
  content.className = "widget-content";

  if (eyebrow) {
    const eyebrowNode = document.createElement("p");
    eyebrowNode.className = "widget-eyebrow";
    eyebrowNode.textContent = eyebrow;
    content.append(eyebrowNode);
  }

  const titleNode = document.createElement("h3");
  titleNode.textContent = title;
  content.append(titleNode);

  const bodyNode = document.createElement("p");
  bodyNode.textContent = body;
  content.append(bodyNode);

  if (meta) {
    const metaNode = document.createElement("span");
    metaNode.className = "widget-meta";
    metaNode.textContent = meta;
    content.append(metaNode);
  }

  card.append(content);

  if (action) {
    const button = document.createElement("button");
    button.className = "secondary-button";
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    card.append(button);
  }

  return card;
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function normalizeComparableUrl(url) {
  try {
    return new URL(url).toString();
  } catch {
    return String(url || "");
  }
}

function matchesWebAppLoad(payload, key, expectedUrl = "") {
  if (!payload || payload.key !== key) {
    return false;
  }

  if (!expectedUrl) {
    return true;
  }

  return normalizeComparableUrl(payload.url) === normalizeComparableUrl(expectedUrl);
}

function hasLoadedWebApp(key, expectedUrl = "") {
  const loadedUrl = loadedWebAppUrlsByKey.get(key);
  if (!loadedUrl) {
    return false;
  }

  return matchesWebAppLoad({ key, url: loadedUrl }, key, expectedUrl);
}

function waitForWebAppLoad(key, expectedUrl = "", timeoutMs = 6000) {
  if (!key || hasLoadedWebApp(key, expectedUrl)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let timeout = null;
    let waiter = null;
    const cleanup = (loaded) => {
      clearTimeout(timeout);
      webAppLoadWaiters.delete(waiter);
      resolve(loaded);
    };
    waiter = (payload) => {
      if (matchesWebAppLoad(payload, key, expectedUrl)) {
        cleanup(true);
      }
    };

    webAppLoadWaiters.add(waiter);
    timeout = setTimeout(() => cleanup(false), timeoutMs);
  });
}

const paneLayoutState = createPaneLayoutState({
  updatePaneLayout: (projectId, layout) => boatyardWindow.boatyard.updatePaneLayout(projectId, layout)
});

const terminalSurfaces = createTerminalSurfaces({
  boatyard: boatyardWindow.boatyard,
  getProjectById,
  getState: () => state,
  createToolIcon,
  clamp,
  defaultWidgetPaneId: DEFAULT_WIDGET_PANE_ID
});

function closeTerminalTabMenu() {
  terminalSurfaces.closeTerminalTabMenu();
}

function detachProjectTerminal(projectId) {
  terminalSurfaces.detachProjectTerminal(projectId);
}

function detachInactiveProjectTerminals(activeProjectId = null) {
  terminalSurfaces.detachInactiveProjectTerminals(activeProjectId);
}

function createTerminalSurface(project, options = {}) {
  return terminalSurfaces.createTerminalSurface(project, options);
}

function createTerminalWidget(project, props = {}) {
  return terminalSurfaces.createTerminalWidget(project, props);
}

boatyardWindow.BoatyardHawserUI = Object.freeze({
  createWidget: createHawserWidget
});

function registerBuiltinWidgets() {
  const registry = boatyardWindow.BoatyardWidgetRegistry;

  if (!registry) {
    throw new Error("Widget registry is unavailable.");
  }

  [
    {
      id: "terminal-shell",
      name: "Terminal",
      title: "Terminal",
      scopes: ["global", "project"],
      category: "Developer tools",
      status: "experimental",
      description: "Persistent multi-tab tmux terminal.",
      layout: {
        default: { columns: 4, rows: 5 },
        min: { columns: 2, rows: 3 }
      },
      createElement: (project, props) => createTerminalWidget(project, props)
    }
  ].forEach((definition) => registry.register(definition));
}

registerBuiltinWidgets();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const widgetSurfaces = createWidgetSurfaces({
  boatyard: boatyardWindow.boatyard,
  getState: () => state,
  getProjectPluginConfig,
  getGlobalPluginConfig,
  isGlobalWorkspace,
  openProjectWebApp,
  createCard,
  createToolIcon,
  renderWorkspaceDashboard,
  dashboardGrid,
  clamp,
  minWidgetRailWidth: MIN_WIDGET_RAIL_WIDTH,
  defaultWidgetPaneId: DEFAULT_WIDGET_PANE_ID,
  widgetGridMinColumnWidth: WIDGET_GRID_MIN_COLUMN_WIDTH,
  widgetGridMaxColumnWidth: WIDGET_GRID_MAX_COLUMN_WIDTH,
  widgetGridRowHeight: WIDGET_GRID_ROW_HEIGHT,
  widgetGridGap: WIDGET_GRID_GAP,
  widgetGridScrollGuard: WIDGET_GRID_SCROLL_GUARD,
  legacyWidgetIds: LEGACY_WIDGET_IDS
});

function getInstalledWidgets(filter = {}) {
  return widgetSurfaces.getInstalledWidgets(filter);
}

function getProjectWidgetDefinitions(project = null) {
  return widgetSurfaces.getProjectWidgetDefinitions(project);
}

function getProjectWidgetPanes(project) {
  return widgetSurfaces.getProjectWidgetPanes(project);
}

function getProjectWidgetLayout(project, columnCount = null, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  return widgetSurfaces.getProjectWidgetLayout(project, columnCount, widgetPaneId);
}

function getOrderedWidgetDefinitions(project, layout) {
  return widgetSurfaces.getOrderedWidgetDefinitions(project, layout);
}

function getWidgetGridColumnCount(widgetRailWidth) {
  return widgetSurfaces.getWidgetGridColumnCount(widgetRailWidth);
}

function getWidgetRailColumnCount(widgetRail) {
  return widgetSurfaces.getWidgetRailColumnCount(widgetRail);
}

function applyWidgetGridLayout(widgetRail, project, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  widgetSurfaces.applyWidgetGridLayout(widgetRail, project, columnCount, widgetPaneId);
}

function createProjectWidget(project, definition, layout, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  return widgetSurfaces.createProjectWidget(project, definition, layout, columnCount, widgetPaneId);
}

function createWidgetPaneActions(project, widgetPane, layout, columnCount) {
  return widgetSurfaces.createWidgetPaneActions(project, widgetPane, layout, columnCount);
}

function createWidgetPaneSurface(project, widgetPane) {
  return widgetSurfaces.createWidgetPaneSurface(project, widgetPane);
}

function closeWidgetAddMenu() {
  widgetSurfaces.closeWidgetAddMenu();
}

function renderWorkspaceDashboard(project) {
  if (isGlobalWorkspace(project)) {
    renderGlobalDashboard();
  } else {
    renderProjectDashboard(project);
  }
}

function renderWorkspacePaneArea(project) {
  if (isGlobalWorkspace(project)) {
    renderGlobalPaneArea();
  } else {
    renderProjectPaneArea(project);
  }
}

const projectWebApps = createProjectWebApps({
  findPaneNode,
  getGlobalPluginConfig,
  getPaneLayout: getProjectPaneLayout,
  getPluginPaneDefinitions,
  getProjectPluginConfig,
  getProjectWidgetPanes,
  isGlobalWorkspace
});

function getProjectWebApps(project, paneId) {
  return projectWebApps.getProjectWebApps(project, paneId);
}

function getProjectPaneLayout(project) {
  return paneLayoutState.getProjectPaneLayout(project);
}

function getSelectedWebApp(project, paneId, webApps) {
  return paneLayoutState.getSelectedWebApp(project, paneId, webApps);
}

function invokeWebApp(action, ...payload) {
  return boatyardWindow.boatyard[action](...payload).catch((error) => {
    console.error(`Could not ${action}:`, error);
  });
}

function isWebAppAutofillEnabled(webApp) {
  return webAppAutofillEnabledByKey.get(webApp.key) === true;
}

function isPasswordManagerEnabled() {
  const settings = getSettings();
  return settings.passwordManagerEnabled === true && settings.passwordManagerDisclaimerAccepted === true;
}

function syncWebAppAutofillButton(button, enabled) {
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  button.title = enabled
    ? "Saved login and password fill is enabled. Click to disable."
    : "Enable one-time fill with the saved login and password.";
  button.setAttribute("aria-label", button.title);
}

async function toggleWebAppAutofill(webApp, button) {
  const enabled = !isWebAppAutofillEnabled(webApp);
  webAppAutofillEnabledByKey.set(webApp.key, enabled);
  syncWebAppAutofillButton(button, enabled);
  await invokeWebApp("updateWebAppAutofill", webApp.key, enabled);
}

function getCurrentWebAppUrl(webApp) {
  if (webApp.restoreUrl === false) {
    return webApp.url;
  }

  return currentWebAppUrlsByKey.get(webApp.key) || webApp.url;
}

function getVisibleWebAppByKey(key) {
  for (const { webApp } of visibleWebAppHosts.values()) {
    if (webApp.key === key) {
      return webApp;
    }
  }

  return null;
}

function getVisibleWebAppEntryByKey(key) {
  for (const [paneId, entry] of visibleWebAppHosts.entries()) {
    if (entry.webApp.key === key) {
      return {
        ...entry,
        paneId
      };
    }
  }

  return null;
}

function getVisibleWebAppEntryByUrl(url) {
  if (!url) {
    return null;
  }

  for (const [paneId, entry] of visibleWebAppHosts.entries()) {
    if (getCurrentWebAppUrl(entry.webApp) === url || entry.webApp.url === url) {
      return {
        ...entry,
        paneId
      };
    }
  }

  return null;
}

function getVisibleWebAppProject() {
  if (currentView === "global") {
    return getGlobalWorkspace();
  }

  if (currentView === "project") {
    return getCurrentProject();
  }

  return null;
}

function persistVisibleWebAppPaneLayout(key, url = "") {
  if (isOnboardingTourActive()) {
    return;
  }

  const sourceEntry = getVisibleWebAppEntryByKey(key);
  const project = sourceEntry ? getVisibleWebAppProject() : null;
  if (project) {
    const paneNode = findPaneNode(getProjectPaneLayout(project), sourceEntry.paneId);
    if (paneNode?.transientWebApp?.id === sourceEntry.webApp.id && url) {
      paneNode.transientWebApp = {
        ...paneNode.transientWebApp,
        url
      };
    }
    persistPaneLayout(project);
  }
}

function findFirstPaneNode(node) {
  return paneLayoutState.findFirstPaneNode(node);
}

function collectPaneNodes(node, panes = []) {
  return paneLayoutState.collectPaneNodes(node, panes);
}

function findPaneNodeBySelectedWebApp(node, webAppId) {
  return paneLayoutState.findPaneNodeBySelectedWebApp(node, webAppId);
}

function createSplitNode(project, direction, first, selectedWebAppId = null) {
  return paneLayoutState.createSplitNode(project, direction, first, selectedWebAppId);
}

function findPaneNode(node, paneId) {
  return paneLayoutState.findPaneNode(node, paneId);
}

function replacePaneNode(node, paneId, replacement) {
  return paneLayoutState.replacePaneNode(node, paneId, replacement);
}

function countPaneNodes(node) {
  return paneLayoutState.countPaneNodes(node);
}

function openProjectWebApp(projectId, webAppId, url = "") {
  const project = getProjects().find((candidate) => candidate.id === projectId);
  if (!project) {
    return false;
  }

  const layout = getProjectPaneLayout(project);
  const paneNode = findPaneNodeBySelectedWebApp(layout, webAppId) || findFirstPaneNode(layout);
  if (!paneNode) {
    return false;
  }

  const webApp = getProjectWebApps(project, paneNode.id).find((candidate) => candidate.id === webAppId);
  if (!webApp) {
    return false;
  }

  paneLayoutState.setSelectedWebAppForPane(paneNode.id, webApp.id);
  paneNode.selectedWebAppId = webApp.id;
  paneLayoutState.setSelectedWebAppForProject(project.id, webApp.id);

  if (url) {
    currentWebAppUrlsByKey.set(webApp.key, url);
  }

  persistPaneLayout(project);
  renderWorkspacePaneArea(project);

  if (url) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => invokeWebApp("navigateWebApp", webApp.key, "open", url));
    });
  }

  return true;
}

boatyardWindow.BoatyardPaneNavigation = Object.freeze({
  openProjectWebApp
});

const paneLayoutView = createPaneLayoutView({
  minWidgetRailWidth: MIN_WIDGET_RAIL_WIDTH,
  webAppSplitResizerSize: WEBAPP_SPLIT_RESIZER_SIZE,
  dashboardGrid,
  createToolIcon,
  paneLayoutState,
  getProjectWebApps,
  getProjectPaneLayout,
  getSelectedWebApp,
  getProjectWidgetLayout,
  getWidgetGridColumnCount,
  createWidgetPaneActions,
  createWidgetPaneSurface,
  createWidgetPaneTabs,
  isWebAppTabMenuOpen,
  closeWebAppTabMenu,
  openWebAppTabMenuFromButton,
  openWebAppHomeMenu,
  openWebAppRefreshMenu,
  createTerminalSurface,
  invokeWebApp,
  isPasswordManagerEnabled,
  isWebAppAutofillEnabled,
  syncWebAppAutofillButton,
  toggleWebAppAutofill,
  getCurrentWebAppUrl,
  setCurrentWebAppUrl: (key, url) => {
    currentWebAppUrlsByKey.set(key, url);
  },
  normalizeAddressInput,
  isGlobalWorkspace,
  getProjectPluginConfig,
  getGlobalPluginConfig,
  getAllProjectPluginConfig: (project) => (isGlobalWorkspace(project) ? {} : state.pluginConfig?.projects?.[project.id] || {}),
  openProjectWebApp,
  setVisibleWebAppHost: (paneId, entry) => {
    visibleWebAppHosts.set(paneId, entry);
  },
  queueWebAppSync,
  renderWorkspaceDashboard,
  persistPaneLayout
});

function createPaneLayout(project, node) {
  return paneLayoutView.createPaneLayout(project, node);
}

function persistPaneLayout(project) {
  paneLayoutState.persistPaneLayout(project);
}

function hydratePaneLayouts() {
  paneLayoutState.hydratePaneLayouts(state.paneLayouts || {});
}

function hydrateWidgetLayouts() {
  widgetSurfaces.hydrateWidgetLayouts();
}

function hydrateTerminalTabOrders() {
  terminalSurfaces.hydrateTerminalTabOrders();
}

const workspaceDashboardViews = createWorkspaceDashboardViews({
  closeProjectGroupMenu,
  closeTerminalTabMenu,
  closeWebAppTabMenu,
  closeWidgetAddMenu,
  createPaneLayout,
  dashboardGrid,
  detachProjectTerminal,
  getGlobalWorkspace,
  getPaneLayout: getProjectPaneLayout,
  getProjectSummaryTarget,
  getViewState: () => ({ currentProjectId, currentView }),
  resetVisibleWebAppHosts: () => {
    visibleWebAppHosts = new Map();
  },
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
});

function renderGlobalDashboard() {
  workspaceDashboardViews.renderGlobalDashboard();
}

function renderGlobalPaneArea() {
  workspaceDashboardViews.renderGlobalPaneArea();
}

const manualViews = createManualViews({
  closeWidgetAddMenu,
  dashboardGrid,
  getManual,
  hideWebApps: () => invokeWebApp("hideWebApp"),
  openOnboardingTour,
  resetVisibleWebAppHosts: () => {
    visibleWebAppHosts = new Map();
  },
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
});

function renderManualPage() {
  manualViews.renderManualPage();
}

function renderGlobalSettingsPage() {
  closeWidgetAddMenu();
  closeTerminalTabMenu();
  visibleWebAppHosts = new Map();
  invokeWebApp("hideWebApp");
  workspace.classList.remove("project-mode");
  workspaceKicker.textContent = "Global";
  workspaceTitle.textContent = "Global settings";
  workspaceSummary.textContent = "";
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-form-layout global-settings-layout";
  dashboardGrid.style.gridTemplateColumns = "";

  dashboardGrid.append(createGlobalUpdateCard(), createGlobalProjectsSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalUrlsSettingsForm({
    onSubmit: async (urls) => {
      state = await boatyardWindow.boatyard.updateGlobalUrls(urls);
      hydratePaneLayouts();
      hydrateWidgetLayouts();
      renderGlobalSettingsPage();
    }
  }), createGlobalPresentationSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalTerminalSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalPasswordManagerSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalWebAppOpenRulesSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalPluginsSettingsView(), createGlobalWidgetsSettingsView());

  boatyardWindow.BoatyardPluginRegistry?.emit("boatyard.globalSettings.opened", {
    forPlugin: (pluginId) => ({
      globalConfig: getGlobalPluginConfig(pluginId)
    })
  });
}

function renderProjectDashboard(project) {
  workspaceDashboardViews.renderProjectDashboard(project);
}

function renderProjectPaneArea(project) {
  workspaceDashboardViews.renderProjectPaneArea(project);
}

const webAppMenus = createWebAppMenus({
  webAppOpenSplitRatio: WEBAPP_OPEN_SPLIT_RATIO,
  getCurrentWebAppUrl,
  getSettings,
  getProjectById,
  getProjectWidgetPanes,
  getVisibleWebAppEntryByKey,
  getVisibleWebAppEntryByUrl,
  getVisibleWebAppProject,
  getProjectPaneLayout,
  getWebAppHostBounds,
  findPaneNode,
  createSplitNode,
  replacePaneNode,
  setPaneLayout: paneLayoutState.setPaneLayout,
  setSelectedWebAppForPane: paneLayoutState.setSelectedWebAppForPane,
  getSelectedWebAppForPane: paneLayoutState.getSelectedWebAppForPane,
  setSelectedWebAppForProject: paneLayoutState.setSelectedWebAppForProject,
  getSelectedWebAppForProject: paneLayoutState.getSelectedWebAppForProject,
  setCurrentWebAppUrl: (key, url) => {
    currentWebAppUrlsByKey.set(key, url);
  },
  persistPaneLayout,
  renderWorkspaceDashboard,
  updateWebAppHomeTab: async (projectId, tab) => {
    state = await boatyardWindow.boatyard.updateWebAppHomeTab(projectId, tab);
    return state;
  },
  updateSettings: async (values) => {
    state = await boatyardWindow.boatyard.updateSettings(values);
    return state;
  },
  updateProject: async (projectId, values) => {
    state = await boatyardWindow.boatyard.updateProject(projectId, values);
    return state;
  },
  invokeWebApp,
  openExternal: (url) => boatyardWindow.boatyard.openExternal(url),
  showOverlayDialog,
  normalizePayloadBounds,
  freezeWebAppsForOverlay,
  restoreWebAppsAfterOverlay,
  closeTerminalTabMenu,
  clamp,
  isGlobalWorkspace,
  isWebAppLoaded: (key) => loadedWebAppKeys.has(key)
});

function applyWebAppOpenChoice(payload, choice) {
  return webAppMenus.applyWebAppOpenChoice(payload, choice);
}

function closeWebAppTabMenu() {
  webAppMenus.closeWebAppTabMenu();
}

function createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, options = {}) {
  return webAppMenus.createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, options);
}

function normalizeAddressInput(rawUrl) {
  return webAppMenus.normalizeAddressInput(rawUrl);
}

function openWebAppHomeMenu(event, project, paneNode, selectedWebApp) {
  return webAppMenus.openWebAppHomeMenu(event, project, paneNode, selectedWebApp);
}

function openWebAppOpenUrlDialog(payload = {}) {
  return webAppMenus.openWebAppOpenUrlDialog(payload);
}

function openWebAppRefreshMenu(event, selectedWebApp) {
  return webAppMenus.openWebAppRefreshMenu(event, selectedWebApp);
}

function openWebAppTabMenuFromButton(button, project, paneNode, selectedWebApp, webApps) {
  return webAppMenus.openWebAppTabMenuFromButton(button, project, paneNode, selectedWebApp, webApps);
}

function isWebAppTabMenuOpen() {
  return webAppMenus.isWebAppTabMenuOpen();
}

const updateViews = createUpdateViews({
  boatyard: boatyardWindow.boatyard,
  createToolIcon,
  showOverlayDialog,
  sidebarUpdateNotice,
  updatePollIntervalMs: UPDATE_POLL_INTERVAL_MS
});

function renderSidebarUpdateNotice() {
  updateViews.renderSidebarUpdateNotice();
}

function createGlobalUpdateCard() {
  return updateViews.createGlobalUpdateCard();
}

function openChangelogDialog(changelog, options = {}) {
  return updateViews.openChangelogDialog(changelog, options);
}

function maybeOpenPendingChangelog() {
  return updateViews.maybeOpenPendingChangelog();
}

function loadPreparedUpdateNotice() {
  return updateViews.loadPreparedUpdateNotice();
}

function startUpdatePolling() {
  updateViews.startUpdatePolling();
}

function resetActiveUpdateCardUpdater() {
  updateViews.resetActiveUpdateCardUpdater();
}

const onboardingTour = createOnboardingTour({
  elements: {
    addProjectButton,
    projectList
  },
  onboardingVersion: ONBOARDING_VERSION,
  getManual,
  getViewState: () => ({ currentView }),
  selectGlobalForTour: () => {
    setCurrentView("global", null, { persist: false });
    render();
  },
  getGlobalWorkspace,
  getProjectWebApps,
  getProjectPaneLayout,
  getSelectedWebApp,
  findPaneNode,
  findFirstPaneNode,
  collectPaneNodes,
  countPaneNodes,
  createSplitNode,
  replacePaneNode,
  setPaneLayout: paneLayoutState.setPaneLayout,
  getPaneLayout: paneLayoutState.getPaneLayout,
  setSelectedWebAppForPane: paneLayoutState.setSelectedWebAppForPane,
  getSelectedWebAppForPane: paneLayoutState.getSelectedWebAppForPane,
  setSelectedWebAppForProject: paneLayoutState.setSelectedWebAppForProject,
  getSelectedWebAppForProject: paneLayoutState.getSelectedWebAppForProject,
  deleteSelectedWebAppForPane: paneLayoutState.deleteSelectedWebAppForPane,
  deleteSelectedWebAppForProject: paneLayoutState.deleteSelectedWebAppForProject,
  getVisibleWebAppEntries: () => visibleWebAppHosts.values(),
  renderWorkspaceDashboard,
  closeWebAppTabMenu,
  openWebAppTabMenuFromButton,
  waitForWebAppLoad,
  syncWebAppView,
  freezeWebAppsForOverlay,
  restoreWebAppsAfterOverlay,
  nextAnimationFrame,
  updateOnboarding: async (values) => {
    state.onboarding = await boatyardWindow.boatyard.updateOnboarding(values);
    return state.onboarding;
  },
  updatePaneLayout: (projectId, layout) => boatyardWindow.boatyard.updatePaneLayout(projectId, layout)
});

function ensureOnboardingDemoProject() {
  return onboardingTour.ensureOnboardingDemoProject();
}

function isOnboardingDemoProjectVisible() {
  return onboardingTour.isDemoProjectVisible();
}

function isOnboardingTourActive() {
  return onboardingTour.isTourActive();
}

function openOnboardingTour(options = {}) {
  return onboardingTour.openOnboardingTour(options);
}

const projectSidebar = createProjectSidebar({
  elements: {
    addProjectButton,
    globalNav,
    globalNavRow,
    globalViewButton,
    projectCount,
    projectList,
    projectSearchInput
  },
  getViewState: () => ({ currentView, currentProjectId }),
  getProjects,
  getProjectGroups,
  getProjectGroupsByName,
  getCollapsedProjectGroups,
  normalizeProjectSearchText,
  projectMatchesSearch,
  renderSidebarUpdateNotice,
  renderProjectNavBadges,
  selectProject,
  selectEditProject,
  clamp,
  applyFormControl,
  applyFormControls,
  showOverlayDialog,
  isOnboardingDemoProjectVisible,
  ensureOnboardingDemoProject,
  updateNavigation: async (values) => {
    const navigation = await boatyardWindow.boatyard.updateNavigation(values);
    state = {
      ...state,
      navigation
    };
    return navigation;
  },
  updateProject: async (projectId, values) => {
    state = await boatyardWindow.boatyard.updateProject(projectId, values);
    return state;
  },
  reorderProjectIds: async (projectIds) => {
    state = await boatyardWindow.boatyard.reorderProjects(projectIds);
    return state;
  },
  renderApp: render
});

function closeProjectGroupMenu() {
  projectSidebar.closeProjectGroupMenu();
}

function renderProjectList() {
  projectSidebar.renderProjectList();
}

const projectSettingsViews = createProjectSettingsViews({
  boatyard: boatyardWindow.boatyard,
  getState: () => state,
  getSettings,
  getProjectGroups,
  getProjectWidgetPanes,
  getProjectPluginConfig,
  getGlobalPluginConfig,
  getPluginProjectSettingsSections,
  applyFormControl,
  applyFormControls,
  readPluginSettingsFieldValue,
  deriveRepoUrl,
  deriveProjectNameFromPath,
  formatProjectNameFromPath,
  slugify
});

const globalSettingsViews = createGlobalSettingsViews({
  boatyard: boatyardWindow.boatyard,
  applyFormControl,
  applyFormControls,
  getInstalledWidgets,
  getPluginGlobalSettingsSections,
  getGlobalPluginConfig,
  readPluginSettingsFieldValue,
  showOverlayDialog,
  renderGlobalSettingsPage,
  updatePluginEnabled: async (pluginId, enabled) => {
    state = await boatyardWindow.boatyard.updatePluginEnabled(pluginId, enabled);
    boatyardWindow.BoatyardPluginRegistry.setEnabled(pluginId, enabled);
  },
  updateGlobalPluginConfig: async (pluginId, values) => {
    state = await boatyardWindow.boatyard.updateGlobalPluginConfig(pluginId, values);
  }
});

function createGlobalProjectsSettingsForm(options) {
  return globalSettingsViews.createGlobalProjectsSettingsForm(options);
}

function createGlobalPresentationSettingsForm(options) {
  return globalSettingsViews.createGlobalPresentationSettingsForm(options);
}

function createGlobalTerminalSettingsForm(options) {
  return globalSettingsViews.createGlobalTerminalSettingsForm(options);
}

function createGlobalPasswordManagerSettingsForm(options) {
  return globalSettingsViews.createGlobalPasswordManagerSettingsForm(options);
}

function createGlobalWebAppOpenRulesSettingsForm(options) {
  return globalSettingsViews.createGlobalWebAppOpenRulesSettingsForm(options);
}

function createGlobalPluginsSettingsView() {
  return globalSettingsViews.createGlobalPluginsSettingsView();
}

function createGlobalWidgetsSettingsView() {
  return globalSettingsViews.createGlobalWidgetsSettingsView();
}

function createGlobalUrlsSettingsForm(options) {
  return projectSettingsViews.createGlobalUrlsSettingsForm(options);
}

function createProjectDangerZone(options) {
  return projectSettingsViews.createProjectDangerZone(options);
}

function createProjectFormView(options) {
  return projectSettingsViews.createProjectFormView(options);
}

function createProjectTerminalSettingsForm(options) {
  return projectSettingsViews.createProjectTerminalSettingsForm(options);
}

function createProjectUrlsForm(options) {
  return projectSettingsViews.createProjectUrlsForm(options);
}

function createProjectWebAppHomeTabsForm(options) {
  return projectSettingsViews.createProjectWebAppHomeTabsForm(options);
}

function createProjectWidgetPanesForm(options) {
  return projectSettingsViews.createProjectWidgetPanesForm(options);
}

const projectPageViews = createProjectPageViews({
  addProject: (values) => boatyardWindow.boatyard.addProject(values),
  createProjectDangerZone,
  createProjectFormView,
  createProjectTerminalSettingsForm,
  createProjectUrlsForm,
  createProjectWebAppHomeTabsForm,
  createProjectWidgetPanesForm,
  dashboardGrid,
  hideWebApps: () => invokeWebApp("hideWebApp"),
  persistProjectPluginConfig,
  reloadProjectSettings,
  removeProject: (projectId) => boatyardWindow.boatyard.removeProject(projectId),
  resetVisibleWebAppHosts: () => {
    visibleWebAppHosts = new Map();
  },
  restoreReturnView,
  selectGlobal,
  selectProject,
  setState: (nextState) => {
    state = nextState;
  },
  updateProject: (projectId, values) => boatyardWindow.boatyard.updateProject(projectId, values),
  updateWebAppHomeTabs: (projectId, tabs) => boatyardWindow.boatyard.updateWebAppHomeTabs(projectId, tabs),
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
});

function renderCreateProjectPage() {
  projectPageViews.renderCreateProjectPage();
}

function renderEditProjectPage(project) {
  projectPageViews.renderEditProjectPage(project);
}

const webAppSurfaces = createWebAppSurfaces({
  boatyard: boatyardWindow.boatyard,
  getSettings,
  getVisibleWebAppEntries: () => visibleWebAppHosts.values(),
  invokeWebApp,
  isWebAppAutofillEnabled,
  markWebAppLoaded: (key) => {
    loadedWebAppKeys.add(key);
  }
});

function getWebAppHostBounds(host) {
  return webAppSurfaces.getWebAppHostBounds(host);
}

function normalizePayloadBounds(bounds) {
  return webAppSurfaces.normalizePayloadBounds(bounds);
}

function syncWebAppView() {
  return webAppSurfaces.syncWebAppView();
}

function queueWebAppSync() {
  webAppSurfaces.queueWebAppSync();
}

function freezeWebAppsForOverlay(options = undefined) {
  return webAppSurfaces.freezeWebAppsForOverlay(options);
}

function restoreWebAppsAfterOverlay() {
  return webAppSurfaces.restoreWebAppsAfterOverlay();
}

function showOverlayDialog(dialog, options = {}) {
  return webAppSurfaces.showOverlayDialog(dialog, options);
}

boatyardWindow.BoatyardOverlayDialog = Object.freeze({
  show: showOverlayDialog
});

function maybeOpenInitialOnboarding() {
  if ((state.onboarding?.completedVersion || 0) >= ONBOARDING_VERSION) {
    return;
  }

  requestAnimationFrame(() => openOnboardingTour());
}

function selectGlobal() {
  setCurrentView("global");
  render();
}

function selectGlobalSettings() {
  setCurrentView("global-settings");
  render();
}

function selectCreateProject() {
  if (currentView !== "project-create") {
    returnView = {
      view: currentView,
      projectId: currentProjectId
    };
  }
  setCurrentView("project-create", null, { persist: false });
  render();
}

function selectProject(id) {
  setCurrentView("project", id);
  render();
}

function selectEditProject(id) {
  setCurrentView("project-edit", id);
  render();
}

function reloadProjectSettings(id) {
  setCurrentView("project-edit", id);
  render();
}

function restoreReturnView() {
  if (returnView.view === "project" && getProjects().some((project) => project.id === returnView.projectId)) {
    selectProject(returnView.projectId);
    return;
  }

  selectGlobal();
}

function render() {
  resetActiveUpdateCardUpdater();
  renderProjectList();

  const project = getCurrentProject();
  detachInactiveProjectTerminals(currentView === "project" && project ? project.id : null);

  if (currentView === "project-create") {
    renderCreateProjectPage();
  } else if (currentView === "global-settings") {
    renderGlobalSettingsPage();
  } else if (currentView === "project-edit" && project) {
    renderEditProjectPage(project);
  } else if (currentView === "project" && project) {
    renderProjectDashboard(project);
  } else {
    renderGlobalDashboard();
  }
}

async function loadState() {
  state = await boatyardWindow.boatyard.getState();
  boatyardWindow.BoatyardPluginRegistry?.applyEnabledState(getPluginEnabledState());
  currentWebAppUrlsByKey.clear();
  for (const [key, webApp] of Object.entries(state.webApps || {})) {
    if (webApp.url) {
      currentWebAppUrlsByKey.set(key, webApp.url);
    }
  }
  hydratePaneLayouts();
  hydrateWidgetLayouts();
  hydrateTerminalTabOrders();
  restoreNavigation();
  render();
  void loadPreparedUpdateNotice();
  startUpdatePolling();
  if (!(await maybeOpenPendingChangelog())) {
    maybeOpenInitialOnboarding();
  }
}

boatyardWindow.boatyard.onWebAppUrlChanged(({ key, url }) => {
  if (!key || !url) {
    return;
  }

  currentWebAppUrlsByKey.set(key, url);
  persistVisibleWebAppPaneLayout(key, url);
  for (const input of document.querySelectorAll<HTMLInputElement>(".webapp-url")) {
    if (input.dataset.webappKey === key && input !== document.activeElement) {
      input.value = url;
    }
  }
});

boatyardWindow.boatyard.onWebAppLoaded?.((payload) => {
  const { key, url } = payload || {};
  if (!key || !url) {
    return;
  }

  loadedWebAppKeys.add(key);
  loadedWebAppUrlsByKey.set(key, url);
  for (const waiter of [...webAppLoadWaiters]) {
    waiter(payload);
  }
});

boatyardWindow.boatyard.onWebAppAutofillChanged?.(({ key, enabled }) => {
  if (!key) {
    return;
  }

  webAppAutofillEnabledByKey.set(key, enabled === true);
  for (const button of document.querySelectorAll<HTMLButtonElement>(".webapp-tool-button.autofill")) {
    if (button.dataset.webappKey === key) {
      syncWebAppAutofillButton(button, enabled === true);
    }
  }
});

boatyardWindow.boatyard.onWebAppOpenUrlRequested?.((payload) => {
  if (payload?.target) {
    applyWebAppOpenChoice(payload, {
      target: payload.target,
      persist: false,
      scope: "exact",
      label: ""
    }).catch((error) => {
      console.error("Could not apply webapp URL opening rule:", error);
    });
    return;
  }

  openWebAppOpenUrlDialog(payload);
});

boatyardWindow.boatyard.onTerminalData((payload) => {
  terminalSurfaces.handleTerminalData(payload);
});

boatyardWindow.boatyard.onTerminalExit((payload) => {
  terminalSurfaces.handleTerminalExit(payload);
});

window.addEventListener("boatyard:plugin-status-changed", () => {
  if (currentView === "global-settings") {
    renderGlobalSettingsPage();
  }
});

window.addEventListener("boatyard:project-nav-badges-changed", renderProjectList);

window.addEventListener("boatyard:pier-workloads-changed", () => {
  if (currentView !== "project" || pierWorkloadPaneRefreshFrame) {
    return;
  }

  pierWorkloadPaneRefreshFrame = requestAnimationFrame(() => {
    pierWorkloadPaneRefreshFrame = null;
    renderWorkspacePaneArea(getCurrentProject());
  });
});

globalNav.addEventListener("click", selectGlobal);
globalSettingsButton.addEventListener("click", selectGlobalSettings);
globalViewButton.addEventListener("click", selectGlobal);
manualTourButton.addEventListener("click", () => openOnboardingTour({ force: true }));
addProjectButton.addEventListener("click", selectCreateProject);
window.addEventListener("resize", queueWebAppSync);
workspace.addEventListener("scroll", queueWebAppSync);

const pluginLoader = createPluginLoader(window);
pluginLoader.ready
  .catch((error) => {
    console.error("Could not load plugins:", error);
  })
  .finally(loadState);
