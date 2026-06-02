"use strict";

const path = require("node:path");
const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require("electron");
const { AppStore, normalizeBounds } = require("./store");

let mainWindow = null;
let store = null;
let viewsSuspended = false;
const views = new Map();

function getStorePath() {
  return path.join(app.getPath("userData"), "dashtop-state.json");
}

function createAppView(appConfig) {
  const existing = views.get(appConfig.id);

  if (existing) {
    return existing;
  }

  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  view.webContents.on("will-navigate", (event, url) => {
    if (!/^https?:\/\//i.test(url)) {
      event.preventDefault();
    }
  });
  view.webContents.loadURL(appConfig.url);
  views.set(appConfig.id, view);
  return view;
}

function attachView(appConfig) {
  if (!mainWindow || mainWindow.isDestroyed() || viewsSuspended) {
    return;
  }

  const view = createAppView(appConfig);
  mainWindow.contentView.removeChildView(view);
  mainWindow.contentView.addChildView(view);
}

function detachView(id) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const view = views.get(id);

  if (view) {
    mainWindow.contentView.removeChildView(view);
  }
}

function destroyView(id) {
  const view = views.get(id);

  if (!view) {
    return;
  }

  detachView(id);
  view.webContents.close();
  views.delete(id);
}

function syncViewsFromState() {
  const state = store.getState();
  const appIds = new Set(state.apps.map((appConfig) => appConfig.id));

  for (const id of views.keys()) {
    if (!appIds.has(id)) {
      destroyView(id);
    }
  }

  for (const appConfig of state.apps) {
    if (appConfig.isOpen && !viewsSuspended) {
      attachView(appConfig);
    } else {
      detachView(appConfig.id);
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    title: "Dashtop",
    backgroundColor: "#101418",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    syncViewsFromState();

    if (process.argv.includes("--smoke")) {
      setTimeout(() => app.quit(), 500);
    }
  });
  mainWindow.on("closed", () => {
    for (const id of views.keys()) {
      destroyView(id);
    }
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("state:get", () => store.getState());

  ipcMain.handle("apps:add", (_event, appConfig) => {
    const state = store.addApp(appConfig);
    syncViewsFromState();
    return state;
  });

  ipcMain.handle("apps:update", (_event, id, patch) => {
    const state = store.updateApp(id, patch);
    syncViewsFromState();
    return state;
  });

  ipcMain.handle("apps:remove", (_event, id) => {
    destroyView(id);
    return store.removeApp(id);
  });

  ipcMain.handle("views:set-bounds", (_event, id, bounds) => {
    const view = views.get(id);

    if (!view) {
      return false;
    }

    view.setBounds(normalizeBounds(bounds));
    return true;
  });

  ipcMain.handle("views:focus", (_event, id) => {
    const appConfig = store.getState().apps.find((candidate) => candidate.id === id);

    if (!appConfig || !appConfig.isOpen) {
      return false;
    }

    attachView(appConfig);
    return true;
  });

  ipcMain.handle("views:suspend", () => {
    viewsSuspended = true;

    for (const appConfig of store.getState().apps) {
      detachView(appConfig.id);
    }

    return true;
  });

  ipcMain.handle("views:resume", () => {
    viewsSuspended = false;
    syncViewsFromState();
    return true;
  });
}

app.whenReady().then(() => {
  store = new AppStore(getStorePath());
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
