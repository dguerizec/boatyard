import { createGlobalSettingsPageView } from "./globalSettingsPageView.js";
import { hasActiveSettingsInteraction } from "./settingsFormController.js";
import { createOnboardingTour } from "./onboardingTour.js";
import { createPaneLayoutState } from "./paneLayoutState.js";
import { createPaneMcpController, PaneMcpError } from "./paneMcpController.js";
import { createPaneLayoutView } from "./paneLayoutView.js";
import { registerPluginRegistry } from "./pluginRegistry.js";
import { registerPluginSettingsFields } from "./pluginSettingsFields.js";
import { createProjectPageViews } from "./projectPageViews.js";
import { createProjectSidebar } from "./projectSidebar.js";
import { createRendererWebAppRuntime } from "./rendererWebAppRuntime.js";
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
import { createRendererNavigationController } from "./rendererNavigationController.js";
import { createRendererSettingsViewBridge } from "./rendererSettingsViewBridge.js";
import { createRendererStateSelectors } from "./rendererStateSelectors.js";
import type {
  RendererPaneLayoutNode,
  RendererPaneNode,
  RendererProject,
  RendererState,
  WebAppDefinition,
  WorkspaceLayout,
} from "./rendererTypes.js";
import { createTerminalSurfaces } from "./terminalSurfaces.js";
import { createToolIcon } from "./toolIcons.js";
import { createThemeToggle } from "./themeController.js";
import { createUpdateViews } from "./updateViews.js";
import { createWebAppMenus } from "./webAppMenus.js";
import { createWebAppLoadTracker } from "./webAppLoadTracker.js";
import { createTopbarWidgets } from "./topbarWidgets.js";
import { createWebAppSurfaces } from "./webAppSurfaces.js";
import { createVisibleWebAppTracker } from "./visibleWebAppTracker.js";
import { registerWidgetRegistry } from "./widgetRegistry.js";
import { createWorkspaceDashboardViews } from "./workspaceDashboardViews.js";
import {
  captureWorkspaceLayoutPane,
  instantiateWorkspaceLayout,
  resolveWorkspaceLayoutAspectRatio
} from "./workspaceLayouts.js";
import { createWorkspaceLayoutPicker } from "./workspaceLayoutPicker.js";
import { createRendererWidgetBridge } from "./rendererWidgetBridge.js";
import { rendererDomElements } from "./rendererDomElements.js";
import { DEFAULT_WIDGET_PANE_ID, GLOBAL_WORKSPACE_ID, LEGACY_WIDGET_IDS, MIN_WIDGET_RAIL_WIDTH, UPDATE_POLL_INTERVAL_MS, WEBAPP_OPEN_SPLIT_RATIO, WEBAPP_SPLIT_RESIZER_SIZE, WIDGET_GRID_GAP, WIDGET_GRID_MAX_COLUMN_WIDTH, WIDGET_GRID_MIN_COLUMN_WIDTH, WIDGET_GRID_ROW_HEIGHT, WIDGET_GRID_SCROLL_GUARD } from "./rendererConstants.js";
import { createRendererGlobalSettingsAdapters } from "./rendererGlobalSettingsAdapters.js";

const boatyardWindow = window;
registerWidgetRegistry(window);
registerPluginRegistry(window);
registerPluginSettingsFields(window);

const {
  addProjectButton, appShell, dashboardGrid, globalNav, globalNavRow, globalSettingsButton, manualTourButton, pinnedProjects,
  projectCount, projectList, projectSearchInput, sidebarRail, sidebarToggleButton, sidebarUpdateNotice, splitScreenButton, themeToggleButton, workspace, workspaceKicker, workspaceLayoutsButton, workspaceSummary, workspaceTitle
} = rendererDomElements;

const ONBOARDING_VERSION = boatyardWindow.BoatyardManual?.version || 1;

let state: RendererState = { projects: [] };
const webAppLoadTracker = createWebAppLoadTracker();
let navigationController: ReturnType<typeof createRendererNavigationController>;
let webAppRuntime: ReturnType<typeof createRendererWebAppRuntime>;

const {
  getCollapsedProjectGroups,
  getCurrentProject,
  getGlobalPluginConfig,
  getGlobalWorkspace,
  getManual,
  getPinnedProjectIds,
  getPluginEnabledState,
  getProjectById,
  getProjectGroups,
  getProjectGroupsByName,
  getProjectPluginConfig,
  getProjects,
  getProjectSummaryTarget,
  getSettings,
  isSidebarCollapsed,
  isGlobalWorkspace
} = createRendererStateSelectors({
  defaultWidgetPaneId: DEFAULT_WIDGET_PANE_ID,
  getCurrentProjectId: () => navigationController.getCurrentProjectId(),
  getManualSource: () => boatyardWindow.BoatyardManual,
  getState: () => state,
  globalWorkspaceId: GLOBAL_WORKSPACE_ID
});

navigationController = createRendererNavigationController({
  closeProjectGroupMenu,
  closeTerminalTabMenu,
  getCollapsedProjectGroups,
  getPinnedProjectIds,
  hasProject: (projectId) => Boolean(projectId && getProjects().some((project) => project.id === projectId)),
  isSidebarCollapsed,
  render,
  updateNavigation: async (values: UnknownRecord) => {
    const navigation = await boatyardWindow.boatyard.updateNavigation(values);
    state = {
      ...state,
      navigation
    };
    return navigation;
  }
});

const {
  restoreNavigation,
  restoreReturnView,
  selectCreateProject,
  selectEditProject,
  selectGlobal,
  selectGlobalSettings,
  selectProject,
  setCurrentView
} = navigationController;

const {
  getPluginGlobalSettingsSections,
  getPluginPaneDefinitions,
  getPluginProjectSettingsSections,
  persistProjectPluginConfig,
  readPluginSettingsFieldValue,
  renderProjectNavBadges
} = createRendererPluginHelpers({
  boatyard: boatyardWindow.boatyard,
  getCurrentView: () => navigationController.getCurrentView(),
  getGlobalPluginConfig,
  getProjectPluginConfig,
  getState: () => state,
  normalizeUrl: normalizeAddressInput,
  windowObject: boatyardWindow
});

function waitForWebAppLoad(key: string, expectedUrl = "", timeoutMs = 6000) {
  return webAppLoadTracker.waitForLoad(key, expectedUrl, timeoutMs);
}

const paneLayoutState = createPaneLayoutState({
  updatePaneLayout: (projectId: string | null | undefined, layout: unknown) => (
    boatyardWindow.boatyard.updatePaneLayout(projectId, layout)
  )
});
const {
  collectPaneNodes,
  countPaneNodes,
  createSplitNode,
  findFirstPaneNode,
  findPaneNode,
  findPaneNodeBySelectedWebApp,
  replacePaneNode
} = paneLayoutState;
const visibleWebApps = createVisibleWebAppTracker({
  findPaneNode: (layout, paneId) => paneId ? findPaneNode(layout, paneId) : null,
  getCurrentWebAppUrl,
  getPaneLayout: getProjectPaneLayout,
  getVisibleWebAppProject: () => webAppRuntime.getVisibleWebAppProject() || null,
  isOnboardingTourActive,
  persistPaneLayout
});

const terminalSurfaces = createTerminalSurfaces({
  boatyard: boatyardWindow.boatyard as Parameters<typeof createTerminalSurfaces>[0]["boatyard"],
  getProjectById,
  getState: () => state,
  createToolIcon,
  clamp,
  defaultWidgetPaneId: DEFAULT_WIDGET_PANE_ID
});

createThemeToggle({
  button: themeToggleButton,
  createIcon: createToolIcon,
  onThemeChange: (theme) => {
    terminalSurfaces.setTheme(theme);
    return boatyardWindow.boatyard.setTheme?.(theme);
  }
});

function closeTerminalTabMenu() {
  terminalSurfaces.closeTerminalTabMenu();
}

function detachProjectTerminal(projectId?: string) {
  if (projectId) {
    terminalSurfaces.detachProjectTerminal(projectId);
  }
}

function detachInactiveProjectTerminals(activeProjectId: string | null = null) {
  terminalSurfaces.detachInactiveProjectTerminals(activeProjectId);
}

function createTerminalSurface(project: RendererProject, options: UnknownRecord = {}) {
  return terminalSurfaces.createTerminalSurface(project, options);
}

function createTerminalWidget(project: RendererProject, props: UnknownRecord = {}) {
  return terminalSurfaces.createTerminalWidget(project, props);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const {
  closeWidgetAddMenu,
  createWidgetPaneActions,
  createWidgetPaneSurface,
  getInstalledWidgets,
  getProjectWidgetLayout,
  getProjectWidgetPanes,
  getWidgetGridColumnCount,
  hydrateWidgetLayouts
} = createRendererWidgetBridge({
  boatyard: boatyardWindow.boatyard,
  createOverlayFreezeScope: () => webAppSurfaces.createFreezeScope(),
  getState: () => state,
  getProjectPluginConfig,
  getGlobalPluginConfig,
  isGlobalWorkspace,
  openUrl: (payload: UnknownRecord) => openWebAppOpenUrlDialog(payload),
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

function renderWorkspaceDashboard(project: RendererProject) {
  if (isGlobalWorkspace(project)) {
    renderGlobalDashboard();
  } else {
    renderProjectDashboard(project);
  }
}

function renderWorkspacePaneArea(project: RendererProject) {
  if (isGlobalWorkspace(project)) {
    renderGlobalPaneArea();
  } else {
    renderProjectPaneArea(project);
  }
}

webAppRuntime = createRendererWebAppRuntime({
  boatyard: boatyardWindow.boatyard,
  findFirstPaneNode,
  findPaneNode: (node, paneId) => paneId ? findPaneNode(node, paneId) : null,
  findPaneNodeBySelectedWebApp: (node, webAppId) => webAppId ? findPaneNodeBySelectedWebApp(node, webAppId) : null,
  getCurrentProject: () => getCurrentProject() || getGlobalWorkspace() || ({
    id: GLOBAL_WORKSPACE_ID,
    isGlobalWorkspace: true,
    name: "Global",
    slug: "global"
  } as RendererProject),
  getCurrentView: () => navigationController.getCurrentView(),
  getGlobalPluginConfig,
  getGlobalWorkspace,
  getPaneLayout: getProjectPaneLayout,
  getPluginPaneDefinitions,
  getProjectPluginConfig,
  getProjectWidgetPanes,
  getProjects,
  getSettings,
  isGlobalWorkspace,
  paneLayoutState,
  persistPaneLayout,
  renderWorkspacePaneArea
});

function getProjectWebApps(project: RendererProject, paneId?: string) {
  return webAppRuntime.getProjectWebApps(project, paneId || "");
}

function getProjectPaneLayout(project: RendererProject) {
  return paneLayoutState.getProjectPaneLayout(project as Parameters<typeof paneLayoutState.getProjectPaneLayout>[0]);
}

function getSelectedWebApp(project: RendererProject, paneId: string, webApps: unknown[]) {
  return paneLayoutState.getSelectedWebApp(
    project as Parameters<typeof paneLayoutState.getSelectedWebApp>[0],
    paneId,
    webApps as Parameters<typeof paneLayoutState.getSelectedWebApp>[2]
  );
}

function getPaneMasterType(project: RendererProject, pane: RendererPaneNode) {
  const selectedWebAppId = paneLayoutState.getSelectedWebAppForPane(pane.id) || pane.selectedWebAppId;
  const webApp = getProjectWebApps(project, pane.id).find((candidate) => candidate.id === selectedWebAppId);
  return typeof webApp?.paneTypeId === "string" ? webApp.paneTypeId : null;
}

function isPaneMasterTypeAvailable(project: RendererProject, paneTypeId: string) {
  return getProjectWebApps(project, "layout-preview").some((webApp) => webApp.paneTypeId === paneTypeId);
}

function getPaneMasterTypeLabel(project: RendererProject, paneTypeId: string) {
  const webApp = getProjectWebApps(project, "layout-preview").find((candidate) => candidate.paneTypeId === paneTypeId);
  return typeof webApp?.label === "string" && webApp.label.trim() ? webApp.label : paneTypeId;
}

function resolvePaneMasterType(project: RendererProject, paneTypeId: string, paneId: string) {
  const webApps = getProjectWebApps(project, paneId);
  const exact = webApps.find((webApp) => webApp.id === paneTypeId && webApp.paneTypeId === paneTypeId);
  const providerDefault = webApps.find((webApp) => (
    webApp.paneTypeId === paneTypeId && webApp.showInMenu !== false && !webApp.transient && !webApp.homeTab
  ));
  const providerFallback = webApps.find((webApp) => webApp.paneTypeId === paneTypeId);
  return exact?.id || providerDefault?.id || providerFallback?.id || null;
}

async function captureCurrentWorkspaceLayout(
  project: RendererProject,
  name: string,
  id: string = crypto.randomUUID(),
  projectId: string | null = null
): Promise<WorkspaceLayout> {
  return {
    id,
    name,
    paneLayout: captureWorkspaceLayoutPane(
      getProjectPaneLayout(project),
      (pane) => getPaneMasterType(project, pane)
    ),
    projectId
  };
}

let workspaceLayoutToast: HTMLElement | null = null;
let workspaceLayoutToastTimer: ReturnType<typeof setTimeout> | null = null;
function acceptWorkspaceLayoutState(nextState: RendererState, projectId: string) {
  const currentView = navigationController.getCurrentView();
  const visibleProject = currentView === "project"
    ? getCurrentProject()
    : currentView === "global" ? getGlobalWorkspace() : null;
  const shouldPreservePanes = visibleProject?.id === projectId;
  state = nextState;
  hydratePaneLayouts();
  if (shouldPreservePanes) {
    const updatedProject = currentView === "project"
      ? getCurrentProject()
      : getGlobalWorkspace();
    if (updatedProject) {
      renderPaneLayoutPreservingPanes(updatedProject);
    }
  }
}

function showWorkspaceLayoutUndo(undoToken: string, projectId: string) {
  workspaceLayoutToast?.remove();
  if (workspaceLayoutToastTimer) {
    clearTimeout(workspaceLayoutToastTimer);
  }
  const toast = document.createElement("div");
  toast.className = "workspace-layout-toast";
  const message = document.createElement("span");
  message.textContent = "Workspace layout applied.";
  const undoButton = document.createElement("button");
  undoButton.className = "secondary-button";
  undoButton.type = "button";
  undoButton.textContent = "Undo";
  undoButton.addEventListener("click", async () => {
    undoButton.disabled = true;
    const restored = await boatyardWindow.boatyard.undoLayout(undoToken);
    if (restored) {
      acceptWorkspaceLayoutState(restored, projectId);
    }
    toast.remove();
  });
  toast.append(message, undoButton);
  document.body.append(toast);
  workspaceLayoutToast = toast;
  workspaceLayoutToastTimer = setTimeout(() => {
    toast.remove();
    if (workspaceLayoutToast === toast) {
      workspaceLayoutToast = null;
    }
  }, 12000);
}

async function applyWorkspaceLayout(project: RendererProject, layout: WorkspaceLayout) {
  const projectId = String(project.id || "");
  if (!projectId) {
    throw new Error("The target project is missing an id.");
  }
  const paneLayout = instantiateWorkspaceLayout(layout, {
    currentLayout: getProjectPaneLayout(project),
    resolveCurrentPaneType: (pane) => getPaneMasterType(project, pane),
    resolveCurrentWebAppId: (pane) => (
      paneLayoutState.getSelectedWebAppForPane(pane.id) || pane.selectedWebAppId
    ),
    resolveDefaultPaneType: (paneTypeId, paneId) => (
      resolvePaneMasterType(project, paneTypeId, paneId)
    )
  });
  const result = await boatyardWindow.boatyard.applyLayout({ projectId, paneLayout });
  acceptWorkspaceLayoutState(result.state, projectId);
  showWorkspaceLayoutUndo(result.undoToken, projectId);
}

async function openWorkspaceLayoutLibrary(project: RendererProject) {
  const projectId = String(project.id || "");
  const projectScopeAvailable = Boolean(projectId && !isGlobalWorkspace(project));
  const previewMetrics = await boatyardWindow.boatyard.getLayoutPreviewMetrics();
  const picker = createWorkspaceLayoutPicker({
    getLayouts: () => boatyardWindow.boatyard.listLayouts(projectScopeAvailable ? projectId : null),
    getPaneTypeLabel: (paneTypeId) => getPaneMasterTypeLabel(project, paneTypeId),
    getAspectRatio: () => resolveWorkspaceLayoutAspectRatio(previewMetrics),
    isPaneTypeAvailable: (paneTypeId) => isPaneMasterTypeAvailable(project, paneTypeId),
    onConfirm: (layout) => applyWorkspaceLayout(project, layout),
    onDelete: async (layout) => {
      if (window.confirm(`Delete the layout “${layout.name}”?`)) {
        await boatyardWindow.boatyard.removeLayout(layout.id);
      }
    },
    onSaveAs: async (name, scope) => {
      const layout = await captureCurrentWorkspaceLayout(
        project,
        name,
        crypto.randomUUID(),
        scope === "project" ? projectId : null
      );
      return boatyardWindow.boatyard.saveLayout(layout);
    },
    onUpdate: async (layout) => {
      const updated = await captureCurrentWorkspaceLayout(
        project,
        layout.name,
        layout.id,
        layout.projectId
      );
      return boatyardWindow.boatyard.saveLayout(updated);
    },
    projectScopeAvailable
  });
  await picker.refresh();
  await showOverlayDialog(picker.dialog, {
    freeze: "overlap",
    freezeMargin: 16,
    removeOnClose: true
  });
}

async function chooseInitialWorkspaceLayout(project: RendererProject): Promise<WorkspaceLayout | null> {
  let selected: WorkspaceLayout | null = null;
  const previewMetrics = await boatyardWindow.boatyard.getLayoutPreviewMetrics();
  const picker = createWorkspaceLayoutPicker({
    confirmLabel: "Use this layout",
    description: "Preview the initial workspace before creating the project.",
    getLayouts: () => boatyardWindow.boatyard.listLayouts(),
    getPaneTypeLabel: (paneTypeId) => getPaneMasterTypeLabel(project, paneTypeId),
    getAspectRatio: () => resolveWorkspaceLayoutAspectRatio(previewMetrics),
    isPaneTypeAvailable: (paneTypeId) => isPaneMasterTypeAvailable(project, paneTypeId),
    onConfirm: (layout) => {
      selected = layout;
    },
    title: "Choose the initial layout"
  });
  await picker.refresh();
  const closed = new Promise<void>((resolve) => picker.dialog.addEventListener("close", () => resolve(), { once: true }));
  await showOverlayDialog(picker.dialog, {
    freeze: "overlap",
    freezeMargin: 16,
    removeOnClose: true
  });
  await closed;
  return selected;
}

function invokeWebApp(action: string, ...payload: unknown[]) {
  return webAppRuntime.invokeWebApp(action, ...payload);
}

function isWebAppAutofillEnabled(webApp: UnknownRecord) {
  return webAppRuntime.isWebAppAutofillEnabled(webApp);
}

function isPasswordManagerEnabled() {
  return webAppRuntime.isPasswordManagerEnabled();
}

function syncWebAppAutofillButton(button: HTMLButtonElement, enabled: boolean) {
  webAppRuntime.syncWebAppAutofillButton(button, enabled);
}

async function toggleWebAppAutofill(webApp: UnknownRecord, button: HTMLButtonElement) {
  await webAppRuntime.toggleWebAppAutofill(webApp, button);
}

function getCurrentWebAppUrl(webApp: UnknownRecord) {
  return webAppRuntime.getCurrentWebAppUrl(webApp);
}

function persistVisibleWebAppPaneLayout(key: string, url = "") {
  visibleWebApps.persistPaneLayoutForWebApp(key, url);
}

function openProjectWebApp(projectId: string | undefined, webAppId: string, url = "") {
  return webAppRuntime.openProjectWebApp(projectId, webAppId, url);
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
  createWidgetPaneActions: (project, widgetPane, layout, columns) => (
    createWidgetPaneActions(project, widgetPane, layout, columns ?? getWidgetGridColumnCount(MIN_WIDGET_RAIL_WIDTH))
  ),
  createWidgetPaneSurface,
  createWidgetPaneTabs,
  isWebAppTabMenuOpen,
  closeWebAppTabMenu,
  openWebAppTabMenuFromButton,
  openWebAppHomeMenu,
  openWebAppRefreshMenu,
  openWebAppNavigationHistoryMenu,
  openWebAppUrlFieldMenu,
  createTerminalSurface,
  invokeWebApp,
  isPasswordManagerEnabled,
  isWebAppAutofillEnabled,
  syncWebAppAutofillButton,
  toggleWebAppAutofill,
  getCurrentWebAppUrl,
  setCurrentWebAppUrl: (key: string, url: string) => {
    webAppRuntime.setCurrentWebAppUrl(key, url);
  },
  normalizeAddressInput,
  isCompactPaneTabs: () => getSettings().compactPaneTabs === true,
  isGlobalWorkspace,
  getProjectPluginConfig,
  getGlobalPluginConfig,
  getAllProjectPluginConfig: (project: RendererProject) => (
    isGlobalWorkspace(project) ? {} : state.pluginConfig?.projects?.[project.id || ""] || {}
  ),
  openProjectWebApp,
  setHiddenWebAppPaneIds: (paneIds: Iterable<string>) => {
    visibleWebApps.setSurfaceHiddenPaneIds(paneIds);
  },
  setVisibleWebAppHost: (paneId: string, entry: unknown) => {
    visibleWebApps.set(paneId, entry as Parameters<typeof visibleWebApps.set>[1]);
  },
  resetVisibleWebAppHosts: () => {
    visibleWebApps.reset();
  },
  queueWebAppSync,
  persistPaneLayout
});

function createPaneLayout(project: RendererProject, node: RendererPaneLayoutNode) {
  return paneLayoutView.createPaneLayout(project, node as Parameters<typeof paneLayoutView.createPaneLayout>[1]);
}

function renderPaneLayoutPreservingPanes(project: RendererProject, options: UnknownRecord = {}) {
  paneLayoutView.renderPaneLayoutPreservingPanes(project, options);
}

function persistPaneLayout(project: RendererProject) {
  paneLayoutState.persistPaneLayout(project as Parameters<typeof paneLayoutState.persistPaneLayout>[0]);
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
  getViewState: () => ({
    currentProjectId: navigationController.getCurrentProjectId(),
    currentView: navigationController.getCurrentView()
  }),
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

const {
  createGlobalMcpSettingsForm,
  createGlobalPasswordManagerSettingsForm,
  createGlobalPluginsSettingsView,
  createGlobalPresentationSettingsForm,
  createGlobalProjectsSettingsForm,
  createGlobalTerminalSettingsForm,
  createGlobalUrlsSettingsForm,
  createGlobalWebAppOpenRulesSettingsForm,
  createGlobalWidgetsSettingsView
} = createRendererGlobalSettingsAdapters(() => settingsViewBridge);

const globalSettingsPageView = createGlobalSettingsPageView({
  closeTerminalTabMenu,
  closeWidgetAddMenu,
  createGlobalMcpSettingsForm,
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

function renderProjectDashboard(project: RendererProject) {
  workspaceDashboardViews.renderProjectDashboard(project);
}

function renderProjectPaneArea(project: RendererProject) {
  workspaceDashboardViews.renderProjectPaneArea(project);
}

const webAppMenus = createWebAppMenus({
  webAppOpenSplitRatio: WEBAPP_OPEN_SPLIT_RATIO,
  getCurrentWebAppUrl,
  getSettings,
  getProjectById,
  getProjectWidgetPanes,
  getWebAppFavicon: (key) => webAppRuntime.getWebAppFavicon(key),
  getVisibleWebAppEntryByKey: (key) => key ? visibleWebApps.getEntryByKey(key) : null,
  getVisibleWebAppEntryByUrl: (url) => url ? visibleWebApps.getEntryByUrl(url) : null,
  getVisibleWebAppEntries: () => visibleWebApps.getEntries(),
  getVisibleWebAppProject: () => webAppRuntime.getVisibleWebAppProject() || null,
  getProjectPaneLayout,
  getWebAppHostBounds,
  findPaneNode: (layout, paneId) => paneId ? findPaneNode(layout, paneId) : null,
  createSplitNode,
  applyPaneSplit: paneLayoutState.applyPaneSplit,
  setSelectedWebAppForPane: (paneId, webAppId) => {
    if (!webAppId) {
      return undefined;
    }
    return paneLayoutState.setSelectedWebAppForPane(paneId, webAppId);
  },
  setSelectedWebAppForProject: (projectId, webAppId) => {
    if (!projectId || !webAppId) {
      return undefined;
    }
    return paneLayoutState.setSelectedWebAppForProject(projectId, webAppId);
  },
  setCurrentWebAppUrl: (key: string, url: string) => {
    webAppRuntime.setCurrentWebAppUrl(key, url);
  },
  persistPaneLayout,
  renderWorkspaceDashboard,
  renderPaneLayoutPreservingPanes,
  updateWebAppHomeTab: async (projectId: string, tab: UnknownRecord) => {
    state = await boatyardWindow.boatyard.updateWebAppHomeTab(projectId, tab);
    return state;
  },
  updateSettings: async (values: UnknownRecord) => {
    state = await boatyardWindow.boatyard.updateSettings(values);
    return state;
  },
  updateProject: async (projectId: string, values: UnknownRecord) => {
    state = await boatyardWindow.boatyard.updateProject(projectId, values);
    return state;
  },
  getWebAppNavigationHistory: (key?: string) => boatyardWindow.boatyard.getWebAppNavigationHistory?.(key) || Promise.resolve(null),
  invokeWebApp,
  openExternal: (url: string) => boatyardWindow.boatyard.openExternal(url),
  showOverlayDialog,
  normalizePayloadBounds,
  freezeWebAppsForOverlay: (options?: unknown) => webAppMenuFreezeScope.freeze(options),
  restoreWebAppsAfterOverlay: () => webAppMenuFreezeScope.restore(),
  closeTerminalTabMenu,
  clamp,
  isGlobalWorkspace,
  isWebAppLoaded: (key) => Boolean(key && webAppLoadTracker.hasLoadedKey(key))
});

const paneMcpController = createPaneMcpController({
  assignWebAppToPane: (project, pane, webApp) => webAppMenus.assignWebAppToPane(project, pane, webApp),
  findPaneNode: (layout, paneId) => findPaneNode(layout, paneId),
  getGlobalWorkspace,
  getProjectById,
  getProjectPaneLayout,
  getProjectWebApps,
  getSelectedWebApp: (project, paneId, webApps) => (
    getSelectedWebApp(project, paneId, webApps) as WebAppDefinition
  )
});

boatyardWindow.boatyard.onMcpRequest?.((payload) => {
  const request = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as UnknownRecord
    : {};
  const requestId = typeof request.requestId === "string" ? request.requestId : "";
  const operation = typeof request.operation === "string" ? request.operation : "";
  const input = request.input && typeof request.input === "object" && !Array.isArray(request.input)
    ? request.input as UnknownRecord
    : {};
  if (!requestId) {
    return;
  }
  try {
    boatyardWindow.boatyard.respondMcpRequest?.({
      requestId,
      result: paneMcpController.handle(operation, input)
    });
  } catch (error) {
    boatyardWindow.boatyard.respondMcpRequest?.({
      requestId,
      error: {
        code: error instanceof PaneMcpError ? error.code : "RENDERER_ERROR",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
});

function applyWebAppOpenChoice(payload: UnknownRecord, choice: UnknownRecord) {
  return webAppMenus.applyWebAppOpenChoice(payload, choice);
}

function applyMatchingWebAppOpenRule(payload: UnknownRecord) {
  return webAppMenus.applyMatchingWebAppOpenRule(payload);
}

function closeWebAppTabMenu() {
  webAppMenus.closeWebAppTabMenu();
}

function createWidgetPaneTabs(
  project: RendererProject,
  paneNode: RendererPaneNode,
  selectedWebApp: UnknownRecord,
  webApps: UnknownRecord[],
  options: UnknownRecord = {}
) {
  return webAppMenus.createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, options);
}

function normalizeAddressInput(rawUrl: string) {
  return webAppMenus.normalizeAddressInput(rawUrl);
}

function openWebAppHomeMenu(
  event: MouseEvent,
  project: RendererProject,
  paneNode: RendererPaneNode,
  selectedWebApp: UnknownRecord,
  onAction?: () => void
) {
  return webAppMenus.openWebAppHomeMenu(event, project, paneNode, selectedWebApp, onAction);
}

function openWebAppOpenUrlDialog(payload = {}) {
  return webAppMenus.openWebAppOpenUrlDialog(payload);
}

function openWebAppRefreshMenu(event: MouseEvent, selectedWebApp: UnknownRecord, onAction?: () => void) {
  return webAppMenus.openWebAppRefreshMenu(event, selectedWebApp, onAction);
}

function openWebAppNavigationHistoryMenu(
  event: MouseEvent,
  selectedWebApp: UnknownRecord,
  direction: "back" | "forward",
  onAction?: () => void
) {
  return webAppMenus.openWebAppNavigationHistoryMenu(event, selectedWebApp, direction, onAction);
}

function openWebAppUrlFieldMenu(
  event: MouseEvent,
  project: RendererProject,
  selectedWebApp: UnknownRecord,
  url: string
) {
  return webAppMenus.openWebAppUrlFieldMenu(event, project, selectedWebApp, url);
}

function openWebAppTabMenuFromButton(
  button: HTMLButtonElement,
  project: RendererProject,
  paneNode: RendererPaneNode,
  selectedWebApp: UnknownRecord,
  webApps: UnknownRecord[]
) {
  return webAppMenus.openWebAppTabMenuFromButton(button, project, paneNode, selectedWebApp, webApps);
}

function isWebAppTabMenuOpen() {
  return webAppMenus.isWebAppTabMenuOpen();
}

function setSidebarUpdateReady(updateReady: boolean) {
  sidebarRail.classList.toggle("update-ready", updateReady);
  sidebarRail.title = updateReady
    ? "Expand project sidebar - update available"
    : "Expand project sidebar";
  sidebarRail.setAttribute(
    "aria-label",
    updateReady
      ? "Expand project sidebar, update available"
      : "Expand project sidebar"
  );
}

const updateViews = createUpdateViews({
  boatyard: boatyardWindow.boatyard as Parameters<typeof createUpdateViews>[0]["boatyard"],
  createToolIcon,
  onSidebarUpdateNoticeChange: setSidebarUpdateReady,
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
  getViewState: () => ({ currentView: navigationController.getCurrentView() }),
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
  waitForWebAppLoad: (key, expectedUrl) => key ? waitForWebAppLoad(key, expectedUrl) : Promise.resolve(false),
  syncWebAppView,
  freezeWebAppsForOverlay: () => onboardingFreezeScope.freeze(),
  restoreWebAppsAfterOverlay: () => onboardingFreezeScope.restore(),
  nextAnimationFrame,
  updateOnboarding: async (values: UnknownRecord) => {
    state.onboarding = await boatyardWindow.boatyard.updateOnboarding(values);
    return state.onboarding;
  },
  updatePaneLayout: (projectId: string | null | undefined, layout: unknown) => (
    boatyardWindow.boatyard.updatePaneLayout(projectId, layout)
  )
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

function openOnboardingTour(options: UnknownRecord = {}) {
  return onboardingTour.openOnboardingTour(options);
}

const projectSidebar = createProjectSidebar({
  elements: {
    addProjectButton,
    globalNav,
    globalNavRow,
    pinnedProjects,
    projectCount,
    projectList,
    projectSearchInput,
    sidebarRail,
    sidebarToggleButton
  },
  getViewState: () => ({
    currentProjectId: navigationController.getCurrentProjectId(),
    currentView: navigationController.getCurrentView()
  }),
  getProjects,
  getProjectGroups,
  getProjectGroupsByName,
  getCollapsedProjectGroups,
  getPinnedProjectIds,
  isSidebarCollapsed,
  freezeWebAppsForRect: (rect: DOMRectReadOnly, options?: { margin?: number }) => (
    sidebarFreezeScope.freezeForRect(rect, options)
  ),
  queueWebAppSync,
  restoreWebAppsAfterOverlay: () => sidebarFreezeScope.restore(),
  normalizeProjectSearchText,
  projectMatchesSearch,
  renderSidebarUpdateNotice,
  renderProjectNavBadges,
  selectProject,
  selectEditProject,
  clamp,
  applyFormControl,
  showOverlayDialog,
  isOnboardingDemoProjectVisible,
  ensureOnboardingDemoProject,
  updateNavigation: async (values: UnknownRecord) => {
    const navigation = await boatyardWindow.boatyard.updateNavigation({
      ...(state.navigation || {}),
      ...values
    });
    state = {
      ...state,
      navigation
    };
    return navigation;
  },
  updateProject: async (projectId: string, values: UnknownRecord) => {
    state = await boatyardWindow.boatyard.updateProject(projectId, values);
    return state;
  },
  reorderProjectIds: async (projectIds: string[]) => {
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
  getProjectPaneLayout,
  getProjectWidgetPanes,
  getSelectedWebAppForPane: paneLayoutState.getSelectedWebAppForPane,
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
  updatePluginEnabled: async (pluginId: string, enabled: boolean) => {
    state = await boatyardWindow.boatyard.updatePluginEnabled(pluginId, enabled);
    boatyardWindow.BoatyardPluginRegistry.setEnabled(pluginId, enabled);
  },
  updateGlobalPluginConfig: async (pluginId: string, values: UnknownRecord) => {
    state = await boatyardWindow.boatyard.updateGlobalPluginConfig(pluginId, values);
  }
});

function createProjectDangerZone(options: UnknownRecord) {
  return settingsViewBridge.createProjectDangerZone(
    options as Parameters<typeof settingsViewBridge.createProjectDangerZone>[0]
  );
}

function createProjectFormView(options: UnknownRecord) {
  return settingsViewBridge.createProjectFormView(
    options as Parameters<typeof settingsViewBridge.createProjectFormView>[0]
  );
}

function createProjectTerminalSettingsForm(options: UnknownRecord) {
  return settingsViewBridge.createProjectTerminalSettingsForm(
    options as Parameters<typeof settingsViewBridge.createProjectTerminalSettingsForm>[0]
  );
}

function createProjectUrlsForm(options: UnknownRecord) {
  return settingsViewBridge.createProjectUrlsForm(
    options as Parameters<typeof settingsViewBridge.createProjectUrlsForm>[0]
  );
}

function createProjectWebAppHomeTabsForm(options: UnknownRecord) {
  return settingsViewBridge.createProjectWebAppHomeTabsForm(
    options as Parameters<typeof settingsViewBridge.createProjectWebAppHomeTabsForm>[0]
  );
}

function createProjectWebAppOpenRulesForm(options: UnknownRecord) {
  return settingsViewBridge.createProjectWebAppOpenRulesForm(
    options as Parameters<typeof settingsViewBridge.createProjectWebAppOpenRulesForm>[0]
  );
}

function createProjectWidgetPanesForm(options: UnknownRecord) {
  return settingsViewBridge.createProjectWidgetPanesForm(
    options as Parameters<typeof settingsViewBridge.createProjectWidgetPanesForm>[0]
  );
}

const projectPageViews = createProjectPageViews({
  addProject: (values: UnknownRecord) => boatyardWindow.boatyard.addProject(values),
  applyInitialLayout: applyWorkspaceLayout,
  chooseInitialLayout: chooseInitialWorkspaceLayout,
  createProjectDangerZone,
  createProjectFormView,
  createProjectTerminalSettingsForm,
  createProjectUrlsForm,
  createProjectWebAppHomeTabsForm,
  createProjectWebAppOpenRulesForm,
  createProjectWidgetPanesForm,
  dashboardGrid,
  hideWebApps: () => invokeWebApp("hideWebApp"),
  persistProjectPluginConfig,
  removeProject: (projectId: string) => boatyardWindow.boatyard.removeProject(projectId),
  resetVisibleWebAppHosts: () => {
    visibleWebApps.reset();
  },
  restoreReturnView,
  selectGlobal,
  selectProject,
  setState: (nextState: RendererState) => {
    state = nextState;
  },
  updateProject: (projectId: string, values: UnknownRecord) => boatyardWindow.boatyard.updateProject(projectId, values),
  updateWebAppHomeTabs: (projectId: string, tabs: UnknownRecord[]) => (
    boatyardWindow.boatyard.updateWebAppHomeTabs(projectId, tabs)
  ),
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
});

function renderCreateProjectPage() {
  projectPageViews.renderCreateProjectPage();
}

function renderEditProjectPage(project: RendererProject) {
  projectPageViews.renderEditProjectPage(project);
}

const webAppSurfaces = createWebAppSurfaces({
  boatyard: boatyardWindow.boatyard,
  getFreezeLayerHost: () => appShell,
  getSettings,
  getVisibleWebAppEntries: () => visibleWebApps.getEntries(),
  invokeWebApp,
  isWebAppAutofillEnabled,
  markWebAppLoaded: (key: string) => {
    webAppLoadTracker.markLoadedKey(key);
  }
});

const webAppMenuFreezeScope = webAppSurfaces.createFreezeScope();
const onboardingFreezeScope = webAppSurfaces.createFreezeScope();
const sidebarFreezeScope = webAppSurfaces.createFreezeScope();

const topbarWidgets = createTopbarWidgets({
  container: document.getElementById("topbar-widgets") as HTMLElement,
  topbar: document.querySelector(".topbar") as HTMLElement,
  getWidgetRegistry: () => boatyardWindow.BoatyardWidgetRegistry || null,
  getTopbarWidgetOrder: () => state.topbarWidgets?.order || [],
  getGlobalPluginConfig,
  updateTopbarWidgets: (order) => boatyardWindow.boatyard.updateTopbarWidgets({ order }),
  onOrderPersisted: (order) => {
    state.topbarWidgets = { order };
  },
  createFreezeScope: () => webAppSurfaces.createFreezeScope()
});

function getWebAppHostBounds(host: Element | null | undefined) {
  return webAppSurfaces.getWebAppHostBounds(host);
}

function normalizePayloadBounds(bounds: unknown) {
  return webAppSurfaces.normalizePayloadBounds(bounds);
}

function syncWebAppView() {
  return webAppSurfaces.syncWebAppView();
}

function queueWebAppSync() {
  webAppSurfaces.queueWebAppSync();
}

function showOverlayDialog(dialog: HTMLDialogElement, options: UnknownRecord = {}) {
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

function render() {
  resetActiveUpdateCardUpdater();
  renderProjectList();

  const currentView = navigationController.getCurrentView();
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
  webAppRuntime.hydrateCurrentWebAppUrls(state.webApps);
  hydratePaneLayouts();
  hydrateWidgetLayouts();
  hydrateTerminalTabOrders();
  restoreNavigation(state.navigation || {});
  render();
  topbarWidgets.render();
  void loadPreparedUpdateNotice();
  startUpdatePolling();
  if (!(await maybeOpenPendingChangelog())) {
    maybeOpenInitialOnboarding();
  }
}

boatyardWindow.boatyard.onWorkspaceNavigationChanged?.((navigation) => {
  state = { ...state, navigation: navigation || {} };
  const hasPendingSettings = (
    ["global-settings", "project-edit"].includes(navigationController.getCurrentView()) &&
    hasActiveSettingsInteraction(document)
  );
  if (hasPendingSettings) {
    return;
  }
  restoreNavigation(state.navigation || {});
  render();
  topbarWidgets.render();
});

workspaceLayoutsButton.addEventListener("click", () => {
  const project = getCurrentProject() || getGlobalWorkspace() || ({
    id: GLOBAL_WORKSPACE_ID,
    isGlobalWorkspace: true,
    name: "Global",
    slug: "global"
  } as RendererProject);
  void openWorkspaceLayoutLibrary(project);
});

splitScreenButton.addEventListener("click", () => {
  void boatyardWindow.boatyard.createWorkspaceWindow?.();
});

registerRendererEventBindings({
  addProjectButton,
  applyWebAppOpenChoice,
  applyMatchingWebAppOpenRule,
  boatyard: boatyardWindow.boatyard,
  globalNav,
  globalSettingsButton,
  getCurrentProject: () => getCurrentProject() || getGlobalWorkspace() || ({
    id: GLOBAL_WORKSPACE_ID,
    isGlobalWorkspace: true,
    name: "Global",
    slug: "global"
  } as RendererProject),
  getCurrentView: () => navigationController.getCurrentView(),
  handleTerminalData: (payload) => terminalSurfaces.handleTerminalData(payload),
  handleTerminalExit: (payload) => terminalSurfaces.handleTerminalExit(payload),
  loadState,
  manualTourButton,
  markWebAppAutofillEnabled: (key, enabled) => {
    webAppRuntime.markWebAppAutofillEnabled(key, enabled);
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
  renderPaneLayoutPreservingPanes,
  selectCreateProject,
  selectGlobal,
  selectGlobalSettings,
  setCurrentWebAppFavicons: (key, favicons, url) => {
    webAppRuntime.setCurrentWebAppFavicons(key, favicons, url);
  },
  setCurrentWebAppUrl: (key, url) => {
    webAppRuntime.setCurrentWebAppUrl(key, url);
  },
  syncWebAppAutofillButton,
  windowObject: window,
  workspace
});
