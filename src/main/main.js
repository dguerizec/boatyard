"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const { app, BrowserWindow, WebContentsView, Menu, clipboard, dialog, ipcMain, shell } = require("electron");
const { getHawserStatus, getHawserWidgetData } = require("./hawserService");
const { PasswordManager } = require("./passwordManager");
const { ProjectStore, deriveRepoUrl } = require("./store");
const { TerminalService } = require("./terminalService");
const { createTwiccProject, inspectTwiccProject, loadTwiccProjectProcessStatuses } = require("./twiccService");

const execFileAsync = promisify(execFile);
const WEBAPP_SESSION_PARTITION = "persist:boatyard-webapps";

let mainWindow = null;
let store = null;
let terminalService = null;
let passwordManager = null;
let saveWindowStateTimer = null;
const webAppViews = new Map();
let activeWebAppKey = null;
let visibleWebAppKeys = new Set();
let webAppsFrozen = false;

function getStorePath() {
  if (process.env.BOATYARD_STATE_PATH) {
    return process.env.BOATYARD_STATE_PATH;
  }

  return path.join(app.getPath("userData"), "boatyard-state.json");
}

function createMainWindow() {
  const windowState = store.getWindowState();

  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 920,
    minHeight: 620,
    title: "Boatyard",
    icon: path.join(__dirname, "../renderer/assets/boatyard-icon.png"),
    backgroundColor: "#101418",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();

    if (process.argv.includes("--smoke")) {
      setTimeout(() => app.quit(), 500);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("maximize", saveWindowState);
  mainWindow.on("unmaximize", saveWindowState);
  mainWindow.on("close", () => {
    saveWindowState();
    terminalService?.detachAll();
    destroyWebAppViews();
  });
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isMinimized()) {
    return;
  }

  store.updateWindowState({
    bounds: mainWindow.getNormalBounds(),
    isMaximized: mainWindow.isMaximized()
  });
}

function scheduleWindowStateSave() {
  clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(saveWindowState, 250);
}

function normalizeWebAppBounds(bounds) {
  const source = bounds && typeof bounds === "object" ? bounds : {};
  return {
    x: Math.max(0, Math.round(Number.isFinite(source.x) ? source.x : 0)),
    y: Math.max(0, Math.round(Number.isFinite(source.y) ? source.y : 0)),
    width: Math.max(1, Math.round(Number.isFinite(source.width) ? source.width : 1)),
    height: Math.max(1, Math.round(Number.isFinite(source.height) ? source.height : 1))
  };
}

async function readGitValue(sourcePath, args) {
  const trimmedPath = typeof sourcePath === "string" ? sourcePath.trim() : "";

  if (!trimmedPath) {
    return "";
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", trimmedPath, ...args], {
      timeout: 3000,
      windowsHide: true
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function inspectSourcePath(sourcePath) {
  const gitUrl = await readGitValue(sourcePath, ["config", "--get", "remote.origin.url"]);
  const twiccProject = await inspectTwiccProject(sourcePath, { execFileAsync });
  return {
    gitUrl,
    repoUrl: deriveRepoUrl(gitUrl),
    twiccMatchType: twiccProject?.matchType || "",
    twiccProjectUrl: twiccProject?.url || ""
  };
}

function createWebAppContextMenu(webContents, params) {
  const template = [];

  if (params.isEditable) {
    template.push(
      { role: "undo", enabled: params.editFlags?.canUndo },
      { role: "redo", enabled: params.editFlags?.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags?.canCut },
      { role: "copy", enabled: params.editFlags?.canCopy },
      { role: "paste", enabled: params.editFlags?.canPaste },
      { role: "delete", enabled: params.editFlags?.canDelete },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags?.canSelectAll }
    );
  } else if (params.selectionText) {
    template.push({ role: "copy" });
  }

  if (params.linkURL) {
    if (template.length) {
      template.push({ type: "separator" });
    }
    template.push(
      {
        label: "Open link in browser",
        click: () => shell.openExternal(params.linkURL)
      },
      {
        label: "Copy link address",
        click: () => clipboard.writeText(params.linkURL)
      }
    );
  }

  if (template.length) {
    template.push({ type: "separator" });
  }

  template.push(
    {
      label: "Back",
      enabled: webContents.canGoBack(),
      click: () => webContents.goBack()
    },
    {
      label: "Forward",
      enabled: webContents.canGoForward(),
      click: () => webContents.goForward()
    },
    {
      label: "Reload",
      click: () => webContents.reload()
    }
  );

  if (!app.isPackaged) {
    template.push(
      { type: "separator" },
      {
        label: "Inspect element",
        click: () => webContents.inspectElement(params.x, params.y)
      }
    );
  }

  return Menu.buildFromTemplate(template);
}

function ensureWebAppView(key) {
  const existing = webAppViews.get(key);
  if (existing) {
    return existing;
  }

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: WEBAPP_SESSION_PARTITION,
      preload: path.join(__dirname, "webappPreload.js"),
      sandbox: true
    }
  });
  view.setBackgroundColor("#0b0f14");
  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  view.webContents.on("context-menu", (_event, params) => {
    createWebAppContextMenu(view.webContents, params).popup({
      window: mainWindow || undefined
    });
  });
  view.webContents.on("did-navigate", (_event, url) => {
    persistWebAppUrl(key, url);
  });
  view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) {
      persistWebAppUrl(key, url);
    }
  });

  mainWindow.contentView.addChildView(view);
  webAppViews.set(key, {
    view,
    url: null
  });
  return webAppViews.get(key);
}

function persistWebAppUrl(key, url) {
  try {
    store.updateWebAppState(key, { url });
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("webapp:url-changed", {
        key: String(key),
        url
      });
    }
  } catch (error) {
    console.warn(`Could not persist webapp ${key}: ${error.message}`);
  }
}

function showWebApp({ key, url, bounds }) {
  if (!key) {
    throw new Error("Webapp key is required.");
  }

  const restoredUrl = store.getWebAppUrl(String(key));
  const parsedUrl = new URL(restoredUrl || url);

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http and https webapps are supported.");
  }

  const webApp = ensureWebAppView(String(key));
  webApp.view.setBounds(normalizeWebAppBounds(bounds));
  webApp.view.setVisible(!webAppsFrozen);
  activeWebAppKey = String(key);

  if (webApp.url !== parsedUrl.toString()) {
    webApp.url = parsedUrl.toString();
    webApp.view.webContents.loadURL(webApp.url).catch((error) => {
      console.warn(`Could not load webapp ${webApp.url}: ${error.message}`);
    });
  }
}

function setWebAppBounds(bounds) {
  if (!activeWebAppKey) {
    return;
  }

  const webApp = webAppViews.get(activeWebAppKey);
  webApp?.view.setBounds(normalizeWebAppBounds(bounds));
}

function navigateWebApp(key, action, url) {
  const webApp = webAppViews.get(String(key || ""));

  if (!webApp || webApp.view.webContents.isDestroyed()) {
    return false;
  }

  if (action === "open" || action === "home") {
    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return false;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return false;
    }

    webApp.url = parsedUrl.toString();
    webApp.view.webContents.loadURL(webApp.url).catch((error) => {
      console.warn(`Could not load webapp ${webApp.url}: ${error.message}`);
    });
    return true;
  }

  if (action === "back") {
    if (webApp.view.webContents.canGoBack()) {
      webApp.view.webContents.goBack();
      return true;
    }
    return false;
  }

  if (action === "forward") {
    if (webApp.view.webContents.canGoForward()) {
      webApp.view.webContents.goForward();
      return true;
    }
    return false;
  }

  if (action === "refresh") {
    webApp.view.webContents.reload();
    return true;
  }

  return false;
}

function setVisibleWebApps(keys) {
  visibleWebAppKeys = new Set(Array.isArray(keys) ? keys.map(String) : []);

  for (const [key, item] of webAppViews) {
    item.view.setVisible(!webAppsFrozen && visibleWebAppKeys.has(key));
  }

  activeWebAppKey = visibleWebAppKeys.size > 0 ? [...visibleWebAppKeys].at(-1) : null;
}

function hideWebApp() {
  activeWebAppKey = null;
  visibleWebAppKeys = new Set();

  for (const item of webAppViews.values()) {
    item.view.setVisible(false);
  }
}

async function freezeWebApps() {
  webAppsFrozen = true;
  const captures = [];

  for (const key of visibleWebAppKeys) {
    const item = webAppViews.get(key);
    if (!item || item.view.webContents.isDestroyed()) {
      continue;
    }

    try {
      const image = await item.view.webContents.capturePage();
      if (!image.isEmpty()) {
        captures.push({
          key,
          bounds: item.view.getBounds(),
          dataUrl: image.toDataURL()
        });
      }
    } catch (error) {
      console.warn(`Could not capture webapp ${key}: ${error.message}`);
    }
  }

  for (const item of webAppViews.values()) {
    item.view.setVisible(false);
  }

  return captures;
}

function restoreWebApps() {
  webAppsFrozen = false;

  for (const [key, item] of webAppViews) {
    item.view.setVisible(visibleWebAppKeys.has(key));
  }
}

function destroyWebAppViews() {
  for (const item of webAppViews.values()) {
    try {
      mainWindow?.contentView.removeChildView(item.view);
    } catch (error) {
      console.warn(`Could not detach webapp view: ${error.message}`);
    }

    if (!item.view.webContents.isDestroyed()) {
      item.view.webContents.close();
    }
  }
  webAppViews.clear();
  activeWebAppKey = null;
  visibleWebAppKeys = new Set();
  webAppsFrozen = false;
}

function registerIpcHandlers() {
  ipcMain.handle("state:get", () => store.getState());

  ipcMain.handle("settings:update", (_event, patch) => {
    if (
      patch?.passwordManagerEnabled === true &&
      patch?.passwordManagerDisclaimerAccepted === true &&
      !passwordManager.getStatus().encryptionAvailable
    ) {
      throw new Error(
        "Electron safeStorage is unavailable. On Linux, safeStorage depends on a secret storage backend available in the desktop session, typically gnome-libsecret or kwallet/kwallet5/kwallet6. Try launching Boatyard from your desktop session instead of a detached terminal, tmux, or headless environment."
      );
    }

    return store.updateSettings(patch);
  });

  ipcMain.handle("navigation:update", (_event, navigation) => {
    return store.updateNavigation(navigation);
  });

  ipcMain.handle("settings:select-projects-base-path", async (_event, currentPath) => {
    const dialogOptions = {
      title: "Select projects base path",
      properties: ["openDirectory", "createDirectory"]
    };

    if (typeof currentPath === "string" && currentPath.trim()) {
      dialogOptions.defaultPath = currentPath.trim();
    }

    const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("projects:inspect-source-path", (_event, sourcePath) => {
    return inspectSourcePath(sourcePath);
  });

  ipcMain.handle("projects:create-twicc-project", async (_event, sourcePath) => {
    return createTwiccProject(sourcePath, { execFileAsync });
  });

  ipcMain.handle("twicc:project-process-statuses", async () => {
    return loadTwiccProjectProcessStatuses({ execFileAsync });
  });

  ipcMain.handle("projects:add", (_event, projectConfig) => {
    return store.addProject(projectConfig);
  });

  ipcMain.handle("projects:update", (_event, id, patch) => {
    return store.updateProject(id, patch);
  });

  ipcMain.handle("projects:reorder", (_event, projectIds) => {
    return store.reorderProjects(projectIds);
  });

  ipcMain.handle("projects:remove", (_event, id) => {
    return store.removeProject(id);
  });

  ipcMain.handle("plugins:enabled:update", (_event, pluginId, enabled) => {
    return store.updatePluginEnabled(pluginId, enabled);
  });

  ipcMain.handle("global-plugin-config:update", (_event, pluginId, patch) => {
    return store.updateGlobalPluginConfig(pluginId, patch);
  });

  ipcMain.handle("project-plugin-config:update", (_event, projectId, pluginId, patch) => {
    return store.updateProjectPluginConfig(projectId, pluginId, patch);
  });

  ipcMain.handle("pane-layout:update", (_event, projectId, layout) => {
    return store.updatePaneLayout(projectId, layout);
  });

  ipcMain.handle("widget-layout:update", (_event, projectId, layout) => {
    return store.updateWidgetLayout(projectId, layout);
  });

  ipcMain.handle("terminal:tabs", (_event, projectId) => {
    return terminalService.listTabs(projectId);
  });

  ipcMain.handle("terminal:create-tab", (_event, projectId, name) => {
    return terminalService.createTab(projectId, name);
  });

  ipcMain.handle("terminal:rename-tab", (_event, projectId, windowId, name) => {
    return terminalService.renameTab(projectId, windowId, name);
  });

  ipcMain.handle("terminal:close-tab", (_event, projectId, windowId) => {
    return terminalService.closeTab(projectId, windowId);
  });

  ipcMain.handle("terminal:attach", (_event, projectId, windowId, size) => {
    return terminalService.attach(projectId, windowId, size);
  });

  ipcMain.handle("terminal:selection:update", (_event, projectId, surfaceKey, windowId) => {
    return store.updateTerminalSelection(projectId, surfaceKey, windowId);
  });

  ipcMain.handle("terminal:tab-order:update", (_event, projectId, windowIds) => {
    return store.updateTerminalTabOrder(projectId, windowIds);
  });

  ipcMain.handle("terminal:write", (_event, terminalId, data) => {
    terminalService.write(terminalId, data);
  });

  ipcMain.handle("terminal:resize", (_event, terminalId, size) => {
    terminalService.resize(terminalId, size);
  });

  ipcMain.handle("terminal:detach", (_event, terminalId) => {
    terminalService.detach(terminalId);
  });

  ipcMain.handle("terminal:write-selection", (_event, text) => {
    clipboard.writeText(String(text || ""), "selection");
  });

  ipcMain.handle("terminal:read-selection", () => {
    return clipboard.readText("selection");
  });

  ipcMain.handle("hawser:widget-data-for-config", (_event, projectId, projectConfig = {}, globalConfig = {}) => {
    const state = store.getState();
    const project = state.projects.find((item) => item.id === String(projectId || ""));
    return getHawserWidgetData({
      ...project,
      hawserMainSession: projectConfig.hawserMainSession
    }, {
      hawserApiUrl: globalConfig.hawserApiUrl,
      hawserToken: globalConfig.hawserToken
    });
  });

  ipcMain.handle("hawser:status-for-config", (_event, globalConfig = {}) => {
    return getHawserStatus({
      hawserApiUrl: globalConfig.hawserApiUrl,
      hawserToken: globalConfig.hawserToken
    });
  });

  ipcMain.handle("password-manager:status", () => {
    return passwordManager.getStatus();
  });

  ipcMain.handle("password-manager:get-credential", (_event, url) => {
    return passwordManager.getCredential(url);
  });

  ipcMain.handle("password-manager:save-credential", (_event, credential) => {
    return passwordManager.saveCredential(credential);
  });

  ipcMain.handle("webapp:show", (_event, webApp) => {
    showWebApp(webApp);
  });

  ipcMain.handle("webapp:set-bounds", (_event, bounds) => {
    setWebAppBounds(bounds);
  });

  ipcMain.handle("webapp:navigate", (_event, key, action, url) => {
    return navigateWebApp(key, action, url);
  });

  ipcMain.handle("webapp:set-visible", (_event, keys) => {
    setVisibleWebApps(keys);
  });

  ipcMain.handle("webapp:hide", () => {
    hideWebApp();
  });

  ipcMain.handle("webapp:freeze", () => {
    return freezeWebApps();
  });

  ipcMain.handle("webapp:restore", () => {
    restoreWebApps();
  });

  ipcMain.handle("clipboard:write-text", (_event, text) => {
    clipboard.writeText(String(text || ""));
  });

  ipcMain.handle("shell:open-external", (_event, url) => {
    return shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  store = new ProjectStore(getStorePath());
  store.load();
  passwordManager = new PasswordManager({
    store,
    confirmSave: async ({ origin, username, isUpdate }) => {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: [isUpdate ? "Update password" : "Save password", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        title: "Boatyard password manager",
        message: `${isUpdate ? "Update" : "Save"} password for ${origin}?`,
        detail: `Username: ${username}\n\nBoatyard stores this password encrypted for the current OS user. This is a minimal local password manager, not a hardened replacement for a dedicated password manager.`
      });
      return result.response === 0;
    }
  });
  terminalService = new TerminalService({
    getProject: (projectId) => store.getState().projects.find((project) => project.id === projectId),
    getSettings: () => store.getState().settings,
    sendToRenderer: (channel, payload) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    }
  });
  registerIpcHandlers();
  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
