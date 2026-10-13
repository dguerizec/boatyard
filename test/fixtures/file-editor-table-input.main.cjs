const { ipcMain } = require('electron');

module.exports = async win => {
  win.setSize(1100, 780);
  win.show();
  ipcMain.handle('table-test-input', async (_event, events) => {
    for (const event of events) {
      win.webContents.focus();
      win.webContents.sendInputEvent(event);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  });
};
