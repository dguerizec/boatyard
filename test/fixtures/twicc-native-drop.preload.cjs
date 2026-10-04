const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nativeKanbanTest', {
  drag: payload => ipcRenderer.invoke('kanban-test:drag', payload)
});
