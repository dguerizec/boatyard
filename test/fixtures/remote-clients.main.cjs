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
  async function connect(readOnly, label, partition = `fixture-${randomUUID()}`) {
    const client = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, backgroundThrottling: false, partition } });
    clients.push(client);
    const invitation = readOnly ? share.server.createReadOnlyInvitation(label) : null;
    await client.loadURL(`http://127.0.0.1:${readOnly ? sharePort : remotePort}/${invitation ? `#share=${invitation.token}` : ''}`);
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
    share.server.revokeClient(second.invitation.id); await sleep(200);
    assert.equal(share.connections.size, 1); assert.equal(remote.connections.size, 1);
    assert.equal(await first.client.webContents.executeJavaScript('document.getElementById("status").textContent'), 'Connected · Read-only', 'Revoking Bob leaves Alice connected');
    await share.stop(); await sleep(150);
    assert.equal(remote.connections.size, 1, 'Stopping Share keeps Remote alive');
    await type('y'); await sleep(150);
    assert.equal(await host.webContents.executeJavaScript('document.getElementById("input").value'), 'zy', 'Remote still controls after Share stops');
    await cleanup(); await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
  })().catch(async error => { console.error(error); if (!harness.isDestroyed()) await harness.webContents.executeJavaScript(`throw new Error(${JSON.stringify(error.message)})`); });
};
