import type {
  BrowserWindow as ElectronBrowserWindow,
  ContextMenuParams,
  HandlerDetails,
  IpcMainInvokeEvent,
  IpcMainEvent,
  Rectangle,
  WebContents as ElectronWebContents
} from "electron";
import type {
  MainProject,
  PasswordManagerInstance,
  PluginHostInstance,
  ProjectStoreInstance,
  ShowWebAppPayload,
  TerminalServiceInstance,
  UnknownRecord,
  UpdateManagerInstance,
  WebAppCapture,
  WebAppItem,
  WebAppLookup,
  WebAppOpenOptions
} from "./mainTypes.js";
import { createWebAppContextMenu } from "./webAppContextMenu.js";
import { WorkspaceWindowRuntime } from "./workspaceWindowRuntime.js";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const { app, BrowserWindow, WebContentsView, clipboard, dialog, ipcMain, screen, shell } = require("electron");
const { createCaptureRunner } = require("./captureRunner");
const { PasswordManager } = require("./passwordManager");
const { PluginHost } = require("./pluginHost");
const { ProjectStore, deriveRepoUrl } = require("./store");
const { TerminalService } = require("./terminalService");
const { createUpdateManager, normalizeVersionTag } = require("./updateManager");

const execFileAsync = promisify(execFile);
const WEBAPP_SESSION_PARTITION = "persist:boatyard-webapps";
const WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS = 350;
const DEFAULT_WEBAPP_BACKGROUND_COLOR = "#0b0f14";

if (process.env.BOATYARD_USER_DATA_PATH) {
  app.setPath("userData", process.env.BOATYARD_USER_DATA_PATH);
}

let mainWindow: ElectronBrowserWindow | null = null;
let store: ProjectStoreInstance;
let terminalService: TerminalServiceInstance;
let passwordManager: PasswordManagerInstance;
let pluginHost: PluginHostInstance;
let updateManager: UpdateManagerInstance;
type WorkspaceWindowRecord = {
  id: string;
  runtime: WorkspaceWindowRuntime;
  saveStateTimer: ReturnType<typeof setTimeout> | null;
  syncGroupId: string;
  window: ElectronBrowserWindow;
};
const workspaceWindows = new Map<string, WorkspaceWindowRecord>();
const individuallyClosingWindowIds = new Set<string>();
let isQuitting = false;
const webAppViews = new Map<string, WebAppItem>();
let activeWebAppKey: string | null = null;
let visibleWebAppKeys = new Set<string>();
type WebAppFreeze = { all: boolean; keys: Set<string>; rect: Rectangle | null };
const webAppFreezes = new Map<number, WebAppFreeze>();
let nextWebAppFreezeToken = 1;
const captureRunner = createCaptureRunner({
  getMainWindow: () => getPrimaryWorkspaceWindow()?.window || null,
  quitApp: () => app.quit()
});

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getConfigDirectory() {
  if (process.env.BOATYARD_CONFIG_PATH) {
    return process.env.BOATYARD_CONFIG_PATH;
  }

  return app.isPackaged
    ? path.join(app.getPath("home"), ".boatyard")
    : path.join(process.cwd(), ".boatyard");
}

function getLegacyStorePath() {
  return process.env.BOATYARD_STATE_PATH || path.join(app.getPath("userData"), "boatyard-state.json");
}

function getPrimaryWorkspaceWindow() {
  return workspaceWindows.values().next().value as WorkspaceWindowRecord | undefined;
}

function getWorkspaceWindowForWebContents(webContents: ElectronWebContents) {
  return [...workspaceWindows.values()].find((workspaceWindow) => workspaceWindow.window.webContents.id === webContents.id) || null;
}

function getWorkspaceWindowForWebAppContents(webContents: ElectronWebContents) {
  return [...workspaceWindows.values()].find((workspaceWindow) => workspaceWindow.runtime.getWebAppForWebContents(webContents)) || null;
}

function getRestoredWindowBounds(bounds: Partial<Rectangle>) {
  const normalized = {
    x: Math.round(Number(bounds.x) || 0),
    y: Math.round(Number(bounds.y) || 0),
    width: Math.max(920, Math.round(Number(bounds.width) || 1280)),
    height: Math.max(620, Math.round(Number(bounds.height) || 800))
  };
  const isVisibleOnAnyDisplay = screen.getAllDisplays().some((display: { workArea: Rectangle }) => {
    const workArea = display.workArea;
    return normalized.x < workArea.x + workArea.width &&
      normalized.x + normalized.width > workArea.x &&
      normalized.y < workArea.y + workArea.height &&
      normalized.y + normalized.height > workArea.y;
  });
  if (isVisibleOnAnyDisplay) {
    return normalized;
  }

  const primaryWorkArea = screen.getPrimaryDisplay().workArea as Rectangle;
  return {
    x: primaryWorkArea.x + Math.max(0, Math.round((primaryWorkArea.width - Math.min(1280, primaryWorkArea.width)) / 2)),
    y: primaryWorkArea.y + Math.max(0, Math.round((primaryWorkArea.height - Math.min(800, primaryWorkArea.height)) / 2)),
    width: Math.min(1280, primaryWorkArea.width),
    height: Math.min(800, primaryWorkArea.height)
  };
}

type CreateWorkspaceWindowOptions = {
  id?: string;
  sourceWindowId?: string | null;
  syncGroupId?: string;
};

function createMainWindow(options: CreateWorkspaceWindowOptions = {}) {
  const workspaceWindowId = options.id || crypto.randomUUID();
  const syncGroupId = options.syncGroupId || crypto.randomUUID();
  const persistedWorkspaceWindow = store.ensureWorkspaceWindow(workspaceWindowId, syncGroupId, options.sourceWindowId) as {
    window: { bounds: Partial<Rectangle>; isFullScreen?: boolean; isMaximized?: boolean };
  };
  const windowState = persistedWorkspaceWindow.window;

  const window = new BrowserWindow({
    ...getRestoredWindowBounds(windowState.bounds),
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
  mainWindow = window;
  const workspaceWindow: WorkspaceWindowRecord = {
    id: workspaceWindowId,
    syncGroupId,
    window,
    runtime: new WorkspaceWindowRuntime({
      id: workspaceWindowId,
      window,
      store,
      openExternalUrl
    }),
    saveStateTimer: null
  };
  workspaceWindows.set(workspaceWindow.id, workspaceWindow);

  if (windowState.isMaximized) {
    window.maximize();
  }
  if (windowState.isFullScreen) {
    window.setFullScreen(true);
  }

  window.loadFile(path.join(__dirname, "../renderer/index.html"));
  if (captureRunner.isCaptureMode()) {
    window.webContents.on("console-message", (event: UnknownRecord) => {
      const details = event;
      console.log(`[capture renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    });
    window.webContents.on("render-process-gone", (_event: Event, details: { reason?: string }) => {
      console.error(`[capture renderer gone] ${details.reason}`);
    });
  }
  window.once("ready-to-show", () => {
    window.show();

    if (captureRunner.isCaptureMode()) {
      captureRunner.runCaptureRequest().catch((error: Error) => {
        console.error(`Capture failed: ${error.stack || error.message}`);
        app.exit(1);
      });
      return;
    }

    if (process.argv.includes("--smoke")) {
      setTimeout(() => app.quit(), 500);
    }
  });
  window.on("closed", () => {
    workspaceWindows.delete(workspaceWindow.id);
    mainWindow = null;
  });

  window.on("move", () => scheduleWindowStateSave(workspaceWindow));
  window.on("resize", () => scheduleWindowStateSave(workspaceWindow));
  window.on("maximize", () => saveWindowState(workspaceWindow));
  window.on("unmaximize", () => saveWindowState(workspaceWindow));
  window.on("enter-full-screen", () => saveWindowState(workspaceWindow));
  window.on("leave-full-screen", () => saveWindowState(workspaceWindow));
  window.on("close", (event: Event) => {
    if (!isQuitting && !individuallyClosingWindowIds.has(workspaceWindow.id)) {
      event.preventDefault();
      void dialog.showMessageBox(window, {
        type: "question",
        title: "Close Boatyard",
        message: "What would you like to close?",
        buttons: ["Close this window", "Quit Boatyard", "Cancel"],
        defaultId: 0,
        cancelId: 2
      }).then((result: { response: number }) => {
        if (result.response === 0) {
          individuallyClosingWindowIds.add(workspaceWindow.id);
          window.close();
        } else if (result.response === 1) {
          isQuitting = true;
          app.quit();
        }
      });
      return;
    }
    saveWindowState(workspaceWindow);
    if (individuallyClosingWindowIds.delete(workspaceWindow.id)) {
      store.removeWorkspaceWindow(workspaceWindow.id);
    }
    if (isQuitting) {
      terminalService?.detachAll();
    }
    workspaceWindow.runtime.destroy();
  });
}

function saveWindowState(workspaceWindow: WorkspaceWindowRecord) {
  if (workspaceWindow.window.isMinimized()) {
    return;
  }

  store.updateWorkspaceWindowState(workspaceWindow.id, {
    bounds: workspaceWindow.window.getNormalBounds(),
    isMaximized: workspaceWindow.window.isMaximized(),
    isFullScreen: workspaceWindow.window.isFullScreen()
  });
}

function scheduleWindowStateSave(workspaceWindow: WorkspaceWindowRecord) {
  if (workspaceWindow.saveStateTimer) {
    clearTimeout(workspaceWindow.saveStateTimer);
  }
  workspaceWindow.saveStateTimer = setTimeout(() => saveWindowState(workspaceWindow), 250);
}

function sendWorkspaceNavigation(windowId: string, navigation: unknown) {
  const workspaceWindow = workspaceWindows.get(windowId);
  if (!workspaceWindow || workspaceWindow.window.webContents.isDestroyed()) {
    return;
  }
  workspaceWindow.window.webContents.send("workspace:navigation-changed", navigation);
}

function normalizeWebAppBounds(bounds: unknown): Rectangle {
  const source = bounds && typeof bounds === "object" ? bounds as Partial<Record<keyof Rectangle, unknown>> : {};
  return {
    x: Math.max(0, Math.round(finiteNumber(source.x, 0))),
    y: Math.max(0, Math.round(finiteNumber(source.y, 0))),
    width: Math.max(1, Math.round(finiteNumber(source.width, 1))),
    height: Math.max(1, Math.round(finiteNumber(source.height, 1)))
  };
}

async function readGitValue(sourcePath: unknown, args: string[]) {
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

async function inspectSourcePath(sourcePath: string) {
  const gitUrl = await readGitValue(sourcePath, ["config", "--get", "remote.origin.url"]);
  const plugins = await pluginHost.inspectSourcePath({
    sourcePath,
    gitUrl,
    repoUrl: deriveRepoUrl(gitUrl)
  });

  return {
    gitUrl,
    repoUrl: deriveRepoUrl(gitUrl),
    plugins
  };
}

function parseHttpUrl(url: unknown) {
  try {
    const parsedUrl = new URL(String(url || ""));
    return ["http:", "https:"].includes(parsedUrl.protocol) ? parsedUrl : null;
  } catch {
    return null;
  }
}

function openExternalUrl(url: unknown) {
  return shell.openExternal(String(url || ""));
}

function sendWebAppOpenUrlRequest(sourceWebAppKey: unknown, url: unknown, source = "window-open", options: WebAppOpenOptions = {}) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return false;
  }

  mainWindow.webContents.send("webapp:open-url-requested", {
    sourceWebAppKey: String(sourceWebAppKey || ""),
    url: String(url || ""),
    source,
    target: String(options.target || ""),
    sourceUrl: String(options.sourceUrl || ""),
    sourceBounds: options.sourceBounds || null
  });
  return true;
}

function sendWebAppOpenUrlRequestFromItem(key: string, webApp: WebAppItem | undefined, url: unknown, source: string, options: WebAppOpenOptions = {}) {
  if (!key || !webApp) {
    return false;
  }

  return sendWebAppOpenUrlRequest(key, url, source, {
    sourceBounds: webApp.bounds || null,
    sourceUrl: webApp.url || "",
    ...options
  });
}

function loadWebAppUrl(webApp: WebAppItem | undefined, url: unknown) {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl || !webApp || webApp.view.webContents.isDestroyed()) {
    return false;
  }

  webApp.url = parsedUrl.toString();
  webApp.view.webContents.loadURL(webApp.url).catch((error: Error) => {
    console.warn(`Could not load webapp ${webApp.url}: ${error.message}`);
  });
  return true;
}

function sendWebAppLoaded(key: unknown, url: string, status = "loaded") {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("webapp:loaded", {
    key: String(key),
    url,
    status
  });
}

function handleWebAppWindowOpen(key: string, details: HandlerDetails) {
  const url = details?.url || "";
  const webApp = webAppViews.get(key);

  if (!sendWebAppOpenUrlRequestFromItem(key, webApp, url, details?.disposition || "window-open")) {
    openExternalUrl(url);
  }
  return { action: "deny" };
}

function ensureWebAppView(key: string): WebAppItem {
  const existing = webAppViews.get(key);
  if (existing) {
    return existing;
  }

  if (!mainWindow) {
    throw new Error("Main window is not available.");
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
  view.setBackgroundColor(DEFAULT_WEBAPP_BACKGROUND_COLOR);
  view.webContents.setWindowOpenHandler((details: HandlerDetails) => handleWebAppWindowOpen(key, details));
  view.webContents.on("context-menu", (_event: Event, params: ContextMenuParams) => {
    void createWebAppContextMenu(view.webContents, params, {
      getSourceKey: (webContents) => getWebAppForWebContents(webContents)?.key || "",
      openExternalUrl,
      sendOpenUrlRequest: sendWebAppOpenUrlRequest
    }).then((menu) => {
      if (!view.webContents.isDestroyed()) {
        menu.popup({
          window: mainWindow || undefined
        });
      }
    });
  });
  view.webContents.on("did-navigate", (_event: Event, url: string) => {
    persistWebAppUrl(key, url);
  });
  view.webContents.on("did-navigate-in-page", (_event: Event, url: string, isMainFrame: boolean) => {
    if (isMainFrame) {
      persistWebAppUrl(key, url);
    }
  });
  view.webContents.on("did-finish-load", () => {
    sendWebAppLoaded(key, view.webContents.getURL());
  });
  view.webContents.on("did-fail-load", (_event: Event, errorCode: number, errorDescription: string, validatedUrl: string, isMainFrame: boolean) => {
    if (isMainFrame) {
      sendWebAppLoaded(key, validatedUrl || view.webContents.getURL(), `failed:${errorCode}:${errorDescription}`);
    }
  });
  view.webContents.on("dom-ready", () => {
    const item = webAppViews.get(key);
    view.webContents.send("webapp:autofill-enabled", item?.autofillEnabled === true);
  });

  mainWindow.contentView.addChildView(view);
  const item: WebAppItem = {
    view,
    url: null,
    bounds: null,
    autofillEnabled: false
  };
  webAppViews.set(key, item);
  return item;
}

function getWebAppForWebContents(webContents: ElectronWebContents): WebAppLookup | null {
  for (const [key, item] of webAppViews) {
    if (item.view.webContents.id === webContents.id) {
      return { key, item };
    }
  }

  return null;
}

function persistWebAppUrl(key: string, url: string) {
  try {
    store.updateWebAppState(key, { url });
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("webapp:url-changed", {
        key: String(key),
        url
      });
    }
  } catch (error) {
    console.warn(`Could not persist webapp ${key}: ${(error as Error).message}`);
  }
}

function normalizeWebAppBackgroundColor(backgroundColor: unknown) {
  return backgroundColor === "#ffffff" ? "#ffffff" : DEFAULT_WEBAPP_BACKGROUND_COLOR;
}

function showWebApp({ key, url, bounds, autofillEnabled, backgroundColor, restoreUrl = true }: ShowWebAppPayload) {
  if (!key) {
    throw new Error("Webapp key is required.");
  }

  const restoredUrl = store.getWebAppUrl(String(key));
  const nextUrl = restoreUrl === false ? url : (restoredUrl || url);
  if (!nextUrl) {
    throw new Error("Webapp URL is required.");
  }
  const parsedUrl = new URL(nextUrl);

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http and https webapps are supported.");
  }

  const webApp = ensureWebAppView(String(key));
  if (typeof autofillEnabled === "boolean") {
    webApp.autofillEnabled = autofillEnabled;
  }
  webApp.view.setBackgroundColor(normalizeWebAppBackgroundColor(backgroundColor));
  webApp.bounds = normalizeWebAppBounds(bounds);
  webApp.view.setBounds(webApp.bounds);
  webApp.view.setVisible(
    visibleWebAppKeys.has(String(key)) &&
    !isWebAppKeyFrozen(String(key))
  );
  activeWebAppKey = String(key);

  const currentUrl = webApp.view.webContents.getURL();
  if (webApp.url !== parsedUrl.toString() && currentUrl !== parsedUrl.toString()) {
    loadWebAppUrl(webApp, parsedUrl.toString());
  } else if (!webApp.view.webContents.isLoadingMainFrame()) {
    sendWebAppLoaded(key, webApp.view.webContents.getURL());
  }
}

function setWebAppBounds(bounds: unknown) {
  if (!activeWebAppKey) {
    return;
  }

  const webApp = webAppViews.get(activeWebAppKey);
  webApp?.view.setBounds(normalizeWebAppBounds(bounds));
}

function getWebAppNavigationHistory(key: unknown) {
  const webApp = webAppViews.get(String(key || ""));
  if (!webApp || webApp.view.webContents.isDestroyed()) {
    return {
      activeIndex: -1,
      entries: []
    };
  }

  const history = webApp.view.webContents.navigationHistory;
  return {
    activeIndex: history.getActiveIndex(),
    entries: history.getAllEntries().map((entry, index) => ({
      index,
      title: entry.title || "",
      url: entry.url || ""
    }))
  };
}

async function navigateWebApp(key: unknown, action: string, url: string) {
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

    return loadWebAppUrl(webApp, parsedUrl.toString());
  }

  if (action === "history-index") {
    const index = Number(url);
    const history = webApp.view.webContents.navigationHistory;
    if (Number.isInteger(index) && index >= 0 && index < history.length() && index !== history.getActiveIndex()) {
      history.goToIndex(index);
      return true;
    }
    return false;
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

  if (action === "hard-refresh") {
    await webApp.view.webContents.session.clearCache();
    webApp.view.webContents.reloadIgnoringCache();
    return true;
  }

  return false;
}

function updateWebAppAutofill(key: unknown, enabled: unknown) {
  const webApp = webAppViews.get(String(key || ""));
  if (!webApp || webApp.view.webContents.isDestroyed()) {
    return false;
  }

  webApp.autofillEnabled = enabled === true;
  webApp.view.webContents.send("webapp:autofill-enabled", webApp.autofillEnabled);
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("webapp:autofill-changed", {
      key: String(key),
      enabled: webApp.autofillEnabled
    });
  }
  return webApp.autofillEnabled;
}

function setVisibleWebApps(keys: unknown) {
  visibleWebAppKeys = new Set(Array.isArray(keys) ? keys.map(String) : []);

  for (const [key, item] of webAppViews) {
    item.view.setVisible(visibleWebAppKeys.has(key) && !isWebAppKeyFrozen(key));
  }

  activeWebAppKey = visibleWebAppKeys.size > 0 ? [...visibleWebAppKeys].at(-1) || null : null;
}

function hideWebApp() {
  activeWebAppKey = null;
  visibleWebAppKeys = new Set();
  webAppFreezes.clear();

  for (const item of webAppViews.values()) {
    item.view.setVisible(false);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    })
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

async function captureWebAppForFreeze(key: string): Promise<WebAppCapture | null> {
  const item = webAppViews.get(key);
  if (!item || item.view.webContents.isDestroyed()) {
    return null;
  }

  try {
    const image = await withTimeout(
      item.view.webContents.capturePage(),
      WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS,
      "capture timed out"
    );

    if (image.isEmpty()) {
      return null;
    }

    return {
      key,
      bounds: item.view.getBounds(),
      dataUrl: image.toDataURL()
    };
  } catch (error) {
    console.warn(`Could not capture webapp ${key}: ${(error as Error).message}`);
    return null;
  }
}

function getWebAppFreezeKeys(options: UnknownRecord = {}, rect: Rectangle | null = null) {
  const hasKeyFilter = Object.prototype.hasOwnProperty.call(options || {}, "keys");
  const requestedKeys = Array.isArray(options?.keys)
    ? options.keys.map(String).filter(Boolean)
    : [];

  if (hasKeyFilter) {
    return requestedKeys.filter((key) => visibleWebAppKeys.has(key));
  }

  const selectByRect = options?.selectByRect === true && rect;
  if (!selectByRect) {
    return [...visibleWebAppKeys];
  }

  return [...visibleWebAppKeys].filter((key) => {
    const bounds = webAppViews.get(key)?.bounds || null;
    return bounds ? webAppRectsIntersect(rect, bounds) : false;
  });
}

function webAppRectsIntersect(left: Rectangle, right: Rectangle) {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

function isWebAppKeyFrozen(key: string) {
  const bounds = webAppViews.get(key)?.bounds || null;

  for (const freeze of webAppFreezes.values()) {
    if (freeze.all || freeze.keys.has(key)) {
      return true;
    }

    if (freeze.rect && bounds && webAppRectsIntersect(freeze.rect, bounds)) {
      return true;
    }
  }

  return false;
}

async function freezeWebApps(options: UnknownRecord = {}) {
  const hasKeyFilter = Object.prototype.hasOwnProperty.call(options || {}, "keys");
  const hasRect = Boolean(options?.rect && typeof options.rect === "object");
  const rect = hasRect ? normalizeWebAppBounds(options.rect) : null;
  const selectByRect = options?.selectByRect === true && rect !== null;
  const freezeKeys = getWebAppFreezeKeys(options, rect);
  const token = nextWebAppFreezeToken;
  nextWebAppFreezeToken += 1;
  webAppFreezes.set(token, {
    all: !hasKeyFilter && !selectByRect,
    keys: new Set(freezeKeys),
    rect
  });
  const captures = (await Promise.all(freezeKeys.map(captureWebAppForFreeze))).filter(Boolean);

  for (const key of freezeKeys) {
    webAppViews.get(key)?.view.setVisible(false);
  }

  return { token, captures };
}

function restoreWebApps(token: unknown = undefined) {
  if (token === undefined || token === null) {
    webAppFreezes.clear();
  } else if (Number.isFinite(Number(token))) {
    webAppFreezes.delete(Number(token));
  }

  for (const [key, item] of webAppViews) {
    item.view.setVisible(visibleWebAppKeys.has(key) && !isWebAppKeyFrozen(key));
  }
}

function destroyWebAppViews() {
  for (const item of webAppViews.values()) {
    try {
      mainWindow?.contentView.removeChildView(item.view);
    } catch (error) {
      console.warn(`Could not detach webapp view: ${(error as Error).message}`);
    }

    if (!item.view.webContents.isDestroyed()) {
      item.view.webContents.close();
    }
  }
  webAppViews.clear();
  activeWebAppKey = null;
  visibleWebAppKeys = new Set();
  webAppFreezes.clear();
}

void [
  showWebApp,
  setWebAppBounds,
  getWebAppNavigationHistory,
  navigateWebApp,
  updateWebAppAutofill,
  setVisibleWebApps,
  hideWebApp,
  freezeWebApps,
  restoreWebApps,
  destroyWebAppViews
];

function registerIpcHandlers() {
  ipcMain.on("webapp:modified-link-click", (event: IpcMainEvent, payload: unknown) => {
    const source = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as UnknownRecord
      : {};
    const workspaceWindow = getWorkspaceWindowForWebAppContents(event.sender);
    const webApp = workspaceWindow?.runtime.getWebAppForWebContents(event.sender);
    if (!workspaceWindow || !webApp) {
      openExternalUrl(source.url);
      return;
    }

    workspaceWindow.runtime.handleModifiedLinkClick({
      webContents: event.sender,
      url: source.url,
      source: String(source.source || "modified-click")
    });
  });

  ipcMain.handle("state:get", (event: IpcMainInvokeEvent) => {
    const workspaceWindow = getWorkspaceWindowForWebContents(event.sender);
    return workspaceWindow ? store.getStateForWorkspaceWindow(workspaceWindow.id) : store.getState();
  });

  ipcMain.handle("settings:update", (_event: IpcMainInvokeEvent, patch: UnknownRecord) => {
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

  ipcMain.handle("navigation:update", (event: IpcMainInvokeEvent, navigation: unknown) => {
    const workspaceWindow = getWorkspaceWindowForWebContents(event.sender);
    if (!workspaceWindow) {
      return store.updateNavigation(navigation);
    }
    const updated = store.updateWorkspaceNavigation(workspaceWindow.id, navigation);
    for (const [windowId, nextNavigation] of Object.entries(updated)) {
      sendWorkspaceNavigation(windowId, nextNavigation);
    }
    return updated[workspaceWindow.id] || store.getStateForWorkspaceWindow(workspaceWindow.id).navigation;
  });

  ipcMain.handle("onboarding:update", (_event: IpcMainInvokeEvent, onboarding: unknown) => {
    return store.updateOnboarding(onboarding);
  });

  ipcMain.handle("workspace:create-window", async (event: IpcMainInvokeEvent) => {
    const sourceWorkspaceWindow = getWorkspaceWindowForWebContents(event.sender);
    if (!sourceWorkspaceWindow) {
      throw new Error("Source workspace window is not available.");
    }
    const result = await dialog.showMessageBox(sourceWorkspaceWindow.window, {
      type: "question",
      title: "Split screen",
      message: "Should the new window synchronize project switching with this window?",
      buttons: ["Synchronize workspace", "Independent workspace", "Cancel"],
      defaultId: 0,
      cancelId: 2
    });
    if (result.response === 2) {
      return false;
    }
    createMainWindow({
      sourceWindowId: sourceWorkspaceWindow.id,
      syncGroupId: result.response === 0 ? sourceWorkspaceWindow.syncGroupId : crypto.randomUUID()
    });
    return true;
  });

  ipcMain.handle("settings:select-projects-base-path", async (event: IpcMainInvokeEvent, currentPath: unknown) => {
    const dialogOptions: UnknownRecord = {
      title: "Select projects base path",
      properties: ["openDirectory", "createDirectory"]
    };

    if (typeof currentPath === "string" && currentPath.trim()) {
      dialogOptions.defaultPath = currentPath.trim();
    }

    const result = await dialog.showOpenDialog(getWorkspaceWindowForWebContents(event.sender)?.window || mainWindow, dialogOptions);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("updates:info", () => {
    return updateManager.getUpdateInfo();
  });

  ipcMain.handle("updates:check", () => {
    return updateManager.checkForUpdates();
  });

  ipcMain.handle("updates:prepare", () => {
    return updateManager.prepareUpdate();
  });

  ipcMain.handle("updates:restart", (_event: IpcMainInvokeEvent, update: unknown) => {
    return updateManager.restartToUpdate(update);
  });

  ipcMain.handle("changelog:pending", () => {
    return updateManager.getPendingChangelog();
  });

  ipcMain.handle("changelog:history", () => {
    return {
      currentVersion: normalizeVersionTag(app.getVersion()),
      releases: updateManager.readChangelogReleases()
    };
  });

  ipcMain.handle("changelog:dismiss", () => {
    return store.dismissChangelog(app.getVersion());
  });

  ipcMain.handle("projects:inspect-source-path", (_event: IpcMainInvokeEvent, sourcePath: string) => {
    return inspectSourcePath(sourcePath);
  });

  ipcMain.handle("plugins:list", () => {
    return pluginHost.listRendererPlugins();
  });

  ipcMain.handle("plugins:invoke", (_event: IpcMainInvokeEvent, pluginId: string, actionName: string, payload: unknown) => {
    return pluginHost.invoke(pluginId, actionName, payload);
  });

  ipcMain.handle("projects:add", (_event: IpcMainInvokeEvent, projectConfig: unknown) => {
    return store.addProject(projectConfig);
  });

  ipcMain.handle("projects:update", (_event: IpcMainInvokeEvent, id: string, patch: unknown) => {
    return store.updateProject(id, patch);
  });

  ipcMain.handle("global-urls:update", (_event: IpcMainInvokeEvent, urls: unknown) => {
    return store.updateGlobalUrls(urls);
  });

  ipcMain.handle("webapp-home-tab:update", (_event: IpcMainInvokeEvent, projectId: string, tab: unknown) => {
    return store.updateWebAppHomeTab(projectId, tab);
  });

  ipcMain.handle("webapp-home-tabs:update", (_event: IpcMainInvokeEvent, projectId: string, tabs: unknown) => {
    return store.updateWebAppHomeTabs(projectId, tabs);
  });

  ipcMain.handle("projects:reorder", (_event: IpcMainInvokeEvent, projectIds: unknown) => {
    return store.reorderProjects(projectIds);
  });

  ipcMain.handle("projects:remove", (_event: IpcMainInvokeEvent, id: string) => {
    return store.removeProject(id);
  });

  ipcMain.handle("plugins:enabled:update", (_event: IpcMainInvokeEvent, pluginId: string, enabled: boolean) => {
    return store.updatePluginEnabled(pluginId, enabled);
  });

  ipcMain.handle("global-plugin-config:update", (_event: IpcMainInvokeEvent, pluginId: string, patch: unknown) => {
    return store.updateGlobalPluginConfig(pluginId, patch);
  });

  ipcMain.handle("project-plugin-config:update", (_event: IpcMainInvokeEvent, projectId: string, pluginId: string, patch: unknown) => {
    return store.updateProjectPluginConfig(projectId, pluginId, patch);
  });

  ipcMain.handle("pane-layout:update", (event: IpcMainInvokeEvent, projectId: string | null | undefined, layout: unknown) => {
    const workspaceWindow = getWorkspaceWindowForWebContents(event.sender);
    return workspaceWindow
      ? store.updateWorkspacePaneLayout(workspaceWindow.id, projectId, layout)
      : store.updatePaneLayout(projectId, layout);
  });

  ipcMain.handle("widget-layout:update", (event: IpcMainInvokeEvent, projectId: string | null | undefined, layout: unknown) => {
    const workspaceWindow = getWorkspaceWindowForWebContents(event.sender);
    return workspaceWindow
      ? store.updateWorkspaceWidgetLayout(workspaceWindow.id, projectId, layout)
      : store.updateWidgetLayout(projectId, layout);
  });

  ipcMain.handle("topbar-widgets:update", (_event: IpcMainInvokeEvent, topbarWidgets: unknown) => {
    return store.updateTopbarWidgets(topbarWidgets);
  });

  ipcMain.handle("terminal:tabs", (_event: IpcMainInvokeEvent, projectId: string) => {
    return terminalService.listTabs(projectId);
  });

  ipcMain.handle("terminal:create-tab", (_event: IpcMainInvokeEvent, projectId: string, name: string) => {
    return terminalService.createTab(projectId, name);
  });

  ipcMain.handle("terminal:rename-tab", (_event: IpcMainInvokeEvent, projectId: string, windowId: string, name: string) => {
    return terminalService.renameTab(projectId, windowId, name);
  });

  ipcMain.handle("terminal:close-tab", (_event: IpcMainInvokeEvent, projectId: string, windowId: string) => {
    return terminalService.closeTab(projectId, windowId);
  });

  ipcMain.handle("terminal:attach", (_event: IpcMainInvokeEvent, projectId: string, windowId: string, size: unknown) => {
    return terminalService.attach(projectId, windowId, size);
  });

  ipcMain.handle("terminal:selection:update", (_event: IpcMainInvokeEvent, projectId: string, surfaceKey: string, windowId: string) => {
    return store.updateTerminalSelection(projectId, surfaceKey, windowId);
  });

  ipcMain.handle("terminal:tab-order:update", (_event: IpcMainInvokeEvent, projectId: string, windowIds: unknown) => {
    return store.updateTerminalTabOrder(projectId, windowIds);
  });

  ipcMain.handle("terminal:write", (_event: IpcMainInvokeEvent, terminalId: string, data: string) => {
    terminalService.write(terminalId, data);
  });

  ipcMain.handle("terminal:resize", (_event: IpcMainInvokeEvent, terminalId: string, size: unknown) => {
    terminalService.resize(terminalId, size);
  });

  ipcMain.handle("terminal:detach", (_event: IpcMainInvokeEvent, terminalId: string) => {
    terminalService.detach(terminalId);
  });

  ipcMain.handle("terminal:write-selection", (_event: IpcMainInvokeEvent, text: unknown) => {
    clipboard.writeText(String(text || ""), "selection");
  });

  ipcMain.handle("terminal:read-selection", () => {
    return clipboard.readText("selection");
  });

  ipcMain.handle("password-manager:status", () => {
    return passwordManager.getStatus();
  });

  ipcMain.handle("password-manager:get-credential", (event: IpcMainInvokeEvent, url: string) => {
    const webApp = getWorkspaceWindowForWebAppContents(event.sender)?.runtime.getWebAppForWebContents(event.sender);
    if (webApp?.item.autofillEnabled === false) {
      return null;
    }

    return passwordManager.getCredential(url);
  });

  ipcMain.handle("password-manager:save-credential", (_event: IpcMainInvokeEvent, credential: unknown) => {
    return passwordManager.saveCredential(credential);
  });

  ipcMain.handle("webapp:show", (event: IpcMainInvokeEvent, webApp: ShowWebAppPayload) => {
    const workspaceWindow = getWorkspaceWindowForWebContents(event.sender);
    if (!workspaceWindow) {
      throw new Error("Workspace window is not available.");
    }
    workspaceWindow.runtime.showWebApp(webApp);
  });

  ipcMain.handle("webapp:set-bounds", (event: IpcMainInvokeEvent, bounds: unknown) => {
    getWorkspaceWindowForWebContents(event.sender)?.runtime.setWebAppBounds(bounds);
  });

  ipcMain.handle("webapp:navigate", (event: IpcMainInvokeEvent, key: unknown, action: string, url: string) => {
    return getWorkspaceWindowForWebContents(event.sender)?.runtime.navigateWebApp(key, action, url) || false;
  });

  ipcMain.handle("webapp:navigation-history", (event: IpcMainInvokeEvent, key: unknown) => {
    return getWorkspaceWindowForWebContents(event.sender)?.runtime.getWebAppNavigationHistory(key) || { activeIndex: -1, entries: [] };
  });

  ipcMain.handle("webapp:autofill:update", (event: IpcMainInvokeEvent, key: unknown, enabled: unknown) => {
    return getWorkspaceWindowForWebContents(event.sender)?.runtime.updateWebAppAutofill(key, enabled) || false;
  });

  ipcMain.handle("webapp:autofill-consumed", (event: IpcMainInvokeEvent) => {
    const workspaceWindow = getWorkspaceWindowForWebAppContents(event.sender);
    const webApp = workspaceWindow?.runtime.getWebAppForWebContents(event.sender);
    return webApp ? workspaceWindow?.runtime.updateWebAppAutofill(webApp.key, false) : false;
  });

  ipcMain.handle("webapp:set-visible", (event: IpcMainInvokeEvent, keys: unknown) => {
    getWorkspaceWindowForWebContents(event.sender)?.runtime.setVisibleWebApps(keys);
  });

  ipcMain.handle("webapp:hide", (event: IpcMainInvokeEvent) => {
    getWorkspaceWindowForWebContents(event.sender)?.runtime.hideWebApps();
  });

  ipcMain.handle("webapp:freeze", (event: IpcMainInvokeEvent, options: UnknownRecord) => {
    return getWorkspaceWindowForWebContents(event.sender)?.runtime.freezeWebApps(options) || { token: 0, captures: [] };
  });

  ipcMain.handle("webapp:restore", (event: IpcMainInvokeEvent, token: unknown) => {
    getWorkspaceWindowForWebContents(event.sender)?.runtime.restoreWebApps(token);
  });

  ipcMain.handle("clipboard:write-text", (_event: IpcMainInvokeEvent, text: unknown) => {
    clipboard.writeText(String(text || ""));
  });

  ipcMain.handle("shell:open-external", (_event: IpcMainInvokeEvent, url: unknown) => {
    return openExternalUrl(url);
  });
}

app.whenReady().then(async () => {
  store = new ProjectStore({
    configDirectory: getConfigDirectory(),
    legacyFilePath: getLegacyStorePath()
  });
  store.load();
  store.reconcileAppVersion(app.getVersion());
  updateManager = createUpdateManager({
    getAppState: () => store.getAppState()
  });
  try {
    await updateManager.ensureCurrentAppImageInstalled();
    await updateManager.cleanupOldAppImages();
  } catch (error) {
    console.warn(`Could not prepare AppImage updates: ${(error as Error).message}`);
  }

  pluginHost = new PluginHost({
    store,
    execFileAsync,
    userDataPath: app.getPath("userData"),
    sendToRenderer: (channel: string, payload: unknown) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    }
  });
  pluginHost.discover();
  await pluginHost.applyStateMigrations();
  passwordManager = new PasswordManager({
    store,
    confirmSave: async ({ origin, username, isUpdate }: { isUpdate?: boolean; origin: string; username: string }) => {
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
    getProject: (projectId: string) => {
      if (projectId === "__global__") {
        const settings = store.getState().settings || {};
        return {
          id: "__global__",
          name: "Global",
          slug: "global",
          sourcePath: settings.projectsBasePath || process.cwd(),
          terminalEnv: ""
        };
      }

      return store.getState().projects.find((project: MainProject) => project.id === projectId);
    },
    getSettings: () => store.getState().settings,
    sendToRenderer: (channel: string, payload: unknown) => {
      for (const workspaceWindow of workspaceWindows.values()) {
        if (!workspaceWindow.window.webContents.isDestroyed()) {
          workspaceWindow.window.webContents.send(channel, payload);
        }
      }
    },
    suppressResizeWarnings: captureRunner.isCaptureMode()
  });
  registerIpcHandlers();
  const restoredWindows = store.getWorkspaceWindowStates() as Array<{ id: string; syncGroupId: string }>;
  if (restoredWindows.length) {
    for (const restoredWindow of restoredWindows) {
      createMainWindow({ id: restoredWindow.id, syncGroupId: restoredWindow.syncGroupId });
    }
  } else {
    createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    isQuitting = true;
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

export {};
