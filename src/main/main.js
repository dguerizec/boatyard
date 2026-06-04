"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const { app, BrowserWindow, WebContentsView, dialog, ipcMain, shell } = require("electron");
const { ProjectStore, deriveRepoUrl } = require("./store");

const execFileAsync = promisify(execFile);

let mainWindow = null;
let store = null;
let saveWindowStateTimer = null;
const webAppViews = new Map();
let activeWebAppKey = null;
let visibleWebAppKeys = new Set();
let webAppsFrozen = false;

function getStorePath() {
  if (process.env.DASHTOP_STATE_PATH) {
    return process.env.DASHTOP_STATE_PATH;
  }

  return path.join(app.getPath("userData"), "dashtop-state.json");
}

function createMainWindow() {
  const windowState = store.getWindowState();

  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 920,
    minHeight: 620,
    title: "Dashtop",
    icon: path.join(__dirname, "../renderer/assets/dashtop-icon.png"),
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
  return {
    gitUrl,
    repoUrl: deriveRepoUrl(gitUrl)
  };
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
      sandbox: true
    }
  });
  view.setBackgroundColor("#0b0f14");
  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
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
    return store.updateSettings(patch);
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

  ipcMain.handle("pane-layout:update", (_event, projectId, layout) => {
    return store.updatePaneLayout(projectId, layout);
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

  ipcMain.handle("shell:open-external", (_event, url) => {
    return shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  store = new ProjectStore(getStorePath());
  store.load();
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
