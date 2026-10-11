import { createWebrtcSettingsForm } from '../../src/renderer/webrtcSettings.js';
import { remotePeerConfiguration, waitForRemoteIce } from '../../src/shared/remoteIce.js';
import { cleanupPaneLayout } from '../../src/renderer/paneCleanup.js';
import '../../src/renderer/styles.css';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
let settings = { provider: 'cloudflare', keyId: 'a'.repeat(32), hasApiToken: true, authentication: 'fixed', username: '', urls: [], hasPassword: false, hasSharedSecret: false }, listener, patch, fail = false;
const bridge = {
  async getWebrtcSettings() { return settings; },
  onWebrtcSettingsChanged(callback) { listener = callback; return () => { listener = null; }; },
  async updateWebrtcSettings(value) { patch = value; if (fail) throw new Error('Fixture save failed'); settings = { ...settings, ...value }; listener(settings); return settings; },
  async getWebrtcTestServers() { return []; }
};
const root = createWebrtcSettingsForm(bridge, () => {}); document.body.append(root); await pause();
const form = root.querySelector('form'), field = name => form.elements.namedItem(name), status = root.querySelector('[role=status]');
check(field('provider').value === 'cloudflare' && field('apiToken').value === '' && root.querySelector('[data-secret=apiToken]').textContent.includes('Secret is set'), 'Migrated Cloudflare is visible with a masked secret');
field('keyId').value = 'b'.repeat(32); field('keyId').dispatchEvent(new Event('input', { bubbles: true }));
listener({ ...settings, keyId: 'c'.repeat(32) });
check(field('keyId').value === 'b'.repeat(32), 'Background changes preserve a dirty draft');
check(root.querySelector('[data-test]').disabled, 'Unsaved settings cannot be tested');
field('apiToken').value = 'fixture-secret'; fail = true; form.requestSubmit(); await pause();
check(field('apiToken').value === 'fixture-secret' && !root.querySelector('[role=alert]').hidden, 'Save failure preserves draft and shows error');
fail = false; form.requestSubmit(); await pause();
check(patch.apiToken === 'fixture-secret' && field('apiToken').value === '', 'Saving clears the secret input');
field('provider').value = 'custom'; field('provider').dispatchEvent(new Event('change', { bubbles: true }));
check(!root.querySelector('[data-custom]').hidden && root.querySelector('[data-cloudflare]').hidden, 'Provider selection shows the appropriate fields');
field('authentication').value = 'temporary'; field('authentication').dispatchEvent(new Event('change', { bubbles: true }));
check(!root.querySelector('[data-temporary]').hidden && root.querySelector('[data-fixed]').hidden, 'Temporary authentication shows the shared secret');
field('urls').value = '# UDP relay\nturn:example:3478 # Active\n\n# turns:example:5349?transport=tcp';
field('forceRelay').checked = true; field('forceRelay').dispatchEvent(new Event('change', { bubbles: true }));
form.requestSubmit(); await pause();
check(patch.urls.join('\n') === field('urls').value && patch.urls.includes(''), 'Saving preserves comments and empty lines');
check(patch.forceRelay === true && patch.authentication === 'temporary', 'Relay policy saves with temporary authentication');
listener({ ...settings, forceRelay: false });
check(!field('forceRelay').checked, 'Clean relay policy follows settings changes');
field('forceRelay').checked = true; field('forceRelay').dispatchEvent(new Event('change', { bubbles: true }));
listener({ ...settings, forceRelay: false });
check(field('forceRelay').checked, 'Background changes preserve the relay policy draft');
field('provider').value = 'direct'; field('provider').dispatchEvent(new Event('change', { bubbles: true })); form.requestSubmit(); await pause();
check(patch.forceRelay === false && root.querySelector('[data-relay]').hidden, 'Direct-only provider disables forced relay');
root.querySelector('[data-test]').click(); await pause();
check(status.textContent.includes('no TURN relay configured'), 'Direct-only test does not claim connectivity');
const NativePeer = window.RTCPeerConnection;
let closed = false;
window.RTCPeerConnection = class {
  createDataChannel() {}
  async createOffer() { return {}; }
  async setLocalDescription() { this.onicecandidate?.({ candidate: { type: 'relay' } }); }
  close() { closed = true; }
};
bridge.getWebrtcTestServers = async () => [{ urls: 'turn:example:3478', username: 'fixture', credential: 'fixture' }];
root.querySelector('[data-test]').click(); await pause();
check(closed && status.textContent.includes('allocated a relay candidate'), 'Relay test reports allocation and closes its peer');
window.RTCPeerConnection = NativePeer;
field('sharedSecret').value = 'unsaved-secret'; cleanupPaneLayout(root);
check(listener === null && field('sharedSecret').value === '', 'Disposal unsubscribes and clears secrets');
root.remove();

// A real browser must not silently gather direct candidates in relay-only mode.
const relayPeer = new RTCPeerConnection(remotePeerConfiguration([], 'relay'));
try {
  relayPeer.createDataChannel('relay-only-fixture');
  await relayPeer.setLocalDescription(await relayPeer.createOffer());
  try { await waitForRemoteIce(relayPeer, 100); } catch (error) {
    check(error.message.includes('without a usable connection candidate'), 'Missing TURN fails explicitly');
  }
  check(!/^a=candidate:.* typ (host|srflx)(?:\s|$)/m.test(relayPeer.localDescription.sdp), 'Relay-only peers cannot fall back to direct candidates');
} finally { relayPeer.close(); }
window.browserTestResult = 'passed';
