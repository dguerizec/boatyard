const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { getRemoteStreamingHost } = require('../../build/main/remoteStreamingHost');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

app.on('browser-window-created', (_event, window) => window.webContents.setAudioMuted(true));
const timeout = setTimeout(() => { console.error('Application shutdown timed out'); app.exit(1); }, 20000);
let workspaceClosed = false;
app.on('quit', (_event, exitCode) => {
  clearTimeout(timeout);
  if (workspaceClosed && exitCode === 0) console.log('APPLICATION_SHUTDOWN_PASSED');
});
require('../../build/main/main');
void (async () => {
  await app.whenReady();
  let workspace;
  for (let i = 0; i < 200; i++) {
    workspace = BrowserWindow.getAllWindows().find(window => window.isVisible());
    if (workspace) break;
    await sleep(50);
  }
  assert.ok(workspace, 'The isolated application opens its workspace');
  const host = getRemoteStreamingHost();
  await host.prepareMicrophones();
  assert.equal(host.handlers.size, 0, 'An idle streaming window alone can keep Electron alive');
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  assert.equal(host.sender.isVisible(), false);
  workspace.once('closed', () => {
    workspaceClosed = true;
    setTimeout(() => {
      console.error('Electron remained alive after its last workspace closed');
      app.exit(1);
    }, 3000);
  });
  workspace.close();
})().catch(error => { console.error(error); app.exit(1); });
