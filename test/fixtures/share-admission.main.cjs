const { BrowserWindow } = require('electron');
const { RemoteServer } = require('../../build/main/remoteServer.js');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

module.exports = async harness => {
  const clients = [];
  const server = new RemoteServer({ assetsDirectory: resolve('build/renderer/remote'), passwordHash: '', readOnly: true,
    listWindows: () => [{ id: 'one', title: 'One', width: 800, height: 600 }, { id: 'two', title: 'Two', width: 800, height: 600 }],
    connect: async () => { throw new Error('This fixture exercises admission without opening a media device.'); }, disconnect() {} });
  const origin = `http://127.0.0.1:${await server.start()}`;
  const evaluate = (client, expression) => client.webContents.executeJavaScript(expression);
  const until = async (client, expression) => {
    for (let attempt = 0; attempt < 150; attempt++) { if (await evaluate(client, expression)) return; await sleep(50); }
    throw new Error(`Admission fixture timed out: ${expression}`);
  };
  const open = async code => {
    const client = new BrowserWindow({ show: false, width: 390, height: 800,
      webPreferences: { sandbox: true, backgroundThrottling: false, partition: `admission-${clients.length}` } });
    clients.push(client); await client.loadURL(`${origin}/${code ? `#share=${code}` : ''}`);
    await until(client, '!document.getElementById("shareJoin").hidden'); return client;
  };
  const join = async (client, name, ask = false) => {
    await evaluate(client, `document.getElementById('participantName').value=${JSON.stringify(name)};${ask ? "document.getElementById('joinWithoutCode').click();document.getElementById('askToJoin').click()" : "document.getElementById('shareJoin').requestSubmit()"}`);
  };
  const joined = client => until(client, 'document.body.classList.contains("authenticated")');
  const cleanup = async () => { await server.stop(); for (const client of clients) if (!client.isDestroyed()) client.destroy(); };
  harness.on('closed', () => { void cleanup(); });
  void (async () => {
    const invitation = server.createReadOnlyInvitation('Alice');
    const phone = await open(invitation.token);
    await until(phone, 'document.getElementById("participantName").value === "Alice"');
    assert.equal(await evaluate(phone, 'location.hash'), '', 'Codes are removed from the address bar before admission');
    assert.equal(await evaluate(phone, 'document.body.classList.contains("authenticated")'), false, 'Opening a link waits for explicit confirmation');
    const layout = await evaluate(phone, `(() => {
      const form=document.getElementById('shareJoin'),rect=form.getBoundingClientRect();
      return {width:rect.width,overflow:form.scrollWidth>form.clientWidth,keyboard:document.getElementById('accessCode').inputMode};
    })()`);
    assert.ok(layout.width <= 390 && !layout.overflow); assert.equal(layout.keyboard, 'numeric');
    await join(phone, 'Alice'); await joined(phone);
    const pc = await open();
    await evaluate(pc, `document.getElementById('participantName').value='Remembered name';document.getElementById('participantName').dispatchEvent(new Event('input'))`);
    await new Promise(resolve => { pc.webContents.once('did-finish-load', resolve); pc.reload(); });
    await until(pc, '!document.getElementById("shareJoin").hidden');
    assert.equal(await evaluate(pc, 'document.getElementById("participantName").value'), 'Remembered name', 'Name drafts survive a later visit through localStorage');
    await evaluate(pc, `document.getElementById('accessCode').value=${JSON.stringify(invitation.token)};document.getElementById('accessCode').dispatchEvent(new Event('change'))`);
    await until(pc, 'document.getElementById("participantName").value === "Alice"');
    assert.equal(await evaluate(phone, "fetch('/api/windows').then(response=>response.status)"), 200, 'Code preview does not disconnect the existing device');
    await join(pc, 'Alice'); await joined(pc);
    assert.equal(await evaluate(phone, "fetch('/api/windows').then(response=>response.status)"), 401);
    await phone.reload(); await until(phone, '!document.getElementById("shareJoin").hidden');
    assert.equal(await evaluate(pc, "fetch('/api/windows').then(response=>response.status)"), 200, 'Reloading the old device cannot reclaim the code');
    await evaluate(pc, 'document.getElementById("access").click()');
    assert.equal(await evaluate(pc, 'document.getElementById("personalCode").textContent.replace(/\\s/g, "")'), invitation.token);
    assert.equal(await evaluate(pc, 'document.getElementById("participantAccess").open'), true);
    await evaluate(pc, 'document.getElementById("closeParticipantAccess").click()');
    server.configureShareAccess({ groupEnabled: true, groupApprovalRequired: false });
    let groupCode = server.getShareAccess().groupCode;
    const groupGuest = await open(groupCode); await join(groupGuest, 'Alice'); await joined(groupGuest);
    const personalCode = await evaluate(groupGuest, 'document.getElementById("personalCode").textContent.replace(/\\s/g, "")');
    assert.notEqual(personalCode, groupCode); assert.notEqual(personalCode, invitation.token);
    assert.equal(server.getClients().length, 2, 'Matching names from group entry remain distinct participants');
    server.configureShareAccess({ allowJoinRequests: true });
    const requester = await open();
    assert.equal(await evaluate(requester, 'document.getElementById("askToJoin").hidden'), true, 'Code entry has its own submit action');
    await evaluate(requester, 'document.getElementById("joinWithoutCode").click()');
    assert.equal(await evaluate(requester, 'document.getElementById("accessCodeField").hidden && document.getElementById("accessCode").disabled && document.getElementById("joinShare").hidden'), true, 'Ask to join shows only the name and request action');
    await join(requester, 'Bob', true);
    await until(requester, '!document.getElementById("cancelJoinRequest").hidden');
    assert.equal(await evaluate(requester, 'document.body.classList.contains("authenticated")'), false);
    const pending = server.getShareAccess().requests[0]; assert.equal(pending.label, 'Bob');
    await requester.reload(); await until(requester, '!document.getElementById("cancelJoinRequest").hidden');
    assert.equal(server.getShareAccess().requests.length, 1, 'Reload resumes the same approval request');
    server.decideShareJoinRequest(pending.id, true); await joined(requester);
    assert.equal(await evaluate(requester, 'document.getElementById("personalName").textContent'), 'Bob');
    await evaluate(requester, 'document.getElementById("logout").click()');
    await until(requester, '!document.getElementById("shareJoin").hidden');
    await evaluate(requester, 'sessionStorage.clear()');
    await new Promise(resolve => { requester.webContents.once('did-finish-load', resolve); requester.reload(); });
    await until(requester, '!document.getElementById("shareJoin").hidden');
    assert.equal(await evaluate(requester, 'document.getElementById("participantName").value'), 'Bob', 'The name persists independently of session storage and authentication');
    await evaluate(requester, 'document.getElementById("joinWithoutCode").click();document.getElementById("shareJoin").requestSubmit()');
    await until(requester, '!document.getElementById("cancelJoinRequest").hidden');
    assert.equal(server.getShareAccess().requests[0].label, 'Bob', 'Submitting the request form does not require an access code or retyping the name');
    await evaluate(requester, 'document.getElementById("cancelJoinRequest").click()');
    for (let attempt = 0; attempt < 50 && server.getShareAccess().requests.length; attempt++) await sleep(20);
    server.configureShareAccess({ groupEnabled: true, groupApprovalRequired: true });
    groupCode = server.getShareAccess().groupCode;
    const awaiting = await open(groupCode); await join(awaiting, 'Carol');
    await until(awaiting, '!document.getElementById("cancelJoinRequest").hidden');
    server.decideShareJoinRequest(server.getShareAccess().requests[0].id, false);
    await until(awaiting, 'document.getElementById("shareJoinStatus").textContent === "The host declined your request."');
    await join(awaiting, 'Carol'); await until(awaiting, '!document.getElementById("cancelJoinRequest").hidden');
    await evaluate(awaiting, 'document.getElementById("cancelJoinRequest").click()');
    await until(awaiting, 'document.getElementById("cancelJoinRequest").hidden');
    for (let attempt = 0; attempt < 50 && server.getShareAccess().requests.length; attempt++) await sleep(20);
    assert.equal(server.getShareAccess().requests.length, 0);
    await cleanup(); await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
  })().catch(error => { console.error(error); if (!harness.isDestroyed()) void harness.webContents.executeJavaScript(`throw new Error(${JSON.stringify(error.message)})`); });
};
