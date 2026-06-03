"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashtop", {
  getState: () => ipcRenderer.invoke("state:get"),
  addProject: (project) => ipcRenderer.invoke("projects:add", project),
  updateProject: (id, patch) => ipcRenderer.invoke("projects:update", id, patch),
  removeProject: (id) => ipcRenderer.invoke("projects:remove", id),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url)
});
