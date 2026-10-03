const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { ipcMain, WebContentsView } = require('electron');
const { WorkspaceWindowRuntime } = require('../../build/main/workspaceWindowRuntime');

module.exports = async win => {
  win.show();
  const server = createServer((_, response) => response.end(`<!doctype html>
    <style>button { position:absolute; left:30px; top:35px; width:120px; height:40px; }
    #disabled { top:100px } .duplicate { top:160px } #covered { top:220px }
    #overlay { position:absolute; left:30px; top:220px; width:120px; height:40px; background:red; z-index:1 }
    iframe { position:absolute; left:200px; top:35px; width:120px; height:80px }</style>
    <button id="save">Save</button><button id="disabled" disabled>Disabled</button>
    <button class="duplicate">One</button><button class="duplicate">Two</button>
    <button id="hidden" style="display:none">Hidden</button><button id="covered">Covered</button><div id="overlay"></div>
    <iframe srcdoc="<button onclick='window.count=(window.count||0)+1'>Frame</button>"></iframe>
    <script>window.events=[]; for (const type of ['pointerdown','pointerup','click'])
    document.querySelector('#save').addEventListener(type, e => events.push({type:e.type,trusted:e.isTrusted}));
    window.debugEvents=[]; for (const type of ['mousemove','mousedown','mouseup','click'])
    document.addEventListener(type,e=>debugEvents.push({type,target:e.target.id,x:e.clientX,y:e.clientY}));</script>`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  win.on('closed', () => server.close());
  const views = [];
  const runtime = new WorkspaceWindowRuntime({
    id: 'click-test', window: win, openExternalUrl() {},
    store: { getWorkspaceWebAppUrl: () => null, updateWorkspaceWebAppState() {} },
    createWebContentsView() {
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      views.push(view);
      return view;
    }
  });
  ipcMain.handle('click-test:run', async () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const bounds = { x:80, y:100, width:400, height:350 };
    const paneBounds = { x:20, y:50, width:500, height:450 };
    runtime.showWebApp({ key:'target', url, bounds, borderRadius:10 });
    runtime.showWebApp({ key:'other', url, bounds:{ x:520, y:100, width:200, height:350 } });
    runtime.setVisibleWebApps(['target', 'other']);
    const contents = views[0].webContents;
    const pause = () => new Promise(resolve => setTimeout(resolve, 25));
    for (const view of views) {
      for (let attempt = 0; attempt < 100 && (!view.webContents.getURL() || view.webContents.isLoadingMainFrame()); attempt++) await pause();
    }
    const click = (target, resolveBounds = async () => paneBounds) => runtime.clickWebApp('target', { expectedUrl:url, ...target }, resolveBounds);
    const events = () => contents.executeJavaScript('window.events');
    const waitClicks = async count => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await events()).filter(event => event.type === 'click').length === count) return;
        await pause();
      }
      assert.fail(`Expected ${count} clicks: ${JSON.stringify({focused:win.isFocused(), contentsFocused:contents.isFocused(), bounds:views[0].getBounds(), events:await contents.executeJavaScript('debugEvents')})}`);
    };
    const first = await click({ selector:'#save' });
    assert.equal(first.clicked, true);
    assert.deepEqual(first.point, { x:150, y:105 });
    await waitClicks(1);
    const guarded = await click({ point:first.point, expectedPaneSize:{width:500,height:450} });
    assert.equal(guarded.captureSizeVerified, true);
    await waitClicks(2);
    await assert.rejects(click({point:first.point, expectedPaneSize:{width:499,height:450}}), {code:'LAYOUT_CHANGED'});
    await assert.rejects(click({point:first.point, expectedPaneSize:{width:500,height:449}}), {code:'LAYOUT_CHANGED'});
    await assert.rejects(click({selector:'#save', expectedPaneSize:{width:500,height:450}}), {code:'INVALID_REQUEST'});
    assert.deepEqual(await events(), Array.from({length:2}, () => [
      {type:'pointerdown',trusted:true}, {type:'pointerup',trusted:true}, {type:'click',trusted:true}
    ]).flat());
    assert.deepEqual(await views[1].webContents.executeJavaScript('window.events'), []);
    for (const [selector, code] of [
      ['#absent','ELEMENT_NOT_FOUND'], ['[','INVALID_SELECTOR'], ['.duplicate','ELEMENT_AMBIGUOUS'],
      ['#hidden','ELEMENT_NOT_CLICKABLE'], ['#disabled','ELEMENT_NOT_CLICKABLE'], ['#covered','ELEMENT_OBSCURED']
    ]) await assert.rejects(click({selector}), {code});
    await assert.rejects(click({point:{x:10,y:10}}), {code:'POINT_OUTSIDE_WEB_CONTENT'});
    await assert.rejects(click({point:{x:500,y:200}}), {code:'POINT_OUTSIDE_WEB_CONTENT'});
    await assert.rejects(click({selector:'#save',point:{x:150,y:105}}), {code:'INVALID_REQUEST'});
    await assert.rejects(click({selector:'#save'}, async () => { throw Object.assign(new Error('Stale layout'), {code:'LAYOUT_CHANGED'}); }), {code:'LAYOUT_CHANGED'});
    await assert.rejects(click({selector:'#save'}, async () => {
      contents.setZoomFactor(1.5);
      return paneBounds;
    }), {code:'LAYOUT_CHANGED'});
    contents.setZoomFactor(1);
    await assert.rejects(click({selector:'#save'}, async () => {
      await contents.executeJavaScript('history.pushState(null,"","/changed")');
      return paneBounds;
    }), {code:'PAGE_CHANGED'});
    await contents.executeJavaScript('history.replaceState(null,"","/")');
    runtime.setVisibleWebApps(['other']);
    await assert.rejects(click({selector:'#save'}), {code:'PANE_NOT_VISIBLE'});
    runtime.setVisibleWebApps(['target','other']);
    const frozen = await runtime.freezeWebApps({keys:['target']});
    await assert.rejects(click({selector:'#save'}), {code:'PANE_NOT_VISIBLE'});
    runtime.restoreWebApps(frozen.token);
    assert.equal((await events()).filter(event => event.type === 'click').length, 2);
    contents.setZoomFactor(1.5);
    await pause();
    await click({selector:'#save'});
    await waitClicks(3);
    contents.setZoomFactor(1);
    runtime.showWebApp({key:'target', url, bounds, viewportSize:{width:390,height:844}});
    await pause();
    await click({selector:'#save'});
    await waitClicks(4);
    await click({point:{x:150,y:105}});
    await waitClicks(5);
    await click({point:{x:300,y:110}});
    for (let attempt=0; attempt<100; attempt++) {
      if (await contents.executeJavaScript('document.querySelector("iframe").contentWindow.count === 1')) break;
      await pause();
    }
    assert.equal(await contents.executeJavaScript('document.querySelector("iframe").contentWindow.count'), 1);
    assert.deepEqual(await views[1].webContents.executeJavaScript('window.events'), []);
    server.close();
  });
};
