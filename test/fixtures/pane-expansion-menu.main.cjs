const { ipcMain, WebContentsView } = require('electron');
const { createServer } = require('node:http');
const { execFileSync } = require('node:child_process');
const { WorkspaceWindowRuntime } = require('../../build/main/workspaceWindowRuntime');

module.exports = async win => {
  win.show();
  const server = createServer((_, response) => response.end('<body style="background:teal">Native fixture</body>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  win.on('closed', () => server.close());
  const views = [];
  const runtime = new WorkspaceWindowRuntime({
    id: 'menu-test', window: win, openExternalUrl() {},
    store: { getWorkspaceWebAppUrl: () => null, updateWorkspaceWebAppState() {} },
    createWebContentsView() {
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      views.push(view);
      return view;
    }
  });
  ipcMain.handle('menu-test:invoke', async (_, action, payload) => {
    if (action === 'fixtureUrl') return `http://127.0.0.1:${server.address().port}/`;
    if (action === 'nativeDrag') {
      const id = String(win.getNativeWindowHandle().readUInt32LE(0));
      const bounds = win.getBounds(), content = win.getContentBounds();
      const pause = () => new Promise(resolve => setTimeout(resolve, 40));
      const move = point => execFileSync('xdotool', ['mousemove', '--window', id,
        String(Math.round(point.x + content.x - bounds.x)), String(Math.round(point.y + content.y - bounds.y))]);
      move(payload.start); await pause();
      execFileSync('xdotool', ['mousedown', '1']); await pause();
      try {
        for (let step = 1; step <= 4; step++) {
          move({ x: payload.start.x + (payload.end.x - payload.start.x) * step / 4,
            y: payload.start.y + (payload.end.y - payload.start.y) * step / 4 });
          await pause();
        }
      } finally { execFileSync('xdotool', ['mouseup', '1']); }
      await pause();
      return;
    }
    return runtime[action](payload);
  });
  ipcMain.handle('menu-test:status', () => Promise.all(views.map(async view => ({
    visible: view.getVisible(), loaded: !view.webContents.isLoadingMainFrame(),
    bounds: view.getBounds(), painted: await view.webContents.capturePage().then(image => !image.isEmpty(), () => false)
  }))));
};
