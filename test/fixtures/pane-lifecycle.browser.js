import { createPaneLayoutState } from '../../src/renderer/paneLayoutState.js';
import { createPaneLayoutView } from '../../src/renderer/paneLayoutView.js';
import { createWorkspaceDashboardViews } from '../../src/renderer/workspaceDashboardViews.js';
import { createProjectPageViews } from '../../src/renderer/projectPageViews.js';
import { createGlobalSettingsPageView } from '../../src/renderer/globalSettingsPageView.js';
import { createManualViews } from '../../src/renderer/manualViews.js';
import { clearPaneContainer } from '../../src/renderer/paneCleanup.js';

function check(value, message) { if (!value) throw new Error(message); }
window.addEventListener('error', event => console.error(event.message));
window.addEventListener('unhandledrejection', event => console.error(String(event.reason)));
const projects = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }];
const state = createPaneLayoutState({ updatePaneLayout: async () => {} });
state.hydratePaneLayouts(Object.fromEntries(projects.map(project => [project.id,
  { type: 'pane', id: `${project.id}:pane`, selectedWebAppId: 'twicc-plugin' }])));
const grid = document.createElement('div');
grid.style.cssText = 'position:fixed;inset:0;display:grid';
document.body.append(grid);
const activeSubscriptions = new Set();
const activeObservers = new Set();
const NativeResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends NativeResizeObserver {
  constructor(callback) { super(callback); activeObservers.add(this); }
  disconnect() { activeObservers.delete(this); super.disconnect(); }
};
let urlCallbacks = 0;
let cleanups = 0;
const pluginPane = {
  pluginId: 'fixture',
  renderHeaderActions() {
    const subscription = {};
    activeSubscriptions.add(subscription);
    return () => { activeSubscriptions.delete(subscription); cleanups++; };
  },
  renderSidePanel(container) {
    container.textContent = 'Sessions';
    const listener = () => { urlCallbacks++; };
    window.addEventListener('boatyard:webapp-url-changed', listener);
    return () => { window.removeEventListener('boatyard:webapp-url-changed', listener); cleanups++; };
  }
};
const apps = paneId => [{ id: 'twicc-plugin', key: `${paneId}:twicc-plugin`, label: 'TwiCC',
  url: 'https://twicc.example.test/project/example', pluginPane,
  navigation: { browserControls: 'compact', items: [] },
  sidePanel: { defaultOpen: true, defaultWidth: 300, minWidth: 100,
    maxWidth: 400, minMainWidth: 100, position: 'left', title: 'Sessions' } }];
const view = createPaneLayoutView({
  paneLayoutState: state, dashboardGrid: grid, webAppSplitResizerSize: 6, minWidgetRailWidth: 200,
  createToolIcon: () => document.createElement('span'),
  getProjectPaneLayout: state.getProjectPaneLayout,
  getProjectWebApps: (_, paneId) => apps(paneId),
  getSelectedWebApp: (_, __, webApps) => webApps[0],
  isCompactPaneTabs: () => false, isGlobalWorkspace: () => false,
  getProjectPluginConfig: () => ({}), getGlobalPluginConfig: () => ({}), getAllProjectPluginConfig: () => ({}),
  setHiddenWebAppPaneIds() {}, resetVisibleWebAppHosts() {}, queueWebAppSync() {},
  persistPaneLayout: state.persistPaneLayout,
  closeWebAppTabMenu() {}, isWebAppTabMenuOpen: () => false,
  getCurrentWebAppUrl: app => app.url, setCurrentWebAppUrl() {},
  invokeWebApp: async () => {}, setVisibleWebAppHost() {}, isPasswordManagerEnabled: () => false
});
let currentProject = projects[0];
let currentView = 'project';
const pageOptions = {
  dashboardGrid: grid, resetVisibleWebAppHosts() {}, hideWebApps() {},
  closeWidgetAddMenu() {}, closeTerminalTabMenu() {},
  workspace: document.createElement('div'), workspaceKicker: document.createElement('div'),
  workspaceSummary: document.createElement('div'), workspaceTitle: document.createElement('div')
};
const dashboards = createWorkspaceDashboardViews({
  ...pageOptions,
  closeProjectGroupMenu() {}, closeTerminalTabMenu() {}, closeWebAppTabMenu() {}, closeWidgetAddMenu() {},
  createPaneLayout: view.createPaneLayout, dashboardGrid: grid, detachProjectTerminal() {},
  getGlobalWorkspace: () => projects[0], getPaneLayout: state.getProjectPaneLayout,
  getProjectSummaryTarget: project => project.name,
  getViewState: () => ({ currentView, currentProjectId: currentProject.id }),
});
for (let i = 0; i < 30; i++) {
  currentProject = projects[i % 2];
  dashboards.renderProjectDashboard(currentProject);
}
window.dispatchEvent(new CustomEvent('boatyard:webapp-url-changed'));
check(urlCallbacks === 1, `Only the mounted TwiCC sidebar handles URL changes, received ${urlCallbacks}`);
check(activeSubscriptions.size === 1, 'Header polling subscriptions stay bounded');
check(activeObservers.size === 1, 'Only the mounted sidebar retains its ResizeObserver');
check(cleanups === 58, 'Every previous pane runs both plugin cleanups');
const retainedPane = grid.querySelector('.webapp-pane');
view.renderPaneLayoutPreservingPanes(currentProject);
check(grid.querySelector('.webapp-pane') === retainedPane, 'Layout-only changes preserve the mounted pane');
check(cleanups === 58, 'Reused panes keep their subscriptions');
dashboards.renderProjectPaneArea(currentProject);
check(activeSubscriptions.size === 1 && activeObservers.size === 1, 'Pane-area replacement disposes old resources');
currentView = 'global';
dashboards.renderGlobalDashboard();
dashboards.renderGlobalPaneArea();
check(activeSubscriptions.size === 1 && activeObservers.size === 1, 'Global transitions dispose old resources');
grid.querySelector('.webapp-browser-controls-button').click();
check(activeObservers.size === 2, 'Open browser controls add their own observer');
const emptyForm = () => document.createElement('form');
const projectPages = createProjectPageViews({
  ...pageOptions, createProjectFormView: emptyForm,
  createProjectTerminalSettingsForm: emptyForm, createProjectUrlsForm: emptyForm,
  createProjectWebAppHomeTabsForm: emptyForm, createProjectWebAppOpenRulesForm: emptyForm,
  createProjectWidgetPanesForm: emptyForm, createProjectDangerZone: emptyForm
});
projectPages.renderCreateProjectPage();
check(activeSubscriptions.size === 0 && activeObservers.size === 0, 'Creation page disposes panes and open browser controls');
dashboards.renderProjectDashboard(currentProject);
projectPages.renderEditProjectPage(currentProject);
check(activeSubscriptions.size === 0 && activeObservers.size === 0, 'Project settings dispose panes');
dashboards.renderProjectDashboard(currentProject);
createGlobalSettingsPageView({
  ...pageOptions, getSettings: () => ({}), emitOpened() {},
  createGlobalProjectsSettingsForm: emptyForm, createGlobalUrlsSettingsForm: emptyForm,
  createGlobalPresentationSettingsForm: emptyForm, createGlobalTerminalSettingsForm: emptyForm,
  createGlobalPasswordManagerSettingsForm: emptyForm, createGlobalMcpSettingsForm: emptyForm,
  createGlobalWebAppOpenRulesSettingsForm: emptyForm, createGlobalPluginsSettingsView: emptyForm,
  createGlobalWidgetsSettingsView: emptyForm, createGlobalUpdateCard: emptyForm
}).renderGlobalSettingsPage();
check(activeSubscriptions.size === 0 && activeObservers.size === 0, 'Global settings dispose panes');
dashboards.renderProjectDashboard(currentProject);
createManualViews({ ...pageOptions, getManual: () => ({ sections: [] }) }).renderManualPage();
check(activeSubscriptions.size === 0 && activeObservers.size === 0, 'Help page disposes panes');
dashboards.renderProjectDashboard(currentProject);
const cleanupsBeforeClear = cleanups;
clearPaneContainer(grid);
clearPaneContainer(grid);
check(cleanups === cleanupsBeforeClear + 2, 'Repeated cleanup never calls a plugin twice');
window.browserTestResult = 'passed';
