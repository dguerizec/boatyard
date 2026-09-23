const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

// Execute the actual app handlers against isolated native Electron windows.
const handlers = new Map();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => { handlers.set(channel, listener); handle(channel, listener); };
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
require(join(process.cwd(), 'build/main/main.js'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Hugescreen integration timed out'); app.exit(1); }, 30000);
const statePath = join(process.env.BOATYARD_CONFIG_ROOT, 'profiles/default/workspace-session.json');
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));
const invoke = (win, channel, ...args) => handlers.get(channel)({ sender: win.webContents }, ...args);
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 0.01, `${value} ~= ${expected}`);

app.whenReady().then(async () => {
  while (!BrowserWindow.getAllWindows().length || !handlers.has('layouts:save')) await delay(25);
  const win = BrowserWindow.getAllWindows()[0];
  // Navigation waits for native startup restoration to complete.
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'a' });
  if (process.env.BOATYARD_TEST_RESTART) {
    await invoke(win, 'navigation:update', { view: 'project', projectId: 'd' });
    const restored = await invoke(win, 'hugescreen:settings');
    near(restored.widthMultiplier, 1000 / 1200);
    near(restored.heightMultiplier, 700 / 800);
    assert.equal(restored.active, false, 'unvisited projects use the original fallback after restart');
    console.log('HUGESCREEN_RESTART_PASSED');
    clearTimeout(timeout);
    app.exit(0);
    return;
  }
  let settings = await invoke(win, 'hugescreen:settings');
  assert.equal(settings.active, false, 'persisted explicit pan off survives startup');
  near(settings.widthMultiplier, 1.5);
  assert.deepEqual(settings.edgeZones, { left: 3, right: 3, top: 28, bottom: 3 });
  const pane = { type: 'pane', id: 'saved-pane', paneTypeId: null };
  const saved = await invoke(win, 'layouts:save', { id: 'saved', name: 'Saved', projectId: null, paneLayout: pane });
  assert.equal(saved.hugescreen.enabled, false);
  assert.equal(saved.hugescreen.heightMultiplier, 2);
  assert.equal(saved.hugescreen.edgeZones, undefined);
  await invoke(win, 'hugescreen:resize', 2, 1.5, 'continuous', { left: 7, right: 8, top: 9, bottom: 10 });
  assert.equal((await invoke(win, 'layouts:list')).find(layout => layout.id === 'saved').hugescreen.widthMultiplier, 1.5);
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'c' });
  settings = await invoke(win, 'hugescreen:settings');
  near(settings.widthMultiplier, 1000 / 1200);
  near(settings.heightMultiplier, 700 / 800);
  assert.equal(settings.active, false, 'an unconfigured project does not inherit Hugescreen');
  assert.equal(readState().projectHugescreen.c, undefined, 'restoration alone does not create a project setting');
  const persistedWindow = Object.values(readState().workspaceSession.windows)[0];
  near(persistedWindow.window.hugescreenDefault.widthMultiplier, 1000 / 1200);
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'a' });
  near((await invoke(win, 'hugescreen:settings')).widthMultiplier, 2);
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'b' });
  settings = await invoke(win, 'hugescreen:settings');
  near(settings.widthMultiplier, 1.25);
  near(settings.heightMultiplier, 1.25);
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'a' });
  near((await invoke(win, 'hugescreen:settings')).widthMultiplier, 2);
  assert.equal((await invoke(win, 'hugescreen:settings')).active, false);
  win.setPosition(-200, -200);
  const applied = await invoke(win, 'layouts:apply', { projectId: 'a', paneLayout: { type: 'pane', id: 'pane-1' }, hugescreen: saved.hugescreen });
  near((await invoke(win, 'hugescreen:settings')).widthMultiplier, 1.5);
  assert.deepEqual([win.getBounds().x, win.getBounds().y], [0, 0]);
  assert.equal(readState().projectHugescreen.a.widthMultiplier, 1.5);
  await invoke(win, 'layouts:undo', applied.undoToken);
  near((await invoke(win, 'hugescreen:settings')).widthMultiplier, 2);
  assert.equal(readState().projectHugescreen.a.widthMultiplier, 2);
  const bounds = win.getBounds();
  await invoke(win, 'layouts:apply', { projectId: 'a', paneLayout: { type: 'pane', id: 'pane-2' } });
  assert.deepEqual(win.getBounds(), bounds, 'legacy layout leaves native geometry alone');
  // A resize started for A must finish before a queued switch, and never write B.
  const resize = invoke(win, 'hugescreen:resize', 2.5, 1.5, 'continuous');
  const switchB = invoke(win, 'navigation:update', { view: 'project', projectId: 'b' });
  await Promise.all([resize, switchB]);
  near((await invoke(win, 'hugescreen:settings')).widthMultiplier, 1.25);
  assert.equal(readState().projectHugescreen.a.widthMultiplier, 2.5);
  assert.equal(readState().projectHugescreen.b.widthMultiplier, 1.25);
  await invoke(win, 'workspace:create-window');
  while (BrowserWindow.getAllWindows().length < 2) await delay(25);
  const second = BrowserWindow.getAllWindows().find(candidate => candidate !== win);
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'a' });
  for (const target of [win, second]) {
    near((await invoke(target, 'hugescreen:settings')).widthMultiplier, 2.5);
    assert.equal((await invoke(target, 'hugescreen:settings')).active, false);
    assert.deepEqual((await invoke(target, 'hugescreen:settings')).edgeZones, { left: 7, right: 8, top: 9, bottom: 10 });
  }
  await invoke(second, 'hugescreen:resize', 1.75, 2, 'continuous', { left: 11, right: 12, top: 13, bottom: 14 });
  // An untouched window must not overwrite the other window's more recent project state.
  win.setPosition(-100, -100);
  await delay(350);
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'b' });
  assert.equal(readState().projectHugescreen.a.widthMultiplier, 1.75);
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'a' });
  for (const target of [win, second]) {
    near((await invoke(target, 'hugescreen:settings')).widthMultiplier, 1.75);
    assert.deepEqual((await invoke(target, 'hugescreen:settings')).edgeZones, { left: 11, right: 12, top: 13, bottom: 14 });
  }
  await invoke(win, 'hugescreen:toggle');
  assert.equal(readState().projectHugescreen.a.enabled, true);
  await invoke(win, 'hugescreen:toggle');
  assert.equal(readState().projectHugescreen.a.enabled, false);
  await assert.rejects(invoke(win, 'hugescreen:resize', 4, 4, 'continuous', undefined, 'b'), /active project changed/);
  await assert.rejects(invoke(win, 'layouts:save', { id: 'stale', name: 'Stale', paneLayout: pane }, 'b'), /active project changed/);
  await invoke(win, 'hugescreen:resize', 1.75, 2, 'edge');
  await invoke(win, 'hugescreen:toggle');
  const edge = await invoke(win, 'layouts:save', { id: 'edge', name: 'Edge', projectId: 'a', paneLayout: pane });
  assert.equal(edge.hugescreen.panMode, 'edge');
  assert.equal(edge.hugescreen.enabled, true);
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'b' });
  await invoke(win, 'navigation:update', { view: 'project', projectId: 'a' });
  assert.equal((await invoke(win, 'hugescreen:settings')).panMode, 'edge');
  assert.equal((await invoke(win, 'hugescreen:settings')).active, true);
  // Simulate a missing native dependency only inside this isolated process.
  const originalPath = process.env.PATH;
  process.env.PATH = '/unavailable-test-tools';
  await invoke(win, 'layouts:apply', { projectId: 'a', paneLayout: { type: 'pane', id: 'edge-pane' }, hugescreen: edge.hugescreen });
  settings = await invoke(win, 'hugescreen:settings');
  assert.equal(settings.active, false);
  assert.match(settings.edgeUnavailableReason, /Install xdotool/);
  win.focus();
  await win.webContents.executeJavaScript('document.querySelector("#hugescreen").click()');
  let ui;
  for (let attempt = 0; attempt < 100; attempt++) {
    ui = await win.webContents.executeJavaScript(`(() => {
      const popup = document.querySelector('.hugescreen-popup');
      return popup && { open: popup.open, mode: popup.querySelector('[name=mode]').value,
        disabled: popup.querySelector('[name=mode]').disabled,
        pan: popup.querySelector('[name=pan]').checked,
        reason: popup.querySelector('#hugescreen-mode-availability').textContent };
    })()`);
    if (ui?.open && !ui.disabled) break;
    await delay(25);
  }
  assert.equal(ui.mode, 'edge');
  assert.equal(ui.pan, false);
  assert.match(ui.reason, /Install xdotool/);
  if (process.env.BOATYARD_TEST_SCREENSHOT) {
    await delay(100);
    const screenshot = await win.webContents.capturePage();
    writeFileSync(process.env.BOATYARD_TEST_SCREENSHOT, screenshot.toPNG());
  }
  process.env.PATH = originalPath;
  await win.webContents.executeJavaScript(`document.querySelector('.hugescreen-popup').close(); document.querySelector('#workspace-layouts').click();`);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await win.webContents.executeJavaScript(`!!document.querySelector('.workspace-layout-dialog[open] .workspace-layout-list-item')`)) break;
    await delay(25);
  }
  assert.match(await win.webContents.executeJavaScript(`document.querySelector('.workspace-layout-detail').textContent`), /No Hugescreen settings saved/);
  const detail = await win.webContents.executeJavaScript(`(() => {
    const entry = [...document.querySelectorAll('.workspace-layout-list-item')].find(item => item.querySelector('strong').textContent === 'Saved');
    entry.click();
    const detail = document.querySelector('.workspace-layout-detail');
    return { text: detail.textContent, ratio: detail.querySelector('.layout-preview-window').style.aspectRatio };
  })()`);
  assert.match(detail.text, /Width ×1.50 · Height ×2.00/);
  assert.match(detail.text, /Pan off · Continuous/);
  assert.match(detail.text, /Saved window/);
  near(Number.parseFloat(detail.ratio), 1.125);
  if (process.env.BOATYARD_TEST_LAYOUT_SCREENSHOT) {
    await delay(100);
    const bounds = await win.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.workspace-layout-dialog').getBoundingClientRect();
      return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    })()`);
    writeFileSync(process.env.BOATYARD_TEST_LAYOUT_SCREENSHOT, (await win.webContents.capturePage(bounds)).toPNG());
  }

  console.log('HUGESCREEN_PERSISTENCE_PASSED');
  clearTimeout(timeout);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
