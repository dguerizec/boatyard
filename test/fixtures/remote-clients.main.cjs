const { BrowserWindow } = require('electron');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { RemoteAccessService } = require('../../build/main/remoteAccess');
const { hashRemotePassword } = require('../../build/main/remotePassword');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async harness => {
  const host = new BrowserWindow({ width: 800, height: 600, frame: false, show: true, webPreferences: { sandbox: true, backgroundThrottling: false } });
  await host.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:rgb(20,40,180)"><input id="input"></body>'));
  const options = { windows: () => [{ id: 'fixture', window: host }], target: (_, x, y) => ({ contents: host.webContents, x, y }), canInput: (_, contents) => contents === host.webContents };
  const iceRequests = { share: 0, remote: 0 };
  const share = new RemoteAccessService({ ...options, passwordHash: '', readOnly: true, getIceServers: async () => { iceRequests.share++; return []; } });
  const remote = new RemoteAccessService({ ...options, passwordHash: await hashRemotePassword('fixture-password'), getIceServers: async () => { iceRequests.remote++; return []; } });
  const sharePort = await share.start(), remotePort = await remote.start();
  const clients = [];
  const cleanup = async () => { await share.stop(); await remote.stop(); clients.forEach(client => { if (!client.isDestroyed()) client.destroy(); }); if (!host.isDestroyed()) host.destroy(); };
  harness.on('closed', () => { void cleanup(); });
  async function until(client, expression, label) {
    for (let i = 0; i < 100; i++) { if (await client.webContents.executeJavaScript(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${label}`);
  }
  async function connect(readOnly, label, partition = `fixture-${randomUUID()}`, existingInvitation) {
    const client = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, backgroundThrottling: false, partition } });
    clients.push(client);
    const invitation = readOnly ? existingInvitation || share.server.createReadOnlyInvitation(label) : null;
    await client.loadURL(`http://127.0.0.1:${readOnly ? sharePort : remotePort}/${invitation ? `#share=${invitation.token}` : ''}`);
    if (readOnly) {
      await until(client, '!document.getElementById("shareJoin").hidden', 'Share join form');
      await client.webContents.executeJavaScript(`document.getElementById('participantName').value=${JSON.stringify(label || 'Fixture guest')};document.getElementById('shareJoin').requestSubmit()`);
    }
    if (!readOnly) {
      await until(client, '!document.getElementById("login").hidden', 'password login');
      await client.webContents.executeJavaScript('document.getElementById("password").value="fixture-password";document.getElementById("login").requestSubmit()');
    }
    await until(client, 'document.getElementById("status").textContent.startsWith("Connected") && document.getElementById("frame").width > 0', 'video');
    await client.webContents.executeJavaScript('if(document.getElementById("followMouse").getAttribute("aria-pressed")==="true")document.getElementById("followMouse").click();document.getElementById("fit").click()');
    await until(client, 'document.getElementById("frame").width === 800 && document.getElementById("frame").height === 600', 'Fit frame');
    const pixel = await client.webContents.executeJavaScript('[...document.getElementById("frame").getContext("2d").getImageData(400,300,1,1).data]');
    assert.ok(pixel[2] > 120 && pixel[0] < 70, 'Viewer receives the selected window image');
    return { client, invitation, partition };
  }
  void (async () => {
    const first = await connect(true, 'Alice'), second = await connect(true, 'Bob'), full = await connect(false, undefined, first.partition);
    assert.equal(await first.client.webContents.executeJavaScript("fetch('/api/windows').then(response=>response.status)"), 200, "Share cookie survives Remote login in the same browser profile");
    assert.equal(await full.client.webContents.executeJavaScript("fetch('/api/windows').then(response=>response.status)"), 200, "Remote cookie is independent");
    assert.equal(share.connections.size, 2); assert.equal(remote.connections.size, 1);
    for (let attempt = 0; attempt < 50 && share.server.getClients().some(client => client.route !== 'direct'); attempt++) await sleep(100);
    assert.deepEqual(share.server.getClients().map(client => client.route), ['direct', 'direct'], 'Each real WebRTC viewer reports its selected direct path to Share');
    assert.ok(iceRequests.share >= 4 && iceRequests.remote >= 2, 'Both services obtain ICE settings for viewers and streaming renderers');
    await first.client.webContents.executeJavaScript('document.getElementById("zoomIn").click()');
    await until(first.client, 'document.getElementById("frame").width < 800', 'Alice crop');
    assert.equal(await second.client.webContents.executeJavaScript('document.getElementById("frame").width'), 800, 'Bob retains his own viewport');
    assert.equal(await full.client.webContents.executeJavaScript('document.getElementById("frame").width'), 800, 'Remote retains its own viewport');
    for (const connection of share.connections.values()) {
      const result = await connection.sender.webContents.executeJavaScript(`remoteHost.invoke('input',{kind:'text',text:'forbidden'},${JSON.stringify(connection.id)}).then(()=> 'accepted',error=>error.message)`);
      assert.match(result, /read-only/);
    }
    await host.webContents.executeJavaScript('document.getElementById("input").focus()');
    const type = async key => full.client.webContents.executeJavaScript(`document.getElementById('surface').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
    await type('z'); await sleep(150);
    assert.equal(await host.webContents.executeJavaScript('document.getElementById("input").value'), 'z', 'Remote controls while spectators stream');
    for (const [index, participant] of [first, second, full].entries()) {
      await participant.client.webContents.executeJavaScript('document.getElementById("raiseHand").click()');
      await until(participant.client, `document.querySelector('#raiseHand span')?.textContent === '${index + 1}'`, 'shared queue arrival position');
    }
    share.setVoiceAllowed(first.invitation.id, true);
    assert.equal(await first.client.webContents.executeJavaScript("document.querySelector('#raiseHand span')?.textContent"), '1', "Permission preserves Alice's hand request");
    assert.equal(await second.client.webContents.executeJavaScript("document.querySelector('#raiseHand span')?.textContent"), '2', "Permission preserves Bob's queue position");
    assert.equal(await full.client.webContents.executeJavaScript("document.querySelector('#raiseHand span')?.textContent"), '3', 'Permission preserves the shared Remote queue position');
    share.floorControl(first.invitation.id);
    await until(first.client, "!document.querySelector('#raiseHand span')", 'Giving Alice the floor consumes her hand request');
    await until(second.client, "document.querySelector('#raiseHand span')?.textContent === '1'", 'Bob advances after Alice receives the floor');
    await until(full.client, "document.querySelector('#raiseHand span')?.textContent === '2'", 'Remote advances in the same queue');
    share.server.revokeClient(second.invitation.id); await sleep(200);
    await until(full.client, "document.querySelector('#raiseHand span')?.textContent === '1'", 'Remote advances after Bob disconnects');
    await full.client.webContents.executeJavaScript('document.getElementById("raiseHand").click()');
    await until(full.client, "!document.querySelector('#raiseHand span')", 'Remote withdraws its request');
    assert.equal(share.connections.size, 1); assert.equal(remote.connections.size, 1);
    assert.equal(await first.client.webContents.executeJavaScript('document.getElementById("status").textContent'), 'Connected · Read-only', 'Revoking Bob leaves Alice connected');
    share.setVoiceAllowed(first.invitation.id, false);
    const replacement = await connect(true, 'Alice', `fixture-${randomUUID()}`, first.invitation);
    await until(first.client, '!document.getElementById("shareJoin").hidden', 'old device returns to explicit join');
    assert.equal(share.connections.size, 1, 'A personal code has only one active stream after takeover');
    assert.equal(share.server.getClients().length, 1, 'Device takeover preserves the same participant');
    assert.equal(share.server.getClients()[0].voice.allowed, false, 'Host microphone restrictions survive a device change');
    assert.equal(share.server.getClients()[0].voice.selfMuted, true, 'The new device starts with its microphone off');
    const guest = replacement.client;
    await until(guest, 'document.querySelector("#microphone .microphone-lock") && document.getElementById("microphone").disabled', 'blocked microphone requires a raised hand');
    const toolbarHeight = await guest.webContents.executeJavaScript('document.querySelector("footer").getBoundingClientRect().height');
    await guest.webContents.executeJavaScript(`
      window.fixtureAudio = new AudioContext();
      const replaceTrack = RTCRtpSender.prototype.replaceTrack;
      RTCRtpSender.prototype.replaceTrack = function(track) {
        if (track?.kind === 'audio') window.fixtureOutgoingTrack = track;
        return replaceTrack.call(this, track);
      };
      navigator.mediaDevices.getUserMedia = async () => {
        window.fixtureMicrophone = fixtureAudio.createMediaStreamDestination().stream;
        return fixtureMicrophone;
      };
      document.getElementById('raiseHand').click();
    `);
    await until(guest, '!document.getElementById("microphone").disabled', 'raised hand enables microphone preparation');
    await guest.webContents.executeJavaScript('document.getElementById("microphone").click()');
    await until(guest, 'document.getElementById("microphone").getAttribute("aria-pressed") === "true" && !document.getElementById("microphone").disabled', 'prepared microphone');
    assert.equal(await guest.webContents.executeJavaScript('fixtureOutgoingTrack.enabled'), false, 'Prepared microphone sends silence while blocked');
    for (let attempt = 0; attempt < 100 && share.server.getClients()[0].voice.selfMuted; attempt++) await sleep(50);
    assert.equal(share.server.getClients()[0].voice.selfMuted, false, 'Host receives the new local microphone intent');
    share.floorControl(first.invitation.id);
    await until(guest, 'fixtureOutgoingTrack.enabled && document.getElementById("raiseHand").getAttribute("aria-pressed") === "false"', 'giving the floor starts prepared microphone and lowers hand');
    assert.equal(await guest.webContents.executeJavaScript('document.querySelector("footer").getBoundingClientRect().height'), toolbarHeight, 'Host block badge does not change toolbar height');
    share.setVoiceAllowed(first.invitation.id, false);
    await until(guest, 'fixtureMicrophone.getAudioTracks()[0].readyState === "ended" && document.getElementById("microphone").getAttribute("aria-pressed") === "false"', 'host block stops capture and resets local intent');
    share.setVoiceAllowed(first.invitation.id, true);
    await until(guest, '!document.querySelector("#microphone .microphone-lock")', 'host restores permission');
    assert.equal(await guest.webContents.executeJavaScript('document.getElementById("microphone").getAttribute("aria-pressed")'), 'false', 'Restoring permission alone cannot reopen private audio');
    share.setVoiceAllowed(first.invitation.id, false);
    await until(guest, 'document.getElementById("microphone").disabled', 'blocked again');
    await guest.webContents.executeJavaScript('document.getElementById("raiseHand").click()');
    await until(guest, 'document.getElementById("raiseHand").getAttribute("aria-pressed") === "true"', 'new turn requested');
    share.floorControl(first.invitation.id);
    await until(guest, 'document.getElementById("raiseHand").getAttribute("aria-pressed") === "false"', 'grant consumes an unattended turn');
    assert.equal(await guest.webContents.executeJavaScript('document.getElementById("microphone").getAttribute("aria-pressed")'), 'false', 'Granting an unattended turn does not activate capture');
    share.setVoiceAllowed(first.invitation.id, false);
    await until(guest, 'document.getElementById("microphone").disabled', 'missed turn must request again');
    await guest.webContents.executeJavaScript('fixtureAudio.close()');
    await sleep(1000);
    assert.equal(await replacement.client.webContents.executeJavaScript('document.getElementById("status").textContent'), 'Connected · Read-only', 'The old device cannot reclaim access automatically');
    assert.equal(remote.connections.size, 1, 'Takeover leaves Remote connected');
    await share.stop(); await sleep(150);
    assert.equal(remote.connections.size, 1, 'Stopping Share keeps Remote alive');
    await type('y'); await sleep(150);
    assert.equal(await host.webContents.executeJavaScript('document.getElementById("input").value'), 'zy', 'Remote still controls after Share stops');
    await cleanup(); await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
  })().catch(async error => { console.error(error); if (!harness.isDestroyed()) await harness.webContents.executeJavaScript(`throw new Error(${JSON.stringify(error.message)})`); });
};
