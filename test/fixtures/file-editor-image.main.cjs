const { app, ipcMain } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { readProjectImage } = require('../../build-test/src/plugins/file-editor/service');

module.exports = async (win) => {
  const root = app.getPath('userData');
  if (process.env.BOATYARD_IMAGE_TEST_CAPTURE_DIRECTORY) win.showInactive();
  ipcMain.handle('image-test-seed', (_event, dataUrl) => {
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    writeFileSync(join(root, 'contact # sheet.png'), Buffer.concat([png, Buffer.alloc(21 * 1024 * 1024)]));
    writeFileSync(join(root, 'second.png'), Buffer.concat([png, Buffer.alloc(21 * 1024 * 1024)]));
    writeFileSync(join(root, 'small.png'), png);
  });
  ipcMain.handle('image-test-read', (_event, path) => readProjectImage(root, path));
  ipcMain.handle('image-test-update', (_event, dataUrl) => {
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    writeFileSync(join(root, 'contact # sheet.png'), Buffer.concat([png, Buffer.alloc(21 * 1024 * 1024)]));
  });
  ipcMain.handle('image-test-actual', () => process.env.BOATYARD_IMAGE_TEST_FILE
    ? readProjectImage(root, process.env.BOATYARD_IMAGE_TEST_FILE) : undefined);
  ipcMain.handle('image-test-capture', async (_event, name) => {
    if (process.env.BOATYARD_IMAGE_TEST_CAPTURE_DIRECTORY) {
      // Let the compositor present the updated frame before capturing the test window.
      await new Promise(resolve => setTimeout(resolve, name.startsWith('actual-') ? 1000 : 200));
      const screenshot = await win.webContents.capturePage();
      writeFileSync(join(process.env.BOATYARD_IMAGE_TEST_CAPTURE_DIRECTORY, `${name}.png`), screenshot.toPNG());
    }
  });
  ipcMain.handle('image-test-pan', async (_event, x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: x - 80, y: y - 60, modifiers: ['leftButtonDown'] });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: x - 80, y: y - 60 });
  });
};
