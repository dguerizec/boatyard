const { ipcMain, WebContentsView } = require('electron');
const { createServer } = require('node:http');
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
  ipcMain.handle('menu-test:invoke', (_, action, payload) => action === 'fixtureUrl'
    ? `http://127.0.0.1:${server.address().port}/` : runtime[action](payload));
  ipcMain.handle('menu-test:status', () => Promise.all(views.map(async view => ({
    visible: view.getVisible(), loaded: !view.webContents.isLoadingMainFrame(),
    bounds: view.getBounds(), painted: await view.webContents.capturePage().then(image => !image.isEmpty(), () => false)
  }))));
};
