"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boatyard", {
  getState: () => ipcRenderer.invoke("state:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  updateNavigation: (navigation) => ipcRenderer.invoke("navigation:update", navigation),
  updateOnboarding: (onboarding) => ipcRenderer.invoke("onboarding:update", onboarding),
  selectProjectsBasePath: (currentPath) => ipcRenderer.invoke("settings:select-projects-base-path", currentPath),
  getUpdateInfo: () => ipcRenderer.invoke("updates:info"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  prepareUpdate: () => ipcRenderer.invoke("updates:prepare"),
  restartToUpdate: (update) => ipcRenderer.invoke("updates:restart", update),
  inspectSourcePath: (sourcePath) => ipcRenderer.invoke("projects:inspect-source-path", sourcePath),
  listPlugins: () => ipcRenderer.invoke("plugins:list"),
  invokePlugin: (pluginId, actionName, payload) => ipcRenderer.invoke("plugins:invoke", pluginId, actionName, payload),
  addProject: (project) => ipcRenderer.invoke("projects:add", project),
  updateProject: (id, patch) => ipcRenderer.invoke("projects:update", id, patch),
  updateGlobalUrls: (urls) => ipcRenderer.invoke("global-urls:update", urls),
  updateWebAppHomeTab: (projectId, tab) => ipcRenderer.invoke("webapp-home-tab:update", projectId, tab),
  updateWebAppHomeTabs: (projectId, tabs) => ipcRenderer.invoke("webapp-home-tabs:update", projectId, tabs),
  reorderProjects: (ids) => ipcRenderer.invoke("projects:reorder", ids),
  removeProject: (id) => ipcRenderer.invoke("projects:remove", id),
  updatePluginEnabled: (pluginId, enabled) => ipcRenderer.invoke("plugins:enabled:update", pluginId, enabled),
  updateGlobalPluginConfig: (pluginId, patch) => ipcRenderer.invoke("global-plugin-config:update", pluginId, patch),
  updateProjectPluginConfig: (projectId, pluginId, patch) => ipcRenderer.invoke("project-plugin-config:update", projectId, pluginId, patch),
  updatePaneLayout: (projectId, layout) => ipcRenderer.invoke("pane-layout:update", projectId, layout),
  updateWidgetLayout: (projectId, layout) => ipcRenderer.invoke("widget-layout:update", projectId, layout),
  listTerminalTabs: (projectId) => ipcRenderer.invoke("terminal:tabs", projectId),
  createTerminalTab: (projectId, name) => ipcRenderer.invoke("terminal:create-tab", projectId, name),
  renameTerminalTab: (projectId, windowId, name) => ipcRenderer.invoke("terminal:rename-tab", projectId, windowId, name),
  closeTerminalTab: (projectId, windowId) => ipcRenderer.invoke("terminal:close-tab", projectId, windowId),
  attachTerminal: (projectId, windowId, size) => ipcRenderer.invoke("terminal:attach", projectId, windowId, size),
  updateTerminalSelection: (projectId, surfaceKey, windowId) => (
    ipcRenderer.invoke("terminal:selection:update", projectId, surfaceKey, windowId)
  ),
  updateTerminalTabOrder: (projectId, windowIds) => ipcRenderer.invoke("terminal:tab-order:update", projectId, windowIds),
  writeTerminal: (terminalId, data) => ipcRenderer.invoke("terminal:write", terminalId, data),
  resizeTerminal: (terminalId, size) => ipcRenderer.invoke("terminal:resize", terminalId, size),
  detachTerminal: (terminalId) => ipcRenderer.invoke("terminal:detach", terminalId),
  writeTerminalSelection: (text) => ipcRenderer.invoke("terminal:write-selection", text),
  readTerminalSelection: () => ipcRenderer.invoke("terminal:read-selection"),
  onPluginEvent: (pluginId, eventName, callback) => {
    const channel = `plugins:event:${String(pluginId || "").trim()}:${String(eventName || "").trim()}`;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
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
  updateWebAppAutofill: (key, enabled) => ipcRenderer.invoke("webapp:autofill:update", key, enabled),
  setVisibleWebApps: (keys) => ipcRenderer.invoke("webapp:set-visible", keys),
  hideWebApp: () => ipcRenderer.invoke("webapp:hide"),
  freezeWebApps: () => ipcRenderer.invoke("webapp:freeze"),
  restoreWebApps: () => ipcRenderer.invoke("webapp:restore"),
  onWebAppUrlChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("webapp:url-changed", listener);
    return () => ipcRenderer.removeListener("webapp:url-changed", listener);
  },
  onWebAppLoaded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("webapp:loaded", listener);
    return () => ipcRenderer.removeListener("webapp:loaded", listener);
  },
  onWebAppAutofillChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("webapp:autofill-changed", listener);
    return () => ipcRenderer.removeListener("webapp:autofill-changed", listener);
  },
  onWebAppOpenUrlRequested: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("webapp:open-url-requested", listener);
    return () => ipcRenderer.removeListener("webapp:open-url-requested", listener);
  },
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url)
});
