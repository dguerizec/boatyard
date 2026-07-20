import type {
  ContextMenuParams,
  HandlerDetails,
  Rectangle,
  WebContents as ElectronWebContents,
  BrowserWindow as ElectronBrowserWindow
} from "electron";
import type {
  ProjectStoreInstance,
  ShowWebAppPayload,
  UnknownRecord,
  WebAppCapture,
  WebAppItem,
  WebAppLookup,
  WebAppOpenOptions
} from "./mainTypes.js";
import { createWebAppContextMenu } from "./webAppContextMenu.js";

const { WebContentsView } = require("electron");
const path = require("node:path");

const WEBAPP_SESSION_PARTITION = "persist:boatyard-webapps";
const WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS = 350;
const DEFAULT_WEBAPP_BACKGROUND_COLOR = "#0b0f14";

type WebAppFreeze = { all: boolean; keys: Set<string>; rect: Rectangle | null };

type WorkspaceWindowRuntimeOptions = {
  id: string;
  openExternalUrl(url: unknown): unknown;
  store: ProjectStoreInstance;
  window: ElectronBrowserWindow;
};

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

function normalizeWebAppBackgroundColor(backgroundColor: unknown) {
  return backgroundColor === "#ffffff" ? "#ffffff" : DEFAULT_WEBAPP_BACKGROUND_COLOR;
}

function webAppRectsIntersect(left: Rectangle, right: Rectangle) {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
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

export class WorkspaceWindowRuntime {
  readonly id: string;
  readonly window: ElectronBrowserWindow;
  private readonly openExternalUrl: WorkspaceWindowRuntimeOptions["openExternalUrl"];
  private readonly store: ProjectStoreInstance;
  private readonly webAppViews = new Map<string, WebAppItem>();
  private activeWebAppKey: string | null = null;
  private visibleWebAppKeys = new Set<string>();
  private readonly webAppFreezes = new Map<number, WebAppFreeze>();
  private nextWebAppFreezeToken = 1;

  constructor({ id, openExternalUrl, store, window }: WorkspaceWindowRuntimeOptions) {
    this.id = id;
    this.openExternalUrl = openExternalUrl;
    this.store = store;
    this.window = window;
  }

  private sendToRenderer(channel: string, payload: unknown) {
    if (!this.window.webContents.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  private sendWebAppOpenUrlRequest(sourceWebAppKey: unknown, url: unknown, source = "window-open", options: WebAppOpenOptions = {}) {
    if (this.window.webContents.isDestroyed()) {
      return false;
    }

    this.sendToRenderer("webapp:open-url-requested", {
      sourceWebAppKey: String(sourceWebAppKey || ""),
      sourceWindowId: this.id,
      url: String(url || ""),
      source,
      target: String(options.target || ""),
      sourceUrl: String(options.sourceUrl || ""),
      sourceBounds: options.sourceBounds || null
    });
    return true;
  }

  private sendWebAppOpenUrlRequestFromItem(key: string, webApp: WebAppItem | undefined, url: unknown, source: string, options: WebAppOpenOptions = {}) {
    if (!key || !webApp) {
      return false;
    }

    return this.sendWebAppOpenUrlRequest(key, url, source, {
      sourceBounds: webApp.bounds || null,
      sourceUrl: webApp.url || "",
      ...options
    });
  }

  private loadWebAppUrl(webApp: WebAppItem | undefined, url: unknown) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(String(url || ""));
    } catch {
      return false;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol) || !webApp || webApp.view.webContents.isDestroyed()) {
      return false;
    }

    webApp.url = parsedUrl.toString();
    webApp.view.webContents.loadURL(webApp.url).catch((error: Error) => {
      console.warn(`Could not load webapp ${webApp.url}: ${error.message}`);
    });
    return true;
  }

  private sendWebAppLoaded(key: unknown, url: string, status = "loaded") {
    this.sendToRenderer("webapp:loaded", {
      key: String(key),
      url,
      status
    });
  }

  private handleWebAppWindowOpen(key: string, details: HandlerDetails) {
    const url = details?.url || "";
    const webApp = this.webAppViews.get(key);

    if (!this.sendWebAppOpenUrlRequestFromItem(key, webApp, url, details?.disposition || "window-open")) {
      this.openExternalUrl(url);
    }
    return { action: "deny" as const };
  }

  private ensureWebAppView(key: string): WebAppItem {
    const existing = this.webAppViews.get(key);
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
    view.setBackgroundColor(DEFAULT_WEBAPP_BACKGROUND_COLOR);
    view.webContents.setWindowOpenHandler((details: HandlerDetails) => this.handleWebAppWindowOpen(key, details));
    view.webContents.on("context-menu", (_event: Event, params: ContextMenuParams) => {
      void createWebAppContextMenu(view.webContents, params, {
        getSourceKey: (webContents) => this.getWebAppForWebContents(webContents)?.key || "",
        openExternalUrl: this.openExternalUrl,
        sendOpenUrlRequest: (sourceKey: unknown, url: unknown, source: string) => this.sendWebAppOpenUrlRequest(sourceKey, url, source)
      }).then((menu) => {
        if (!view.webContents.isDestroyed()) {
          menu.popup({ window: this.window });
        }
      });
    });
    view.webContents.on("did-navigate", (_event: Event, url: string) => {
      this.persistWebAppUrl(key, url);
    });
    view.webContents.on("did-navigate-in-page", (_event: Event, url: string, isMainFrame: boolean) => {
      if (isMainFrame) {
        this.persistWebAppUrl(key, url);
      }
    });
    view.webContents.on("did-finish-load", () => {
      this.sendWebAppLoaded(key, view.webContents.getURL());
    });
    view.webContents.on("did-fail-load", (_event: Event, errorCode: number, errorDescription: string, validatedUrl: string, isMainFrame: boolean) => {
      if (isMainFrame) {
        this.sendWebAppLoaded(key, validatedUrl || view.webContents.getURL(), `failed:${errorCode}:${errorDescription}`);
      }
    });
    view.webContents.on("dom-ready", () => {
      const item = this.webAppViews.get(key);
      view.webContents.send("webapp:autofill-enabled", item?.autofillEnabled === true);
    });

    this.window.contentView.addChildView(view);
    const item: WebAppItem = {
      view,
      url: null,
      bounds: null,
      autofillEnabled: false
    };
    this.webAppViews.set(key, item);
    return item;
  }

  getWebAppForWebContents(webContents: ElectronWebContents): WebAppLookup | null {
    for (const [key, item] of this.webAppViews) {
      if (item.view.webContents.id === webContents.id) {
        return { key, item };
      }
    }

    return null;
  }

  handleModifiedLinkClick(source: UnknownRecord) {
    const webApp = this.getWebAppForWebContents(source.webContents as ElectronWebContents);
    if (!this.sendWebAppOpenUrlRequestFromItem(webApp?.key || "", webApp?.item, source.url, String(source.source || "modified-click"))) {
      this.openExternalUrl(source.url);
    }
  }

  private persistWebAppUrl(key: string, url: string) {
    try {
      this.store.updateWorkspaceWebAppState(this.id, key, { url });
      this.sendToRenderer("webapp:url-changed", { key: String(key), url });
    } catch (error) {
      console.warn(`Could not persist webapp ${key}: ${(error as Error).message}`);
    }
  }

  showWebApp({ key, url, bounds, autofillEnabled, backgroundColor, restoreUrl = true }: ShowWebAppPayload) {
    if (!key) {
      throw new Error("Webapp key is required.");
    }

    const restoredUrl = this.store.getWorkspaceWebAppUrl(this.id, String(key));
    const nextUrl = restoreUrl === false ? url : (restoredUrl || url);
    if (!nextUrl) {
      throw new Error("Webapp URL is required.");
    }

    const webApp = this.ensureWebAppView(String(key));
    if (typeof autofillEnabled === "boolean") {
      webApp.autofillEnabled = autofillEnabled;
    }
    webApp.view.setBackgroundColor(normalizeWebAppBackgroundColor(backgroundColor));
    webApp.bounds = normalizeWebAppBounds(bounds);
    webApp.view.setBounds(webApp.bounds);
    webApp.view.setVisible(this.visibleWebAppKeys.has(String(key)) && !this.isWebAppKeyFrozen(String(key)));
    this.activeWebAppKey = String(key);

    const requestedUrl = new URL(nextUrl).toString();
    const currentUrl = webApp.view.webContents.getURL();
    if (webApp.url !== requestedUrl && currentUrl !== requestedUrl) {
      this.loadWebAppUrl(webApp, requestedUrl);
    } else if (!webApp.view.webContents.isLoadingMainFrame()) {
      this.sendWebAppLoaded(key, webApp.view.webContents.getURL());
    }
  }

  setWebAppBounds(bounds: unknown) {
    if (!this.activeWebAppKey) {
      return;
    }

    const webApp = this.webAppViews.get(this.activeWebAppKey);
    if (!webApp) {
      return;
    }

    webApp.bounds = normalizeWebAppBounds(bounds);
    webApp.view.setBounds(webApp.bounds);
  }

  getWebAppNavigationHistory(key: unknown) {
    const webApp = this.webAppViews.get(String(key || ""));
    if (!webApp || webApp.view.webContents.isDestroyed()) {
      return { activeIndex: -1, entries: [] };
    }

    const history = webApp.view.webContents.navigationHistory;
    return {
      activeIndex: history.getActiveIndex(),
      entries: history.getAllEntries().map((entry, index) => ({ index, title: entry.title || "", url: entry.url || "" }))
    };
  }

  async navigateWebApp(key: unknown, action: string, url: string) {
    const webApp = this.webAppViews.get(String(key || ""));
    if (!webApp || webApp.view.webContents.isDestroyed()) {
      return false;
    }

    if (action === "open" || action === "home") {
      return this.loadWebAppUrl(webApp, url);
    }

    const history = webApp.view.webContents.navigationHistory;
    if (action === "history-index") {
      const index = Number(url);
      if (Number.isInteger(index) && index >= 0 && index < history.length() && index !== history.getActiveIndex()) {
        history.goToIndex(index);
        return true;
      }
      return false;
    }
    if (action === "back" && webApp.view.webContents.canGoBack()) {
      webApp.view.webContents.goBack();
      return true;
    }
    if (action === "forward" && webApp.view.webContents.canGoForward()) {
      webApp.view.webContents.goForward();
      return true;
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

  updateWebAppAutofill(key: unknown, enabled: unknown) {
    const webApp = this.webAppViews.get(String(key || ""));
    if (!webApp || webApp.view.webContents.isDestroyed()) {
      return false;
    }

    webApp.autofillEnabled = enabled === true;
    webApp.view.webContents.send("webapp:autofill-enabled", webApp.autofillEnabled);
    this.sendToRenderer("webapp:autofill-changed", { key: String(key), enabled: webApp.autofillEnabled });
    return webApp.autofillEnabled;
  }

  setVisibleWebApps(keys: unknown) {
    this.visibleWebAppKeys = new Set(Array.isArray(keys) ? keys.map(String) : []);
    for (const [key, item] of this.webAppViews) {
      item.view.setVisible(this.visibleWebAppKeys.has(key) && !this.isWebAppKeyFrozen(key));
    }
    this.activeWebAppKey = this.visibleWebAppKeys.size > 0 ? [...this.visibleWebAppKeys].at(-1) || null : null;
  }

  hideWebApps() {
    this.activeWebAppKey = null;
    this.visibleWebAppKeys = new Set();
    this.webAppFreezes.clear();
    for (const item of this.webAppViews.values()) {
      item.view.setVisible(false);
    }
  }

  private getWebAppFreezeKeys(options: UnknownRecord = {}, rect: Rectangle | null = null) {
    const hasKeyFilter = Object.prototype.hasOwnProperty.call(options || {}, "keys");
    const requestedKeys = Array.isArray(options.keys) ? options.keys.map(String).filter(Boolean) : [];
    if (hasKeyFilter) {
      return requestedKeys.filter((key) => this.visibleWebAppKeys.has(key));
    }
    const selectByRect = options.selectByRect === true && rect;
    if (!selectByRect) {
      return [...this.visibleWebAppKeys];
    }
    return [...this.visibleWebAppKeys].filter((key) => {
      const bounds = this.webAppViews.get(key)?.bounds || null;
      return bounds ? webAppRectsIntersect(rect, bounds) : false;
    });
  }

  private isWebAppKeyFrozen(key: string) {
    const bounds = this.webAppViews.get(key)?.bounds || null;
    for (const freeze of this.webAppFreezes.values()) {
      if (freeze.all || freeze.keys.has(key)) {
        return true;
      }
      if (freeze.rect && bounds && webAppRectsIntersect(freeze.rect, bounds)) {
        return true;
      }
    }
    return false;
  }

  private async captureWebAppForFreeze(key: string): Promise<WebAppCapture | null> {
    const item = this.webAppViews.get(key);
    if (!item || item.view.webContents.isDestroyed()) {
      return null;
    }
    try {
      const image = await withTimeout(item.view.webContents.capturePage(), WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS, "capture timed out");
      if (image.isEmpty()) {
        return null;
      }
      return { key, bounds: item.view.getBounds(), dataUrl: image.toDataURL() };
    } catch (error) {
      console.warn(`Could not capture webapp ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  async freezeWebApps(options: UnknownRecord = {}) {
    const hasKeyFilter = Object.prototype.hasOwnProperty.call(options || {}, "keys");
    const hasRect = Boolean(options.rect && typeof options.rect === "object");
    const rect = hasRect ? normalizeWebAppBounds(options.rect) : null;
    const selectByRect = options.selectByRect === true && rect !== null;
    const freezeKeys = this.getWebAppFreezeKeys(options, rect);
    const token = this.nextWebAppFreezeToken;
    this.nextWebAppFreezeToken += 1;
    this.webAppFreezes.set(token, { all: !hasKeyFilter && !selectByRect, keys: new Set(freezeKeys), rect });
    const captures = (await Promise.all(freezeKeys.map((key) => this.captureWebAppForFreeze(key)))).filter(Boolean);
    for (const key of freezeKeys) {
      this.webAppViews.get(key)?.view.setVisible(false);
    }
    return { token, captures };
  }

  restoreWebApps(token: unknown = undefined) {
    if (token === undefined || token === null) {
      this.webAppFreezes.clear();
    } else if (Number.isFinite(Number(token))) {
      this.webAppFreezes.delete(Number(token));
    }
    for (const [key, item] of this.webAppViews) {
      item.view.setVisible(this.visibleWebAppKeys.has(key) && !this.isWebAppKeyFrozen(key));
    }
  }

  destroy() {
    for (const item of this.webAppViews.values()) {
      try {
        this.window.contentView.removeChildView(item.view);
      } catch (error) {
        console.warn(`Could not detach webapp view: ${(error as Error).message}`);
      }
      if (!item.view.webContents.isDestroyed()) {
        item.view.webContents.close();
      }
    }
    this.webAppViews.clear();
    this.activeWebAppKey = null;
    this.visibleWebAppKeys = new Set();
    this.webAppFreezes.clear();
  }
}
