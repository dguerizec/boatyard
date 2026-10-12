import { createSharePane } from '../../src/renderer/sharePane.js';
import '../../src/renderer/styles.css';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async (predicate, message) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error(message); };
const invoke = window.chatFixture.invoke;
const bridge = {
  getRemoteStatus: async () => ({ listening: true, clients: [] }),
  getShareChat: id => invoke('read', id), sendShareChat: (id, input) => invoke('send', id, input),
  deleteShareChatMessage: (id, messageId) => invoke('delete', id, messageId), getShareChatImage: (id, messageId) => invoke('image', id, messageId),
  onShareChatChanged: callback => window.chatFixture.subscribe(callback), openExternal() { throw new Error('Chat bypassed the Boatyard link gate'); }
};
const links = [];
const host = createSharePane(bridge, false, { openUrl: payload => links.push(payload) }); host.style.height = '650px'; document.body.append(host);
host.querySelector('[data-share-tab="chat"]').click();
const guest = await invoke('guest', 'Alice');
const evaluate = code => invoke('eval', guest, code);
await wait(() => evaluate(`!document.getElementById('shareJoin').hidden`), 'Join form missing');
await evaluate(`document.getElementById('participantName').value = 'Guest'; document.getElementById('shareJoin').requestSubmit()`);
await wait(() => evaluate(`!document.getElementById('chat').hidden`), 'Client chat unavailable');
await wait(() => evaluate(`document.querySelector('.chat-compose textarea')?.disabled === false`), 'Client conversation still loading');
await evaluate(`document.getElementById('chat').click(); const text = document.querySelector('.chat-compose textarea'); text.value = 'Question https://example.com <script>alert(1)</script>'; text.dispatchEvent(new Event('input')); document.querySelector('.chat-compose').requestSubmit();`);
await wait(() => host.querySelectorAll('.chat-message').length === 1, 'Operator did not receive message');
check(host.querySelector('.chat-message a').href === 'https://example.com/', 'Link not clickable');
const link = host.querySelector('.chat-message a');
for (const event of [new MouseEvent('click', { bubbles: true, cancelable: true }), new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })]) {
  check(!link.dispatchEvent(event) && event.defaultPrevented, 'Chat navigation was not intercepted');
}
check(links.length === 3 && links.every(payload => payload.url === link.href && payload.sourceId === 'boatyard-share-chat' && payload.sourceLabel === 'Share chat' && payload.sourceBounds.width > 0), 'Chat links must use the destination gate with source context');
check(!host.querySelector('.chat-message script'), 'Text was interpreted as HTML');
check(/^\d{2}:\d{2}/.test(host.querySelector('.chat-message time').textContent), 'Compact timestamp missing');
check(host.querySelector('.chat-message time').title && host.querySelector('.chat-day'), 'Full timestamp/date missing');
const textarea = host.querySelector('.chat-compose textarea'); textarea.value = 'Operator answer'; textarea.dispatchEvent(new Event('input')); host.querySelector('.chat-compose').requestSubmit();
await wait(() => evaluate(`document.querySelectorAll('.chat-message').length === 2`), 'Operator answer not broadcast');
const bob = await invoke('guest', 'Bob');
await wait(() => invoke('eval', bob, `!document.getElementById('shareJoin').hidden`), 'Second join form missing');
await invoke('eval', bob, `document.getElementById('participantName').value = 'Guest'; document.getElementById('shareJoin').requestSubmit()`);
await wait(() => invoke('eval', bob, `document.querySelectorAll('.chat-message').length === 2`), 'Late join history missing');
await invoke('reload', bob);
await wait(() => invoke('eval', bob, `document.querySelectorAll('.chat-message').length === 2`), 'History lost after client reload');
const png = await evaluate(`(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); return canvas.toDataURL('image/png').split(',')[1]; })()`);
await evaluate(`const data = Uint8Array.from(atob('${png}'), char => char.charCodeAt(0)); const transfer = new DataTransfer(); transfer.items.add(new File([data], 'screenshot.png', { type: 'image/png' })); document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));`);
await wait(() => evaluate(`!document.querySelector('.chat-preview').hidden`), 'Pasted image preview missing');
await new Promise(resolve => setTimeout(resolve, 550));
await evaluate(`document.querySelector('.chat-compose').requestSubmit()`);
try { await wait(() => host.querySelectorAll('.chat-message').length === 3, 'Pasted image not delivered'); } catch (error) { throw new Error(`${error.message}: ${await evaluate(`document.querySelector('.chat-status').textContent`)}`); }
await wait(() => host.querySelector('.chat-image img')?.naturalWidth === 2, 'Archived image did not load');
host.querySelector('.chat-image').click(); check(host.querySelector('dialog').open, 'Image enlargement unavailable'); host.querySelector('dialog button').click();
check(await evaluate(`document.querySelectorAll('.chat-delete').length === 0`), 'Guest can moderate');
const removed = host.querySelector('.chat-message:last-child').dataset.messageId;
host.querySelector('.chat-message:last-child .chat-delete').click();
await wait(() => evaluate(`document.querySelectorAll('.chat-message').length === 2`), 'Deletion not broadcast');
check(!(await invoke('read')).messages.some(message => message.id === removed), 'Deletion not permanent');
await invoke('narrow', guest);
check(await evaluate(`getComputedStyle(document.getElementById('surface')).display === 'none' && document.getElementById('chatPanel').getBoundingClientRect().width > 300`), 'Mobile chat layout broken');
await evaluate(`document.querySelector('.client-chat-heading button').click()`);
check(await evaluate(`getComputedStyle(document.getElementById('surface')).display !== 'none'`), 'Cannot return to video on mobile');
// Draft/focus survive new messages and tab switches.
textarea.value = 'Unsent draft'; textarea.dispatchEvent(new Event('input')); textarea.focus();
const current = await invoke('read'); await invoke('send', current.activeId, { text: 'Another answer', requestId: 'another-operator-message-123' });
await wait(() => host.querySelectorAll('.chat-message').length === 3, 'Host refresh missing');
check(textarea.value === 'Unsent draft' && document.activeElement === textarea, 'Live update lost draft or focus');
host.querySelector('[data-share-tab="session"]').click();
await invoke('send', current.activeId, { text: 'Unread', requestId: 'unread-operator-message-123' });
await wait(() => !host.querySelector('.share-chat-badge').hidden, 'Unread badge missing');
host.querySelector('[data-share-tab="chat"]').click(); check(host.querySelector('.share-chat-badge').hidden, 'Unread badge not cleared');
await invoke('stop');
const archive = await invoke('read', current.activeId); check(archive.session.endedAt && archive.messages.length === 4, 'Archive lost after restart');
await wait(() => host.querySelector('.chat-status').textContent === 'Archived conversation', 'Operator archive view missing');
check(host.querySelector('textarea').disabled, 'Archived conversation still accepts messages');
check(host.querySelector('.chat-archive select').options.length === 2, 'Archive selector missing');
const selection = host.querySelector('.chat-archive select'); selection.value = current.activeId; selection.dispatchEvent(new Event('change'));
await wait(() => host.querySelectorAll('.chat-message').length === 4, 'Cannot consult archived messages');
host.querySelector('.chat-message a').click();
check(links.length === 4, 'Archived chat links must use the same gate');
await host.boatyardCleanup();
window.browserTestResult = 'passed';
