"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashtop", {
  getState: () => ipcRenderer.invoke("state:get"),
  addApp: (app) => ipcRenderer.invoke("apps:add", app),
  updateApp: (id, patch) => ipcRenderer.invoke("apps:update", id, patch),
  removeApp: (id) => ipcRenderer.invoke("apps:remove", id),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url)
});
