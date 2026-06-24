import type {
  BrowserWindow as ElectronBrowserWindow,
  ContextMenuParams,
  HandlerDetails,
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  Rectangle,
  WebContents as ElectronWebContents,
  WebContentsView as ElectronWebContentsView
} from "electron";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const { app, BrowserWindow, WebContentsView, Menu, clipboard, dialog, ipcMain, shell } = require("electron");
const { createCaptureRunner } = require("./captureRunner");
const { PasswordManager } = require("./passwordManager");
const { PluginHost } = require("./pluginHost");
const { ProjectStore, deriveRepoUrl } = require("./store");
const { TerminalService } = require("./terminalService");
const { createUpdateManager, normalizeVersionTag } = require("./updateManager");

const execFileAsync = promisify(execFile);
const WEBAPP_SESSION_PARTITION = "persist:boatyard-webapps";
const WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS = 350;
type UnknownRecord = Record<string, unknown>;
type WebAppOpenRule = {
  pattern?: string;
  scope?: string;
  target?: string;
};
type MainProject = UnknownRecord & {
  id?: string;
  name?: string;
  slug?: string;
  sourcePath?: string;
};
type AppState = UnknownRecord & {
  projects: MainProject[];
  settings?: UnknownRecord & {
    projectsBasePath?: string;
    webAppOpenRules?: WebAppOpenRule[];
  };
};
type ProjectStoreInstance = {
  addProject(values: unknown): unknown;
  dismissChangelog(version: string): unknown;
  getAppState(): unknown;
  getState(): AppState;
  getWebAppUrl(key: string): string;
  getWindowState(): { bounds: Partial<Rectangle>; isMaximized?: boolean };
  load(): unknown;
  reconcileAppVersion(version: string): unknown;
  removeProject(id: string): unknown;
  reorderProjects(projectIds: unknown): unknown;
  updateGlobalPluginConfig(pluginId: string, patch: unknown): unknown;
  updateGlobalUrls(urls: unknown): unknown;
  updateNavigation(navigation: unknown): unknown;
  updateOnboarding(onboarding: unknown): unknown;
  updatePaneLayout(projectId: string | null | undefined, layout: unknown): unknown;
  updatePluginEnabled(pluginId: string, enabled: boolean): unknown;
  updateProject(id: string, patch: unknown): unknown;
  updateProjectPluginConfig(projectId: string, pluginId: string, patch: unknown): unknown;
  updateSettings(patch: UnknownRecord): unknown;
  updateTerminalSelection(projectId: string, surfaceKey: string, windowId: string): unknown;
  updateTerminalTabOrder(projectId: string, windowIds: unknown): unknown;
  updateWebAppHomeTab(projectId: string, tab: unknown): unknown;
  updateWebAppHomeTabs(projectId: string, tabs: unknown): unknown;
  updateWebAppState(key: string, state: UnknownRecord): unknown;
  updateWidgetLayout(projectId: string | null | undefined, layout: unknown): unknown;
  updateWindowState(state: { bounds: Rectangle; isMaximized: boolean }): unknown;
};
type TerminalServiceInstance = {
  attach(projectId: string, windowId: string, size: unknown): unknown;
  closeTab(projectId: string, windowId: string): unknown;
  createTab(projectId: string, name: string): unknown;
  detach(terminalId: string): unknown;
  detachAll(): unknown;
  listTabs(projectId: string): unknown;
  renameTab(projectId: string, windowId: string, name: string): unknown;
  resize(terminalId: string, size: unknown): unknown;
  write(terminalId: string, data: string): void;
};
type PasswordManagerInstance = {
  getCredential(url: string): unknown;
  getStatus(): { encryptionAvailable?: boolean };
  saveCredential(credential: unknown): unknown;
};
type PluginHostInstance = {
  applyStateMigrations(): Promise<unknown>;
  discover(): unknown;
  inspectSourcePath(values: UnknownRecord): Promise<unknown>;
  invoke(pluginId: string, actionName: string, payload: unknown): unknown;
  listRendererPlugins(): unknown;
};
type UpdateManagerInstance = {
  checkForUpdates(): unknown;
  cleanupOldAppImages(): Promise<unknown>;
  ensureCurrentAppImageInstalled(): Promise<unknown>;
  getPendingChangelog(): unknown;
  getUpdateInfo(): unknown;
  prepareUpdate(): unknown;
  readChangelogReleases(): unknown;
  restartToUpdate(update: unknown): unknown;
};
type WebAppItem = {
  autofillEnabled: boolean;
  bounds: Rectangle | null;
  url: string | null;
  view: ElectronWebContentsView;
};
type WebAppLookup = {
  item: WebAppItem;
  key: string;
};
type ShowWebAppPayload = {
  autofillEnabled?: unknown;
  bounds?: unknown;
  key?: unknown;
  restoreUrl?: boolean;
  url?: string;
};
type WebAppOpenOptions = UnknownRecord & {
  sourceBounds?: unknown;
  sourceUrl?: unknown;
  target?: unknown;
};
type WebAppCapture = {
  bounds: Rectangle;
  dataUrl: string;
  key: string;
};

if (process.env.BOATYARD_USER_DATA_PATH) {
  app.setPath("userData", process.env.BOATYARD_USER_DATA_PATH);
}

let mainWindow: ElectronBrowserWindow | null = null;
let store: ProjectStoreInstance;
let terminalService: TerminalServiceInstance;
let passwordManager: PasswordManagerInstance;
let pluginHost: PluginHostInstance;
let saveWindowStateTimer: ReturnType<typeof setTimeout> | null = null;
let updateManager: UpdateManagerInstance;
const webAppViews = new Map<string, WebAppItem>();
let activeWebAppKey: string | null = null;
let visibleWebAppKeys = new Set<string>();
let allWebAppsFrozen = false;
let frozenWebAppKeys = new Set<string>();
const captureRunner = createCaptureRunner({
  getMainWindow: () => mainWindow,
  quitApp: () => app.quit()
});

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

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
  if (captureRunner.isCaptureMode()) {
    mainWindow.webContents.on("console-message", (event) => {
      const details = event;
      console.log(`[capture renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[capture renderer gone] ${details.reason}`);
    });
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();

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

function createWebAppContextMenu(webContents: ElectronWebContents, params: ContextMenuParams) {
  const template: MenuItemConstructorOptions[] = [];

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
        label: "Open with...",
        click: () => {
          const webApp = getWebAppForWebContents(webContents);
          if (!sendWebAppOpenUrlRequest(webApp?.key || "", params.linkURL, "context-menu")) {
            openExternalUrl(params.linkURL);
          }
        }
      },
      {
        label: "Open link in browser",
        click: () => openExternalUrl(params.linkURL)
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

function getWebAppOpenRule(url: unknown) {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl) {
    return null;
  }

  const rules = store?.getState()?.settings?.webAppOpenRules || [];
  return rules.find((rule: WebAppOpenRule) => {
    if (rule.scope === "host") {
      return parsedUrl.host === rule.pattern || parsedUrl.hostname === rule.pattern;
    }

    if (rule.scope === "path-prefix") {
      return parsedUrl.toString().startsWith(rule.pattern);
    }

    return parsedUrl.toString() === rule.pattern;
  }) || null;
}

function applyWebAppOpenRule(webApp: WebAppItem | undefined, rule: WebAppOpenRule | null, url: string, sourceWebAppKey = "") {
  if (!rule) {
    return false;
  }

  if (rule.target === "external") {
    openExternalUrl(url);
    return true;
  }

  if (rule.target === "same-pane") {
    return loadWebAppUrl(webApp, url);
  }

  if (rule.target === "split-pane") {
    return sendWebAppOpenUrlRequest(sourceWebAppKey, url, "saved-rule", {
      target: "split-pane",
      sourceUrl: webApp?.url || "",
      sourceBounds: webApp?.bounds || null
    });
  }

  return false;
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

  if (details?.disposition === "background-tab") {
    openExternalUrl(url);
    return { action: "deny" };
  }

  const rule = getWebAppOpenRule(url);
  if (rule) {
    applyWebAppOpenRule(webApp, rule, url, key);
  } else if (!sendWebAppOpenUrlRequest(key, url, "window-open", {
    sourceBounds: webApp?.bounds || null
  })) {
    openExternalUrl(url);
  }
  return { action: "deny" };
}

function ensureWebAppView(key: string): WebAppItem {
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
  view.webContents.setWindowOpenHandler((details: HandlerDetails) => handleWebAppWindowOpen(key, details));
  view.webContents.on("context-menu", (_event: Event, params: ContextMenuParams) => {
    createWebAppContextMenu(view.webContents, params).popup({
      window: mainWindow || undefined
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
  webAppViews.set(key, {
    view,
    url: null,
    bounds: null,
    autofillEnabled: false
  });
  return webAppViews.get(key);
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

function showWebApp({ key, url, bounds, autofillEnabled, restoreUrl = true }: ShowWebAppPayload) {
  if (!key) {
    throw new Error("Webapp key is required.");
  }

  const restoredUrl = store.getWebAppUrl(String(key));
  const parsedUrl = new URL(restoreUrl === false ? url : (restoredUrl || url));

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http and https webapps are supported.");
  }

  const webApp = ensureWebAppView(String(key));
  if (typeof autofillEnabled === "boolean") {
    webApp.autofillEnabled = autofillEnabled;
  }
  webApp.bounds = normalizeWebAppBounds(bounds);
  webApp.view.setBounds(webApp.bounds);
  webApp.view.setVisible(
    visibleWebAppKeys.has(String(key)) &&
    !allWebAppsFrozen &&
    !frozenWebAppKeys.has(String(key))
  );
  activeWebAppKey = String(key);

  if (webApp.url !== parsedUrl.toString()) {
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
    item.view.setVisible(visibleWebAppKeys.has(key) && !allWebAppsFrozen && !frozenWebAppKeys.has(key));
  }

  activeWebAppKey = visibleWebAppKeys.size > 0 ? [...visibleWebAppKeys].at(-1) : null;
}

function hideWebApp() {
  activeWebAppKey = null;
  visibleWebAppKeys = new Set();
  allWebAppsFrozen = false;
  frozenWebAppKeys = new Set();

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
    clearTimeout(timeout);
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

function getWebAppFreezeKeys(options: UnknownRecord = {}) {
  const hasKeyFilter = Object.prototype.hasOwnProperty.call(options || {}, "keys");
  const requestedKeys = Array.isArray(options?.keys)
    ? options.keys.map(String).filter(Boolean)
    : [];

  if (!hasKeyFilter) {
    return [...visibleWebAppKeys];
  }

  return requestedKeys.filter((key) => visibleWebAppKeys.has(key));
}

async function freezeWebApps(options: UnknownRecord = {}) {
  const hasKeyFilter = Object.prototype.hasOwnProperty.call(options || {}, "keys");
  const freezeKeys = getWebAppFreezeKeys(options);
  allWebAppsFrozen = !hasKeyFilter;
  frozenWebAppKeys = new Set([...frozenWebAppKeys, ...freezeKeys]);
  const captures = (await Promise.all(freezeKeys.map(captureWebAppForFreeze))).filter(Boolean);

  for (const key of freezeKeys) {
    webAppViews.get(key)?.view.setVisible(false);
  }

  return captures;
}

function restoreWebApps() {
  allWebAppsFrozen = false;
  frozenWebAppKeys = new Set();

  for (const [key, item] of webAppViews) {
    item.view.setVisible(visibleWebAppKeys.has(key));
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
  allWebAppsFrozen = false;
  frozenWebAppKeys = new Set();
}

function registerIpcHandlers() {
  ipcMain.handle("state:get", () => store.getState());

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

  ipcMain.handle("navigation:update", (_event: IpcMainInvokeEvent, navigation: unknown) => {
    return store.updateNavigation(navigation);
  });

  ipcMain.handle("onboarding:update", (_event: IpcMainInvokeEvent, onboarding: unknown) => {
    return store.updateOnboarding(onboarding);
  });

  ipcMain.handle("settings:select-projects-base-path", async (_event: IpcMainInvokeEvent, currentPath: unknown) => {
    const dialogOptions: UnknownRecord = {
      title: "Select projects base path",
      properties: ["openDirectory", "createDirectory"]
    };

    if (typeof currentPath === "string" && currentPath.trim()) {
      dialogOptions.defaultPath = currentPath.trim();
    }

    const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
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

  ipcMain.handle("pane-layout:update", (_event: IpcMainInvokeEvent, projectId: string | null | undefined, layout: unknown) => {
    return store.updatePaneLayout(projectId, layout);
  });

  ipcMain.handle("widget-layout:update", (_event: IpcMainInvokeEvent, projectId: string | null | undefined, layout: unknown) => {
    return store.updateWidgetLayout(projectId, layout);
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
    const webApp = getWebAppForWebContents(event.sender);
    if (webApp?.item.autofillEnabled === false) {
      return null;
    }

    return passwordManager.getCredential(url);
  });

  ipcMain.handle("password-manager:save-credential", (_event: IpcMainInvokeEvent, credential: unknown) => {
    return passwordManager.saveCredential(credential);
  });

  ipcMain.handle("webapp:show", (_event: IpcMainInvokeEvent, webApp: ShowWebAppPayload) => {
    showWebApp(webApp);
  });

  ipcMain.handle("webapp:set-bounds", (_event: IpcMainInvokeEvent, bounds: unknown) => {
    setWebAppBounds(bounds);
  });

  ipcMain.handle("webapp:navigate", (_event: IpcMainInvokeEvent, key: unknown, action: string, url: string) => {
    return navigateWebApp(key, action, url);
  });

  ipcMain.handle("webapp:autofill:update", (_event: IpcMainInvokeEvent, key: unknown, enabled: unknown) => {
    return updateWebAppAutofill(key, enabled);
  });

  ipcMain.handle("webapp:autofill-consumed", (event: IpcMainInvokeEvent) => {
    const webApp = getWebAppForWebContents(event.sender);
    return webApp ? updateWebAppAutofill(webApp.key, false) : false;
  });

  ipcMain.handle("webapp:set-visible", (_event: IpcMainInvokeEvent, keys: unknown) => {
    setVisibleWebApps(keys);
  });

  ipcMain.handle("webapp:hide", () => {
    hideWebApp();
  });

  ipcMain.handle("webapp:freeze", (_event: IpcMainInvokeEvent, options: UnknownRecord) => {
    return freezeWebApps(options);
  });

  ipcMain.handle("webapp:restore", () => {
    restoreWebApps();
  });

  ipcMain.handle("clipboard:write-text", (_event: IpcMainInvokeEvent, text: unknown) => {
    clipboard.writeText(String(text || ""));
  });

  ipcMain.handle("shell:open-external", (_event: IpcMainInvokeEvent, url: unknown) => {
    return openExternalUrl(url);
  });
}

app.whenReady().then(async () => {
  store = new ProjectStore(getStorePath());
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
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    },
    suppressResizeWarnings: captureRunner.isCaptureMode()
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

export {};
