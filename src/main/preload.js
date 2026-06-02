"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashtop", {
  getState: () => ipcRenderer.invoke("state:get"),
  addApp: (app) => ipcRenderer.invoke("apps:add", app),
  updateApp: (id, patch) => ipcRenderer.invoke("apps:update", id, patch),
  removeApp: (id) => ipcRenderer.invoke("apps:remove", id),
  setViewBounds: (id, bounds) => ipcRenderer.invoke("views:set-bounds", id, bounds),
  focusView: (id) => ipcRenderer.invoke("views:focus", id),
  suspendViews: () => ipcRenderer.invoke("views:suspend"),
  resumeViews: () => ipcRenderer.invoke("views:resume")
});
