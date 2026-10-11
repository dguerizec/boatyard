const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chatFixture', {
  invoke: (action, ...args) => ipcRenderer.invoke('chat-fixture', action, ...args),
  subscribe: callback => { const listener = () => callback(); ipcRenderer.on('chat-fixture-changed', listener); return () => ipcRenderer.removeListener('chat-fixture-changed', listener); }
});
