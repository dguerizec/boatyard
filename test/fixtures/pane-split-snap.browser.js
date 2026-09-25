import { createPaneLayoutState } from '../../src/renderer/paneLayoutState.js';
import { createPaneLayoutView } from '../../src/renderer/paneLayoutView.js';
import '../../src/renderer/styles.css';

function check(value, message) { if (!value) throw new Error(message); }
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const pane = id => ({ type: 'pane', id });
const split = (id, direction, ratio, first, second) => ({ type: 'split', id, direction, ratio, first, second });
const project = { id: 'project', name: 'Example' };
let saved;
const state = createPaneLayoutState({ updatePaneLayout: async (_, layout) => { saved = structuredClone(layout); } });
const grid = document.createElement('div');
grid.style.cssText = 'position:fixed;left:23px;top:19px;width:900px;height:660px;display:grid';
document.body.append(grid);
const app = { id: 'empty', kind: 'empty', label: 'Empty', minWidth: '60px', minHeight: '60px' };
const view = createPaneLayoutView({
  paneLayoutState: state, dashboardGrid: grid, webAppSplitResizerSize: 6, minWidgetRailWidth: 200,
  createToolIcon: () => document.createElement('span'),
  getProjectPaneLayout: state.getProjectPaneLayout, getProjectWebApps: () => [app], getSelectedWebApp: () => app,
  isCompactPaneTabs: () => false, setHiddenWebAppPaneIds() {}, resetVisibleWebAppHosts() {}, queueWebAppSync() {},
  persistPaneLayout: state.persistPaneLayout
});
const handle = id => grid.querySelector(`[data-split-id="${id}"] > .webapp-split-resizer`);
function center(id, vertical) {
  const rect = handle(id).getBoundingClientRect();
  return vertical ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
}
function begin(id) {
  const rect = handle(id).getBoundingClientRect();
  handle(id).dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, pointerId: 1, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }));
}
function move(position, vertical) {
  document.dispatchEvent(new PointerEvent('pointermove', {
    pointerId: 1, clientX: vertical ? position : 100, clientY: vertical ? 100 : position
  }));
}
function finish() { document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })); }
async function mount(layout) {
  state.setPaneLayout(project.id, layout);
  view.renderPaneLayoutPreservingPanes(project);
  await frame(); await frame();
}
for (const vertical of [false, true]) {
  const direction = vertical ? 'vertical' : 'horizontal';
  const cross = vertical ? 'horizontal' : 'vertical';
  await mount(split('root', cross, 0.48,
    split('moving', direction, 0.35, pane('a'), pane('b')),
    split('target', direction, 0.51, pane('c'), pane('d'))));
  const target = center('target', vertical);
  const originalContent = grid.querySelector('[data-pane-id="a"] .webapp-host');
  begin('moving');
  move(target - 5, vertical);
  check(Math.abs(center('moving', vertical) - target) < 0.05, `${direction}: approaching snaps to adjacent crossing`);
  move(target + 6, vertical);
  check(Math.abs(center('moving', vertical) - target) < 0.05, `${direction}: nearby movement stays aligned`);
  move(target + 18, vertical);
  check(Math.abs(center('moving', vertical) - target - 18) < 0.05, `${direction}: moving away releases snap`);
  move(target + 4, vertical);
  finish();
  check(Math.abs(center('moving', vertical) - target) < 0.05, `${direction}: final crossing is aligned`);
  check(grid.querySelector('[data-pane-id="a"] .webapp-host') === originalContent, 'Snapping preserves pane content');
  const restored = structuredClone(saved);
  await mount(restored);
  check(Math.abs(center('moving', vertical) - center('target', vertical)) < 0.05, `${direction}: alignment survives layout reload`);
}
// Resizing normalizes consecutive splits, changing the dragged divider's parent.
await mount(split('root', 'horizontal', 0.48,
  split('moving', 'vertical', 0.65,
    split('inner', 'vertical', 0.4, pane('a'), pane('b')), pane('c')),
  split('target', 'vertical', 0.51, pane('d'), pane('e'))));
const nestedTarget = center('target', true);
const originalHandle = handle('moving');
begin('moving'); move(nestedTarget + 5, true); finish();
check(handle('moving') !== originalHandle, 'Fixture exercises split normalization during drag');
check(Math.abs(center('moving', true) - nestedTarget) < 0.05, 'Nested divider snaps in viewport coordinates after normalization');
// Parallel dividers separated by another column must not attract one another.
await mount(split('root', 'vertical', 0.32,
  split('moving', 'horizontal', 0.35, pane('a'), pane('b')),
  split('right', 'vertical', 0.5, pane('middle'),
    split('target', 'horizontal', 0.51, pane('c'), pane('d')))));
const distant = center('target', false);
begin('moving'); move(distant + 5, false); finish();
check(Math.abs(center('moving', false) - distant - 5) < 0.05, 'Unconnected dividers do not snap');
// Expanding over a target hides its internal crossing and removes it from snapping.
await mount(split('root', 'vertical', 0.48,
  split('moving', 'horizontal', 0.35, pane('a'), pane('b')),
  split('target', 'horizontal', 0.51, pane('c'), pane('d'))));
state.activatePaneExpansion(project, 'c', ['c', 'd']);
view.renderPaneLayoutPreservingPanes(project);
await frame(); await frame();
const hiddenTarget = center('target', false);
begin('moving'); move(hiddenTarget + 5, false); finish();
check(Math.abs(center('moving', false) - hiddenTarget - 5) < 0.05, 'Hidden internal dividers do not attract visible crossings');
window.browserTestResult = 'passed';
