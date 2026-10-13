const { BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { RemoteAccessService } = require('../../build/main/remoteAccess');
const { ShareAccessState } = require('../../build/main/shareAccessState');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async harness => {
  const root = mkdtempSync(join(tmpdir(), 'boatyard-share-reconnect-'));
  const file = join(root, 'share-access.json');
  const target = new BrowserWindow({ show: true, width: 800, height: 600, webPreferences: { sandbox: true } });
  await target.loadURL('data:text/html,<title>Shared fixture</title><body style="background:navy">Shared window</body>');
  const client = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  let access = new ShareAccessState(undefined, file), service, port = 0, windowId = 'before-restart';
  const boot = async () => {
    service = new RemoteAccessService({ passwordHash: '', readOnly: true, shareAccess: access, host: '127.0.0.1', port,
      windows: () => [{ id: windowId, window: target }],
      target: (_, x, y) => ({ contents: target.webContents, x, y }), canInput: () => false });
    port = await service.start();
  };
  await boot();
  const origin = `http://127.0.0.1:${port}`;
  const requests = [];
  client.webContents.session.webRequest.onCompleted({ urls: [`${origin}/api/*`] }, details => { requests.push({ path: new URL(details.url).pathname, status: details.statusCode }); });
  const evaluate = expression => client.webContents.executeJavaScript(expression);
  const until = async (predicate, label) => {
    console.log(`Share reconnect: waiting for ${label}`);
    for (let attempt = 0; attempt < 700; attempt++) { if (await predicate()) return; await sleep(50); }
    // Reading a crashed renderer can leave executeJavaScript pending indefinitely.
    const crashed = client.webContents.isCrashed();
    const status = crashed ? 'renderer crashed' : await evaluate('document.getElementById("status")?.textContent ?? document.body?.textContent');
    const intent = crashed ? 'unavailable' : await evaluate('(() => { try { return sessionStorage.getItem("boatyard-stream-active"); } catch (error) { return error.message; } })()');
    throw new Error(`Share reconnect timed out: ${label}; url=${client.webContents.getURL()}; status=${status}; intent=${intent}; clients=${JSON.stringify(service.server.getClients())}; requests=${JSON.stringify(requests.slice(-15))}`);
  };
  const connected = () => until(async () => service.server.getClients().some(client => client.state === 'connected') &&
    await evaluate('document.getElementById("status").textContent.startsWith("Connected") && document.getElementById("video").videoWidth > 0'), 'live video');
  const joinClient = async code => {
    await evaluate(`document.getElementById('accessCode').value=${JSON.stringify(code)};document.getElementById('participantName').value='Alice';document.getElementById('shareJoin').requestSubmit()`);
    await connected();
  };
  harness.on('closed', () => {
    void service.stop().finally(() => rmSync(root, { recursive: true, force: true }));
    if (!client.isDestroyed()) client.destroy();
    if (!target.isDestroyed()) target.destroy();
  });
  void (async () => {
    const invitation = service.server.createReadOnlyInvitation('Alice');
    const unused = service.server.createReadOnlyInvitation('Unused');
    await client.loadURL(`${origin}/#share=${invitation.token}`);
    await until(() => evaluate('!document.getElementById("shareJoin").hidden'), 'initial join form');
    await joinClient(invitation.token);
    const identity = service.server.getClients().find(client => client.state === 'connected').id;
    const reloadStarted = Date.now();
    let loaded = new Promise(resolve => client.webContents.once('did-finish-load', resolve));
    client.reload(); await loaded;
    await connected();
    assert.ok(Date.now() - reloadStarted < 14000, 'Reload reconnects before the old 15-second transport retention expires');
    assert.equal(service.server.getClients().find(client => client.state === 'connected').id, identity, 'Reload keeps participant identity');
    const clientURL = client.webContents.getURL();
    console.log('Share reconnect: terminating guest renderer');
    const rendererPid = client.webContents.getOSProcessId();
    assert.ok(rendererPid > 0, 'Guest renderer has a live process');
    assert.notEqual(rendererPid, harness.webContents.getOSProcessId(), 'Guest renderer is separate from the test harness');
    assert.notEqual(rendererPid, target.webContents.getOSProcessId(), 'Guest renderer is separate from the shared window');
    const crashed = once(client.webContents, 'render-process-gone', { signal: AbortSignal.timeout(10000) });
    // forcefullyCrashRenderer can stall before render-process-gone on CI. Kill
    // only the guest renderer to exercise abrupt loss without a native crash.
    process.kill(rendererPid, 'SIGKILL');
    const [, details] = await crashed;
    assert.ok(['killed', 'crashed'].includes(details.reason), 'Guest renderer exits abnormally');
    // The 15-second transport retention can expire before a busy runner observes
    // the transient connecting state. Exercise recovery after expiry instead.
    await until(() => service.server.getClients().find(client => client.id === identity)?.state === 'signed-in', 'host retains admission after crashed transport expires');
    // Explicit navigation avoids Electron's unreliable reload of a crashed renderer.
    await client.loadURL(clientURL); await connected();
    assert.equal(service.server.getClients().find(client => client.state === 'connected').id, identity, 'Renderer crash and reload preserve admission');
    await service.stop();
    await sleep(2200);
    access = new ShareAccessState(undefined, file); windowId = 'after-restart';
    await boot();
    assert.equal(service.server.getClients().find(client => client.id === identity)?.state, 'signed-in', 'Restarted host shows the participant while waiting for automatic reconnection');
    await connected();
    assert.equal(service.server.getClients().find(client => client.state === 'connected').id, identity, 'Host restart retains the admitted participant');
    assert.equal(await evaluate('document.getElementById("microphone").getAttribute("aria-pressed")'), 'false', 'Automatic reconnection never starts a microphone');
    await evaluate('document.getElementById("disconnect").click()');
    await until(() => service.server.getClients().find(client => client.id === identity)?.state === 'invited', 'voluntary disconnect removes the waiting participant');
    await sleep(1800);
    assert.equal(service.server.getConnectedClientCount(), 0, 'Voluntary disconnect does not reconnect automatically');
    await service.stop(); access = new ShareAccessState(undefined, file); await boot();
    assert.equal(service.server.getClients().find(client => client.id === identity)?.state, 'invited', 'Voluntary departure stays hidden after host restart');
    loaded = new Promise(resolve => client.webContents.once('did-finish-load', resolve));
    client.reload(); await loaded;
    await until(() => evaluate('!document.getElementById("connect").hidden'), 'voluntary departure presents manual Connect after reload');
    await sleep(1800);
    assert.equal(service.server.getClients().find(client => client.id === identity)?.state, 'invited', 'Reload after voluntary departure does not resume automatically');
    await evaluate('document.getElementById("connect").requestSubmit()'); await connected();
    assert.equal(service.server.getClients().find(client => client.state === 'connected').id, identity, 'A voluntary departure can reconnect manually without joining again');
    service.server.disconnectClient(identity);
    await until(() => evaluate('!document.getElementById("shareJoin").hidden'), 'forced disconnect requires admission');
    await sleep(2200);
    assert.equal(service.server.getConnectedClientCount(), 0, 'Forced disconnect does not automatically redeem a reusable code');
    await joinClient(invitation.token);
    await service.stop(); access.terminateSession();
    await sleep(1800); access = new ShareAccessState(undefined, file); await boot();
    await until(() => evaluate('!document.getElementById("shareJoin").hidden'), 'explicit Stop terminates admission');
    await sleep(1800);
    assert.equal(service.server.getConnectedClientCount(), 0, 'Restarting Share after explicit Stop does not resume the old client');
    assert.equal(access.lookup(invitation.token), undefined, 'Used code is invalidated by Stop');
    assert.ok(access.lookup(unused.token), 'Unused invitation survives Stop');
    await client.webContents.executeJavaScript('document.getElementById("accessCode").value="000000"');
    client.reload();
    await until(() => evaluate('!document.getElementById("shareJoin").hidden'), 'reload after Stop still requires admission');
    assert.equal(service.server.getConnectedClientCount(), 0);
    await joinClient(unused.token);
    await service.stop(); client.destroy(); target.destroy();
    rmSync(root, { recursive: true, force: true });
    await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
  })().catch(error => { console.error(error); require('electron').app.exit(1); });
};
