"use strict";

import type { IpcRendererEvent } from "electron";

const { contextBridge, ipcRenderer } = require("electron");

type BridgeCallback = (payload: unknown) => void;
type Unsubscribe = () => void;

contextBridge.exposeInMainWorld("boatyard", {
  getState: () => ipcRenderer.invoke("state:get"),
  updateSettings: (patch: unknown) => ipcRenderer.invoke("settings:update", patch),
  updateNavigation: (navigation: unknown) => ipcRenderer.invoke("navigation:update", navigation),
  updateOnboarding: (onboarding: unknown) => ipcRenderer.invoke("onboarding:update", onboarding),
  selectProjectsBasePath: (currentPath: unknown) => ipcRenderer.invoke("settings:select-projects-base-path", currentPath),
  getUpdateInfo: () => ipcRenderer.invoke("updates:info"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  prepareUpdate: () => ipcRenderer.invoke("updates:prepare"),
  restartToUpdate: (update: unknown) => ipcRenderer.invoke("updates:restart", update),
  getPendingChangelog: () => ipcRenderer.invoke("changelog:pending"),
  getChangelogHistory: () => ipcRenderer.invoke("changelog:history"),
  dismissChangelog: () => ipcRenderer.invoke("changelog:dismiss"),
  inspectSourcePath: (sourcePath: string) => ipcRenderer.invoke("projects:inspect-source-path", sourcePath),
  listPlugins: () => ipcRenderer.invoke("plugins:list"),
  invokePlugin: (pluginId: string, actionName: string, payload: unknown) => ipcRenderer.invoke("plugins:invoke", pluginId, actionName, payload),
  addProject: (project: unknown) => ipcRenderer.invoke("projects:add", project),
  updateProject: (id: string, patch: unknown) => ipcRenderer.invoke("projects:update", id, patch),
  updateGlobalUrls: (urls: unknown) => ipcRenderer.invoke("global-urls:update", urls),
  updateWebAppHomeTab: (projectId: string, tab: unknown) => ipcRenderer.invoke("webapp-home-tab:update", projectId, tab),
  updateWebAppHomeTabs: (projectId: string, tabs: unknown) => ipcRenderer.invoke("webapp-home-tabs:update", projectId, tabs),
  reorderProjects: (ids: unknown) => ipcRenderer.invoke("projects:reorder", ids),
  removeProject: (id: string) => ipcRenderer.invoke("projects:remove", id),
  updatePluginEnabled: (pluginId: string, enabled: boolean) => ipcRenderer.invoke("plugins:enabled:update", pluginId, enabled),
  updateGlobalPluginConfig: (pluginId: string, patch: unknown) => ipcRenderer.invoke("global-plugin-config:update", pluginId, patch),
  updateProjectPluginConfig: (projectId: string, pluginId: string, patch: unknown) => ipcRenderer.invoke("project-plugin-config:update", projectId, pluginId, patch),
  updatePaneLayout: (projectId: string | null | undefined, layout: unknown) => ipcRenderer.invoke("pane-layout:update", projectId, layout),
  updateWidgetLayout: (projectId: string | null | undefined, layout: unknown) => ipcRenderer.invoke("widget-layout:update", projectId, layout),
  updateTopbarWidgets: (topbarWidgets: unknown) => ipcRenderer.invoke("topbar-widgets:update", topbarWidgets),
  listTerminalTabs: (projectId: string) => ipcRenderer.invoke("terminal:tabs", projectId),
  createTerminalTab: (projectId: string, name: string) => ipcRenderer.invoke("terminal:create-tab", projectId, name),
  renameTerminalTab: (projectId: string, windowId: string, name: string) => ipcRenderer.invoke("terminal:rename-tab", projectId, windowId, name),
  closeTerminalTab: (projectId: string, windowId: string) => ipcRenderer.invoke("terminal:close-tab", projectId, windowId),
  attachTerminal: (projectId: string, windowId: string, size: unknown) => ipcRenderer.invoke("terminal:attach", projectId, windowId, size),
  updateTerminalSelection: (projectId: string, surfaceKey: string, windowId: string) => (
    ipcRenderer.invoke("terminal:selection:update", projectId, surfaceKey, windowId)
  ),
  updateTerminalTabOrder: (projectId: string, windowIds: unknown) => ipcRenderer.invoke("terminal:tab-order:update", projectId, windowIds),
  writeTerminal: (terminalId: string, data: string) => ipcRenderer.invoke("terminal:write", terminalId, data),
  resizeTerminal: (terminalId: string, size: unknown) => ipcRenderer.invoke("terminal:resize", terminalId, size),
  detachTerminal: (terminalId: string) => ipcRenderer.invoke("terminal:detach", terminalId),
  writeTerminalSelection: (text: unknown) => ipcRenderer.invoke("terminal:write-selection", text),
  readTerminalSelection: () => ipcRenderer.invoke("terminal:read-selection"),
  /**
   * @param {unknown} pluginId
   * @param {unknown} eventName
   * @param {BridgeCallback} callback
   * @returns {Unsubscribe}
   */
  onPluginEvent: (pluginId: unknown, eventName: unknown, callback: BridgeCallback): Unsubscribe => {
    const channel = `plugins:event:${String(pluginId || "").trim()}:${String(eventName || "").trim()}`;
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  /**
   * @param {BridgeCallback} callback
   * @returns {Unsubscribe}
   */
  onTerminalData: (callback: BridgeCallback): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  /**
   * @param {BridgeCallback} callback
   * @returns {Unsubscribe}
   */
  onTerminalExit: (callback: BridgeCallback): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
  showWebApp: (webApp: unknown) => ipcRenderer.invoke("webapp:show", webApp),
  setWebAppBounds: (bounds: unknown) => ipcRenderer.invoke("webapp:set-bounds", bounds),
  navigateWebApp: (key: unknown, action: string, url: string) => ipcRenderer.invoke("webapp:navigate", key, action, url),
  getWebAppNavigationHistory: (key: unknown) => ipcRenderer.invoke("webapp:navigation-history", key),
  updateWebAppAutofill: (key: unknown, enabled: unknown) => ipcRenderer.invoke("webapp:autofill:update", key, enabled),
  setVisibleWebApps: (keys: unknown) => ipcRenderer.invoke("webapp:set-visible", keys),
  hideWebApp: () => ipcRenderer.invoke("webapp:hide"),
  freezeWebApps: (options: unknown) => ipcRenderer.invoke("webapp:freeze", options),
  restoreWebApps: (token: unknown) => ipcRenderer.invoke("webapp:restore", token),
  /**
   * @param {BridgeCallback} callback
   * @returns {Unsubscribe}
   */
  onWebAppUrlChanged: (callback: BridgeCallback): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("webapp:url-changed", listener);
    return () => ipcRenderer.removeListener("webapp:url-changed", listener);
  },
  /**
   * @param {BridgeCallback} callback
   * @returns {Unsubscribe}
   */
  onWebAppLoaded: (callback: BridgeCallback): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("webapp:loaded", listener);
    return () => ipcRenderer.removeListener("webapp:loaded", listener);
  },
  /**
   * @param {BridgeCallback} callback
   * @returns {Unsubscribe}
   */
  onWebAppAutofillChanged: (callback: BridgeCallback): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("webapp:autofill-changed", listener);
    return () => ipcRenderer.removeListener("webapp:autofill-changed", listener);
  },
  /**
   * @param {BridgeCallback} callback
   * @returns {Unsubscribe}
   */
  onWebAppOpenUrlRequested: (callback: BridgeCallback): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("webapp:open-url-requested", listener);
    return () => ipcRenderer.removeListener("webapp:open-url-requested", listener);
  },
  writeClipboardText: (text: unknown) => ipcRenderer.invoke("clipboard:write-text", text),
  openExternal: (url: unknown) => ipcRenderer.invoke("shell:open-external", url)
});

export {};
