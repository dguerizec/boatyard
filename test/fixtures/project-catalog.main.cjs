const { ipcMain } = require('electron');

module.exports = async win => {
  let finishRead;
  ipcMain.handle('state:get', () => new Promise(resolve => { finishRead = resolve; }));
  ipcMain.handle('plugins:invoke', (_event, _pluginId, action, payload) => {
    if (action === 'catalog') win.webContents.send('projects:changed', payload);
    if (action === 'finish-read') finishRead(payload);
  });
};
