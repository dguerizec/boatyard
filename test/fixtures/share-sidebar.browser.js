import { createShareSidebar } from '../../src/renderer/shareSidebar.js';
import { setupRemoteSharingControls } from '../../src/renderer/remoteSharingControls.js';
import '../../src/renderer/styles.css';

const check = (value, message) => { if (!value) throw new Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } throw new Error('Sidebar transition timed out'); };
const listeners = { share: new Set(), remote: new Set(), chat: new Set() };
const status = {
  share: { listening: true, clients: [{ id: 'alice', label: 'Alice', state: 'connected', voice: { handRaised: 1, selfMuted: true } }], shareAccess: { requests: [{ id: 'join', label: 'Bob' }] } },
  remote: { listening: false, clients: [] }
};
const chat = { activeId: 'current', session: { id: 'current', startedAt: new Date().toISOString(), endedAt: null, count: 0 }, messages: [] };
let mutations = 0, persisted;
const bridge = {
  getRemoteStatus: async mode => structuredClone(status[mode]),
  onRemoteStatusChanged(callback, mode) { listeners[mode].add(callback); return () => listeners[mode].delete(callback); },
  getShareProjects: async () => [],
  getShareChat: async () => structuredClone(chat),
  sendShareChat: async () => {}, getShareChatImage: async () => '',
  onShareChatChanged(callback) { listeners.chat.add(callback); return () => listeners.chat.delete(callback); },
  updateRemoteSettings: async () => { mutations++; },
  async decideShareJoinRequest() { status.share.shareAccess.requests = []; listeners.share.forEach(callback => callback(status.share)); return status.share; }
};
const shell = document.createElement('div'); shell.className = 'app-shell';
shell.innerHTML = '<aside class="sidebar"></aside><main class="workspace"><div id="project">First project</div></main>';
document.body.append(shell);
const links = [];
const options = { async save(value) { persisted = structuredClone(value); }, layoutChanged() {}, applyFormControls() {}, openUrl: payload => links.push(payload) };
let sidebar = createShareSidebar(shell, bridge, options);
check(shell.querySelector('.share-sidebar').hidden && listeners.share.size === 0, 'Unpinned sidebar stays hidden and does not subscribe');
const toolbar = document.createElement('button'); document.body.append(toolbar);
const disposeToolbar = setupRemoteSharingControls(toolbar, bridge, () => {}, async (dialog, options) => {
  document.body.append(dialog);
  dialog.addEventListener('close', () => { options.onClose(); dialog.remove(); }, { once: true });
  dialog.showModal();
}, 'share', () => {}, sidebar.pinControl, payload => {
  check(!document.querySelector('.remote-sharing-dialog[open]'), 'Share popup must close before the destination dialog opens');
  links.push(payload);
});
await wait(() => !toolbar.disabled); toolbar.click();
check(document.querySelector('.remote-sharing-dialog .share-pin').textContent === 'Pin to right sidebar', 'Popup starts with a Pin action');
document.querySelector('.remote-sharing-dialog .share-pin').click();
sidebar.restore(undefined);
check(!shell.querySelector('.share-sidebar').hidden, 'A stale navigation snapshot cannot overwrite an in-flight pin');
await wait(() => !document.querySelector('.remote-sharing-dialog')); await tick(); toolbar.click();
check(document.querySelector('.remote-sharing-dialog .share-pin').textContent === 'Unpin from right sidebar', 'Popup shows Unpin while the sidebar is pinned');
document.querySelector('.remote-sharing-dialog .share-pin').click(); await wait(() => !document.querySelector('.remote-sharing-dialog')); await tick();
check(!persisted.pinned && shell.querySelector('.share-sidebar').hidden, 'Popup Unpin removes the sidebar');
toolbar.click(); document.querySelector('.remote-sharing-dialog .share-pin').click(); await wait(() => !document.querySelector('.remote-sharing-dialog')); await tick();
chat.messages = [{ id: 'popup-link', authorId: 'alice', author: 'Alice', createdAt: new Date().toISOString(), text: 'https://example.com/', requestId: 'popup-link' }];
toolbar.click();
await wait(() => document.querySelector('.remote-sharing-dialog .chat-message a'));
document.querySelector('.remote-sharing-dialog [data-share-tab=chat]').click();
document.querySelector('.remote-sharing-dialog .chat-message a').click();
check(links.length === 1 && links[0].sourceId === 'boatyard-share-chat', 'Share dialog forwards links to the destination gate');
await wait(() => !document.querySelector('.remote-sharing-dialog'));
chat.messages = []; links.length = 0;
disposeToolbar(); toolbar.remove();
check(persisted.pinned && !shell.querySelector('.share-sidebar').hidden, 'Share popup can pin the sidebar');
check(listeners.share.size === 1 && listeners.remote.size === 1 && listeners.chat.size === 1, `Pinned sidebar owns one subscription per event: ${JSON.stringify(Object.fromEntries(Object.entries(listeners).map(([name, set]) => [name, set.size])))}`);
const pane = shell.querySelector('.share-pane');
const rail = shell.querySelector('.share-sidebar-rail');
const collapse = rail.querySelector('button');
check(getComputedStyle(pane.querySelector('.share-tabs')).display === 'none' && !shell.querySelector('.share-sidebar-header button'), 'Sidebar uses only the rail tabs and the bottom Unpin control');
const alert = name => rail.querySelector(`[data-alert="${name}"]`);
check(!alert('requests').hidden && !alert('hands').hidden && alert('messages').hidden, 'Live admission and hand alerts start with their current counts');
collapse.click(); await tick();
check(persisted.collapsed && rail.querySelectorAll('[data-sidebar-tab] svg').length === 4, 'Collapsed rail preserves all tab icons');
chat.messages.push({ id: 'one', authorId: 'alice', author: 'Alice', createdAt: new Date().toISOString(), text: 'Hello https://example.com/', requestId: 'one' });
listeners.chat.forEach(callback => callback()); await tick();
check(!alert('messages').hidden && alert('messages').textContent === '1', 'Messages arriving while collapsed remain unread');
check(new Set(['requests', 'hands', 'messages'].map(name => getComputedStyle(alert(name)).color)).size === 3, 'Alerts have distinct colors as well as labels and counts');
shell.querySelector('#project').textContent = 'Second project';
check(shell.querySelector('.share-pane') === pane && !alert('messages').hidden, 'Project navigation leaves the Share view and alerts intact');
alert('hands').click(); await tick();
check(!persisted.collapsed && persisted.tab === 'session' && document.activeElement.closest('.hand-raised'), 'Hand alert opens and focuses the first waiting participant');
alert('requests').click();
check(document.activeElement.closest('[data-join-queue]'), 'Arrival alert opens and focuses approval actions');
document.activeElement.click(); await tick();
check(alert('requests').hidden, 'Handled requests remove their alert');
alert('messages').click(); await tick();
check(persisted.tab === 'chat' && alert('messages').hidden, 'Opening chat clears messages that are displayed');
pane.querySelector('.chat-message a').click();
check(links.length === 1 && links[0].sourceLabel === 'Share chat', 'Sidebar forwards chat links to the destination gate');
const text = pane.querySelector('textarea'); text.value = 'Unsent draft'; text.dispatchEvent(new Event('input'));
collapse.click(); await tick();
chat.messages.push({ id: 'two', authorId: 'alice', author: 'Alice', createdAt: new Date().toISOString(), text: 'Another message', requestId: 'two' });
listeners.chat.forEach(callback => callback()); await tick();
check(!alert('messages').hidden, 'Collapsing the selected Chat tab stops marking messages read');
rail.querySelector('[data-sidebar-tab=setup]').click(); await tick();
check(!alert('messages').hidden && text.value === 'Unsent draft', 'Opening another tab preserves unread messages and the chat draft');
rail.querySelector('[data-sidebar-tab=chat]').click(); await tick();
check(alert('messages').hidden && text.value === 'Unsent draft', 'Returning to chat preserves the draft and reads messages');
rail.querySelector('[data-sidebar-tab=projects]').click(); await tick();
check(persisted.tab === 'projects' && rail.querySelector('[data-sidebar-tab=projects]').getAttribute('aria-pressed') === 'true' && document.activeElement.matches('[data-share-panel=projects]'), 'Rail selection persists the tab and focuses its panel');
rail.querySelector('[data-sidebar-tab=chat]').click(); await tick();
const resizer = shell.querySelector('[role=separator]');
resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await tick();
check(persisted.width === 400, 'Keyboard resizing persists the sidebar width');
check(shell.querySelector('.workspace').getBoundingClientRect().right <= shell.querySelector('.share-sidebar').getBoundingClientRect().left + 1, 'Docked sidebar reserves space outside the workspace');
collapse.click(); await tick();
const saved = structuredClone(persisted);
sidebar.dispose();
check(Object.values(listeners).every(set => set.size === 0), 'Disposal releases all subscriptions');
sidebar = createShareSidebar(shell, bridge, options); sidebar.restore(saved); await tick();
check(shell.querySelector('.share-sidebar').classList.contains('collapsed') && shell.querySelector('[data-sidebar-tab=chat]').getAttribute('aria-pressed') === 'true', 'Recreating the renderer restores pinned, collapsed and selected tab state');
shell.querySelector('.share-sidebar-rail button').click(); await tick();
check(shell.querySelector('[role=separator]').getAttribute('aria-valuenow') === '400', 'Restored sidebar retains its width');
shell.querySelector('.share-sidebar-unpin').click(); await tick();
check(!persisted.pinned && shell.querySelector('.share-sidebar').hidden && mutations === 0 && status.share.listening, 'Unpinning persists without stopping Share');
sidebar.dispose();
window.browserTestResult = 'passed';
