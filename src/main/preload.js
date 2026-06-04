"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashtop", {
  getState: () => ipcRenderer.invoke("state:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  updateNavigation: (navigation) => ipcRenderer.invoke("navigation:update", navigation),
  selectProjectsBasePath: (currentPath) => ipcRenderer.invoke("settings:select-projects-base-path", currentPath),
  inspectSourcePath: (sourcePath) => ipcRenderer.invoke("projects:inspect-source-path", sourcePath),
  addProject: (project) => ipcRenderer.invoke("projects:add", project),
  updateProject: (id, patch) => ipcRenderer.invoke("projects:update", id, patch),
  reorderProjects: (ids) => ipcRenderer.invoke("projects:reorder", ids),
  removeProject: (id) => ipcRenderer.invoke("projects:remove", id),
  updatePaneLayout: (projectId, layout) => ipcRenderer.invoke("pane-layout:update", projectId, layout),
  updateWidgetLayout: (projectId, layout) => ipcRenderer.invoke("widget-layout:update", projectId, layout),
  listTerminalTabs: (projectId) => ipcRenderer.invoke("terminal:tabs", projectId),
  createTerminalTab: (projectId, name) => ipcRenderer.invoke("terminal:create-tab", projectId, name),
  closeTerminalTab: (projectId, windowId) => ipcRenderer.invoke("terminal:close-tab", projectId, windowId),
  attachTerminal: (projectId, windowId, size) => ipcRenderer.invoke("terminal:attach", projectId, windowId, size),
  writeTerminal: (terminalId, data) => ipcRenderer.invoke("terminal:write", terminalId, data),
  resizeTerminal: (terminalId, size) => ipcRenderer.invoke("terminal:resize", terminalId, size),
  detachTerminal: (terminalId) => ipcRenderer.invoke("terminal:detach", terminalId),
  writeTerminalSelection: (text) => ipcRenderer.invoke("terminal:write-selection", text),
  readTerminalSelection: () => ipcRenderer.invoke("terminal:read-selection"),
  getHawserWidgetData: (projectId) => ipcRenderer.invoke("hawser:widget-data", projectId),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
  showWebApp: (webApp) => ipcRenderer.invoke("webapp:show", webApp),
  setWebAppBounds: (bounds) => ipcRenderer.invoke("webapp:set-bounds", bounds),
  navigateWebApp: (key, action, url) => ipcRenderer.invoke("webapp:navigate", key, action, url),
  setVisibleWebApps: (keys) => ipcRenderer.invoke("webapp:set-visible", keys),
  hideWebApp: () => ipcRenderer.invoke("webapp:hide"),
  freezeWebApps: () => ipcRenderer.invoke("webapp:freeze"),
  restoreWebApps: () => ipcRenderer.invoke("webapp:restore"),
  onWebAppUrlChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("webapp:url-changed", listener);
    return () => ipcRenderer.removeListener("webapp:url-changed", listener);
  },
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url)
});
