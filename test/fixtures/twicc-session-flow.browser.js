import { registerPluginRegistry } from '../../src/renderer/pluginRegistry.js';
import { registerWidgetRegistry } from '../../src/renderer/widgetRegistry.js';
import '../../src/plugins/twicc/style.css';

function check(value, message) { if (!value) throw new Error(message); }
window.addEventListener('error', event => console.error(event.message));
window.addEventListener('unhandledrejection', event => console.error(String(event.reason)));
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const timers = [];
window.setInterval = callback => { timers.push(callback); return timers.length; };
window.clearInterval = () => {};
registerWidgetRegistry(window);
const registry = registerPluginRegistry(window);
let serverSessions = [
  { id: 'a', title: 'Session A', lane: 'in_progress', order: 0 },
  { id: 'b', title: 'Session B', lane: 'backlog', order: 0 },
  { id: 'c', title: 'Session C', lane: 'done', order: 0 }
];
let readCount = 0;
let nextRead;
const writes = [];
const archives = [];
const pendingWrites = [];
window.boatyard = {
  onPluginEvent: () => () => {},
  invokePlugin: async (_plugin, action, payload) => {
    if (action === 'sessionFlow') {
      readCount++;
      if (nextRead) {
        const read = nextRead;
        nextRead = null;
        return read.promise;
      }
      return structuredClone(serverSessions);
    }
    if (action === 'reorderSessionFlow') {
      writes.push(structuredClone(payload));
      const write = deferred();
      pendingWrites.push(write);
      await write.promise;
      const reordered = payload.sessionIds.map((id, order) => ({
        ...serverSessions.find(session => session.id === id), lane: payload.lane, order
      }));
      serverSessions = serverSessions.filter(session => !payload.sessionIds.includes(session.id)).concat(reordered);
      return { lane: payload.lane, sessionIds: payload.sessionIds };
    }
    if (action === 'archiveSession') {
      archives.push(payload.sessionId);
      serverSessions = serverSessions.filter(session => session.id !== payload.sessionId);
      return { status: 'updated' };
    }
    return null;
  }
};
await import('../../src/plugins/twicc/renderer.ts');
registry.applyEnabledState({});
const pane = registry.listPanes({ scope: 'project', kind: 'dom' })
  .find(item => item.id === 'boatyard.twicc.sessionFlowPane');
const host = document.createElement('div');
host.style.width = '420px';
document.body.append(host);
const cleanup = pane.render(host, {
  project: { id: 'example', sourcePath: '/workspace/example' }, paneId: 'kanban',
  pluginConfig: { twiccProjectUrl: 'https://twicc.example.test/project/example' },
  globalPluginConfig: { twiccBaseUrl: 'https://twicc.example.test' }
});
await settle();
const surface = host.querySelector('.twicc-session-flow-widget');
const card = id => host.querySelector(`[data-session-id="${id}"]`);
const lane = id => host.querySelector(`[data-lane="${id}"]`);
const laneOf = id => card(id)?.closest('[data-lane]')?.dataset.lane;
const refresh = () => timers.at(-1)();
const openMenu = id => card(id).querySelector('.twicc-session-flow-move').click();
function chooseLane(id, target) {
  openMenu(id);
  const buttons = document.querySelectorAll('.twicc-session-flow-menu button');
  buttons[['in_progress', 'backlog', 'done'].indexOf(target)].click();
}
function drag(id, grabX = 0.5, grabY = 0.5) {
  const original = card(id);
  const rect = original.getBoundingClientRect();
  const offsetX = Math.round(rect.width * grabX);
  const offsetY = Math.round(rect.height * grabY);
  const clientX = rect.left + offsetX;
  const clientY = rect.top + offsetY;
  const dataTransfer = new DataTransfer();
  let ghost;
  dataTransfer.setDragImage = (element, x, y) => { ghost = { element, x, y }; };
  original.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX, clientY }));
  // The drag threshold must not replace the original pointerdown grip.
  original.dispatchEvent(new DragEvent('dragstart', {
    bubbles: true, dataTransfer, clientX: clientX + 6, clientY: clientY + 5
  }));
  return { original, dataTransfer, ghost, offsetX, offsetY,
    centerOffsetX: rect.width / 2 - offsetX, centerOffsetY: rect.height / 2 - offsetY };
}
function dragEventAtCenter(dragged, type, centerX, centerY) {
  const clientX = centerX - dragged.centerOffsetX;
  const clientY = centerY - dragged.centerOffsetY;
  const target = document.elementFromPoint(clientX, clientY) || document.body;
  const event = new DragEvent(type, {
    bubbles: true, cancelable: true, dataTransfer: dragged.dataTransfer, clientX, clientY
  });
  target.dispatchEvent(event);
  return event;
}
function drop(dragged, target) {
  const rect = lane(target).getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.bottom - 2;
  dragEventAtCenter(dragged, 'dragover', centerX, centerY);
  dragEventAtCenter(dragged, 'drop', centerX, centerY);
  dragged.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
}
check(laneOf('a') === 'in_progress', 'Initial board must load');

// Polls must not remove a drag source or close a menu, including reads
// that were dispatched just before the interaction began.
const oldDragRead = deferred();
nextRead = oldDragRead;
refresh();
const dragged = drag('a');
const beforeDragReads = readCount;
refresh();
await settle();
check(readCount === beforeDragReads, 'Polling must pause while dragging');
oldDragRead.resolve(structuredClone(serverSessions));
await settle();
check(card('a') === dragged.original, 'A delayed read must preserve the drag source');
drop(dragged, 'backlog');
await settle();
check(writes.length === 1 && laneOf('a') === 'backlog', 'Drop must persist its optimistic destination');
pendingWrites.shift().resolve();
await settle();
check(laneOf('a') === 'backlog', 'Saved drop must survive reconciliation');

const oldMenuRead = deferred();
nextRead = oldMenuRead;
refresh();
openMenu('a');
const menu = document.querySelector('.twicc-session-flow-menu');
const beforeMenuReads = readCount;
refresh();
oldMenuRead.resolve(structuredClone(serverSessions));
await settle();
check(readCount === beforeMenuReads, 'Polling must pause while the move menu is open');
check(menu.isConnected, 'A delayed read must not close the move menu');
menu.querySelectorAll('button')[2].click();
await settle();
pendingWrites.shift().resolve();
await settle();
check(laneOf('a') === 'done', 'The preserved menu must still move its session');

// Accept rapid moves across both input methods without overlapping writes.
const writesBeforeQueue = writes.length;
chooseLane('a', 'in_progress');
await settle();
const queuedDrag = drag('b');
drop(queuedDrag, 'done');
chooseLane('a', 'backlog');
await settle();
check(writes.length === writesBeforeQueue + 1, 'Only one lane write may run at a time');
check(surface.getAttribute('aria-busy') === 'true', 'Queued writes must remain visibly pending');
pendingWrites.shift().resolve();
await settle();
check(writes.length === writesBeforeQueue + 2 && writes.at(-1).sessionIds.includes('b'), 'Queued drop must execute');
pendingWrites.shift().resolve();
await settle();
check(writes.length === writesBeforeQueue + 3 && writes.at(-1).lane === 'backlog', 'The last menu intent must execute');
pendingWrites.shift().resolve();
await settle();
check(laneOf('a') === 'backlog' && laneOf('b') === 'done', 'All queued destinations must persist');
check(surface.getAttribute('aria-busy') === 'false', 'Busy state must clear after the complete queue');

// Mutation completion and active-conversation events also render the board.
// Defer those renders until an ongoing menu or drag has finished.
chooseLane('a', 'in_progress');
await settle();
openMenu('b');
const menuDuringSave = document.querySelector('.twicc-session-flow-menu');
pendingWrites.shift().resolve();
await settle();
check(menuDuringSave.isConnected, 'Completing a save must preserve an ongoing menu interaction');
menuDuringSave.querySelectorAll('button')[1].click();
await settle();
pendingWrites.shift().resolve();
await settle();
check(laneOf('b') === 'backlog', 'A menu kept open during a save must remain usable');

chooseLane('a', 'backlog');
await settle();
const dragDuringSave = drag('b');
window.dispatchEvent(new CustomEvent('boatyard:webapp-url-changed', {
  detail: { key: 'example:twicc-plugin', url: 'https://twicc.example.test/project/example/session/a' }
}));
pendingWrites.shift().resolve();
await settle();
check(card('b') === dragDuringSave.original, 'Save completion and navigation must preserve an ongoing drag');
drop(dragDuringSave, 'done');
await settle();
pendingWrites.shift().resolve();
await settle();
check(laneOf('b') === 'done', 'A drag kept alive during a save must still persist');

// A read that finishes after a successful mutation must never roll it back.
const staleSnapshot = structuredClone(serverSessions);
const staleRead = deferred();
nextRead = staleRead;
refresh();
refresh();
const readsDuringPending = readCount;
refresh();
check(readCount === readsDuringPending, 'Concurrent polls must share one read');
chooseLane('a', 'in_progress');
await settle();
pendingWrites.shift().resolve();
await settle();
staleRead.resolve(staleSnapshot);
await settle();
check(laneOf('a') === 'in_progress', 'An obsolete response must not undo a completed move');
check(readCount > readsDuringPending, 'Mutation reconciliation must follow an obsolete in-flight read');

const staleFailure = deferred();
nextRead = staleFailure;
refresh();
chooseLane('a', 'done');
await settle();
pendingWrites.shift().resolve();
await settle();
staleFailure.reject(new Error('Obsolete read failed'));
await settle();
check(laneOf('a') === 'done' && !host.querySelector('.twicc-session-flow-board').hidden,
  'An obsolete read failure must not hide or replace a successfully updated board');

// On partial failure, do not execute more queued rewrites against unknown state.
const writesBeforeFailure = writes.length;
chooseLane('a', 'backlog');
await settle();
chooseLane('b', 'in_progress');
await settle();
serverSessions = serverSessions.map(session => session.id === 'a' ? { ...session, lane: 'backlog' } : session);
pendingWrites.shift().reject(new Error('Later session update failed'));
await settle();
check(writes.length === writesBeforeFailure + 1, 'A failed batch must stop its remaining rewrites');
check(laneOf('a') === 'backlog' && laneOf('b') === 'done', 'Partial failure must reconcile actual backend state');
check(host.querySelector('.twicc-session-flow-message').textContent.includes('Could not save all session moves'),
  'Reconciliation must preserve the failure explanation');
chooseLane('b', 'backlog');
await settle();
pendingWrites.shift().resolve();
await settle();
check(laneOf('b') === 'backlog', 'A reconciled board must allow a fresh user move');

// The hotspot is the original grip; the tile's center, not that hotspot,
// selects a lane even when the mouse is physically over its neighbor.
const lowerCorner = drag('a', 0.98, 0.98);
check(lowerCorner.ghost?.element === lowerCorner.original
  && lowerCorner.ghost.x === lowerCorner.offsetX && lowerCorner.ghost.y === lowerCorner.offsetY,
  'The native ghost must keep a bottom-right grip at the pointer');
let targetRect = lane('in_progress').getBoundingClientRect();
let centerX = targetRect.left + targetRect.width / 2;
let centerY = targetRect.bottom - 4;
let pointerHit = document.elementFromPoint(centerX - lowerCorner.centerOffsetX, centerY - lowerCorner.centerOffsetY);
check(pointerHit?.closest('[data-lane]')?.dataset.lane !== 'in_progress', 'Fixture must put the pointer outside the chosen lane');
let hover = dragEventAtCenter(lowerCorner, 'dragover', centerX, centerY);
check(hover.defaultPrevented && lane('in_progress').classList.contains('drop-target'),
  'A center inside the lane must accept and highlight the drop despite an outside pointer');
dragEventAtCenter(lowerCorner, 'drop', centerX, centerY);
lowerCorner.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await settle();
check(writes.at(-1).lane === 'in_progress', 'Releasing the lower-corner grip must persist the center-selected lane');
pendingWrites.shift().resolve();
await settle();

const upperCorner = drag('a', 0.02, 0.02);
check(upperCorner.ghost?.x === upperCorner.offsetX && upperCorner.ghost.y === upperCorner.offsetY,
  'The native ghost must also preserve a top-left grip');
targetRect = lane('backlog').getBoundingClientRect();
centerX = targetRect.left + targetRect.width / 2;
centerY = targetRect.top + 4;
pointerHit = document.elementFromPoint(centerX - upperCorner.centerOffsetX, centerY - upperCorner.centerOffsetY);
check(pointerHit?.closest('[data-lane]')?.dataset.lane !== 'backlog', 'Top-left fixture must also put the pointer outside its destination');
hover = dragEventAtCenter(upperCorner, 'dragover', centerX, centerY);
check(hover.defaultPrevented && lane('backlog').classList.contains('drop-target'), 'Top-left grip must select by center');
dragEventAtCenter(upperCorner, 'drop', centerX, centerY);
upperCorner.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await settle();
check(writes.at(-1).lane === 'backlog' && writes.at(-1).sessionIds[0] === 'a', 'The ghost center must also determine insertion order');
pendingWrites.shift().resolve();
await settle();

// Check the horizontal axis independently, and make the final release choose
// a new destination without relying on the last dragover or its event target.
host.style.width = '780px';
surface.setOrientation('horizontal');
const horizontalGrip = drag('a', 0.98, 0.98);
targetRect = lane('in_progress').getBoundingClientRect();
centerX = targetRect.right - 4;
centerY = targetRect.top + 60;
pointerHit = document.elementFromPoint(centerX - horizontalGrip.centerOffsetX, centerY - horizontalGrip.centerOffsetY);
check(pointerHit?.closest('[data-lane]')?.dataset.lane === 'backlog', 'Horizontal fixture must put the pointer in the neighboring lane');
hover = dragEventAtCenter(horizontalGrip, 'dragover', centerX, centerY);
check(hover.defaultPrevented && lane('in_progress').classList.contains('drop-target')
  && !lane('backlog').classList.contains('drop-target'), 'The ghost center must choose exactly one horizontal lane');
targetRect = lane('done').getBoundingClientRect();
dragEventAtCenter(horizontalGrip, 'drop', targetRect.left + 30, targetRect.top + 60);
horizontalGrip.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await settle();
check(writes.at(-1).lane === 'done', 'Release must re-evaluate the ghost center instead of keeping an old hover target');
pendingWrites.shift().resolve();
await settle();

// A pointer over a lane is insufficient when the center is outside the board.
const invalidGrip = drag('a', 0.02, 0.02);
targetRect = lane('done').getBoundingClientRect();
centerX = targetRect.right + 20;
centerY = targetRect.top + 60;
const writesBeforeInvalidDrop = writes.length;
hover = dragEventAtCenter(invalidGrip, 'dragover', centerX, centerY);
check(!hover.defaultPrevented && !host.querySelector('.drop-target'), 'A center outside every zone must clear the drop preview');
dragEventAtCenter(invalidGrip, 'drop', centerX, centerY);
invalidGrip.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await settle();
check(writes.length === writesBeforeInvalidDrop, 'Dropping outside by center must not persist a pointer-selected lane');

surface.setOrientation('vertical');
host.style.width = '420px';

const insertionGrip = drag('c', 0.98, 0.98);
const anchorRect = card('a').getBoundingClientRect();
centerX = anchorRect.left + anchorRect.width / 2;
centerY = anchorRect.top + anchorRect.height / 2 + 4;
hover = dragEventAtCenter(insertionGrip, 'dragover', centerX, centerY);
check(hover.defaultPrevented && host.querySelector('.twicc-session-flow-insertion-placeholder')
  ?.nextElementSibling?.dataset.sessionId === 'a', 'A ghost covering a card must reserve that card position rather than the following slot');
const stablePreview = host.querySelector('.twicc-session-flow-insertion-placeholder');
const previewMutations = new MutationObserver(() => {});
previewMutations.observe(stablePreview.parentElement, { childList: true });
for (let i = 0; i < 5; i++) {
  const preview = host.querySelector('.twicc-session-flow-insertion-placeholder');
  check(preview === stablePreview, 'The native drop target must retain its DOM identity');
  const previewRect = preview.getBoundingClientRect();
  check(centerY >= previewRect.top && centerY <= previewRect.bottom, 'The insertion preview must contain the ghost center');
  dragEventAtCenter(insertionGrip, 'dragover', centerX, centerY);
  check(host.querySelector('.twicc-session-flow-insertion-placeholder')?.nextElementSibling?.dataset.sessionId === 'a',
    'Repeated dragover events must keep the preview under a stationary ghost');
}
check(previewMutations.takeRecords().length === 0,
  'A stationary ghost must not detach or reinsert the accepted drop target');
previewMutations.disconnect();
const otherLaneRect = card('c').getBoundingClientRect();
dragEventAtCenter(insertionGrip, 'dragover', otherLaneRect.left + otherLaneRect.width / 2,
  otherLaneRect.top + otherLaneRect.height / 2);
check(host.querySelector('.twicc-session-flow-insertion-placeholder') === stablePreview,
  'Moving between lanes must reuse the same preview');
dragEventAtCenter(insertionGrip, 'dragover', 1, 1);
check(!stablePreview.isConnected, 'Leaving the board must hide the preview');
dragEventAtCenter(insertionGrip, 'dragover', centerX, centerY);
check(host.querySelector('.twicc-session-flow-insertion-placeholder') === stablePreview,
  'Returning to the board must reuse the same preview');
dragEventAtCenter(insertionGrip, 'drop', centerX, centerY);
insertionGrip.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await settle();
check(writes.at(-1).sessionIds.join(',') === 'c,a', 'The center-based insertion order must be persisted');
pendingWrites.shift().resolve();
await settle();

const ownSlotGrip = drag('a', 0.98, 0.98);
const ownSlotRect = ownSlotGrip.original.getBoundingClientRect();
centerX = ownSlotRect.left + ownSlotRect.width / 2;
centerY = ownSlotRect.top + ownSlotRect.height / 2;
const writesBeforeOwnSlot = writes.length;
for (let i = 0; i < 5; i++) {
  dragEventAtCenter(ownSlotGrip, 'dragover', centerX, centerY);
  const previewRect = host.querySelector('.twicc-session-flow-insertion-placeholder').getBoundingClientRect();
  check(centerY >= previewRect.top && centerY <= previewRect.bottom, 'Dragging over the original slot must also keep the preview under the ghost');
}
dragEventAtCenter(ownSlotGrip, 'drop', centerX, centerY);
ownSlotGrip.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await settle();
check(writes.length === writesBeforeOwnSlot, 'Dropping in the original slot must preserve the existing order without a write');

const archiveGrip = drag('c', 0.98, 0.98);
const archive = host.querySelector('.twicc-session-flow-archive-dropzone');
targetRect = archive.getBoundingClientRect();
centerX = targetRect.left + targetRect.width / 2;
centerY = targetRect.bottom - 4;
hover = dragEventAtCenter(archiveGrip, 'dragover', centerX, centerY);
check(hover.defaultPrevented && archive.classList.contains('drop-target'), 'The archive zone must use the same ghost-center rule');
dragEventAtCenter(archiveGrip, 'drop', centerX, centerY);
archiveGrip.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await settle();
check(archives.join(',') === 'c' && !card('c'), 'The center-selected archive drop must execute exactly once');

// Selection uses modifiers without opening sessions or replacing focused cards.
serverSessions = Array.from({ length: 6 }, (_, index) => ({
  id: `s${index}`, title: `Selectable ${index}`, lane: index < 4 ? 'in_progress' : 'backlog', order: index
}));
refresh();
await settle();
const opened = [];
window.boatyard.openExternal = url => opened.push(url);
const clickCard = (id, modifiers = {}) => card(id).dispatchEvent(new MouseEvent('click', {
  bubbles: true, cancelable: true, ...modifiers
}));
const selected = () => [...host.querySelectorAll('.twicc-session-flow-card.selected')].map(node => node.dataset.sessionId).join(',');
const contextMenu = id => card(id).dispatchEvent(new MouseEvent('contextmenu', {
  bubbles: true, cancelable: true, clientX: 120, clientY: 100
}));
const dismissMenu = () => document.querySelector('.twicc-session-flow-menu')?.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
clickCard('s0', { ctrlKey: true });
const selectionCard = card('s0');
check(selected() === 's0' && selectionCard.getAttribute('aria-selected') === 'true', 'Ctrl-click must select a session');
const titleLeft = selectionCard.querySelector('.twicc-session-flow-title').getBoundingClientRect().left;
clickCard('s0', { ctrlKey: true });
check(!selected() && titleLeft === card('s0').querySelector('.twicc-session-flow-title').getBoundingClientRect().left,
  'Toggling the thicker selection border must not shift card content');
clickCard('s1', { metaKey: true });
clickCard('s3', { shiftKey: true });
check(selected() === 's1,s2,s3', 'Shift-click must select the range from the anchor');
clickCard('s2', { shiftKey: true });
check(selected() === 's1,s2', 'A second Shift-click must shrink from the same anchor');
clickCard('s5', { ctrlKey: true });
check(selected() === 's1,s2,s5', 'Ctrl-click must add a disjoint session across categories');
refresh();
await settle();
check(selected() === 's1,s2,s5', 'Selection must survive polling');
contextMenu('s2');
let selectionMenu = document.querySelector('.twicc-session-flow-menu');
check(selectionMenu.querySelector('.twicc-session-flow-menu-label').textContent === 'Move 3 sessions to',
  'Right-click on a selected card must target the selection');
check([...selectionMenu.querySelectorAll('button')].every(button => button.getAttribute('aria-current') === 'false'),
  'A mixed selection must not mark any destination as current');
selectionMenu.querySelectorAll('button')[2].click();
await settle();
check(writes.at(-1).sessionIds.join(',') === 's1,s2,s5' && writes.at(-1).lane === 'done',
  'A group move must write one ordered destination lane');
pendingWrites.shift().resolve();
await settle();
check(['s1', 's2', 's5'].every(id => laneOf(id) === 'done') && selected() === 's1,s2,s5',
  'A successful group move must retain the selected cards');
openMenu('s1');
check(document.querySelector('.twicc-session-flow-menu-label').textContent === 'Move 3 sessions to',
  'The ellipsis menu must target the same selection as right-click');
dismissMenu();
check(selected() === 's1,s2,s5' && document.activeElement === card('s1'),
  'Escape from the menu must preserve selection and restore card focus');
contextMenu('s0');
check(!selected() && document.querySelector('.twicc-session-flow-menu-label').textContent === 'Move session to',
  'Right-click on an unselected session must target only that session');
dismissMenu();
clickCard('s3', { ctrlKey: true });
openMenu('s3');
check(document.querySelector('.twicc-session-flow-menu-label').textContent === 'Move session to',
  'A single selected session must use singular menu copy');
dismissMenu();
card('s3').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check(!selected(), 'Escape on the board must clear selection');
clickCard('s0');
clickCard('s4', { shiftKey: true });
check(selected() === 's0,s3,s4', 'Plain click must establish the next range anchor across categories');
await new Promise(resolve => setTimeout(resolve, 330));
check(opened.length === 0, 'Modifier selection must cancel a pending plain-click navigation');
clickCard('s0');
check(!selected(), 'A plain click must clear multi-selection');
await new Promise(resolve => setTimeout(resolve, 330));
check(opened.length === 1, 'A plain click must still open a session');
clickCard('s0', { ctrlKey: true });
serverSessions = serverSessions.filter(session => session.id !== 's0');
refresh();
await settle();
check(!selected(), 'Polling must prune selection when sessions disappear');

// A partial bulk save must reconcile backend authority and stop later intents.
clickCard('s1', { ctrlKey: true });
clickCard('s2', { ctrlKey: true });
contextMenu('s1');
document.querySelectorAll('.twicc-session-flow-menu button')[1].click();
await settle();
check(writes.at(-1).sessionIds.join(',') === 's4,s1,s2',
  'A group must append in visual order after existing destination sessions');
chooseLane('s3', 'done');
const writesBeforeBulkFailure = writes.length;
serverSessions = serverSessions.map(session => session.id === 's1' ? { ...session, lane: 'backlog' } : session);
pendingWrites.shift().reject(new Error('Partial bulk move failed'));
await settle();
check(writes.length === writesBeforeBulkFailure && laneOf('s1') === 'backlog' && laneOf('s2') === 'done'
  && laneOf('s3') === 'in_progress', 'Partial bulk failure must read actual placements and stop the queued move');

// Search matches title OR branch without case sensitivity, survives refreshes,
// and never includes hidden sessions in selections or bulk actions.
serverSessions = [
  { id: 'search-a', title: 'Fix the Sidebar', branch: 'feature/search', lane: 'in_progress', order: 0 },
  { id: 'search-hidden', title: 'Unrelated task', branch: 'main', lane: 'in_progress', order: 1 },
  { id: 'search-b', title: 'Another task', branch: 'fix/sidebar', lane: 'in_progress', order: 2 },
  { id: 'search-done', title: 'Sidebar cleanup', lane: 'done', order: 0 },
  { id: 'search-done-hidden', title: 'Completed task', branch: 'main', lane: 'done', order: 1 }
];
refresh();
await settle();
const search = host.querySelector('.twicc-session-flow-search');
const filterSessions = value => {
  search.focus();
  search.value = value;
  search.dispatchEvent(new Event('input', { bubbles: true }));
};
check(lane('done').querySelector('.twicc-session-flow-archive-all').textContent === 'Archive all',
  'Without a filter, the bulk archive button must retain its default label');
lane('done').querySelector('.twicc-session-flow-archive-all').click();
const unfilteredArchiveDialog = document.querySelector('.twicc-session-flow-archive-dialog');
check(unfilteredArchiveDialog.querySelector('h3').textContent === 'Archive all done sessions',
  'Without a filter, the archive dialog must retain its default title');
await new Promise(resolve => {
  unfilteredArchiveDialog.addEventListener('close', resolve, { once: true });
  unfilteredArchiveDialog.close();
});
clickCard('search-hidden', { ctrlKey: true });
filterSessions('  SIDEbar  ');
check(document.activeElement === search && search.isConnected, 'Filtering must preserve the search input and focus');
check(card('search-a') && card('search-b') && card('search-done') && !card('search-hidden') && !card('search-done-hidden'),
  'Search must match title or branch in any lane, ignoring case and outer whitespace');
check(!selected(), 'Filtering must remove hidden sessions from the selection');
check(lane('in_progress').querySelector('.twicc-session-flow-count').textContent === '2 / 3',
  'Filtered lane counts must show matching and total sessions');
clickCard('search-a', { ctrlKey: true });
clickCard('search-b', { shiftKey: true });
check(selected() === 'search-a,search-b', 'Shift selection must include only matching cards');
chooseLane('search-b', 'backlog');
await settle();
check(writes.at(-1).sessionIds.join(',') === 'search-a,search-b', 'Bulk moves must not include a filtered-out selection');
pendingWrites.shift().resolve();
await settle();
check(!card('search-hidden') && laneOf('search-a') === 'backlog' && search.value === '  SIDEbar  ',
  'The filter must survive move reconciliation');
// Reordering a filtered lane must retain its hidden destination sessions.
filterSessions('another');
chooseLane('search-b', 'in_progress');
await settle();
check(writes.at(-1).sessionIds.join(',') === 'search-hidden,search-b',
  'Filtered moves must retain hidden sessions in persisted destination ordering');
pendingWrites.shift().resolve();
await settle();
filterSessions('does-not-exist');
check(!host.querySelector('.twicc-session-flow-card')
  && [...host.querySelectorAll('.twicc-session-flow-empty')].every(node => node.textContent === 'No matching sessions'),
  'No matches must leave the search available with an explicit empty state');
filterSessions('feature/search');
check(card('search-a') && !card('search-b'), 'The branch field must be independently searchable');
search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
check(search.value === '' && card('search-hidden') && card('search-done-hidden'), 'Escape must clear the filter and restore sessions');
const filteredRead = deferred();
nextRead = filteredRead;
refresh();
filterSessions('cleanup');
filteredRead.resolve(structuredClone(serverSessions));
await settle();
check(card('search-done') && !card('search-a') && document.activeElement === search,
  'An in-flight refresh must apply the latest filter without losing input focus');
check(lane('done').querySelector('.twicc-session-flow-archive-all').textContent === 'Archive matches',
  'Bulk archive must clearly indicate the filtered scope');
lane('done').querySelector('.twicc-session-flow-archive-all').click();
const archiveSearchDialog = document.querySelector('.twicc-session-flow-archive-dialog');
check(archiveSearchDialog.textContent.includes('1 matching session'), 'Archive confirmation must count only matching sessions');
archiveSearchDialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
await settle();
check(archives.includes('search-done') && !archives.includes('search-done-hidden'),
  'Archiving search matches must leave hidden done sessions untouched');
filterSessions('');
check(card('search-done-hidden'), 'Clearing a filter must restore remaining hidden sessions');

serverSessions = [
  { id: 'available', title: 'Available session', lane: 'in_progress', order: 0 },
  { id: 'unavailable', title: 'Missing conversation', stale: true, lane: 'in_progress', order: 1 }
];
refresh();
await settle();
check(card('unavailable').textContent.includes('Source missing') && !card('unavailable').textContent.includes('Unavailable'),
  'A missing source file must not label session metadata as unavailable');
card('available').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
card('unavailable').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
const beforeUnavailableMove = writes.length;
chooseLane('unavailable', 'done');
await settle();
check(writes.length === beforeUnavailableMove + 1 && writes.at(-1).sessionIds.includes('unavailable'),
  'A selection containing a stale session must reach TwiCC for metadata updates');
pendingWrites.shift().resolve();
await settle();
check(laneOf('available') === 'done' && laneOf('unavailable') === 'done',
  'TwiCC may confirm moving both stale and available sessions');
lane('done').querySelector('.twicc-session-flow-archive-all').click();
document.querySelector('.twicc-session-flow-archive-dialog form')
  .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
await settle();
check(archives.includes('unavailable') && !card('unavailable'),
  'A stale session must remain archivable when TwiCC accepts its metadata update');

// Edge scrolling continues with a stationary pointer and recomputes insertion
// after each frame, in both the vertical board and horizontal lane lists.
serverSessions = Array.from({ length: 36 }, (_, index) => ({
  id: `scroll${index}`, title: `Scrolling session ${index}`, lane: index < 30 ? 'in_progress' : 'backlog', order: index
}));
host.style.cssText = 'position:fixed;left:20px;top:20px;width:420px;height:360px';
surface.style.display = 'flex';
surface.style.flexDirection = 'column';
surface.style.boxSizing = 'border-box';
refresh();
await settle();
const board = host.querySelector('.twicc-session-flow-board');
const nativeRequestFrame = window.requestAnimationFrame;
const nativeCancelFrame = window.cancelAnimationFrame;
const animationFrames = new Map();
let frameId = 0;
let frameTime = performance.now();
window.requestAnimationFrame = callback => { animationFrames.set(++frameId, callback); return frameId; };
window.cancelAnimationFrame = id => animationFrames.delete(id);
const frames = async (count = 8) => {
  for (let i = 0; i < count; i++) {
    frameTime = Math.max(frameTime + 16, performance.now() + 16);
    const pending = [...animationFrames.values()];
    animationFrames.clear();
    for (const callback of pending) callback(frameTime);
    await settle();
  }
};
const hoverAt = (dragged, x, y) => dragEventAtCenter(dragged, 'dragover',
  x + dragged.centerOffsetX, y + dragged.centerOffsetY);
check(board.scrollHeight > board.clientHeight, 'Vertical fixture must overflow');
const scrollGrip = drag('scroll0');
const boardRect = board.getBoundingClientRect();
hoverAt(scrollGrip, boardRect.left + boardRect.width / 2, boardRect.bottom - 3);
await frames();
check(board.scrollTop > 10, `A stationary pointer near the lower board edge must scroll down: ${JSON.stringify({ scrollTop: board.scrollTop, rect: boardRect.toJSON(), currentRect: board.getBoundingClientRect().toJSON(), dragging: surface.dataset.dragging })}`);
const scrollAfterFirstFrames = board.scrollTop;
await frames();
check(board.scrollTop > scrollAfterFirstFrames, 'Scrolling must continue without another dragover');
const beforeUpScroll = board.scrollTop;
hoverAt(scrollGrip, boardRect.left + boardRect.width / 2, boardRect.top + 3);
await frames();
check(board.scrollTop < beforeUpScroll, 'The upper board edge must scroll back up');
hoverAt(scrollGrip, boardRect.left + boardRect.width / 2, boardRect.top + boardRect.height / 2);
await frames(2);
const middleScroll = board.scrollTop;
await frames();
check(board.scrollTop === middleScroll, 'The middle of the board must not keep scrolling');
hoverAt(scrollGrip, boardRect.left + boardRect.width / 2, boardRect.bottom - 3);
await frames(3);
scrollGrip.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
const afterEnd = board.scrollTop;
await frames();
check(board.scrollTop === afterEnd, 'Ending a drag must cancel the scrolling animation');

surface.setOrientation('horizontal');
host.style.width = '780px';
board.scrollTop = 0;
const horizontalList = lane('in_progress').querySelector('.twicc-session-flow-list');
check(horizontalList.scrollHeight > horizontalList.clientHeight, 'Horizontal lane fixture must overflow');
const listGrip = drag('scroll0');
const listRect = horizontalList.getBoundingClientRect();
hoverAt(listGrip, listRect.left + listRect.width / 2, listRect.bottom - 3);
await frames();
check(horizontalList.scrollTop > 10 && board.scrollTop === 0, 'Horizontal layout must scroll the hovered lane independently');
const beforeScrollDrop = writes.length;
const previewBeforeScrollDrop = host.querySelector('.twicc-session-flow-insertion-placeholder');
check(previewBeforeScrollDrop?.isConnected, 'Scrolling must keep a live insertion preview');
const dropX = listRect.left + listRect.width / 2;
const dropY = listRect.bottom - 3;
dragEventAtCenter(listGrip, 'drop', dropX + listGrip.centerOffsetX, dropY + listGrip.centerOffsetY);
listGrip.original.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
await settle();
check(writes.length === beforeScrollDrop + 1 && writes.at(-1).sessionIds.indexOf('scroll0') > 0,
  'Dropping after scrolling must save the newly revealed insertion position');
pendingWrites.shift().resolve();
await settle();
surface.setOrientation('vertical');
board.scrollTop = 0;
// Refresh failures keep the usable board, and late reads cannot revive it after cleanup.
const failedRead = deferred();
nextRead = failedRead;
refresh();
failedRead.reject(new Error('TwiCC unavailable'));
await settle();
check(!host.querySelector('.twicc-session-flow-board').hidden && card('scroll1'), 'Read failure must retain the last useful board');
const removedRead = deferred();
nextRead = removedRead;
refresh();
const disposalGrip = drag('scroll1');
const cleanupRect = board.getBoundingClientRect();
hoverAt(disposalGrip, cleanupRect.left + cleanupRect.width / 2, cleanupRect.bottom - 3);
cleanup();
const disposedScroll = board.scrollTop;
await frames();
check(board.scrollTop === disposedScroll, 'Disposal must cancel edge scrolling');
removedRead.resolve([]);
await settle();
check(!surface.isConnected, 'A disposed surface must stay removed');
window.requestAnimationFrame = nativeRequestFrame;
window.cancelAnimationFrame = nativeCancelFrame;
window.browserTestResult = 'passed';
