"use strict";

const path = require("node:path");
const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require("electron");
const { ProjectStore } = require("./store");

let mainWindow = null;
let store = null;
let saveWindowStateTimer = null;
const webAppViews = new Map();
let activeWebAppKey = null;

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
  webApp.view.setVisible(true);
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

function setVisibleWebApps(keys) {
  const visibleKeys = new Set(Array.isArray(keys) ? keys.map(String) : []);

  for (const [key, item] of webAppViews) {
    item.view.setVisible(visibleKeys.has(key));
  }

  activeWebAppKey = visibleKeys.size > 0 ? [...visibleKeys].at(-1) : null;
}

function hideWebApp() {
  activeWebAppKey = null;

  for (const item of webAppViews.values()) {
    item.view.setVisible(false);
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
}

function registerIpcHandlers() {
  ipcMain.handle("state:get", () => store.getState());

  ipcMain.handle("projects:add", (_event, projectConfig) => {
    return store.addProject(projectConfig);
  });

  ipcMain.handle("projects:update", (_event, id, patch) => {
    return store.updateProject(id, patch);
  });

  ipcMain.handle("projects:remove", (_event, id) => {
    return store.removeProject(id);
  });

  ipcMain.handle("webapp:show", (_event, webApp) => {
    showWebApp(webApp);
  });

  ipcMain.handle("webapp:set-bounds", (_event, bounds) => {
    setWebAppBounds(bounds);
  });

  ipcMain.handle("webapp:set-visible", (_event, keys) => {
    setVisibleWebApps(keys);
  });

  ipcMain.handle("webapp:hide", () => {
    hideWebApp();
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
