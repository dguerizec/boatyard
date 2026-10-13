import { createProjectSidebar } from '../../src/renderer/projectSidebar.js';
import { createProjectCatalogSync } from '../../src/renderer/projectCatalog.js';
import { normalizeProjectSearchText, projectMatchesSearch } from '../../src/renderer/projectUtils.js';
import '../../src/renderer/styles.css';

const check = (value, message) => { if (!value) throw new Error(message); };
const waitFor = async predicate => {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Catalog IPC notification did not arrive');
};
const elements = {};
for (const name of ['addProjectButton', 'globalNav', 'globalNavRow', 'pinnedProjects', 'projectCount', 'projectList', 'projectSearchInput', 'sidebarRail', 'sidebarToggleButton']) {
  elements[name] = document.createElement(name === 'projectSearchInput' ? 'input' : 'div');
  document.body.append(elements[name]);
}
let state = {
  projects: [{ id: 'one', name: 'One', slug: 'one' }],
  navigation: { view: 'project-edit', projectId: 'one' },
  paneLayouts: { one: { id: 'pane-one', draft: 'Unsaved editor text' } },
  pluginConfig: { global: { example: { enabled: true } }, projects: {} }
};
const initial = structuredClone(state);
const navigation = state.navigation, paneLayouts = state.paneLayouts, globalConfig = state.pluginConfig.global;
const draft = document.createElement('input'); draft.value = 'Unsaved project settings'; document.body.append(draft);
draft.focus(); draft.setSelectionRange(2, 8);
const sidebar = createProjectSidebar({
  elements, getProjects: () => state.projects, getProjectGroups: () => [], getProjectGroupsByName: () => new Map(),
  getCollapsedProjectGroups: () => new Set(), getPinnedProjectIds: () => [],
  getViewState: () => ({ currentView: 'project-edit', currentProjectId: 'one' }), isSidebarCollapsed: () => false,
  freezeWebAppsForRect: async () => {}, queueWebAppSync() {}, restoreWebAppsAfterOverlay: async () => {},
  normalizeProjectSearchText, projectMatchesSearch, renderSidebarUpdateNotice() {}, renderProjectNavBadges() {},
  selectProject() { throw new Error('Catalog changes must not navigate'); }, selectEditProject() {},
  clamp: (value, min, max) => Math.max(min, Math.min(value, max)),
  applyFormControl() {}, showOverlayDialog: async () => false, isOnboardingDemoProjectVisible: () => false,
  ensureOnboardingDemoProject() {}, updateNavigation: async () => {}, updateProject: async () => {}, reorderProjectIds: async () => {},
  renderApp() { throw new Error('Catalog changes must not remount the active view'); }
});
const sync = createProjectCatalogSync({
  subscribe: window.boatyard.onProjectsChanged,
  readState: window.boatyard.getState,
  getState: () => state, setState: next => { state = next; },
  renderProjectList: () => sidebar.renderProjectList()
});
sidebar.renderProjectList();
const pendingRead = sync.readState();
const catalog = {
  projects: [...state.projects, { id: 'two', name: 'New MCP project', slug: 'new-mcp-project', group: '', isOpen: true }],
  projectPluginConfig: {}, projectHugescreen: { two: { widthMultiplier: 1 } }
};
await window.boatyard.invokePlugin('test', 'catalog', catalog);
await waitFor(() => elements.projectList.textContent.includes('New MCP project'));
check(elements.projectCount.textContent === '2', 'IPC creation updates the real sidebar without a reload');
check(state.navigation === navigation && state.paneLayouts === paneLayouts && state.pluginConfig.global === globalConfig, 'Catalog updates preserve window navigation, panes, and global settings');
check(draft.value === 'Unsaved project settings' && document.activeElement === draft && draft.selectionStart === 2 && draft.selectionEnd === 8, 'Sidebar updates preserve settings drafts, focus, and selection');
catalog.projectPluginConfig.two = { 'boatyard.twicc': { twiccProjectUrl: 'https://twicc.example/project/two' } };
await window.boatyard.invokePlugin('test', 'catalog', catalog);
await waitFor(() => state.pluginConfig.projects.two);
check(state.pluginConfig.projects.two['boatyard.twicc'].twiccProjectUrl === catalog.projectPluginConfig.two['boatyard.twicc'].twiccProjectUrl, 'The later TwiCC link is synchronized too');
await window.boatyard.invokePlugin('test', 'finish-read', initial);
const loaded = await pendingRead;
check(loaded.projects.length === 2 && loaded.pluginConfig.projects.two, 'An in-flight initial snapshot cannot erase catalog events');
sync.cleanup();
await window.boatyard.invokePlugin('test', 'catalog', { ...catalog, projects: [] });
await new Promise(resolve => setTimeout(resolve, 30));
check(state.projects.length === 2, 'Disposing the subscription prevents further updates');
window.browserTestResult = 'passed';
