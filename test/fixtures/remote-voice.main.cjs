const { BrowserWindow } = require('electron');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { RemoteAccessService } = require('../../build/main/remoteAccess');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async harness => {
  const host = new BrowserWindow({ width: 800, height: 600, frame: false, show: true, webPreferences: { sandbox: true, backgroundThrottling: false } });
  await host.loadURL('data:text/html,<body style="background:blue">Voice fixture</body>');
  const share = new RemoteAccessService({ passwordHash: '', readOnly: true, windows: () => [{ id: 'fixture', window: host }], target: (_, x, y) => ({ contents: host.webContents, x, y }), canInput: () => false });
  const port = await share.start(), clients = [];
  const cleanup = async () => { await share.stop(); for (const client of clients) if (!client.isDestroyed()) client.destroy(); if (!host.isDestroyed()) host.destroy(); };
  harness.on('closed', () => { void cleanup(); });
  async function until(check, label) { for (let i = 0; i < 120; i++) { if (await check()) return; await sleep(100); } throw new Error(`Timed out: ${label}`); }
  const evaluate = (client, script) => client.webContents.executeJavaScript(script, true);
  const button = (client, id) => evaluate(client, `document.getElementById('${id}').click()`);
  const level = (client, frequency) => evaluate(client, `(() => { const data = new Float32Array(voiceAnalyser.frequencyBinCount); voiceAnalyser.getFloatFrequencyData(data); const bin = Math.round(${frequency} * voiceAnalyser.fftSize / voiceContext.sampleRate); return Math.max(...data.slice(bin - 2, bin + 3)); })()`);
  async function syntheticMic(client, frequency) {
    await evaluate(client, `window.micRequests = 0; navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints.video !== false) throw new Error('Camera must never be requested');
      window.micRequests++; const context = new AudioContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = ${frequency}; const gain = context.createGain(); gain.gain.value = 0.1; oscillator.connect(gain); gain.connect(destination); oscillator.start(); await context.resume();
      const track = destination.stream.getAudioTracks()[0], stop = track.stop.bind(track); track.stop = () => { stop(); oscillator.stop(); void context.close(); }; window.lastMic = destination.stream; window.lastMicContext = context; return destination.stream;
    }; void 0;`);
  }
  async function connect(label) {
    const invitation = share.server.createReadOnlyInvitation(label);
    const client = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', contextIsolation: false, preload: join(__dirname, 'remote-voice.preload.cjs'), partition: `voice-fixture-${randomUUID()}` } });
    clients.push(client);
    await client.loadURL(`http://127.0.0.1:${port}/#share=${invitation.token}`);
    await until(() => evaluate(client, '!document.getElementById("shareJoin").hidden'), 'Share join form');
    await client.webContents.executeJavaScript('document.getElementById("participantName").value="Fixture guest";document.getElementById("shareJoin").requestSubmit()');
    await until(() => evaluate(client, `!document.getElementById('microphone').disabled && document.getElementById('voiceAudio').srcObject !== null`), 'voice connection');
    await evaluate(client, `window.voiceContext = new AudioContext(); window.voiceAnalyser = voiceContext.createAnalyser(); voiceAnalyser.fftSize = 8192; voiceAnalyser.smoothingTimeConstant = 0; voiceContext.createMediaStreamSource(document.getElementById('voiceAudio').srcObject).connect(voiceAnalyser); voiceContext.resume();`);
    return { client, id: invitation.id };
  }
  void (async () => {
    const alice = await connect('Alice'), bob = await connect('Bob');
    await syntheticMic(alice.client, 397); await syntheticMic(bob.client, 719);
    assert.ok(share.server.getClients().every(client => client.voice.selfMuted), 'All guests start muted');
    assert.equal(share.getHostMuted(), true);
    assert.equal(await evaluate(alice.client, 'micRequests'), 0, 'No guest microphone request at connection');
    const sender = [...share.connections.values()][0].sender;
    assert.ok([host, sender, ...clients].every(window => window.webContents.isAudioMuted()), 'Every fixture window is muted before generating audio');
    await syntheticMic(sender, 1103);
    assert.equal(await evaluate(sender, 'micRequests'), 0, 'Host capture waits for explicit unmute');
    await share.setHostMuted(false);
    await until(async () => await level(alice.client, 1103) > -65 && await level(bob.client, 1103) > -65, 'host voice reaches both guests');
    await button(alice.client, 'microphone'); await button(bob.client, 'microphone');
    await until(async () => await level(alice.client, 719) > -65 && await level(bob.client, 397) > -65, 'guest voices redistributed');
    // Measure a stable mix while confirming the other guest remains audible.
    let excludedSince = null;
    await until(async () => {
      const excluded = await level(alice.client, 397) < -75 && await level(bob.client, 719) < -75;
      const received = await level(alice.client, 719) > -65 && await level(bob.client, 397) > -65;
      if (!excluded || !received) { excludedSince = null; return false; }
      excludedSince ??= Date.now();
      return Date.now() - excludedSince >= 500;
    }, 'both guests receive each other with stable self-exclusion');
    assert.ok(await level(alice.client, 397) < -75, 'Alice does not receive her own voice');
    assert.ok(await level(bob.client, 719) < -75, 'Bob does not receive his own voice');
    share.setVoiceAllowed(alice.id, false);
    await until(() => evaluate(alice.client, `document.getElementById('microphone').disabled`), 'host blocks guest microphone');
    await until(async () => await level(bob.client, 397) < -75, 'blocked guest is excluded from mix');
    // Call admission directly as a malicious client would; the host rejects reopening.
    const connection = [...share.connections.values()][0];
    await assert.rejects(() => evaluate(sender, `remoteHost.invoke('voice', { selfMuted: false }, ${JSON.stringify(connection.id)})`), /Raise your hand before preparing your microphone/);
    // A hostile guest can keep sending RTP, but the host's mixer must still exclude it.
    await evaluate(alice.client, `navigator.mediaDevices.getUserMedia({ video: false }).then(media => voiceFixturePeer.getTransceivers().find(t => t.receiver.track.kind === 'audio').sender.replaceTrack(media.getAudioTracks()[0]))`);
    await sleep(300);
    assert.ok(await level(bob.client, 397) < -75, 'Host gate excludes audio even when a guest bypasses microphone controls');
    await evaluate(alice.client, `lastMic.getTracks().forEach(track => track.stop())`);
    await button(alice.client, 'raiseHand'); await button(bob.client, 'raiseHand');
    await until(() => share.server.getClients().every(client => typeof client.voice.handRaised === 'number'), 'raised hands');
    assert.deepEqual(share.server.getClients().map(client => client.voice.handRaised), [1, 2]);
    share.setVoiceAllowed(alice.id, true);
    await until(() => evaluate(alice.client, `!document.getElementById('microphone').disabled && document.getElementById('raiseHand').getAttribute('aria-pressed') === 'true'`), 'host grants permission without clearing the hand');
    assert.deepEqual(share.server.getClients().map(client => client.voice.handRaised), [1, 2], 'Restoring permission preserves both queue positions');
    assert.equal(await evaluate(alice.client, `document.getElementById('microphone').getAttribute('aria-pressed')`), 'false', 'Granting permission does not activate mic');
    assert.ok(await level(alice.client, 719) > -65, 'Muted guest continues listening');
    share.setVoiceAllowed(null, false);
    await until(() => evaluate(bob.client, `document.getElementById('voiceStatus').textContent.includes('blocked')`), 'mute everyone');
    share.setVoiceAllowed(null, true);
    await until(() => evaluate(bob.client, `!document.getElementById('microphone').disabled`), 'allow everyone');
    assert.ok(share.server.getClients().every(client => client.voice.selfMuted), 'Allow all keeps personal mutes');
    assert.deepEqual(share.server.getClients().map(client => client.voice.handRaised), [1, 2], 'Allow all preserves the queue');
    share.floorControl(alice.id);
    await until(() => evaluate(alice.client, `document.getElementById('raiseHand').getAttribute('aria-pressed') === 'false'`), 'giving the floor clears the selected hand');
    assert.equal(share.server.getClients().find(client => client.id === bob.id).voice.handRaised, 1, 'Giving the floor advances the remaining queue');
    // A host block while permission is pending must discard the eventual microphone.
    await evaluate(alice.client, `navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.resolvePendingMic = resolve; }); void 0;`);
    await button(alice.client, 'microphone');
    await until(() => evaluate(alice.client, `typeof resolvePendingMic === 'function'`), 'pending microphone permission');
    share.setVoiceAllowed(alice.id, false);
    await until(() => evaluate(alice.client, `document.getElementById('voiceStatus').textContent.includes('blocked')`), 'block during permission request');
    share.setVoiceAllowed(alice.id, true);
    await until(() => evaluate(alice.client, `document.getElementById('voiceStatus').textContent.includes('Allowed to speak')`), 'permission restored while capture pending');
    await evaluate(alice.client, `window.pendingContext = new AudioContext(); window.pendingMedia = pendingContext.createMediaStreamDestination().stream; resolvePendingMic(pendingMedia); void 0;`);
    await until(() => evaluate(alice.client, `pendingMedia.getAudioTracks()[0].readyState === 'ended'`), 'late microphone released');
    await evaluate(alice.client, `pendingContext.close()`);
    assert.equal(await evaluate(alice.client, `document.getElementById('microphone').getAttribute('aria-pressed')`), 'false', 'A canceled unmute cannot reopen after permission is restored');
    for (const client of clients) assert.equal(await evaluate(client, 'voiceFixturePeers.length'), 1, 'Audio reuses the original client peer');
    await share.setHostMuted(true);
    await until(async () => await level(alice.client, 1103) < -75, 'host mute stops outgoing audio');
    share.server.revokeClient(bob.id);
    assert.equal(share.connections.size, 1);
    assert.equal(share.getHostMuted(), true);
    await cleanup(); await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
  })().catch(async error => { console.error(error); if (!harness.isDestroyed()) await harness.webContents.executeJavaScript(`throw new Error(${JSON.stringify(error.message)})`); });
};
