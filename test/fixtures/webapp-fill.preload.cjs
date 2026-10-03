const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nativeFillTest', { run: () => ipcRenderer.invoke('fill-test:run') });
