const { BrowserWindow, ipcMain, app } = require('electron');
const { join } = require('node:path');
const { RemoteServer } = require('../../build/main/remoteServer.js');
const { ShareChatStore } = require('../../build/main/shareChatStore.js');
module.exports = async win => {
  const directory = join(app.getPath('userData'), 'chat');
  let store = new ShareChatStore(directory);
  const server = new RemoteServer({ chat: store, readOnly: true, assetsDirectory: join(__dirname, '../../build/renderer/remote'), passwordHash: '', host: '127.0.0.1', listWindows: () => [], connect: async () => { throw new Error('No stream needed'); }, disconnect() {} });
  const origin = `http://127.0.0.1:${await server.start()}`;
  store.subscribe(() => win.webContents.send('chat-fixture-changed'));
  const guests = [];
  ipcMain.handle('chat-fixture', async (_event, action, ...args) => {
    if (action === 'read') return store.snapshot(args[0], true);
    if (action === 'send') return store.send(args[0], 'operator', 'Operator', args[1]);
    if (action === 'delete') return store.delete(args[0], args[1]);
    if (action === 'image') { const value = store.image(args[0], args[1]); return `data:${value.mime};base64,${value.bytes.toString('base64')}`; }
    if (action === 'guest') {
      const invitation = server.createReadOnlyInvitation(args[0]);
      const guest = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { partition: `chat-guest-${guests.length}`, backgroundThrottling: false } });
      guests.push(guest); await guest.loadURL(`${origin}/#share=${invitation.token}`); return guests.length - 1;
    }
    if (action === 'eval') return guests[args[0]].webContents.executeJavaScript(args[1]);
    if (action === 'reload') { await guests[args[0]].webContents.reload(); return; }
    if (action === 'narrow') { guests[args[0]].setSize(390, 700); return; }
    if (action === 'stop') { await server.stop(); store = new ShareChatStore(directory); return; }
    throw new Error('Unknown test action');
  });
};
