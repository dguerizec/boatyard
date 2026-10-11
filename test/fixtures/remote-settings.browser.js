import { setupRemoteSharingControls } from '../../src/renderer/remoteSharingControls.js';
import { createRemoteAccessSettingsForms } from '../../src/renderer/remoteSettings.js';
import { cleanupPaneLayout } from '../../src/renderer/paneCleanup.js';
import '../../src/renderer/styles.css';

function check(condition, message) { if (!condition) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
const initial = { enabled: false, port: 47831, publicOrigin: '', readOnly: false, hasPassword: false, listening: false, connectedClients: 0, urls: [], clients: [] };
const current = { remote: { ...initial }, share: { ...initial, port: 47832, readOnly: true } };
const listeners = { remote: new Set(), share: new Set() }, changes = [];
let copied = '', counter = 0;
const emit = mode => {
  if (mode === 'share') current.share.connectedClients = current.share.clients.filter(client => client.state === 'connected').length;
  listeners[mode].forEach(callback => callback(current[mode]));
};
const bridge = {
  async getRemoteStatus(mode = 'remote') { return current[mode]; },
  onRemoteStatusChanged(callback, mode = 'remote') { listeners[mode].add(callback); return () => listeners[mode].delete(callback); },
  async updateRemoteSettings(patch, mode = 'remote') {
    changes.push({ mode, patch });
    const { password, ...settings } = patch;
    current[mode] = { ...current[mode], ...settings, hasPassword: Boolean(password) || current[mode].hasPassword, listening: settings.enabled ?? current[mode].enabled };
    current[mode].urls = current[mode].listening ? [`http://192.0.2.10:${current[mode].port}`] : [];
    if (settings.enabled === false) current[mode].clients = [];
    emit(mode); return current[mode];
  },
  async createReadOnlyShareLink(label) {
    const id = `client-${++counter}`;
    current.share.listening = true; current.share.enabled = true;
    const urls = [`http://192.0.2.10:47832/#share=fixture-${counter}`, `http://192.0.2.20:47832/#share=fixture-${counter}`];
    current.share.clients.push({ id, label: label || '', state: 'invited', urls, code: String(counter).padStart(6, '0') }); emit('share');
    return { id, urls, code: String(counter).padStart(6, '0') };
  },
  async revokeShareClient(id) { current.share.clients = current.share.clients.filter(client => client.id !== id); emit('share'); return current.share; },
  async writeClipboardText(value) { copied = value; }
};
const root = createRemoteAccessSettingsForms(bridge, () => {}); document.body.append(root); await pause();
const [, remote, share] = root.querySelectorAll('section');
const field = (container, name) => container.querySelector(`[name="${name}"]`);
check(!field(remote, 'port').disabled && field(share, 'port').value === '47832', 'Independent server settings load');
check(!field(share, 'password') && !field(remote, 'readOnly'), 'Modes are fixed and Share has no password');
field(remote, 'port').value = '47833'; field(remote, 'password').value = 'fixture-password';
field(remote, 'port').dispatchEvent(new Event('input', { bubbles: true }));
current.remote = { ...current.remote, port: 49000 }; emit('remote');
check(field(remote, 'port').value === '47833', 'Other windows preserve drafts');
remote.querySelector('[data-action=start]').click(); await pause();
check(changes[0].mode === 'remote' && changes[0].patch.password === 'fixture-password' && changes[0].patch.enabled, 'Remote saves its own password and starts');
check(field(remote, 'password').value === '', 'Saved password is cleared');
check(!share.querySelector('[data-action=start]') && !field(share, 'enabled'), 'Share cannot start without creating a client');
share.querySelector('form').requestSubmit(); await pause();
check(changes.at(-1).mode === 'share' && changes.at(-1).patch.enabled === false && !current.share.listening, 'Saving Share settings leaves it stopped');
field(remote, 'password').value = 'unsaved-secret'; cleanupPaneLayout(root);
check(listeners.remote.size === 0 && listeners.share.size === 0 && field(remote, 'password').value === '', 'Disposed forms unsubscribe and clear passwords');
root.remove();
const showDialog = async (dialog, options) => {
  document.body.append(dialog); dialog.addEventListener('close', () => { options.onClose(); dialog.remove(); }, { once: true }); dialog.showModal();
};
let openedSettings = 0;
const remoteButton = document.createElement('button'), shareButton = document.createElement('button');
remoteButton.className = shareButton.className = 'secondary-button';
remoteButton.id = 'remote-access'; shareButton.id = 'remote-sharing'; document.body.append(remoteButton, shareButton);
remoteButton.style.cssText = 'position:fixed;right:150px;top:12px';
shareButton.style.cssText = 'position:fixed;right:60px;top:12px';
const disposeRemote = setupRemoteSharingControls(remoteButton, bridge, () => openedSettings++, showDialog, 'remote');
const disposeShare = setupRemoteSharingControls(shareButton, bridge, () => openedSettings++, showDialog, 'share');
await pause();
check(remoteButton.textContent === 'Remote' && shareButton.textContent === 'Share', 'Toolbar has separate fixed labels');
const remoteWidth = remoteButton.getBoundingClientRect().width, shareWidth = shareButton.getBoundingClientRect().width;
check(remoteButton.classList.contains('sharing-waiting') && getComputedStyle(remoteButton).borderColor === 'rgb(185, 47, 71)' && !remoteButton.classList.contains('sharing-active'), 'Remote waiting has only a red border');
check(!shareButton.classList.contains('sharing-active') && !shareButton.classList.contains('sharing-waiting'), 'Stopped Share has normal appearance');
current.remote.connectedClients = 1; emit('remote');
check(remoteButton.textContent === '1' && remoteButton.classList.contains('sharing-active') && !remoteButton.classList.contains('sharing-waiting') && getComputedStyle(remoteButton).backgroundColor === 'rgb(185, 47, 71)', 'Connected Remote shows count and red background');
check(remoteButton.getBoundingClientRect().width === remoteWidth && remoteButton.getAttribute('aria-label').includes('Remote'), 'Remote count preserves width and accessible name');
current.remote.connectedClients = 0; emit('remote');
check(remoteButton.textContent === 'Remote' && remoteButton.classList.contains('sharing-waiting'), 'Remote disconnection restores waiting label');
const popup = () => document.querySelector('.remote-sharing-dialog');
const closePopup = async () => { popup().close(); for (let attempt = 0; popup() && attempt < 100; attempt++) await pause(); };
remoteButton.click(); await pause();
check(popup().querySelector('[name=password]') && !popup().querySelector('[data-invite]') && !popup().querySelector('[name=port]') && !popup().querySelector('[name=publicOrigin]') && !popup().querySelector('[name=enabled]'), 'Remote popup keeps password and start/stop controls without server settings');
check(Math.abs(popup().getBoundingClientRect().top - remoteButton.getBoundingClientRect().bottom - 8) < 1 && popup().getBoundingClientRect().width <= 380 && popup().getBoundingClientRect().height < 500, 'Remote opens compactly below its toolbar button');
popup().querySelector('[name=password]').value = 'replacement';
popup().querySelector('[data-action=start]').click(); await pause();
check(changes.at(-1).mode === 'remote' && changes.at(-1).patch.password === 'replacement', 'Remote dialog applies its password');
check(changes.at(-1).patch.port === undefined && changes.at(-1).patch.publicOrigin === undefined, 'Starting Remote preserves server settings');
popup().querySelector('[data-action=stop]').click(); await pause();
check(!current.remote.listening, 'Compact Remote controls stop the server');
popup().querySelector('[data-action=start]').click(); await pause();
check(current.remote.listening && current.remote.hasPassword && changes.at(-1).patch.password === '', 'Compact Remote restarts with the existing password');
await closePopup();
shareButton.click(); await pause();
check(popup().querySelector('[data-invite]') && !popup().querySelector('[name=password]'), 'Share dialog manages passwordless clients');
check(popup().querySelector('[data-screen-projects]') && popup().querySelector('[data-share-tab=projects]') && !popup().querySelector('[name=port]') && !popup().querySelector('[name=publicOrigin]'), 'Share links to server settings instead of embedding them');
const shareBounds = popup().getBoundingClientRect();
check(Math.abs(shareBounds.top - shareButton.getBoundingClientRect().bottom - 8) < 1 && shareBounds.width <= 380 && shareBounds.height < 500 && shareBounds.bottom <= window.innerHeight - 12, `Share opens compactly below its toolbar button with audio controls: ${JSON.stringify(shareBounds.toJSON())}`);
for (const selector of ['[data-audio-mode]', '[data-microphone-device]']) {
  const bounds = popup().querySelector(selector).getBoundingClientRect();
  check(bounds.width > 0 && bounds.height > 0 && bounds.left >= shareBounds.left && bounds.right <= shareBounds.right && bounds.top >= shareBounds.top && bounds.bottom <= shareBounds.bottom, 'Compact Share keeps audio settings visible inside the dialog');
}
check(!popup().querySelector('[data-share-panel=session]').hidden && popup().querySelector('[data-share-panel=setup]').hidden, 'Compact Share opens on the session tab');
popup().querySelector('[data-share-tab=setup]').click();
popup().querySelector('[data-start]').click(); await pause();
check(current.share.listening && current.remote.listening, 'Setup starts Share without interrupting Remote');
popup().querySelector('[data-stop]').click(); await pause();
check(!current.share.listening && current.remote.listening, 'Setup stops Share independently');
const invitationPanel = () => popup().querySelector('[data-share-panel=setup]');
const invite = async label => { popup().querySelector('[data-invite] [name=label]').value = label; popup().querySelector('[data-invite]').requestSubmit(); await pause(); };
await invite(''); await invite('');
check(shareButton.textContent === 'Share' && shareButton.classList.contains('sharing-waiting'), 'Invitations do not count as connected viewers');
check(current.share.clients.every(client => client.label === ''), 'Unnamed invitations leave names for participants');
check(!popup().querySelector('[data-share-panel=session] .remote-client-row'), 'Unconnected invitations stay out of the live session');
check(current.remote.listening && current.share.listening && invitationPanel().querySelectorAll('.remote-client-row').length === 2, 'Multiple invites coexist with Remote');
check(invitationPanel().querySelectorAll('.remote-client-row select').length === 2 && invitationPanel().querySelectorAll('.remote-client-row option').length === 4, 'Each client has one address selector');
check(!popup().textContent.includes('fixture-1') && !popup().textContent.includes('fixture-2'), 'Invitation codes stay out of shared video text');
invitationPanel().querySelector('.remote-client-row .remote-urls button').click(); await pause();
check(copied.endsWith('#share=fixture-1'), 'First invitation survives generating a second');
const selector = invitationPanel().querySelector('.remote-client-row select');
selector.value = '1'; selector.dispatchEvent(new Event('change'));
invitationPanel().querySelector('.remote-client-row .remote-urls button').click(); await pause();
check(copied === 'http://192.0.2.20:47832/#share=fixture-1' && invitationPanel().querySelector('.remote-client-row a').href === copied, 'Copy and Open use the selected address with the private code');
current.share.clients[0].state = 'connected'; emit('share');
check(invitationPanel().querySelector('.remote-client-row').textContent.includes('Checking connection…'), 'Pending route is not reported as direct');
current.share.clients[0].route = 'direct'; emit('share');
check(invitationPanel().querySelector('.remote-client-row').textContent.includes('Connected · Direct'), 'Share displays the direct route');
check(shareButton.textContent === '1' && shareButton.classList.contains('sharing-active') && shareButton.getBoundingClientRect().width === shareWidth, 'First connected viewer fills Share without changing width');
current.share.clients[1].state = 'connected'; emit('share');
current.share.clients[1].route = 'relay'; emit('share');
check(invitationPanel().querySelectorAll('.remote-client-row')[1].textContent.includes('Connected · Relayed'), 'Share displays each viewer route independently');
current.share.clients[0].route = 'relay'; emit('share');
check(invitationPanel().querySelector('.remote-client-row').textContent.includes('Connected · Relayed'), 'Route changes update an existing viewer');
check(shareButton.textContent === '2' && shareButton.getBoundingClientRect().width === shareWidth, 'Share displays actual viewer count at fixed width');
check(invitationPanel().querySelector('.remote-client-row').textContent.includes('Connected') && invitationPanel().querySelector('.remote-client-row').querySelector('a'), `Personal links remain available after connection: ${invitationPanel().querySelector('.remote-client-row').textContent}`);
invitationPanel().querySelector('.remote-client-row [data-client-action=revoke]').click(); await pause();
check(current.share.clients.length === 1 && current.share.clients[0].id === 'client-2', 'Revoking one client preserves others');
check(shareButton.textContent === '1', 'Revocation updates the connected count');
current.share.clients[0].state = 'signed-in'; emit('share');
check(current.share.listening && shareButton.textContent === 'Share' && shareButton.classList.contains('sharing-waiting') && !shareButton.classList.contains('sharing-active'), 'Last disconnection keeps Share waiting');
popup().querySelector('[data-stop]').click(); await pause();
check(current.remote.listening && !current.share.listening && !invitationPanel().querySelector('.remote-client-row'), 'Stopping Share removes its clients without stopping Remote');
check(shareButton.textContent === 'Share' && !shareButton.classList.contains('sharing-waiting') && !shareButton.classList.contains('sharing-active') && shareButton.getBoundingClientRect().width === shareWidth, 'Stopping Share restores normal appearance at fixed width');
popup().querySelector('.remote-settings-link').click(); await pause();
for (let attempt = 0; popup() && attempt < 100; attempt++) await pause();
check(!popup() && openedSettings === 1, 'Server settings closes the popup and opens global settings');
await bridge.updateRemoteSettings({ enabled: false }, 'remote');
check(remoteButton.textContent === 'Remote' && !remoteButton.classList.contains('sharing-waiting') && !remoteButton.classList.contains('sharing-active') && remoteButton.getBoundingClientRect().width === remoteWidth, 'Stopping Remote restores normal appearance at fixed width');
disposeRemote(); disposeShare();
check(listeners.remote.size === 0 && listeners.share.size === 0 && openedSettings === 1, 'Both toolbar subscriptions are disposed');
window.browserTestResult = 'passed';
