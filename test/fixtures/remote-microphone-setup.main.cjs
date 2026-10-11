const { getRemoteStreamingHost } = require('../../build/main/remoteStreamingHost');
const { RemoteAccessManager } = require('../../build/main/remoteAccessManager');
const { RemoteAccessController } = require('../../build/main/remoteAccessController');
const { RemoteSettingsStore } = require('../../build/main/remoteSettingsStore');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

module.exports = async harness => {
  const host = getRemoteStreamingHost();
  const controller = mode => new RemoteAccessController(new RemoteSettingsStore(join(tmpdir(), `unused-${mode}.json`)), () => {
    throw new Error('Microphone preparation must never start a service.');
  });
  let updates = 0;
  const manager = new RemoteAccessManager({ share: controller('share'), remote: controller('remote') }, () => { updates++; }, host);
  harness.on('closed', () => { void manager.stop(); });
  void (async () => {
    await manager.prepareHostMicrophones('share');
    const sender = host.sender;
    assert.equal(sender.webContents.isAudioMuted(), true, 'Fixture output stays silent');
    await sender.webContents.executeJavaScript(`window.captureRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => { captureRequests++; throw new Error('Unexpected media capture'); };
      navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'desk', label: 'Desk microphone' }]; void 0;`);
    const prepared = await manager.prepareHostMicrophones('share');
    assert.deepEqual(prepared.hostMicrophone.devices, [{ deviceId: 'desk', label: 'Desk microphone' }]);
    const selected = await manager.selectHostMicrophone('share', 'desk');
    assert.equal(selected.hostMicrophone.deviceId, 'desk');
    assert.equal(manager.getStatus('remote').hostMicrophone.deviceId, 'desk');
    for (const mode of ['share', 'remote']) {
      const status = manager.getStatus(mode);
      assert.equal(status.listening, false, 'Device selection does not start a server');
      assert.equal(status.connectedClients, 0);
      assert.equal(status.hostMuted, true);
    }
    assert.equal(host.handlers.size, 0, 'No streaming connection is required');
    assert.equal(await sender.webContents.executeJavaScript('captureRequests'), 0, 'Selection never opens a microphone or camera');
    await assert.rejects(host.setHostMuted(false), /Connect a participant/, 'Unmute still requires a listener');
    assert.ok(updates > 0, 'Idle device changes notify the shared status');
    await manager.stop();
    assert.equal(sender.isDestroyed(), true, 'Shutdown releases the idle audio renderer');
    await harness.webContents.executeJavaScript('window.browserTestResult = "passed"');
  })().catch(async error => {
    console.error(error);
    if (!harness.isDestroyed()) await harness.webContents.executeJavaScript(`throw new Error(${JSON.stringify(error.message)})`);
  });
};
