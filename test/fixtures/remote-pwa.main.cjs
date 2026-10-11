const { BrowserWindow } = require('electron');
const { cpSync, mkdtempSync, appendFileSync, rmSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const { RemoteServer } = require('../../build/main/remoteServer');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async harness => {
  const directory = mkdtempSync(join(tmpdir(), 'boatyard-pwa-fixture-'));
  const remoteDirectory = join(directory, 'remote');
  cpSync(resolve('build/renderer/remote'), remoteDirectory, { recursive: true });
  cpSync(resolve('build/renderer/shareChat.css'), join(directory, 'shareChat.css'));
  mkdirSync(join(directory, 'assets'));
  cpSync(resolve('build/renderer/assets/boatyard-mark-night-preview.png'), join(directory, 'assets/boatyard-mark-night-preview.png'));
  const server = new RemoteServer({ assetsDirectory: remoteDirectory, passwordHash: '', readOnly: true,
    listWindows: () => [{id: "one", title: "One", width: 800, height: 600}, {id: "two", title: "Two", width: 800, height: 600}], connect: async () => { throw new Error('No fixture windows'); }, disconnect() {} });
  const port = await server.start(), invitation = server.createReadOnlyInvitation('PWA viewer');
  const client = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  harness.on('closed', () => { void server.stop(); if (!client.isDestroyed()) client.destroy(); rmSync(directory, { recursive: true, force: true }); });
  const until = async expression => {
    for (let i=0;i<100;i++) { if (await client.webContents.executeJavaScript(expression)) return; await sleep(50); }
    throw new Error('PWA integration fixture timed out: '+expression);
  };
  void (async () => {
    await client.loadURL(`http://127.0.0.1:${port}/#share=${invitation.token}`);
    await until('!document.getElementById("shareJoin").hidden');
    await client.webContents.executeJavaScript('document.getElementById("participantName").value="Fixture guest";document.getElementById("shareJoin").requestSubmit()');
    await until('document.getElementById("status").textContent === "Choose a window"');
    assert.equal(await client.webContents.executeJavaScript('location.hash'), '', 'The invitation is absent from the installed start address');
    client.webContents.debugger.attach('1.3');
    const manifest = await client.webContents.debugger.sendCommand('Page.getAppManifest');
    assert.equal(manifest.errors.length, 0, 'Chromium parses the served manifest without errors');
    assert.equal(JSON.parse(manifest.data).display, 'standalone');
    client.webContents.debugger.detach();
    for (const width of [1000, 390]) {
      client.setContentSize(width, 800);
      await until(`window.innerWidth === ${width} && window.innerHeight === 800 && document.body.style.getPropertyValue('--viewer-height') === '800px'`);
      const layout = await client.webContents.executeJavaScript(`(() => {
        const surface=document.getElementById('surface').getBoundingClientRect(),bar=document.querySelector('footer').getBoundingClientRect();
        const buttons=[...document.querySelectorAll('.toolbar button')];
        const connect=document.getElementById('connect').getBoundingClientRect(),button=document.querySelector('#connect button').getBoundingClientRect();
        const status=document.getElementById('status').getBoundingClientRect();
        return {top:surface.top,height:surface.height,bottom:bar.bottom,barHeight:document.querySelector('.toolbar').getBoundingClientRect().height,
          connectTop:connect.top,connectBottom:connect.bottom,buttonTop:button.top,buttonBottom:button.bottom,
          centeredStatus:Math.abs(status.left+status.width/2-surface.left-surface.width/2)<1 && Math.abs(status.top+status.height/2-surface.top-surface.height/2)<1,
          icons:buttons.every(b=>b.querySelector('svg')?.children.length && b.getAttribute('aria-label') && b.title),
          bottomCommands:['disconnect','logout','install'].every(id=>document.getElementById(id).closest('footer')),
          scrolling:document.querySelector('.toolbar').scrollWidth>document.querySelector('.toolbar').clientWidth};
      })()`);
      assert.equal(layout.top, 0, 'Video begins at the top without a header');
      assert.ok(layout.height >= 660 && layout.barHeight <= 60 && layout.bottom === 800, `The connection row and compact toolbar reserve their own space at ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.centeredStatus, 'Connection status belongs to the video area');
      assert.equal(layout.connectTop, layout.height, 'The connection form stays below the video');
      assert.ok(layout.buttonTop >= layout.connectTop && layout.buttonBottom <= layout.connectBottom, 'The reconnect button is fully inside its reserved row');
      assert.ok(layout.icons && layout.bottomCommands, 'All commands use labeled icons in the bottom toolbar');
      if (width === 390) assert.ok(layout.scrolling, 'Mobile users can scroll to every command without another row');
      await client.webContents.executeJavaScript('document.getElementById("diagnostics").click()');
      assert.equal(await client.webContents.executeJavaScript(`(() => {const b=document.querySelector('#connect button'),r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b;})()`), true, 'Diagnostics do not cover the reconnect button');
      await client.webContents.executeJavaScript('document.getElementById("diagnostics").click()');
      const inputLayout = await client.webContents.executeJavaScript(`(() => {
        const chooser=document.getElementById('connect');chooser.hidden=true;
        const form=document.getElementById('textForm');form.hidden=false;
        const surface=document.getElementById('surface').getBoundingClientRect(),input=form.getBoundingClientRect(),bar=document.querySelector('.toolbar').getBoundingClientRect();
        form.hidden=true;chooser.hidden=false;
        return {videoBottom:surface.bottom,inputTop:input.top,inputBottom:input.bottom,barTop:bar.top,barBottom:bar.bottom,
          restoredHeight:document.getElementById('surface').getBoundingClientRect().height};
      })()`);
      assert.equal(inputLayout.videoBottom, inputLayout.inputTop, 'Open text input reserves its own space below the video');
      assert.equal(inputLayout.inputBottom, inputLayout.barTop, 'Text input remains above the command toolbar');
      assert.equal(inputLayout.barBottom, 800, 'Text input keeps the toolbar at the viewport bottom');
      assert.equal(inputLayout.restoredHeight, layout.height, 'Closing text input restores the video area');
    }
    const keyboardLayout = await client.webContents.executeJavaScript(`(() => {
      const visible=window.visualViewport;
      Object.defineProperty(visible,'height',{configurable:true,value:450});
      Object.defineProperty(visible,'offsetTop',{configurable:true,value:20});
      document.getElementById('connect').hidden=true;
      document.getElementById('textForm').hidden=false;
      document.getElementById('text').focus();
      visible.dispatchEvent(new Event('resize'));visible.dispatchEvent(new Event('scroll'));
      const bar=document.querySelector('footer').getBoundingClientRect(),input=document.getElementById('text').getBoundingClientRect();
      const result={bottom:bar.bottom,inputBottom:input.bottom,inputTop:input.top,videoBottom:document.getElementById('surface').getBoundingClientRect().bottom,formTop:document.getElementById('textForm').getBoundingClientRect().top,focus:document.activeElement.id};
      delete visible.height;delete visible.offsetTop;
      visible.dispatchEvent(new Event('resize'));
      document.getElementById('textForm').hidden=true;
      document.getElementById('connect').hidden=false;
      return {...result,restoredBottom:document.querySelector('footer').getBoundingClientRect().bottom};
    })()`);
    assert.equal(keyboardLayout.bottom, 470, 'Toolbar stays at the visible viewport bottom above the keyboard');
    assert.ok(keyboardLayout.inputTop >= 20 && keyboardLayout.inputBottom <= 470, 'Text input remains in the visible viewport');
    assert.equal(keyboardLayout.videoBottom, keyboardLayout.formTop, 'Text input does not overlap video when the native keyboard is open');
    assert.equal(keyboardLayout.focus, 'text', 'Viewport adjustment preserves keyboard focus');
    assert.equal(keyboardLayout.restoredBottom, 800, 'Closing the keyboard restores the full viewer height');
    await client.webContents.executeJavaScript(`(() => {
      const original=window.fetch;window.fixtureProxyOffline=true;
      window.fetch=(url,options)=>window.fixtureProxyOffline && url==='/api/windows'
        ? Promise.resolve(new Response('<!DOCTYPE html><title>Origin unavailable</title>',{status:502,headers:{'Content-Type':'text/html'}}))
        : original(url,options);
      document.getElementById('connect').requestSubmit();
    })()`);
    await until('document.getElementById("status").textContent === "Boatyard is unavailable. Make sure it is running, then try again."');
    assert.equal(await client.webContents.executeJavaScript('document.getElementById("connect").hidden'), false, 'A proxy error keeps reconnection available');
    await client.webContents.executeJavaScript('window.fixtureProxyOffline=false');
    const before = await client.webContents.executeJavaScript('document.querySelector("meta[name=boatyard-client-version]").content');
    appendFileSync(join(remoteDirectory, 'remote.css'), '\nbody { background-color: rgb(33, 44, 55); }\n');
    await client.webContents.executeJavaScript('document.getElementById("connect").requestSubmit()');
    await until(`document.querySelector('meta[name=boatyard-client-version]').content !== ${JSON.stringify(before)} && document.getElementById('status').textContent === 'Choose a window'`);
    assert.equal(await client.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor'), 'rgb(33, 44, 55)', 'Actual reload applies the new stylesheet');
    assert.equal(await client.webContents.executeJavaScript('document.getElementById("login").hidden && location.hash === ""'), true, 'Reload preserves the redeemed Share cookie without replaying the invitation');
    assert.equal(server.getClients().length, 1);
    await server.stop(); client.destroy(); rmSync(directory, { recursive: true, force: true });
    await harness.webContents.executeJavaScript('window.browserTestResult="passed"');
  })().catch(error => { console.error(error); void harness.webContents.executeJavaScript(`throw new Error(${JSON.stringify(error.message)})`); });
};
