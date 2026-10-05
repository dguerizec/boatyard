const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('imageTest', {
  seed: (url) => ipcRenderer.invoke('image-test-seed', url),
  read: (path) => ipcRenderer.invoke('image-test-read', path),
  update: (url) => ipcRenderer.invoke('image-test-update', url),
  actual: () => ipcRenderer.invoke('image-test-actual'),
  pan: (x, y) => ipcRenderer.invoke('image-test-pan', x, y),
  capture: (name) => ipcRenderer.invoke('image-test-capture', name)
});
