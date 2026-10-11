const { BrowserWindow, WebContentsView, Menu } = require('electron');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { hashRemotePassword } = require('../../build/main/remotePassword');
const { RemoteAccessService } = require('../../build/main/remoteAccess');
const { WorkspaceWindowRuntime } = require('../../build/main/workspaceWindowRuntime');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async harness => {
  const readOnly = process.env.BOATYARD_REMOTE_FIXTURE_READONLY === '1';
  const multipleWindows = process.env.BOATYARD_REMOTE_FIXTURE_MENU === '1';
  const target = new BrowserWindow({ width: 800, height: 600, frame: process.env.BOATYARD_REMOTE_FIXTURE_MENU === '1', show: true,
    webPreferences: { sandbox: true, backgroundThrottling: false } });
  if (process.env.BOATYARD_REMOTE_FIXTURE_MENU === '1') { target.setMenu(Menu.buildFromTemplate([{ label: 'Fixture', submenu: [{ label: 'Example' }] }])); target.setContentSize(800, 600); }
  await target.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:rgb(20,40,180)"><style>#shortcuts button{position:absolute;left:20px;top:20px;width:100px;height:50px}</style><nav id="shortcuts"></nav><input id="main" style="position:absolute;left:20px;top:90px"><script>window.keys=[];document.addEventListener("keydown",e=>keys.push(e.key))</script>'));
  const shortcutScript = require('esbuild').buildSync({ entryPoints: ['test/fixtures/remote-shortcuts.browser.js'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
  await target.webContents.executeJavaScript(shortcutScript);
  const native = new WebContentsView({ webPreferences: { sandbox: true } });
  const runtime = new WorkspaceWindowRuntime({ id: 'remote-fixture', window: target, openExternalUrl() {},
    store: { getWorkspaceWebAppUrl: () => null, updateWorkspaceWebAppState() {} }, createWebContentsView: () => native });
  const nativeHtml = '<body style="margin:0;background:rgb(20,180,40)"><input id="native" style="position:absolute;left:10px;top:10px;width:180px;height:40px"><script>window.keys=[];document.addEventListener("keydown",e=>keys.push(e.key))</script>';
  const fixtureServer = createServer((_, response) => { response.setHeader('Content-Type', 'text/html'); response.end(nativeHtml); });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${fixtureServer.address().port}/`;
  runtime.setVisibleWebApps(['native']);
  runtime.showWebApp({ key: 'native', url, bounds: { x: 400, y: 120, width: 300, height: 300 }, label: 'Native', projectId: 'fixture' });
  await new Promise(resolve => native.webContents.once('did-finish-load', resolve));
  await sleep(200);
  const iceFile = process.env.BOATYARD_REMOTE_FIXTURE_ICE_FILE;
  let iceRequests = 0;
  const getIceServers = global.remoteFixtureRenewal ? async () => { iceRequests++; return [{ urls: "stun:unused.example:3478" }]; } : iceFile ? async () => JSON.parse(require('node:fs').readFileSync(iceFile, 'utf8')) : undefined;
  let iceTransportPolicy = process.env.BOATYARD_REMOTE_FIXTURE_FORCE_RELAY === "1" ? "relay" : "all";
  let screenAllowed = true, screenRevision = 0, screenFailure = false;
  const service = new RemoteAccessService({ screenState: global.remoteFixturePrivacy ? () => { if (screenFailure) throw new Error("Fixture screen policy unavailable"); return { allowed: screenAllowed, revision: String(screenRevision) }; } : undefined, getIceServers, getIceTransportPolicy: () => iceTransportPolicy, passwordHash: readOnly ? "" : await hashRemotePassword("fixture-password"), readOnly, windows: () => [{ id: 'fixture', window: target }, ...(multipleWindows ? [{ id: 'other-fixture', window: target }] : [])], target: (_, x, y) => runtime.resolveRemoteInputTarget(x, y), canInput: (_, contents) => runtime.isRemoteInputTargetVisible(contents) });
  const connection = () => service.connections.values().next().value;
  const port = await service.start();
  const client = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, backgroundThrottling: false } });
  client.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  harness.on('closed', () => { void service.stop(); fixtureServer.close(); if (!target.isDestroyed()) target.destroy(); if (!client.isDestroyed()) client.destroy(); });
  async function until(expression, label) {
    for (let i = 0; i < 300; i++) { if (await client.webContents.executeJavaScript(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${label}; status=${await client.webContents.executeJavaScript('document.getElementById("status").textContent')}`);
  }
  // Wait for the harness to load before publishing its completion flag.
  void (async () => {
    const invitation = readOnly ? service.server.createReadOnlyInvitation().token : "";
    // Install frame-observation hooks before the authenticated single-window auto-connect.
    const pendingRequests = [], pendingConnections = [];
    client.webContents.session.webRequest.onBeforeRequest({ urls: [`http://127.0.0.1:${port}/api/windows`] }, (_, callback) => pendingRequests.push(callback));
    await client.loadURL(`http://127.0.0.1:${port}/${readOnly ? `#share=${invitation}` : ""}`);
    // Keep input-coordinate fixtures at the source ratio; camera coverage below
    // exercises mismatched ratios explicitly instead of relying on window chrome.
    await client.webContents.executeJavaScript('Object.assign(document.getElementById("surface").style,{width:"800px",height:"600px",flex:"none"})');
    await client.webContents.executeJavaScript(`(() => {const create=RTCPeerConnection.prototype.createDataChannel;RTCPeerConnection.prototype.createDataChannel=function(...args){window.fixturePeer=this;const channel=create.apply(this,args);channel.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.kind==='viewport')window.remoteViewport=message.viewport;});Object.defineProperty(channel,'onmessage',{set(handler){channel.addEventListener('message',event=>{if(window.delayViewport && JSON.parse(event.data).kind==='viewport')setTimeout(()=>handler(event),window.delayViewport);else handler(event);});}});return channel;};})()`);
    if (global.remoteFixtureInputHandover) await client.webContents.executeJavaScript(`(() => {
      const create = RTCPeerConnection.prototype.createDataChannel;
      RTCPeerConnection.prototype.createDataChannel = function(...args) {
        const channel = create.apply(this, args), send = channel.send.bind(channel);
        window.fixtureChannel = channel; window.sentControls = [];
        channel.send = message => { window.sentControls.push(JSON.parse(message)); send(message); };
        return channel;
      };
    })()`);
    if (global.remoteFixtureRenewal) await client.webContents.executeJavaScript(`(() => {
      const schedule = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 10 * 60 * 60 * 1000) { window.renewIce = callback; return schedule(() => {}, delay); }
        return schedule(callback, delay, ...args);
      };
      const answer = RTCPeerConnection.prototype.setRemoteDescription;
      RTCPeerConnection.prototype.setRemoteDescription = async function(...args) {
        await answer.apply(this, args); window.iceAnswers = (window.iceAnswers || 0) + 1;
      };
    })()`);
    client.webContents.session.webRequest.onBeforeRequest(null);
    if (global.remoteFixturePrivacy) client.webContents.session.webRequest.onBeforeRequest({ urls: [`http://127.0.0.1:${port}/api/connect`] }, (_, callback) => pendingConnections.push(callback));
    pendingRequests.forEach(callback => callback({ cancel: false }));
    if (!readOnly) {
      await until('!document.getElementById("login").hidden', "password login");
      await client.webContents.executeJavaScript('document.getElementById("password").value="wrong-password";document.getElementById("login").requestSubmit()');
      await until('!document.getElementById("loginStatus").hidden && document.getElementById("loginStatus").textContent === "Incorrect password."', 'login errors remain visible');
      await client.webContents.executeJavaScript('document.getElementById("password").value="fixture-password";document.getElementById("login").requestSubmit()');
    }
    if (multipleWindows) {
      await until('!document.getElementById("connect").hidden', 'window list');
      assert.equal(await client.webContents.executeJavaScript('document.getElementById("windows").options.length'), 2);
      assert.equal(service.connections.size, 0, 'Multiple windows wait for an explicit choice');
      await client.webContents.executeJavaScript('document.getElementById("connect").requestSubmit()');
    }
    if (readOnly && !await client.webContents.executeJavaScript('location.hash === "" && document.getElementById("login").hidden')) throw new Error('Read-only invitation must clear the fragment and skip password login');
    if (global.remoteFixturePrivacy) {
      await until('document.getElementById("status").textContent === "Connecting…" && !document.getElementById("waitingActivity").hidden', 'long connections show an animated waiting screen');
      await sleep(500);
      assert.ok(pendingConnections.length, 'Signaling remains pending during the waiting animation');
      const waiting = await client.webContents.executeJavaScript(`(() => {
        const panel=document.getElementById('placeholder'),dot=document.querySelector('#waitingActivity i');
        return { visible:getComputedStyle(panel).display !== 'none', image:getComputedStyle(panel,'::before').backgroundImage,
          animation:dot.getAnimations().some(animation=>animation.playState==='running') };
      })()`);
      assert.ok(waiting.visible && waiting.animation && waiting.image.includes('waiting-screen.png'), 'The connection screen reuses the Boatyard illustration and a running animation');
      client.webContents.session.webRequest.onBeforeRequest(null);
      pendingConnections.forEach(callback => callback({ cancel: false }));
    }
    await until('document.getElementById("status").textContent.startsWith("Connected") && document.getElementById("video").videoWidth > 0', 'WebRTC video');
    if (global.remoteFixtureRenewal) {
      const before = connection(), requests = iceRequests;
      iceTransportPolicy = "relay";
      await client.webContents.executeJavaScript('window.renewIce()');
      await until('window.iceAnswers >= 2 && window.fixturePeer.connectionState === "connected"', 'ICE renewal on both peers');
      assert.equal(connection(), before, 'Renewal preserves the streaming session and viewport');
      assert.ok(iceRequests >= requests + 2, 'Both peers request fresh credentials');
      assert.equal(before.iceTransportPolicy, 'all', 'Host keeps the policy captured when the connection started');
      assert.equal(await client.webContents.executeJavaScript('window.fixturePeer.getConfiguration().iceTransportPolicy'), 'all', 'Credential renewal does not apply a newly saved relay policy to an existing viewer');
      iceTransportPolicy = 'all';
    }
    if (iceFile) {
      const relay = await client.webContents.executeJavaScript(`(async () => {
        const peer = window.fixturePeer, stats = await peer.getStats();
        const transport = [...stats.values()].find(value => value.type === 'transport' && value.selectedCandidatePairId);
        const pair = stats.get(transport?.selectedCandidatePairId);
        return { policy: peer.getConfiguration().iceTransportPolicy,
          local: stats.get(pair?.localCandidateId)?.candidateType, remote: stats.get(pair?.remoteCandidateId)?.candidateType };
      })()`);
      assert.equal(relay.policy, process.env.BOATYARD_REMOTE_FIXTURE_FORCE_RELAY === "1" ? "relay" : "all", 'The fixture uses its requested ICE transport policy');
      assert.ok(relay.local && relay.remote, 'Video and controls have a selected connection path');
      if (process.env.BOATYARD_REMOTE_FIXTURE_FORCE_RELAY === '1') assert.equal(relay.local, 'relay', 'TURN trials must actually select the relay');
      if (process.env.BOATYARD_REMOTE_FIXTURE_EXPECT_DIRECT === '1') {
        assert.equal(relay.local, 'host'); assert.equal(relay.remote, 'host');
      }
      console.log('REMOTE_CONNECTION_PATH_VERIFIED', relay);
    }
    await sleep(200);
    await client.webContents.executeJavaScript('document.getElementById("diagnostics").click()');
    await until('/Transport: (Direct|TURN relay)/.test(document.getElementById("diagnosticsPanel").textContent) && /Received video: \\d+ fps/.test(document.getElementById("diagnosticsPanel").textContent) && /Host render \\/ encode: \\d+ fps/.test(document.getElementById("diagnosticsPanel").textContent)', 'live connection diagnostics');
    await until('document.getElementById("diagnosticsPanel").textContent.includes("Sent video: " + document.getElementById("video").videoWidth + " × " + document.getElementById("video").videoHeight)', 'encoded video dimensions match the received stream');
    await until('/Estimated frame age: \\d+ ms/.test(document.getElementById("diagnosticsPanel").textContent)', 'displayed frame age without optional browser capture timestamps');
    await client.webContents.executeJavaScript('document.getElementById("diagnostics").click()');
    await until('!document.getElementById("videoDelay").hidden && /Video delay: \\d+ ms/.test(document.getElementById("videoDelay").textContent)', 'persistent video delay with the diagnostics panel closed');
    assert.equal(await client.webContents.executeJavaScript('getComputedStyle(document.getElementById("videoDelay")).pointerEvents'), 'none', 'Video delay does not intercept viewer gestures');
    if (global.remoteFixtureInputHandover) {
      await require('./remote-input-handover.cjs')({ target, native, client, service, connection, until });
      await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
      await service.stop();
      assert.equal(service.inputObservers.size, 0, 'Stopping Remote removes local input observers');
      fixtureServer.close(); target.destroy(); client.destroy(); return;
    }
    if (global.remoteFixtureRecovery) {
      const original = connection(), sender = original.sender;
      await client.webContents.executeJavaScript('window.originalPeer=window.fixturePeer');
      assert.ok([sender, target, client].every(window => window.webContents.isAudioMuted()), 'Recovery fixtures cannot play through physical speakers');
      // Keep real RTP frames moving, but age their embedded capture times. This
      // exercises the same recovery signal as a queue of obsolete network frames.
      if (global.remoteFixtureInterrupted) {
        await client.webContents.executeJavaScript('window.fixturePeer.close()');
      } else {
        await sleep(Math.max(0, 11000 - await sender.webContents.executeJavaScript('performance.now()')));
        await sender.webContents.executeJavaScript(`(() => {
          const now = performance.now.bind(performance);
          window.delayedFrames = true;
          performance.now = () => now() - (window.delayedFrames && new Error().stack.includes('paint') ? 10000 : 0);
        })()`);
      }
      if (global.remoteFixtureInterrupted) {
        await until('window.fixturePeer !== window.originalPeer', 'automatic transport replacement after interruption');
      } else {
        await until('Number(document.getElementById("videoDelay").textContent.match(/\\d+/)?.[0]) > 9000', 'old frames remain observable');
        await client.webContents.executeJavaScript('document.getElementById("diagnostics").click()');
        await until('Number(document.getElementById("diagnosticsPanel").textContent.match(/Host canvas capture age: (\\d+) ms/)?.[1]) > 9000', 'the host observes old timestamps on the actual canvas track before WebRTC');
        await client.webContents.executeJavaScript('document.getElementById("diagnostics").click()');
        await sleep(4000);
        assert.equal(await client.webContents.executeJavaScript('window.fixturePeer === window.originalPeer'), true, 'Persistent frame delay never interrupts an established transport');
      }
      await sender.webContents.executeJavaScript('window.delayedFrames=false');
      await until('window.fixturePeer.connectionState === "connected" && document.getElementById("surface").classList.contains("live") && Number(document.getElementById("videoDelay").textContent.match(/\\d+/)?.[0]) < 1500', 'replacement catches up to a live frame');
      assert.equal(connection(), original, 'Recovery retains the host session instead of admitting a new participant');
      assert.equal(service.connections.size, 1);
      assert.equal(original.epoch, global.remoteFixtureInterrupted ? 1 : 0);
      assert.equal(original.sender, sender, 'Recovery retains the shared streaming renderer');
      assert.equal(await client.webContents.executeJavaScript('window.originalPeer.connectionState'), global.remoteFixtureInterrupted ? 'closed' : 'connected', 'Only an interrupted transport is replaced');
      assert.equal(await client.webContents.executeJavaScript('window.fixturePeer.getReceivers().every(receiver => receiver.jitterBufferTarget === 0)'), true);
      if (global.remoteFixtureInterrupted) assert.throws(() => service.handle(original, 'transport', { epoch: 0, action: 'closed' }), /Stale streaming transport/, 'Late old-transport callbacks cannot close the recovered session');
      await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
      await service.stop(); fixtureServer.close(); target.destroy(); client.destroy(); return;
    }
    await client.webContents.executeJavaScript('document.getElementById("fit").click()');
    await until('document.getElementById("frame").width === 800', "full resolution");
    await sleep(300);
    if (global.remoteFixturePrivacy) {
      const original = connection();
      const isBlue = `(() => {const f=document.getElementById('frame'),p=f.getContext('2d').getImageData(100,400,1,1).data;return p[2]>120 && p[0]<70;})()`;
      const isBlack = `(() => {const f=document.getElementById('frame'),x=f.getContext('2d');return [[4,4],[100,400],[500,300]].every(([a,b])=>[...x.getImageData(a,b,1,1).data].slice(0,3).every(v=>v<20));})()`;
      await until(isBlue, 'allowed project appears in actual received video');
      await client.webContents.executeJavaScript('window.peerBeforePrivacy=window.fixturePeer');
      assert.equal(await client.webContents.executeJavaScript('getComputedStyle(document.getElementById("placeholder")).display'), 'none', 'Live video hides the connection screen');
      screenAllowed = false; screenRevision++;
      await until(isBlack, 'Hide screen encodes black video including native sibling panes');
      assert.equal(await client.webContents.executeJavaScript('!document.getElementById("screenWaitingCopy").hidden && !document.getElementById("waitingActivity").hidden'), true, 'Private video displays the animated waiting overlay');
      const mediaTime = await client.webContents.executeJavaScript('document.getElementById("video").currentTime');
      await sleep(300);
      assert.ok(await client.webContents.executeJavaScript('document.getElementById("video").currentTime') > mediaTime + .1, 'Black video continues decoding behind the waiting screen');
      if (process.env.BOATYARD_WAITING_SCREENSHOT_PATH) {
        await client.webContents.executeJavaScript('if(!document.getElementById("diagnosticsPanel").hidden)document.getElementById("diagnostics").click();Object.assign(document.getElementById("surface").style,{width:"",height:"",flex:""})');
        client.show(); await sleep(200);
        require('node:fs').writeFileSync(process.env.BOATYARD_WAITING_SCREENSHOT_PATH, (await client.webContents.capturePage()).toPNG());
        client.hide();
      }
      assert.equal(service.handle(original, 'cursor'), null, 'Hidden screens do not expose the physical pointer');
      screenAllowed = true; screenRevision++;
      await until(isBlue, 'Show screen resumes the same peer');
      assert.equal(await client.webContents.executeJavaScript('document.getElementById("screenWaitingCopy").hidden && window.fixturePeer === window.peerBeforePrivacy'), true, 'Waiting ends on the first visible frame without reconnecting');
      screenFailure = true;
      await until(isBlack, 'A failed policy check still sends a decodable black frame');
      screenFailure = false;
      await until(isBlue, 'Policy checks recover without replacing the connection');
      // Announce a private project before repainting the local workspace.
      screenAllowed = false; screenRevision++;
      await target.webContents.executeJavaScript('document.body.style.background="#ff0000"');
      await native.webContents.executeJavaScript('document.body.style.background="#ff0000"');
      await until(isBlack, 'Private project sends black instead of its pixels');
      await sleep(300);
      assert.equal(await client.webContents.executeJavaScript(isBlack), true, 'Black frames continue instead of freezing the previous project');
      await target.webContents.executeJavaScript('document.body.style.background="#1234ee"');
      await native.webContents.executeJavaScript('document.body.style.background="#00cc44"');
      screenAllowed = true; screenRevision++;
      await until(isBlue, 'Returning to an allowed project resumes video');
      assert.equal(connection(), original, 'Privacy controls retain the host session');
      await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
      await service.stop(); fixtureServer.close(); target.destroy(); client.destroy(); return;
    }
    const pixels = await client.webContents.executeJavaScript(`(() => {
      const v=document.getElementById('frame'),c=document.createElement('canvas');c.width=v.width;c.height=v.height;
      const x=c.getContext('2d');x.drawImage(v,0,0);return {width:c.width,height:c.height,blue:[...x.getImageData(100,400,1,1).data],green:[...x.getImageData(500,300,1,1).data],origin:[...x.getImageData(4,4,1,1).data],nativeOrigin:[...x.getImageData(405,125,1,1).data]};})()`);
    assert.equal(pixels.width, 800); assert.equal(pixels.height, 600);
    assert.ok(pixels.blue[2] > 120 && pixels.blue[0] < 70, JSON.stringify(pixels));
    assert.ok(pixels.green[1] > 120 && pixels.green[2] < 70, JSON.stringify(pixels));
    assert.ok(pixels.origin[2] > 120 && pixels.origin[0] < 70, 'Frame begins at the Boatyard content origin: ' + JSON.stringify(pixels));
    assert.ok(pixels.nativeOrigin[1] > 120 && pixels.nativeOrigin[2] < 70, 'Native pane pixels align with its input bounds: ' + JSON.stringify(pixels));
    async function checkNativeOrigin(label) {
      const camera = { ...connection().viewport };
      await until('Number(document.getElementById("frame").dataset.revision) === ' + camera.revision, label + ' rendered crop');
      const pixel = await client.webContents.executeJavaScript(`(() => {const f=document.getElementById('frame');return [...f.getContext('2d').getImageData(Math.floor((405-${camera.x})/${camera.width}*f.width),Math.floor((125-${camera.y})/${camera.height}*f.height),1,1).data];})()`);
      assert.ok(pixel[1] > 120 && pixel[2] < 70, label + ': native pane image shares input coordinates ' + JSON.stringify(pixel));
    }
    const moveMouse = async fraction => client.webContents.executeJavaScript(`(() => {const s=document.getElementById('surface'),r=s.getBoundingClientRect();s.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:'mouse',buttons:0,clientX:r.left+${fraction}*(r.width-1),clientY:r.top+r.height/2,bubbles:true}));})()`);
    const fitCamera = { ...connection().viewport };
    const cameraBounds = ({ x, y, width, height }) => ({ x, y, width, height });
    await moveMouse(.5); await sleep(40); await moveMouse(1); await sleep(100);
    assert.deepEqual(cameraBounds(connection().viewport), cameraBounds(fitCamera), 'The complete window stays visible after mouse movement');
    if (process.env.BOATYARD_REMOTE_FIXTURE_FOLLOW === '1') {
      const { execFileSync } = require('node:child_process');
      const bounds = target.getContentBounds();
      const moveLocal = (x, y) => execFileSync('xdotool', ['mousemove', '--', String(bounds.x + x), String(bounds.y + y)]);
      assert.equal(await client.webContents.executeJavaScript('document.getElementById("followMouse").getAttribute("aria-pressed")'), String(readOnly), 'Only Share follows the mouse by default');
      moveLocal(20, 20);
      await target.webContents.executeJavaScript('document.getElementById("main").focus()');
      if (!readOnly) await until('document.getElementById("followMouse").getAttribute("aria-pressed") === "true"', 'Local movement automatically enables follow on Remote');
      await until('!document.getElementById("localCursor").hidden', 'local cursor in Fit');
      assert.deepEqual(cameraBounds(connection().viewport), cameraBounds(fitCamera), 'Follow preserves the full Fit viewport');
      await client.webContents.executeJavaScript('document.getElementById("zoomIn").click()');
      await until('document.getElementById("frame").width === 640', 'follow zoom');
      await sleep(200);
      assert.equal(connection().viewport.x, 0); assert.equal(connection().viewport.y, 0);
      moveLocal(780, 580);
      await until('window.remoteViewport?.x === 160 && window.remoteViewport?.y === 120', 'follow bottom-right content edge');
      assert.equal(connection().viewport.width, 640); assert.equal(connection().viewport.height, 480);
      assert.equal(await client.webContents.executeJavaScript('document.getElementById("keyboard").disabled'), true, 'Following pauses remote keyboard');
      await client.webContents.executeJavaScript(`(() => {const s=document.getElementById('surface');s.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true}));document.getElementById('text').value='forbidden';document.getElementById('textForm').requestSubmit();s.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));})()`);
      await until('document.getElementById("frame").width < 640 && window.remoteViewport?.x === 224 && window.remoteViewport?.y === 168', 'follow wheel zoom');
      assert.equal(await target.webContents.executeJavaScript('document.getElementById("main").value'), '', 'Following sends no remote text');
      const followed = { ...connection().viewport };
      await moveMouse(.5); await moveMouse(1); await sleep(150);
      assert.deepEqual(connection().viewport, followed, 'Viewer mouse does not fight host following');
      // Move outside the selected window; no desktop coordinates reach the viewer.
      execFileSync('xdotool', ['mousemove', '--', '0', '0']);
      await until('document.getElementById("localCursor").hidden', 'cursor leaves shared content');
      assert.deepEqual(connection().viewport, followed, 'Leaving shared content preserves the camera');
      await client.webContents.executeJavaScript('document.getElementById("followMouse").click()');
      await until('document.getElementById("followMouse").getAttribute("aria-pressed") === "false"', 'explicit follow exit');
      for (let i = 0; i < 50 && connection().following; i++) await sleep(20);
      assert.equal(connection().following, false, 'The host acknowledges remote control before the next local gesture');
      assert.deepEqual(connection().viewport, followed, 'Disabling follow stops host-driven pan');
      assert.equal(await client.webContents.executeJavaScript('document.getElementById("keyboard").disabled'), readOnly, 'Leaving follow restores the session input permissions');
      moveLocal(20, 20); await sleep(150);
      if (!readOnly) await until('document.getElementById("followMouse").getAttribute("aria-pressed") === "true"', 'New local movement takes control again');
      else assert.deepEqual(connection().viewport, followed, 'Share keeps its explicit follow preference');
      await service.stop(); fixtureServer.close(); target.destroy(); client.destroy();
      await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
      return;
    }
    assert.equal(await client.webContents.executeJavaScript('document.getElementById("followMouse").getAttribute("aria-pressed")'), String(readOnly), 'Default follow state matches access mode');
    if (readOnly) await client.webContents.executeJavaScript('document.getElementById("followMouse").click()');
    if (process.env.BOATYARD_REMOTE_FIXTURE_CAMERA === '1') {
      for (const [width, height] of [[400, 600], [600, 300]]) {
        await client.webContents.executeJavaScript(`Object.assign(document.getElementById('surface').style,{width:'${width}px',height:'${height}px'})`);
        await sleep(150);
        const fit = async () => {
          await client.webContents.executeJavaScript('document.getElementById("fit").click()');
          await until('window.remoteViewport?.width === 800 && window.remoteViewport?.height === 600 && document.getElementById("frame").width === 800 && document.getElementById("frame").height === 600', 'full Fit image');
        };
        const visibleSize = () => client.webContents.executeJavaScript(`(() => {
          const f=document.getElementById('frame'),r=document.getElementById('surface').getBoundingClientRect();
          const scale=Math.min(r.width/f.width,r.height/f.height);
          return {width:f.width*scale,height:f.height*scale};
        })()`);
        await fit();
        const before = await visibleSize();
        assert.ok(before.width < width - 10 || before.height < height - 10, 'Fit starts letterboxed');
        await client.webContents.executeJavaScript('document.getElementById("zoomIn").click()');
        await until('document.getElementById("frame").width < 800 || document.getElementById("frame").height < 600', 'zoomed Fit image');
        const after = await visibleSize();
        const axis = before.width < width - 10 ? 'width' : 'height';
        assert.ok(after[axis] > before[axis] + 10, 'Zoom fills previously letterboxed space');
        for (let i=0;i<3;i++) {
          await client.webContents.executeJavaScript('document.getElementById("zoomIn").click()');
          await sleep(100);
        }
        await until(`Math.abs(document.getElementById('frame').width/document.getElementById('frame').height-${width/height}) < .01`, 'zoom fills viewer ratio');
        const filled = await visibleSize();
        assert.ok(Math.abs(filled.width-width)<2 && Math.abs(filled.height-height)<2, 'Zoom removes both bands');
        await fit();
        await client.webContents.executeJavaScript('document.getElementById("fill").click()');
        await until(`Math.abs(document.getElementById('frame').width/document.getElementById('frame').height-${width/height}) < .01`, 'Fill covers viewer ratio');
        const camera = connection().viewport;
        assert.ok(Math.abs(camera.x-(800-camera.width)/2)<1 && Math.abs(camera.y-(600-camera.height)/2)<1, 'Fill centers the cropped source');
        assert.ok(Math.abs(camera.width-800)<1 || Math.abs(camera.height-600)<1, 'Fill retains the entire limiting source axis');
        // Leave room on every edge so source bounds do not constrain the anchor.
        for (let i = 0; i < 2; i++) {
          await client.webContents.executeJavaScript('document.getElementById("zoomIn").click()');
          await sleep(150);
        }
        for (const [deltaY, count] of [[-100, 3], [100, 1]]) {
          const previous = { ...connection().viewport };
          const factor = (deltaY < 0 ? .9 : 1.1) ** count;
          await client.webContents.executeJavaScript(`(() => {
            const s = document.getElementById('surface'), r = s.getBoundingClientRect();
            for (let i = 0; i < ${count}; i++) s.dispatchEvent(new WheelEvent('wheel', {
              clientX: r.left + r.width * .7, clientY: r.top + r.height * .3,
              deltaY: ${deltaY}, altKey: true, bubbles: true, cancelable: true
            }));
          })()`);
          await until(`Math.abs(window.remoteViewport?.width - ${previous.width * factor}) < 1 && Math.abs(document.getElementById('frame').width - ${previous.width * factor}) < 2`, 'cursor-anchored wheel zoom');
          const next = connection().viewport;
          assert.ok(Math.abs(next.x + next.width * .7 - previous.x - previous.width * .7) < 1, 'Alt+wheel preserves the source point under the viewer cursor horizontally');
          assert.ok(Math.abs(next.y + next.height * .3 - previous.y - previous.height * .3) < 1, 'Alt+wheel preserves the source point under the viewer cursor vertically');
        }
        for (const input of ['wheel', 'pinch']) {
          await fit();
          await client.webContents.executeJavaScript(`(() => {
            const s=document.getElementById('surface'),r=s.getBoundingClientRect();
            if ('${input}' === 'wheel') { s.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,altKey:true,bubbles:true,cancelable:true})); return; }
            s.setPointerCapture=()=>{};
            const touch=(type,id,x)=>s.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',button:0,buttons:type==='pointerup'?0:1,clientX:r.left+x*r.width,clientY:r.top+r.height/2,bubbles:true}));
            touch('pointerdown',10,.4); touch('pointerdown',11,.6);
            touch('pointermove',10,.375); touch('pointermove',11,.625);
            touch('pointerup',10,.375); touch('pointerup',11,.625);
          })()`);
          await until('document.getElementById("frame").width < 800 || document.getElementById("frame").height < 600', input+' zoom after Fit');
          assert.ok((await visibleSize())[axis] > before[axis]+10, input+' fills letterboxed space');
        }
      }
      await service.stop(); fixtureServer.close(); target.destroy(); client.destroy();
      await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
      return;
    }
    if (process.env.BOATYARD_REMOTE_FIXTURE_GESTURE === '1') {
      if (!readOnly) await client.webContents.executeJavaScript('document.getElementById("keyboard").click()');
      const motion = client.webContents.executeJavaScript(`(async () => {
        const surface = document.getElementById('surface'), rect = surface.getBoundingClientRect();
        surface.setPointerCapture = () => {};
        // Keep synthetic touch IDs separate from the desktop mouse pointer.
        const touch = (type, id, x) => surface.dispatchEvent(new PointerEvent(type, {
          pointerId:id+10,pointerType:'touch',button:0,buttons:type==='pointerup'?0:1,
          clientX:rect.left+x*rect.width,clientY:rect.top+rect.height/2,bubbles:true,cancelable:true
        }));
        window.gestureActive = true;
        touch('pointerdown',1,.4); touch('pointerdown',2,.6);
        for (let i=1;i<=60;i++) {
          touch('pointermove',1,.4-i*.003); touch('pointermove',2,.6+i*.001);
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        // Keep both fingers held to distinguish live updates from a final flush.
        await new Promise(resolve=>setTimeout(resolve,150));
        window.gestureActive = false;
        touch('pointerup',1,.22); touch('pointerup',2,.66);
      })()`);
      await until('window.gestureActive && document.getElementById("frame").width < 760', 'video zoom while both fingers are moving');
      const first = { ...connection().viewport };
      await until(`window.gestureActive && window.remoteViewport?.width < ${first.width - 20}`, 'successive live gesture crops');
      assert.ok(connection().viewport.x > (800 - connection().viewport.width) / 2, 'Two-finger translation reaches the host in addition to centered zoom');
      await motion;
      if (!readOnly) {
        assert.equal(await client.webContents.executeJavaScript('document.activeElement.id'), 'text', 'Pan and pinch preserve the mobile keyboard input focus');
        await client.webContents.executeJavaScript('document.getElementById("keyboard").click()');
        assert.equal(await client.webContents.executeJavaScript('document.activeElement.id'), 'surface', 'Explicit keyboard dismissal restores video focus');
      }
      await until('Math.abs(window.remoteViewport?.width - 800*.2/.44) < 1', 'final pinch position');
      await service.stop(); fixtureServer.close(); target.destroy(); client.destroy();
      await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
      return;
    }
    if (readOnly) {
      assert.equal(await client.webContents.executeJavaScript('document.getElementById("keyboard").disabled'), true);
      const sender = connection().sender;
      for (const input of [
        { kind: 'text', text: 'forbidden' }, { kind: 'key', action: 'down', key: 'Enter', modifiers: [] },
        { kind: 'pointer', action: 'down', x: .1, y: .1, revision: 0, button: 'left', deltaX: 0, deltaY: 0 }
      ]) {
        const result = await sender.webContents.executeJavaScript(`remoteHost.invoke('input', ${JSON.stringify(input)}, ${JSON.stringify(connection().id)}).then(()=>"accepted",error=>error.message)`);
        assert.match(result, /read-only/);
      }
      assert.equal(await target.webContents.executeJavaScript('window.clicks||0'), 0);
      assert.equal(await native.webContents.executeJavaScript('document.getElementById("native").value'), '');
      await client.webContents.executeJavaScript('document.getElementById("zoomIn").click()');
      await until('document.getElementById("frame").width === 640', 'read-only crop');
      await checkNativeOrigin('read-only zoom');
      await client.webContents.executeJavaScript("document.getElementById('surface').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}))");
      await until('document.getElementById("frame").width < 640', 'read-only plain wheel zoom in');
      await client.webContents.executeJavaScript("window.beforeWheelZoomOut=document.getElementById('frame').width;document.getElementById('surface').dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}))");
      await until('document.getElementById("frame").width > window.beforeWheelZoomOut', 'read-only plain wheel zoom out');
      assert.equal(await target.webContents.executeJavaScript('window.clicks||0'), 0);
      await client.webContents.executeJavaScript('document.getElementById("disconnect").click()');
      await until('document.getElementById("videoDelay").hidden', 'video delay hidden after disconnect');
      assert.equal(await client.webContents.executeJavaScript('document.getElementById("status").textContent'), 'Disconnected', 'Disconnect status is preserved in the video placeholder');
      assert.equal(await client.webContents.executeJavaScript(`(() => {const b=document.querySelector('#connect button'),r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b;})()`), true, 'The one-window reconnect button is accessible');
      await service.stop(); fixtureServer.close(); target.destroy(); client.destroy();
      await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
      return;
    }
    const click = async (x,y,width=800,height=600) => client.webContents.executeJavaScript(`(() => {const box=document.getElementById('frame').getBoundingClientRect(),ratio=document.getElementById('frame').width/document.getElementById('frame').height,scale=Math.min(box.width/ratio,box.height),v={left:box.left+(box.width-scale*ratio)/2,top:box.top+(box.height-scale)/2,width:scale*ratio,height:scale},s=document.getElementById('surface');const p={pointerId:1,pointerType:'mouse',button:0,clientX:v.left+${x}/${width}*v.width,clientY:v.top+${y}/${height}*v.height,bubbles:true};s.dispatchEvent(new PointerEvent('pointerdown',p));s.dispatchEvent(new PointerEvent('pointerup',p));})()`);
    await native.webContents.executeJavaScript(`(() => {
      const scroller = document.createElement('div'); scroller.id = 'wheelScroller';
      scroller.style.cssText = 'position:absolute;left:0;top:80px;width:280px;height:200px;overflow:scroll;background:rgb(220,80,80)';
      scroller.innerHTML = '<div style="width:1000px;height:1000px"></div>';
      document.body.append(scroller); scroller.scrollTop = scroller.scrollLeft = 100;
    })()`);
    await until(`(() => {const f=document.getElementById('frame'),p=f.getContext('2d').getImageData(Math.floor(f.width*450/800),Math.floor(f.height*250/600),1,1).data;return p[0]>150 && p[1]<130;})()`, 'scroll target painted in the displayed video');
    const wheel = async delta => client.webContents.executeJavaScript(`(() => {
      const frame=document.getElementById('frame'),box=frame.getBoundingClientRect();
      const scale=Math.min(box.width/4,box.height/3),width=scale*4,height=scale*3;
      document.getElementById('surface').dispatchEvent(new WheelEvent('wheel',{
        clientX:box.left+(box.width-width)/2+450/800*width,
        clientY:box.top+(box.height-height)/2+250/600*height,
        deltaX:${delta},deltaY:${delta},bubbles:true,cancelable:true
      }));
    })()`);
    await wheel(80);
    for (let attempt=0; attempt<40 && !await native.webContents.executeJavaScript('wheelScroller.scrollTop>100 && wheelScroller.scrollLeft>100'); attempt++) await sleep(50);
    assert.equal(await native.webContents.executeJavaScript('wheelScroller.scrollTop>100 && wheelScroller.scrollLeft>100'), true, 'Positive browser wheel scrolls down and right on the host');
    await native.webContents.executeJavaScript('wheelScroller.scrollTop=wheelScroller.scrollLeft=100');
    await wheel(-80);
    for (let attempt=0; attempt<40 && !await native.webContents.executeJavaScript('wheelScroller.scrollTop<100 && wheelScroller.scrollLeft<100'); attempt++) await sleep(50);
    assert.equal(await native.webContents.executeJavaScript('wheelScroller.scrollTop<100 && wheelScroller.scrollLeft<100'), true, 'Negative browser wheel scrolls up and left on the host');
    await native.webContents.executeJavaScript('wheelScroller.remove()');
    // Synthetic pointers do not support native setPointerCapture.
    await client.webContents.executeJavaScript('document.getElementById("surface").setPointerCapture=()=>{};undefined');
    await click(70,45); await sleep(200);
    assert.equal(await target.webContents.executeJavaScript('window.clicks'), 1);
    assert.equal(await target.webContents.executeJavaScript('window.selectedProject'), 'fixture', 'Actual pinned shortcut selects its project');
    await native.webContents.executeJavaScript('window.dragButtons=[];document.addEventListener("mousemove",e=>dragButtons.push(e.buttons));undefined');
    await click(450,150); await sleep(200);
    await client.webContents.executeJavaScript(`(() => {const box=document.getElementById('frame').getBoundingClientRect(),scale=Math.min(box.width/4,box.height/3),v={left:box.left+(box.width-scale*4)/2,top:box.top+(box.height-scale*3)/2,width:scale*4,height:scale*3},s=document.getElementById('surface');const p={pointerId:1,pointerType:'mouse',button:0,clientX:v.left+450/800*v.width,clientY:v.top+150/600*v.height,bubbles:true};s.dispatchEvent(new PointerEvent('pointerdown',p));s.dispatchEvent(new PointerEvent('pointermove',{...p,clientX:v.left+500/800*v.width}));})()`);
    for (let attempt = 0; attempt < 40 && !(await native.webContents.executeJavaScript('window.dragButtons.includes(1)')); attempt++) await sleep(50);
    assert.ok((await native.webContents.executeJavaScript('window.dragButtons')).includes(1));
    await client.webContents.executeJavaScript(`document.getElementById('surface').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1}));`);
    await click(450,150); await sleep(100);
    await client.webContents.executeJavaScript(`document.getElementById('surface').dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true}));`);
    await sleep(200); assert.equal(await native.webContents.executeJavaScript('document.getElementById("native").value'), 'a');
    await native.webContents.executeJavaScript(`(() => {
      const input=document.getElementById('native'),form=document.createElement('form');
      window.enterSubmissions=0;window.enterEvents=[];
      form.onsubmit=e=>{e.preventDefault();window.enterSubmissions++;};
      input.replaceWith(form);form.append(input);input.focus();
      for(const type of ['keydown','keypress','keyup'])input.addEventListener(type,e=>{if(e.key==='Enter')window.enterEvents.push(type);});
    })()`);
    await client.webContents.executeJavaScript('document.getElementById("keyboard").click()');
    const enterPoint = await client.webContents.executeJavaScript('(() => {const r=document.getElementById("enter").getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()');
    client.webContents.sendInputEvent({ type: 'mouseDown', ...enterPoint, button: 'left', clickCount: 1 });
    client.webContents.sendInputEvent({ type: 'mouseUp', ...enterPoint, button: 'left', clickCount: 1 });
    await sleep(200);
    assert.equal(await native.webContents.executeJavaScript('window.enterSubmissions'), 1, 'Keyboard-panel Enter triggers native form submission');
    assert.equal(await client.webContents.executeJavaScript('document.activeElement.id'), 'text', 'Toolbar actions preserve the mobile keyboard input focus');
    assert.deepEqual(await native.webContents.executeJavaScript('window.enterEvents'), ['keydown','keypress','keyup'], 'Enter sends a complete native key sequence');
    await native.webContents.executeJavaScript("document.getElementById('native').addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault();});undefined");
    await client.webContents.executeJavaScript('document.getElementById("enter").click()');
    await sleep(200);
    assert.equal(await native.webContents.executeJavaScript('window.enterSubmissions'), 1, 'A keydown handler can suppress the default Enter action');
    await client.webContents.executeJavaScript('document.getElementById("keyboard").click()');
    await client.webContents.executeJavaScript(`document.getElementById('surface').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));document.getElementById('surface').dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));`);
    await sleep(200); assert.ok((await native.webContents.executeJavaScript('window.keys')).includes('ArrowLeft'));
    await client.webContents.executeJavaScript(`(() => {let active=false;Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>active?document.body:null});window.testFullscreen=value=>{active=value;document.dispatchEvent(new Event('fullscreenchange'));};testFullscreen(true);})()`);
    assert.equal(await client.webContents.executeJavaScript('document.getElementById("fullscreen").getAttribute("aria-pressed")'), 'true');
    assert.equal(await client.webContents.executeJavaScript('getComputedStyle(document.getElementById("fullscreen")).backgroundColor'), 'rgb(49, 93, 134)');
    await client.webContents.executeJavaScript('testFullscreen(false)');
    assert.equal(await client.webContents.executeJavaScript('document.getElementById("fullscreen").getAttribute("aria-pressed")'), 'false');
    await client.webContents.executeJavaScript('document.getElementById("zoomIn").click()');
    await until('document.getElementById("frame").width === 640', 'server crop');
    assert.equal(await client.webContents.executeJavaScript('document.getElementById("frame").height'), 480);
    await checkNativeOrigin('zoom');
    await click(370, 90, 640, 480); await sleep(100);
    await client.webContents.executeJavaScript(`document.getElementById('surface').dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true}));`);
    await sleep(100);
    assert.ok((await native.webContents.executeJavaScript('document.getElementById("native").value')).includes('b'));
    await moveMouse(.5); await sleep(40); await moveMouse(1);
    for (let i = 0; i < 40 && connection().viewport.x < 160; i++) await sleep(50);
    assert.equal(connection().viewport.x, 160, 'Mouse pan remains available after Fit and zoom');
    await client.webContents.executeJavaScript('document.getElementById("fit").click()');
    await until('document.getElementById("frame").width === 800', 'Fit restores the complete window after pan');
    console.log('REMOTE_VIDEO_AND_INPUT_PASSED', JSON.stringify(pixels));
    await client.webContents.executeJavaScript('document.getElementById("surface").removeAttribute("style")');
    client.setSize(390, 844);
    assert.equal(await client.webContents.executeJavaScript('document.getElementById("surface").classList.contains("fit")'), false, 'Fit is a one-shot camera adjustment');
    await client.webContents.executeJavaScript('document.getElementById("fill").click()');
    await until('document.getElementById("frame").width < document.getElementById("frame").height && document.getElementById("frame").height === 600', 'portrait fill');
    await checkNativeOrigin('portrait fill');
    await sleep(150);
    const camera = connection().viewport;
    await click(450 - camera.x, 150 - camera.y, camera.width, camera.height); await sleep(100);
    await client.webContents.executeJavaScript(`document.getElementById('surface').dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true}));`);
    await sleep(100);
    assert.ok((await native.webContents.executeJavaScript('document.getElementById("native").value')).includes('c'));
    await moveMouse(.5); await sleep(40); await moveMouse(1);
    for (let i = 0; i < 40 && connection().viewport.x < 800 - connection().viewport.width - 1; i++) await sleep(50);
    assert.ok(connection().viewport.x >= 800 - connection().viewport.width - 1, 'Right pointer edge reveals right window edge: ' + JSON.stringify(connection().viewport) + ' status=' + await client.webContents.executeJavaScript('document.getElementById("status").textContent'));
    const stoppedCamera = { ...connection().viewport };
    await sleep(300);
    assert.deepEqual(connection().viewport, stoppedCamera, 'Camera stops when the pointer stops');
    await moveMouse(0);
    for (let i = 0; i < 40 && connection().viewport.x > 0; i++) await sleep(50);
    assert.equal(connection().viewport.x, 0, 'Left pointer edge reveals left window edge');
    await until('Number(document.getElementById("frame").dataset.revision) === ' + connection().viewport.revision, 'client acknowledges the left camera edge');
    await click(70,45,connection().viewport.width,connection().viewport.height);
    for (let i = 0; i < 40 && await target.webContents.executeJavaScript('window.clicks') < 2; i++) await sleep(50);
    assert.equal(await target.webContents.executeJavaScript('window.clicks'), 2, 'Native click coordinates follow the panned camera');
    await client.webContents.executeJavaScript('window.delayViewport=400');
    const displayedRevision = await client.webContents.executeJavaScript('Number(document.getElementById("frame").dataset.revision)');
    await moveMouse(.5); await sleep(40); await moveMouse(1);
    await until('window.remoteViewport.revision > ' + displayedRevision, 'camera update awaiting display');
    // Click the visible draggable project shortcut before the new camera message
    // reaches the viewer. The down/up pair must use the old displayed crop.
    await click(70,45,stoppedCamera.width,stoppedCamera.height);
    for (let i = 0; i < 40 && await target.webContents.executeJavaScript('window.clicks') < 3; i++) await sleep(50);
    assert.equal(await target.webContents.executeJavaScript('window.clicks'), 3, 'Draggable shortcut clicks survive in-flight camera changes');
    await client.webContents.executeJavaScript('window.delayViewport=0');
    if (process.env.BOATYARD_REMOTE_SCREENSHOT) {
      require('node:fs').writeFileSync(process.env.BOATYARD_REMOTE_SCREENSHOT, (await client.capturePage()).toPNG());
    }
    const beforeHiddenInput = await native.webContents.executeJavaScript('document.getElementById("native").value');
    runtime.setVisibleWebApps([]);
    await client.webContents.executeJavaScript(`document.getElementById('surface').dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true}));`);
    await sleep(100);
    assert.equal(await native.webContents.executeJavaScript('document.getElementById("native").value'), beforeHiddenInput);
    await client.webContents.executeJavaScript('document.getElementById("disconnect").click()');
    await sleep(200);
    await client.webContents.executeJavaScript('document.getElementById("connect").requestSubmit()');
    await until('document.getElementById("status").textContent.startsWith("Connected")', 'reconnect after disconnect');
    const closing = connection();
    target.setSize(820, 620);
    await until('document.getElementById("status").textContent.includes("Connection lost")', 'resize stops sharing');
    for (const action of ['closed', 'error']) {
      await closing.sender.webContents.executeJavaScript(`remoteHost.invoke('transport', {epoch:${closing.epoch},action:'${action}',payload:'Late teardown'},${JSON.stringify(closing.id)})`);
    }
    await assert.rejects(() => closing.sender.webContents.executeJavaScript(`remoteHost.invoke('transport', {epoch:${closing.epoch},action:'input',payload:{kind:'text',text:'forbidden'}},${JSON.stringify(closing.id)})`), /Remote connection unavailable/, 'Removed connections still reject input');
    await service.stop(); fixtureServer.close(); target.destroy(); client.destroy();
    await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
  })().catch(error => { console.error(error); require('electron').app.exit(1); });
};
