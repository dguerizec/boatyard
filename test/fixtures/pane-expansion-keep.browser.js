import { createPaneMcpController } from '../../src/renderer/paneMcpController.js';
import { createPaneLayoutState } from '../../src/renderer/paneLayoutState.js';
import { createVisibleWebAppTracker } from '../../src/renderer/visibleWebAppTracker.js';
import { createPaneLayoutView } from '../../src/renderer/paneLayoutView.js';
import { createWebAppMenus } from '../../src/renderer/webAppMenus.js';
import '../../src/renderer/styles.css';

function check(value, message) { if (!value) throw new Error(message); }
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const project = { id: 'project', name: 'Example' };
const pane = id => ({ type: 'pane', id, selectedWebAppId: 'fixture' });
const split = (id, direction, ratio, first, second) => ({ type: 'split', id, direction, ratio, first, second });
const layout = split('root', 'vertical', 0.68,
  split('left', 'vertical', 0.46,
    split('a', 'horizontal', 0.43, pane('c'), pane('b')),
    split('c', 'horizontal', 0.43, pane('a'), pane('d'))),
  split('e', 'horizontal', 0.43, pane('e'), pane('f')));
const saves = [];
const disposed = [];
let frozen = false;
const reloads = [];
let hidden = [];
let visibleProject = project;
const tracker = createVisibleWebAppTracker({
  getVisibleWebAppProject: () => visibleProject
});
const capture = id => tracker.getPaneCaptureBounds(project, id);
const state = createPaneLayoutState({ updatePaneLayout: async (_, value) => saves.push(structuredClone(value)) });
state.hydratePaneLayouts({ project: layout });
const grid = document.createElement('div');
grid.style.cssText = 'position:fixed;left:13px;top:17px;width:calc(100vw - 26px);height:calc(100vh - 34px);display:grid';
document.body.append(grid);
const app = { id: 'fixture', kind: 'dom', label: 'Fixture', pluginPane: {
  pluginId: 'fixture', render(host, props) {
    const input = document.createElement('input');
    input.value = `Draft ${props.paneId}`;
    host.append(input);
    return () => disposed.push(props.paneId);
  }
} };
const menus = createWebAppMenus({
  freezeWebAppsForOverlayRect: async () => { frozen = true; },
  restoreWebAppsAfterOverlay: () => { frozen = false; },
  closeTerminalTabMenu() {},
  invokeWebApp: async (...args) => reloads.push(args),
  clamp: (value, min, max) => Math.min(max, Math.max(min, value))
});
const terminal = { id: 'terminal', kind: 'terminal', label: 'Terminal' };
const selectedApp = (_, id) => ['b', 'f'].includes(id) ? terminal : app;
const controller = createPaneMcpController({
  getProjectById: () => project, getProjectPaneLayout: state.getProjectPaneLayout,
  getProjectWebApps: () => [app, terminal], getSelectedWebApp: selectedApp,
  getMobileDevViewport: () => null, getCurrentWebAppUrl: () => undefined,
  getPaneVisibility: tracker.getPaneVisibility, getPaneCaptureBounds: tracker.getPaneCaptureBounds,
  findPaneNode: state.findPaneNode
});
const describe = id => {
  const find = node => node.type === 'pane' ? (node.id === id ? node : null) : find(node.first) || find(node.second);
  return find(controller.getPaneLayout({ projectId: project.id }).layout);
};
const revision = () => controller.getPaneLayout({ projectId: project.id }).revision;
const originalRevision = revision();
const view = createPaneLayoutView({
  paneLayoutState: state, dashboardGrid: grid, webAppSplitResizerSize: 6, minWidgetRailWidth: 200,
  createToolIcon: () => document.createElement('span'),
  getProjectPaneLayout: state.getProjectPaneLayout,
  getProjectWebApps: () => [app, terminal], getSelectedWebApp: selectedApp,
  createTerminalSurface: (_, options) => {
    const surface = document.createElement('div');
    surface.dataset.boatyardCleanup = 'true';
    surface.boatyardCleanup = () => disposed.push(options.storageKey.slice('pane:'.length));
    return surface;
  },
  isCompactPaneTabs: () => false, isGlobalWorkspace: () => false,
  getProjectPluginConfig: () => ({}), getGlobalPluginConfig: () => ({}), getAllProjectPluginConfig: () => ({}),
  setHiddenWebAppPaneIds: ids => { hidden = [...ids]; tracker.setSurfaceHiddenPaneIds(hidden); },
  resetVisibleWebAppHosts() {}, queueWebAppSync() {},
  persistPaneLayout: state.persistPaneLayout,
  openPaneExpansionMenu: menus.openPaneExpansionMenu,
  closeWebAppTabMenu: menus.closeWebAppTabMenu,
  isWebAppTabMenuOpen: menus.isWebAppTabMenuOpen
});
grid.append(view.createPaneLayout(project, layout));
await frame(); await frame();
const element = id => grid.querySelector(`[data-pane-id="${id}"].webapp-pane`);
const button = id => element(id).querySelector('[data-pane-action="toggle-expand"]');
const original = element('a');
const input = original.querySelector('input');
input.value = 'Unsaved content';
const outside = element('b').getBoundingClientRect();
const context = id => button(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 70 }));
context('a'); await frame();
check(!document.querySelector('[role="menu"]'), 'Normal panes have no keep menu');
state.activatePaneExpansion(project, 'a', ['a', 'c']);
view.renderPaneLayoutPreservingPanes(project);
await frame(); await frame();
check(capture('a'), 'Expanded pane remains capturable');
check(capture('b') && capture('e'), 'Visible neighbors remain capturable beside one expansion');
check(capture('c') === null, 'Covered pane is refused even with nonempty DOM bounds');
state.activatePaneExpansion(project, 'e', ['e', 'f']);
view.renderPaneLayoutPreservingPanes(project);
await frame(); await frame();
check(capture('a') && capture('e'), 'Both expanded panes remain capturable');
check(capture('b') && capture('d'), 'Visible neighbors remain capturable beside multiple expansions');
check(capture('c') === null && capture('f') === null, 'Only actually covered panes are refused');
for (const id of ['a', 'b', 'd', 'e']) {
  const pane = describe(id);
  check(pane.visibility.visible === true && pane.visibility.reason === 'visible', `Layout reports ${id} visible`);
}
for (const id of ['c', 'f']) {
  const pane = describe(id);
  check(pane.visibility.visible === false && pane.visibility.reason === 'covered', `Layout reports ${id} covered`);
}
check(describe('b').paneTypeId === 'terminal' && describe('f').paneTypeId === 'terminal', 'Visible and covered terminals expose the same visibility metadata');
check(revision() === originalRevision, 'Visibility does not change the structural layout revision');
check(controller.getPaneCaptureTarget({ projectId: project.id, paneId: 'b', expectedRevision: revision() }).bounds, 'Visible terminal layout metadata agrees with capture');
try {
  controller.getPaneCaptureTarget({ projectId: project.id, paneId: 'f', expectedRevision: revision() });
  throw new Error('Covered terminal must reject capture');
} catch (error) {
  check(error.code === 'PANE_NOT_VISIBLE', 'Covered terminal metadata agrees with capture refusal');
}
visibleProject = { id: 'other-project' };
check(capture('a') === null && capture('b') === null, 'Inactive projects cannot be captured');
check(describe('b').visibility.reason === 'inactive_project', 'Layout explains inactive project visibility');
check(revision() === originalRevision, 'Project activation does not change the layout revision');
visibleProject = project;
check(capture('missing') === null, 'Missing panes cannot be captured');
check(tracker.getPaneVisibility(project, 'missing').reason === 'not_rendered', 'Missing DOM has an explicit reason');
check(button('a').classList.contains('active'), 'Expanded button is highlighted');
const expanded = element('a').getBoundingClientRect();
context('a'); await frame();
check(frozen && document.activeElement?.getAttribute('role') === 'menuitem', 'Menu freezes native surfaces and focuses its action');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check(!frozen && !document.querySelector('[role="menu"]'), 'Escape dismisses the menu');
check(document.activeElement === button('a'), 'Escape restores button focus');
check(state.countPaneNodes(state.getProjectPaneLayout(project)) === 6, 'Dismissal leaves all panes intact');
context('a'); await frame();
document.querySelector('[role="menuitem"]').click();
await frame(); await frame();
check(element('a') === original && original.querySelector('input') === input && input.value === 'Unsaved content', 'Kept pane retains its mounted content');
check(!element('c') && disposed.join(',') === 'c', 'Only the covered pane is disposed');
check(!button('a').classList.contains('active') && button('a').getAttribute('aria-pressed') === 'false', 'Highlight and pressed state are cleared');
check(!element('a').classList.contains('pane-expanded'), 'Kept pane is a normal layout pane');
for (const edge of ['left', 'top', 'width', 'height']) {
  check(Math.abs(element('a').getBoundingClientRect()[edge] - expanded[edge]) < 0.1, `Kept ${edge} is unchanged`);
  check(Math.abs(element('b').getBoundingClientRect()[edge] - outside[edge]) < 0.1, `Outside ${edge} is unchanged`);
}
check(button('e').classList.contains('active') && hidden.join(',') === 'f', 'Disjoint expansion remains active');
check(capture('a') && capture('b') && capture('e') && capture('f') === null, 'Capture visibility follows expansion cleanup');
check(describe('a').visibility.visible && describe('f').visibility.reason === 'covered', 'Layout visibility follows expansion cleanup');
const boundsProbe = document.createElement('div');
boundsProbe.className = 'webapp-pane';
boundsProbe.dataset.paneId = 'bounds-probe';
document.body.append(boundsProbe);
const probe = rect => {
  boundsProbe.getBoundingClientRect = () => rect;
  return capture('bounds-probe');
};
const clipped = probe({ left: -10.5, top: 20.1, right: window.innerWidth + 10, bottom: 100.9 });
check(clipped.x === 0 && clipped.y === 21 && clipped.width === window.innerWidth && clipped.height === 79, 'Bounds are clipped and rounded inward');
check(probe({ left: -30, top: 0, right: -10, bottom: 100 }) === null, 'Outside viewport bounds are refused');
check(tracker.getPaneVisibility(project, 'bounds-probe').reason === 'outside_viewport', 'Viewport exclusion has an explicit reason');
check(probe({ left: 10, top: 0, right: 10, bottom: 100 }) === null, 'Empty bounds are refused');
check(probe({ left: NaN, top: 0, right: 10, bottom: 100 }) === null, 'Invalid bounds are refused');
check(tracker.getPaneVisibility(project, 'bounds-probe').reason === 'invalid_bounds', 'Invalid geometry has an explicit reason');
boundsProbe.remove();
check(button('a').closest('.webapp-pane').querySelector('[data-pane-action="split-vertical"]').disabled === false, 'Normal structural actions are restored');
check(!frozen && saves.length === 1, 'Action restores overlays and persists once');
const restored = createPaneLayoutState({ updatePaneLayout: async () => {} });
restored.hydratePaneLayouts({ project: saves[0] });
check(!restored.findPaneNode(restored.getProjectPaneLayout(project), 'a').expansion, 'Kept expansion stays cleared after reload');
check(restored.countPaneNodes(restored.getProjectPaneLayout(project)) === 5, 'Removed pane stays removed after reload');
// Keeping a full-workspace expansion also works when no split remains.
state.activatePaneExpansion(project, 'a', ['a', 'b', 'd', 'e', 'f']);
view.renderPaneLayoutPreservingPanes(project);
await frame(); await frame();
context('a'); await frame();
document.querySelector('[role="menuitem"]').click();
await frame(); await frame();
check(state.getProjectPaneLayout(project).id === 'a' && grid.querySelectorAll('.webapp-pane').length === 1, 'Full expansion becomes the only pane');
check(button('a').disabled && !button('a').classList.contains('active'), 'Single pane has no expansion highlight');
check(disposed.length === 5 && !disposed.includes('a'), 'All removed contents are disposed exactly once');
let actionCalled = false;
await menus.openWebAppRefreshMenu(new MouseEvent('contextmenu'), { key: 'fixture' }, () => {
  check(!menus.isWebAppTabMenuOpen(), 'Shared action menu closes before its callback');
  actionCalled = true;
});
document.querySelector('[role="menuitem"]').click();
check(actionCalled && reloads[0].join(',') === 'navigateWebApp,fixture,hard-refresh', 'Existing hard reload action is preserved');
window.browserTestResult = 'passed';
