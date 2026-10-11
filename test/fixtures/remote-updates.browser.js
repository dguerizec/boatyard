import { startRemoteClientUpdates } from '../../src/renderer/remote/clientUpdates.js';

const assert = (value, message) => { if (!value) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
Object.defineProperty(document, 'hidden', { configurable: true, value: false });
const button = document.createElement('button'); button.hidden = true; document.body.append(button);
let version = 'loaded', unavailable = false, requests = 0, reloaded = 0, installPrompts = 0;
window.fetch = async (url, options) => {
  assert(url === '/api/client-version' && options.cache === 'no-store', 'Update check bypasses the browser cache');
  assert(options.credentials === 'same-origin', 'Update check remains on its own origin');
  requests++;
  if (unavailable) throw new Error('Offline fixture');
  return { ok: true, json: async () => ({ version }) };
};
let connected = true;
const updates = startRemoteClientUpdates({ version: 'loaded', installButton: button,
  isConnected: () => connected, reload: () => { reloaded++; } });
const invitation = new Event('beforeinstallprompt', { cancelable: true });
invitation.prompt = async () => { installPrompts++; };
window.dispatchEvent(invitation);
assert(invitation.defaultPrevented && !button.hidden, 'Offer installation only when the browser allows it');
button.click(); await sleep(10);
assert(installPrompts === 1 && button.hidden, 'Install button invokes the browser prompt once');
version = 'updated';
window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online'));
await sleep(60); await updates.check();
assert(requests === 0 && reloaded === 0, 'No polling or reload interrupts a connected stream');
connected = false; version = 'loaded';
assert(await updates.check() === false && reloaded === 0, 'Unchanged version permits reconnection');
unavailable = true; await updates.check();
assert(reloaded === 0, 'Network failures preserve the existing viewer');
unavailable = false; version = 'updated';
await Promise.all([updates.check(), updates.check()]);
assert(reloaded === 1, 'Concurrent reconnect checks reload only once');
updates.stop(); const stoppedRequests = requests;
await updates.check();
assert(requests === stoppedRequests, 'Disposal stops explicit checks');
window.browserTestResult = 'passed';
