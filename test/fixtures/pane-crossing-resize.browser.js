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
function finish() { document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })); }
async function mount(layout) {
  state.setPaneLayout(project.id, layout);
  view.renderPaneLayoutPreservingPanes(project);
  await frame(); await frame();
}
const box = id => grid.querySelector(`[data-pane-id="${id}"].webapp-pane`).getBoundingClientRect();
function separatorAt(x, y) {
  return [...grid.querySelectorAll('.webapp-split-resizer')].find(element => {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
}
function down(x, y) {
  const element = separatorAt(x, y);
  check(element, 'Pointer lands on a separator');
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }));
}
function moveTo(x, y) {
  document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y }));
}
const highlighted = () => [...grid.querySelectorAll('.webapp-split-resizer.crossing-highlight')];
function hover(x, y) {
  const element = separatorAt(x, y);
  element.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, buttons: 0 }));
  return element;
}
const layout = () => split('root', 'horizontal', 0.5,
  split('top', 'vertical', 0.5, pane('a'), pane('b')),
  split('bottom', 'vertical', 0.5, pane('c'), pane('d')));
await mount(layout());
const input = document.createElement('input'); input.value = 'Unsaved content';
grid.querySelector('[data-pane-id="b"] .webapp-host').append(input);
const originalLeft = box('a');
const originalRight = box('b');
const y = originalRight.bottom + 3;
const x = originalLeft.right + 3;
down(x + 150, y);
moveTo(x + 150, y + 45);
finish(); await frame();
check(Math.abs(box('a').bottom - originalLeft.bottom) < 0.05, 'Dragging the right branch leaves the opposite branch still');
check(Math.abs(box('b').bottom - originalRight.bottom - 45) < 0.05, 'The grabbed branch moves');
check(input.isConnected && input.value === 'Unsaved content', 'Branch restructuring preserves mounted input content');
// Snap the branch back into a plus, then drag the center in both directions.
down(x + 150, box('b').bottom + 3);
moveTo(x + 150, y + 4);
finish(); await frame();
check(Math.abs(box('a').bottom - box('b').bottom) < 0.05, 'Independent branches still snap back together');
const cross = hover(x, y);
check(cross.style.cursor === 'move', 'Crossing center advertises movement in both axes');
check(highlighted().length === 3, 'Hovering a plus highlights all four branches across its three separators');
check(highlighted().every(element => getComputedStyle(element).backgroundImage.includes('linear-gradient')),
  'Connected separator highlights are painted by the stylesheet');
hover(x + 100, y);
check(highlighted().length === 0, 'Moving away from the center clears connected highlights');
hover(x, y);
cross.dispatchEvent(new PointerEvent('pointerleave'));
check(highlighted().length === 0, 'Leaving the separator clears connected highlights');
hover(x, y);
window.dispatchEvent(new Event('blur'));
check(highlighted().length === 0, 'Window blur clears connected highlights');
hover(x, y);
down(x + 2, y + 2); moveTo(x + 62, y + 32); finish(); await frame();
check(highlighted().length === 0, 'Starting a drag clears the previous hover geometry');
check(Math.abs(box('a').right - originalLeft.right - 60) < 0.05, 'Crossing moves the upper vertical branch');
check(Math.abs(box('c').right - originalLeft.right - 60) < 0.05, 'Crossing moves the lower vertical branch');
check(Math.abs(box('a').bottom - originalLeft.bottom - 30) < 0.05, 'Crossing moves the left horizontal branch');
check(Math.abs(box('b').bottom - originalRight.bottom - 30) < 0.05, 'Crossing moves the right horizontal branch');
check(input.isConnected, 'Crossing movement retains pane content');
const beforeReload = box('a');
await mount(structuredClone(saved));
check(Math.abs(box('a').right - beforeReload.right) < 0.05 && Math.abs(box('a').bottom - beforeReload.bottom) < 0.05, 'Crossing position persists');
// The continuous edge at a T keeps both halves together.
await mount(split('root', 'horizontal', 0.5, pane('a'), split('bottom', 'vertical', 0.5, pane('c'), pane('d'))));
const top = box('a');
down(top.left + 150, top.bottom + 3); moveTo(top.left + 150, top.bottom + 43); finish(); await frame();
check(Math.abs(box('a').bottom - top.bottom - 40) < 0.05, 'T through-edge moves as a whole');
check(Math.abs(box('c').top - box('d').top) < 0.05, 'T keeps both lower panes connected');
const tx = box('c').right + 3, ty = box('a').bottom + 3;
hover(tx, ty);
check(highlighted().length === 2, 'Hovering a T highlights the through-edge and its third branch');
down(tx, ty); moveTo(tx + 30, ty + 20); finish(); await frame();
check(Math.abs(box('c').right + 3 - tx - 30) < 0.05 && Math.abs(box('a').bottom + 3 - ty - 20) < 0.05, 'T center moves all three branches');
// The horizontal separator spans two crossings, but the hovered crossing
// only moves its immediate left and middle branches.
const row = prefix => split(`${prefix}-row`, 'vertical', 0.5, pane(`${prefix}-left`),
  split(`${prefix}-right`, 'vertical', 0.5, pane(`${prefix}-middle`), pane(`${prefix}-right`)));
await mount(split('root', 'horizontal', 0.5, row('top'), row('bottom')));
const left = box('top-left'), middle = box('top-middle');
hover(left.right + 3, left.bottom + 3);
check(highlighted().length === 3, 'The other crossing vertical branches are not highlighted');
const through = highlighted().find(element => element.classList.contains('horizontal'));
const painted = getComputedStyle(through).backgroundImage;
const highlightEnd = middle.right + 3 - through.getBoundingClientRect().left;
check(painted.includes(`transparent ${highlightEnd}px`) || painted.includes(`rgba(0, 0, 0, 0) ${highlightEnd}px`),
  'Horizontal highlight stops at the next crossing, leaving the unrelated branch unpainted');
await mount(layout());
check(highlighted().length === 0, 'Replacing the layout clears crossing highlights');
if (window.nativeMenuTest) {
  await mount(layout());
  const bridge = window.nativeMenuTest;
  const url = await bridge.invoke('fixtureUrl');
  for (const id of ['a', 'b', 'c', 'd']) {
    const host = grid.querySelector(`[data-pane-id="${id}"] .webapp-host`).getBoundingClientRect();
    await bridge.invoke('showWebApp', { key: id, url: `${url}?pane=${id}`,
      bounds: { x: host.x + 2, y: host.y + 2, width: host.width - 4, height: host.height - 4 } });
  }
  await bridge.invoke('setVisibleWebApps', ['a', 'b', 'c', 'd']);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = (await bridge.status()).every(item => item.visible && item.loaded && item.painted);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  check(ready, 'Native panes are painted before the real pointer gesture');
  const before = box('a');
  const start = { x: before.right + 3, y: before.bottom + 3 };
  await bridge.invoke('nativeDrag', { start, end: { x: start.x + 80, y: start.y + 100 } });
  await frame(); await frame();
  check(Math.abs(box('a').right - before.right - 80) < 0.1 &&
    Math.abs(box('a').bottom - before.bottom - 100) < 0.1, 'Captured native mouse drag continues across WebContentsViews');
  check(Math.abs(box('c').right - box('a').right) < 0.1 && Math.abs(box('b').bottom - box('a').bottom) < 0.1,
    'Real mouse drag moves all four connected branches');
}
window.browserTestResult = 'passed';
