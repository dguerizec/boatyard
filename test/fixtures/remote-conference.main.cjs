const { app, BrowserWindow } = require('electron');
const { RemoteAccessService } = require('../../build/main/remoteAccess');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async harness => {
  app.on('browser-window-created', (_, window) => {
    window.webContents.on('console-message', event => { if (event.level === 'error') console.error('Fixture renderer:', event.message); });
  });
  const host = new BrowserWindow({ show: true, frame: false, width: 600, height: 400, webPreferences: { sandbox: true } });
  await host.loadURL('data:text/html,' + encodeURIComponent('<body>Conference fixture<div id=frame></div><script>let n=0;setInterval(()=>document.getElementById("frame").textContent=++n,100)</script>'));
  // Two independent services exercise the shared Share/Remote conference policy.
  const services = [0, 1].map(() => new RemoteAccessService({ passwordHash: '', readOnly: true,
    windows: () => [{ id: 'fixture', window: host }], target: (_, x, y) => ({ contents: host.webContents, x, y }), canInput: () => false }));
  const clients = [];
  const evaluate = (client, script) => client.webContents.executeJavaScript(script, true);
  const until = async (check, label) => {
    for (let attempt = 0; attempt < 300; attempt++) { if (await check()) return; await sleep(50); }
    const status = await Promise.all(clients.map(client => evaluate(client, 'document.getElementById("status").textContent')));
    throw new Error(`Conference fixture timed out: ${label}: ${JSON.stringify(status)}`);
  };
  const click = (client, id) => evaluate(client, `document.getElementById(${JSON.stringify(id)}).click()`);
  const snapshot = (service, id) => service.server.getClients().find(client => client.id === id).voice;
  const cleanup = async () => {
    for (const service of services) await service.stop();
    for (const client of clients) if (!client.isDestroyed()) client.destroy();
    if (!host.isDestroyed()) host.destroy();
  };
  harness.on('closed', () => { void cleanup(); });
  void (async () => {
    const [share, remote] = services;
    const port = await share.start(); await remote.start();
    const invitation = share.server.createReadOnlyInvitation('Alice');
    const client = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required', partition: `conference-${randomUUID()}` } });
    clients.push(client);
    await client.loadURL(`http://127.0.0.1:${port}/#share=${invitation.token}`);
    await until(() => evaluate(client, '!document.getElementById("shareJoin").hidden'), 'join form');
    await evaluate(client, 'document.getElementById("participantName").value="Alice";document.getElementById("shareJoin").requestSubmit()');
    await until(() => evaluate(client, '!document.getElementById("raiseHand").disabled'), 'voice connection');
    await evaluate(client, 'window.micRequests = 0; navigator.mediaDevices.getUserMedia = async () => { window.micRequests++; throw new Error("Unexpected microphone capture"); }; void 0;');
    const sender = [...share.connections.values()][0].sender;
    assert.equal(sender.webContents.isAudioMuted(), true, 'Host fixture output stays silent');
    await evaluate(sender, `window.hostMicRequests = []; window.fixtureDevices = [{ kind: 'audioinput', deviceId: 'desk', label: 'Desk microphone' }, { kind: 'audioinput', deviceId: 'headset', label: 'Headset' }];
      navigator.mediaDevices.enumerateDevices = async () => fixtureDevices;
      const captureDesktop = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (constraints.video !== false) {
          if (constraints.audio !== false || constraints.video?.mandatory?.chromeMediaSource !== 'desktop') throw new Error('No camera capture');
          return captureDesktop(constraints);
        }
        hostMicRequests.push(constraints); window.fixtureContext ??= new AudioContext();
        return fixtureContext.createMediaStreamDestination().stream;
      };
      navigator.mediaDevices.dispatchEvent(new Event('devicechange')); void 0;`);
    await until(() => share.getHostMicrophone().devices.length === 2, 'host device list');
    await share.setHostMicrophoneDevice('desk');
    assert.equal(share.getHostMuted(), true, 'Device selection retains mute');
    assert.equal(remote.getHostMicrophone().deviceId, 'desk', 'Share and Remote share one selected host microphone');
    assert.equal(await evaluate(sender, 'hostMicRequests.length'), 0);
    await share.setHostMuted(false);
    assert.equal(await evaluate(sender, 'hostMicRequests.at(-1).audio.deviceId.exact'), 'desk');
    await remote.setHostMicrophoneDevice('headset');
    assert.equal(await evaluate(sender, 'hostMicRequests.at(-1).audio.deviceId.exact'), 'headset');
    assert.equal(share.getHostMicrophone().deviceId, 'headset');
    await evaluate(sender, `fixtureDevices = fixtureDevices.filter(device => device.deviceId !== 'desk'); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); void 0;`);
    await until(() => remote.getHostMicrophone().devices.length === 1, 'device removal');
    await assert.rejects(share.setHostMicrophoneDevice('desk'), /unavailable/);
    assert.equal(share.getHostMuted(), false, 'A failed device switch retains the active microphone');
    assert.equal(share.getHostMicrophone().deviceId, 'headset');
    await share.setHostMuted(true);
    await share.setHostMicrophoneDevice('');
    await evaluate(sender, 'fixtureContext.close()');
    share.setAudioMode('speaker-only');
    assert.equal(remote.getAudioMode(), 'speaker-only');
    await until(() => evaluate(client, 'document.getElementById("microphone").title.includes("Speaker only") && document.getElementById("microphone").disabled'), 'speaker-only policy');
    await click(client, 'raiseHand');
    await until(() => snapshot(share, invitation.id).handRaised === 1, 'hand queue');
    share.floorControl(invitation.id);
    await until(() => evaluate(client, 'document.getElementById("voiceStatus").textContent.includes("You have the floor")'), 'floor notification');
    assert.equal(snapshot(share, invitation.id).selfMuted, true);
    share.setAudioMode('qa');
    await click(client, 'raiseHand');
    await until(() => snapshot(share, invitation.id).handRaised === 1, 'Q&A hand');
    share.floorControl(invitation.id);
    share.setVoiceAllowed(null, false); share.setVoiceAllowed(null, true);
    assert.equal(share.getAudioMode(), 'qa', 'Manual moderation retains the mode');
    share.floorControl(invitation.id);
    share.floorControl(null);
    assert.equal(snapshot(share, invitation.id).allowed, false);
    await click(client, 'disconnect');
    await until(() => share.server.getConnectedClientCount() === 0, 'guest disconnect');
    await evaluate(client, 'document.getElementById("connect").requestSubmit()');
    await until(() => share.server.getConnectedClientCount() === 1 && snapshot(share, invitation.id), 'guest reconnect');
    assert.equal(snapshot(share, invitation.id).allowed, false, 'Reconnection cannot restore stale permission');
    assert.equal(snapshot(share, invitation.id).selfMuted, true);
    await until(() => evaluate(client, 'document.getElementById("microphone").title.includes("Q&A")'), 'restored policy');
    share.setAudioMode('open-discussion');
    await until(() => evaluate(client, 'document.getElementById("microphone").title.includes("Open discussion") && !document.getElementById("microphone").disabled'), 'discussion policy');
    assert.equal(snapshot(share, invitation.id).selfMuted, true);
    assert.equal(await evaluate(client, 'micRequests'), 0, 'Host actions never request guest microphone access');
    assert.equal(client.webContents.isAudioMuted(), true, 'Fixture output stays silent');
    share.setAudioMode('qa'); await share.stop();
    assert.equal(remote.getAudioMode(), 'qa', 'Stopping Share retains the running Remote conference');
    await cleanup();
    await harness.webContents.executeJavaScript('window.browserTestResult = "passed"');
  })().catch(async error => {
    console.error(error);
    if (!harness.isDestroyed()) await harness.webContents.executeJavaScript(`throw new Error(${JSON.stringify(error.message)})`);
  });
};
