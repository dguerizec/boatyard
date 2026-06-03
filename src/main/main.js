"use strict";

const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { ProjectStore } = require("./store");

let mainWindow = null;
let store = null;

function getStorePath() {
  if (process.env.DASHTOP_STATE_PATH) {
    return process.env.DASHTOP_STATE_PATH;
  }

  return path.join(app.getPath("userData"), "dashtop-state.json");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
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
