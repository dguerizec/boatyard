import { createGlobalSettingsPageView } from "./globalSettingsPageView.js";
import { createHawserWidget } from "./hawserWidget.js";
import { createManualViews } from "./manualViews.js";
import { createOnboardingTour } from "./onboardingTour.js";
import { createPaneLayoutState } from "./paneLayoutState.js";
import { createPaneLayoutView } from "./paneLayoutView.js";
import { registerPluginRegistry } from "./pluginRegistry.js";
import { registerPluginSettingsFields } from "./pluginSettingsFields.js";
import { createProjectPageViews } from "./projectPageViews.js";
import { createProjectSidebar } from "./projectSidebar.js";
import { createProjectWebApps } from "./projectWebApps.js";
import {
  applyFormControl,
  applyFormControls,
  createCard,
  nextAnimationFrame
} from "./rendererDomHelpers.js";
import {
  deriveProjectNameFromPath,
  deriveRepoUrl,
  formatProjectNameFromPath,
  normalizeProjectSearchText,
  projectMatchesSearch,
  slugify
} from "./projectUtils.js";
import type { UnknownRecord } from "./rendererRecords.js";
import { registerRendererEventBindings } from "./rendererEventBindings.js";
import { createRendererPluginHelpers } from "./rendererPluginHelpers.js";
import { createRendererSettingsViewBridge } from "./rendererSettingsViewBridge.js";
import { createRendererStateSelectors } from "./rendererStateSelectors.js";
import type {
  GlobalSettingsViewsInstance,
  PaneLayoutStateInstance,
  PaneLayoutViewInstance,
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
import { createWebAppLoadTracker } from "./webAppLoadTracker.js";
import { createWebAppSurfaces } from "./webAppSurfaces.js";
import { createVisibleWebAppTracker } from "./visibleWebAppTracker.js";
import { registerWidgetRegistry } from "./widgetRegistry.js";
import { createWorkspaceDashboardViews } from "./workspaceDashboardViews.js";
import { createRendererWidgetBridge } from "./rendererWidgetBridge.js";

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
const currentWebAppUrlsByKey = new Map<string, string>();
const webAppAutofillEnabledByKey = new Map<string, boolean>();
const UPDATE_POLL_INTERVAL_MS = 10 * 60 * 1000;
const webAppLoadTracker = createWebAppLoadTracker();
const visibleWebApps = createVisibleWebAppTracker({
  findPaneNode,
  getCurrentWebAppUrl,
  getPaneLayout: getProjectPaneLayout,
  getVisibleWebAppProject,
  isOnboardingTourActive,
  persistPaneLayout
});

const {
  getCollapsedProjectGroups,
  getCurrentProject,
  getGlobalPluginConfig,
  getGlobalWorkspace,
  getManual,
  getPluginEnabledState,
  getProjectById,
  getProjectGroups,
  getProjectGroupsByName,
  getProjectPluginConfig,
  getProjects,
  getProjectSummaryTarget,
  getSettings,
  isGlobalWorkspace
} = createRendererStateSelectors({
  defaultWidgetPaneId: DEFAULT_WIDGET_PANE_ID,
  getCurrentProjectId: () => currentProjectId,
  getManualSource: () => boatyardWindow.BoatyardManual,
  getState: () => state,
  globalWorkspaceId: GLOBAL_WORKSPACE_ID
});

const {
  getPluginGlobalSettingsSections,
  getPluginPaneDefinitions,
  getPluginProjectSettingsSections,
  persistProjectPluginConfig,
  readPluginSettingsFieldValue,
  renderProjectNavBadges
} = createRendererPluginHelpers({
  boatyard: boatyardWindow.boatyard,
  getCurrentView: () => currentView,
  getGlobalPluginConfig,
  getProjectPluginConfig,
  getState: () => state,
  normalizeUrl: normalizeAddressInput,
  windowObject: boatyardWindow
});

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

function waitForWebAppLoad(key, expectedUrl = "", timeoutMs = 6000) {
  return webAppLoadTracker.waitForLoad(key, expectedUrl, timeoutMs);
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const {
  applyWidgetGridLayout,
  closeWidgetAddMenu,
  createProjectWidget,
  createWidgetPaneActions,
  createWidgetPaneSurface,
  getInstalledWidgets,
  getOrderedWidgetDefinitions,
  getProjectWidgetDefinitions,
  getProjectWidgetLayout,
  getProjectWidgetPanes,
  getWidgetGridColumnCount,
  getWidgetRailColumnCount,
  hydrateWidgetLayouts
} = createRendererWidgetBridge({
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
  legacyWidgetIds: LEGACY_WIDGET_IDS,
  createTerminalWidget,
  windowObject: boatyardWindow
});

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

function getVisibleWebAppEntryByKey(key) {
  return visibleWebApps.getEntryByKey(key);
}

function getVisibleWebAppEntryByUrl(url) {
  return visibleWebApps.getEntryByUrl(url);
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
  visibleWebApps.persistPaneLayoutForWebApp(key, url);
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
    visibleWebApps.set(paneId, entry);
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
    visibleWebApps.reset();
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
    visibleWebApps.reset();
  },
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
});

function renderManualPage() {
  manualViews.renderManualPage();
}

function createGlobalProjectsSettingsForm(options) {
  return settingsViewBridge.createGlobalProjectsSettingsForm(options);
}

function createGlobalPresentationSettingsForm(options) {
  return settingsViewBridge.createGlobalPresentationSettingsForm(options);
}

function createGlobalTerminalSettingsForm(options) {
  return settingsViewBridge.createGlobalTerminalSettingsForm(options);
}

function createGlobalPasswordManagerSettingsForm(options) {
  return settingsViewBridge.createGlobalPasswordManagerSettingsForm(options);
}

function createGlobalWebAppOpenRulesSettingsForm(options) {
  return settingsViewBridge.createGlobalWebAppOpenRulesSettingsForm(options);
}

function createGlobalPluginsSettingsView() {
  return settingsViewBridge.createGlobalPluginsSettingsView();
}

function createGlobalWidgetsSettingsView() {
  return settingsViewBridge.createGlobalWidgetsSettingsView();
}

function createGlobalUrlsSettingsForm(options) {
  return settingsViewBridge.createGlobalUrlsSettingsForm(options);
}

const globalSettingsPageView = createGlobalSettingsPageView({
  closeTerminalTabMenu,
  closeWidgetAddMenu,
  createGlobalPasswordManagerSettingsForm,
  createGlobalPluginsSettingsView,
  createGlobalPresentationSettingsForm,
  createGlobalProjectsSettingsForm,
  createGlobalTerminalSettingsForm,
  createGlobalUpdateCard,
  createGlobalUrlsSettingsForm,
  createGlobalWebAppOpenRulesSettingsForm,
  createGlobalWidgetsSettingsView,
  dashboardGrid,
  emitOpened: () => {
    boatyardWindow.BoatyardPluginRegistry?.emit("boatyard.globalSettings.opened", {
      forPlugin: (pluginId) => ({
        globalConfig: getGlobalPluginConfig(pluginId)
      })
    });
  },
  getSettings,
  hideWebApps: () => invokeWebApp("hideWebApp"),
  hydratePaneLayouts,
  hydrateWidgetLayouts,
  resetVisibleWebAppHosts: () => {
    visibleWebApps.reset();
  },
  updateGlobalUrls: async (urls) => {
    state = await boatyardWindow.boatyard.updateGlobalUrls(urls as UnknownRecord[]);
    return state;
  },
  updateSettings: async (values) => {
    state = await boatyardWindow.boatyard.updateSettings(values as UnknownRecord);
    return state;
  },
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
});

function renderGlobalSettingsPage() {
  globalSettingsPageView.renderGlobalSettingsPage();
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
  isWebAppLoaded: (key) => webAppLoadTracker.hasLoadedKey(key)
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
  getVisibleWebAppEntries: () => visibleWebApps.getEntries(),
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

const settingsViewBridge = createRendererSettingsViewBridge({
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
  slugify,
  getInstalledWidgets,
  getPluginGlobalSettingsSections,
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

function createProjectDangerZone(options) {
  return settingsViewBridge.createProjectDangerZone(options);
}

function createProjectFormView(options) {
  return settingsViewBridge.createProjectFormView(options);
}

function createProjectTerminalSettingsForm(options) {
  return settingsViewBridge.createProjectTerminalSettingsForm(options);
}

function createProjectUrlsForm(options) {
  return settingsViewBridge.createProjectUrlsForm(options);
}

function createProjectWebAppHomeTabsForm(options) {
  return settingsViewBridge.createProjectWebAppHomeTabsForm(options);
}

function createProjectWidgetPanesForm(options) {
  return settingsViewBridge.createProjectWidgetPanesForm(options);
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
    visibleWebApps.reset();
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
  getVisibleWebAppEntries: () => visibleWebApps.getEntries(),
  invokeWebApp,
  isWebAppAutofillEnabled,
  markWebAppLoaded: (key) => {
    webAppLoadTracker.markLoadedKey(key);
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

registerRendererEventBindings({
  addProjectButton,
  applyWebAppOpenChoice,
  boatyard: boatyardWindow.boatyard,
  globalNav,
  globalSettingsButton,
  globalViewButton,
  getCurrentProject,
  getCurrentView: () => currentView,
  handleTerminalData: (payload) => terminalSurfaces.handleTerminalData(payload),
  handleTerminalExit: (payload) => terminalSurfaces.handleTerminalExit(payload),
  loadState,
  manualTourButton,
  markWebAppAutofillEnabled: (key, enabled) => {
    webAppAutofillEnabledByKey.set(key, enabled);
  },
  markWebAppLoaded: (payload) => {
    webAppLoadTracker.markLoaded(payload);
  },
  openOnboardingTour,
  openWebAppOpenUrlDialog,
  persistVisibleWebAppPaneLayout,
  queueWebAppSync,
  renderGlobalSettingsPage,
  renderProjectList,
  renderWorkspacePaneArea,
  selectCreateProject,
  selectGlobal,
  selectGlobalSettings,
  setCurrentWebAppUrl: (key, url) => {
    currentWebAppUrlsByKey.set(key, url);
  },
  syncWebAppAutofillButton,
  windowObject: window,
  workspace
});
