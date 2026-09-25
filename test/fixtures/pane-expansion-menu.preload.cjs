const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nativeMenuTest', {
  invoke: (action, payload) => ipcRenderer.invoke('menu-test:invoke', action, payload),
  status: () => ipcRenderer.invoke('menu-test:status')
});
