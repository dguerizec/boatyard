const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nativeClickTest', {
  run: () => ipcRenderer.invoke('click-test:run')
});
