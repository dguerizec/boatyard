import { createPaneLayoutState } from '../../src/renderer/paneLayoutState.js';
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
const state = createPaneLayoutState({ updatePaneLayout: async (_, value) => saves.push(structuredClone(value)) });
state.hydratePaneLayouts({ project: layout });
const grid = document.createElement('div');
grid.style.cssText = 'position:fixed;left:13px;top:17px;width:1200px;height:800px;display:grid';
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
const view = createPaneLayoutView({
  paneLayoutState: state, dashboardGrid: grid, webAppSplitResizerSize: 6, minWidgetRailWidth: 200,
  createToolIcon: () => document.createElement('span'),
  getProjectPaneLayout: state.getProjectPaneLayout,
  getProjectWebApps: () => [app], getSelectedWebApp: () => app,
  isCompactPaneTabs: () => false, isGlobalWorkspace: () => false,
  getProjectPluginConfig: () => ({}), getGlobalPluginConfig: () => ({}), getAllProjectPluginConfig: () => ({}),
  setHiddenWebAppPaneIds: ids => { hidden = [...ids]; },
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
state.activatePaneExpansion(project, 'e', ['e', 'f']);
view.renderPaneLayoutPreservingPanes(project);
await frame(); await frame();
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
