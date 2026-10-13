const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tableTestInput', { send: events => ipcRenderer.invoke('table-test-input', events) });
