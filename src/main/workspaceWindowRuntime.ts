import type {
  ContextMenuParams,
  BrowserWindowConstructorOptions,
  Event as ElectronEvent,
  HandlerDetails,
  Rectangle,
  WebContents as ElectronWebContents,
  BrowserWindow as ElectronBrowserWindow,
  WebContentsView as ElectronWebContentsView
} from "electron";
import type {
  ProjectStoreInstance,
  OpenWebAppModalPayload,
  ShowWebAppPayload,
  UnknownRecord,
  WebAppCapture,
  WebAppItem,
  WebAppLookup,
  WebAppOpenOptions
} from "./mainTypes.js";
import { getLiveWindowWebContents } from "./browserWindowTarget.js";
import { createWebAppContextMenu } from "./webAppContextMenu.js";
import { applyDefaultWebAppScrollbarStyle } from "./webAppScrollbars.js";
import { resolveWebAppShowNavigation } from "./webAppShowNavigation.js";
import {
  getAppBackgroundColor,
  getWebAppBackgroundColor,
  normalizeAppTheme,
  type AppTheme
} from "./appTheme.js";

const { BrowserWindow, WebContentsView } = require("electron");
const path = require("node:path");

const WEBAPP_SESSION_PARTITION = "persist:boatyard-webapps";
const WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS = 350;
const WEBAPP_POPUP_RESERVATION_TIMEOUT_MS = 100;

type WebAppFreeze = { all: boolean; keys: Set<string>; rect: Rectangle | null };

type WorkspaceWebAppItem = WebAppItem & {
  attached: boolean;
  detachedForBackgroundLoad: boolean;
  webContents: ElectronWebContents;
};

type WorkspaceWindowRuntimeOptions = {
  createModalWindow?(options: BrowserWindowConstructorOptions): ElectronBrowserWindow;
  createWebContentsView?(): ElectronWebContentsView;
  id: string;
  openExternalUrl(url: unknown): unknown;
  store: ProjectStoreInstance;
  theme?: unknown;
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
  private readonly createModalWindow: (options: BrowserWindowConstructorOptions) => ElectronBrowserWindow;
  private readonly createWebContentsView: () => ElectronWebContentsView;
  private theme: AppTheme;
  private readonly webAppViews = new Map<string, WorkspaceWebAppItem>();
  private readonly webAppPopupReservations = new Map<string, ReturnType<typeof setTimeout>>();
  private activeWebAppKey: string | null = null;
  private visibleWebAppKeys = new Set<string>();
  private readonly webAppFreezes = new Map<number, WebAppFreeze>();
  private webAppModalWindow: ElectronBrowserWindow | null = null;
  private nextWebAppFreezeToken = 1;

  constructor({ createModalWindow, createWebContentsView, id, openExternalUrl, store, theme, window }: WorkspaceWindowRuntimeOptions) {
    this.id = id;
    this.openExternalUrl = openExternalUrl;
    this.store = store;
    this.theme = normalizeAppTheme(theme);
    this.window = window;
    this.createModalWindow = createModalWindow || ((options) => new BrowserWindow(options));
    this.createWebContentsView = createWebContentsView || (() => new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: WEBAPP_SESSION_PARTITION,
        preload: path.join(__dirname, "webappPreload.js"),
        sandbox: true
      }
    }));
  }

  private dispatchWebAppModalEvent(
    modalWindow: ElectronBrowserWindow,
    eventName: string,
    serializedDetail: string,
    readySelector: string
  ) {
    if (modalWindow.isDestroyed() || modalWindow.webContents.isDestroyed()) {
      return;
    }

    modalWindow.webContents.executeJavaScript(`(() => {
      const readySelector = ${JSON.stringify(readySelector)};
      const dispatch = () => {
        window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, {
          detail: ${serializedDetail}
        }));
        return true;
      };
      if (!readySelector) {
        return dispatch();
      }

      return new Promise((resolve) => {
        const deadline = Date.now() + 10000;
        const waitUntilReady = () => {
          let ready = false;
          try {
            ready = document.querySelector(readySelector) !== null;
          } catch {
            resolve(false);
            return;
          }
          if (ready) {
            // Let the framework finish the mount cycle that inserted the marker.
            setTimeout(() => resolve(dispatch()), 0);
            return;
          }
          if (Date.now() >= deadline) {
            resolve(false);
            return;
          }
          setTimeout(waitUntilReady, 50);
        };
        waitUntilReady();
      });
    })()`).catch((error: Error) => {
      console.warn(`Could not initialize webapp modal: ${error.message}`);
    });
  }

  openWebAppModal({ eventDetail = null, eventName, readySelector, title, url }: OpenWebAppModalPayload = {}) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(String(url || ""));
    } catch {
      return false;
    }

    const normalizedEventName = String(eventName || "").trim();
    const normalizedReadySelector = String(readySelector || "").trim();
    if (
      !["http:", "https:"].includes(parsedUrl.protocol)
      || !/^[A-Za-z][A-Za-z0-9:._-]{0,127}$/.test(normalizedEventName)
      || normalizedReadySelector.length > 512
    ) {
      return false;
    }

    let serializedDetail: string;
    try {
      serializedDetail = JSON.stringify(eventDetail ?? null);
    } catch {
      return false;
    }

    const existingModal = this.webAppModalWindow;
    if (existingModal && !existingModal.isDestroyed()) {
      existingModal.show();
      existingModal.focus();
      this.dispatchWebAppModalEvent(
        existingModal,
        normalizedEventName,
        serializedDetail,
        normalizedReadySelector
      );
      return true;
    }

    const modalWindow = this.createModalWindow({
      parent: this.window,
      modal: false,
      show: false,
      width: 1100,
      height: 800,
      minWidth: 720,
      minHeight: 560,
      title: String(title || "Web app").trim().slice(0, 160) || "Web app",
      autoHideMenuBar: true,
      backgroundColor: getAppBackgroundColor(this.theme),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: WEBAPP_SESSION_PARTITION,
        sandbox: true
      }
    });
    this.webAppModalWindow = modalWindow;
    modalWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const popupUrl = new URL(url);
        if (["http:", "https:"].includes(popupUrl.protocol)) {
          this.openExternalUrl(popupUrl.toString());
        }
      } catch {
        // Ignore malformed popup requests from embedded pages.
      }
      return { action: "deny" };
    });
    modalWindow.webContents.on("will-navigate", (details) => {
      try {
        const navigationUrl = new URL(details.url);
        if (navigationUrl.origin !== parsedUrl.origin) {
          details.preventDefault();
          if (["http:", "https:"].includes(navigationUrl.protocol)) {
            this.openExternalUrl(navigationUrl.toString());
          }
        }
      } catch {
        details.preventDefault();
      }
    });
    modalWindow.webContents.once("did-finish-load", () => {
      this.dispatchWebAppModalEvent(
        modalWindow,
        normalizedEventName,
        serializedDetail,
        normalizedReadySelector
      );
    });
    modalWindow.once("ready-to-show", () => {
      if (!modalWindow.isDestroyed()) {
        modalWindow.show();
      }
    });
    modalWindow.once("closed", () => {
      const wasActiveModal = this.webAppModalWindow === modalWindow;
      if (wasActiveModal) {
        this.webAppModalWindow = null;
      }
      if (wasActiveModal && !this.window.isDestroyed()) {
        this.window.focus();
      }
    });
    modalWindow.loadURL(parsedUrl.toString()).catch((error: Error) => {
      console.warn(`Could not load webapp modal ${parsedUrl.toString()}: ${error.message}`);
      if (!modalWindow.isDestroyed()) {
        modalWindow.close();
      }
    });
    return true;
  }

  private sendToRenderer(channel: string, payload: unknown) {
    const webContents = getLiveWindowWebContents(this.window);
    if (!webContents) {
      return false;
    }
    webContents.send(channel, payload);
    return true;
  }

  private sendWebAppOpenUrlRequest(sourceWebAppKey: unknown, url: unknown, source = "window-open", options: WebAppOpenOptions = {}) {
    return this.sendToRenderer("webapp:open-url-requested", {
      sourceWebAppKey: String(sourceWebAppKey || ""),
      sourceWindowId: this.id,
      url: String(url || ""),
      source,
      target: String(options.target || ""),
      sourceUrl: String(options.sourceUrl || ""),
      sourceBounds: options.sourceBounds || null
    });
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

  private loadWebAppUrl(webApp: WorkspaceWebAppItem | undefined, url: unknown) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(String(url || ""));
    } catch {
      return false;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol) || !webApp || webApp.webContents.isDestroyed()) {
      return false;
    }

    webApp.url = parsedUrl.toString();
    webApp.webContents.loadURL(webApp.url).catch((error: Error) => {
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

  // Chromium focuses an attached WebContentsView during reload even when another
  // view owns keyboard focus. Hiding the view is not enough to prevent it.
  private detachWebAppForBackgroundLoad(key: string, view: ElectronWebContentsView, webContents: ElectronWebContents) {
    const item = this.webAppViews.get(key);
    if (
      !item ||
      item.view !== view ||
      item.webContents !== webContents ||
      !item.attached ||
      item.detachedForBackgroundLoad ||
      !this.window.isFocused() ||
      webContents.isFocused()
    ) {
      return;
    }

    try {
      this.window.contentView.removeChildView(view);
      item.attached = false;
      item.detachedForBackgroundLoad = true;
    } catch (error) {
      console.warn(`Could not detach background-loading webapp ${key}: ${(error as Error).message}`);
    }
  }

  private restoreWebAppAfterBackgroundLoad(key: string, view: ElectronWebContentsView, webContents: ElectronWebContents) {
    const item = this.webAppViews.get(key);
    if (!item?.detachedForBackgroundLoad || item.view !== view || item.webContents !== webContents) {
      return;
    }

    // Let Chromium's load-event focus sequence finish before reattaching the view.
    setImmediate(() => {
      const currentItem = this.webAppViews.get(key);
      if (
        !currentItem ||
        currentItem.view !== view ||
        currentItem.webContents !== webContents ||
        !currentItem.detachedForBackgroundLoad ||
        webContents.isDestroyed() ||
        webContents.isLoadingMainFrame()
      ) {
        return;
      }

      try {
        view.setVisible(this.visibleWebAppKeys.has(key) && !this.isWebAppKeyFrozen(key));
        this.window.contentView.addChildView(view);
        currentItem.attached = true;
        currentItem.detachedForBackgroundLoad = false;
      } catch (error) {
        console.warn(`Could not restore background-loaded webapp ${key}: ${(error as Error).message}`);
      }
    });
  }

  private handleWebAppWindowOpen(key: string, details: HandlerDetails) {
    const url = details?.url || "";

    // Electron reports window.open("about:blank", "_blank") from a user click as
    // an unnamed foreground tab. Allow only that blank reservation: the page can
    // later navigate its WindowProxy after asynchronous work completes.
    if (url === "about:blank" && !details?.frameName && details?.disposition === "foreground-tab" && !details?.features && this.consumeWebAppPopupReservation(key)) {
      return { action: "allow" as const };
    }

    const webApp = this.webAppViews.get(key);

    if (!this.sendWebAppOpenUrlRequestFromItem(key, webApp, url, details?.disposition || "window-open")) {
      this.openExternalUrl(url);
    }
    return { action: "deny" as const };
  }

  private consumeWebAppPopupReservation(key: string) {
    const timeout = this.webAppPopupReservations.get(key);
    if (!timeout) {
      return false;
    }

    clearTimeout(timeout);
    this.webAppPopupReservations.delete(key);
    return true;
  }

  reserveWebAppPopup(webContents: ElectronWebContents) {
    const webApp = this.getWebAppForWebContents(webContents);
    if (!webApp) {
      return false;
    }

    const existing = this.webAppPopupReservations.get(webApp.key);
    if (existing) {
      clearTimeout(existing);
    }
    const timeout = setTimeout(() => {
      if (this.webAppPopupReservations.get(webApp.key) === timeout) {
        this.webAppPopupReservations.delete(webApp.key);
      }
    }, WEBAPP_POPUP_RESERVATION_TIMEOUT_MS);
    this.webAppPopupReservations.set(webApp.key, timeout);
    return true;
  }

  private ensureWebAppView(key: string): WorkspaceWebAppItem {
    const existing = this.webAppViews.get(key);
    if (existing && !existing.webContents.isDestroyed()) {
      return existing;
    }
    if (existing) {
      this.webAppViews.delete(key);
      if (existing.attached) {
        try {
          this.window.contentView.removeChildView(existing.view);
        } catch (error) {
          console.warn(`Could not detach stale webapp view: ${(error as Error).message}`);
        }
      }
    }

    const view = this.createWebContentsView();
    const webContents = view.webContents;
    view.setBackgroundColor(getWebAppBackgroundColor(null, this.theme));
    webContents.setWindowOpenHandler((details: HandlerDetails) => this.handleWebAppWindowOpen(key, details));
    webContents.on("context-menu", (_event: ElectronEvent, params: ContextMenuParams) => {
      void createWebAppContextMenu(webContents, params, {
        getSourceKey: (webContents) => this.getWebAppForWebContents(webContents)?.key || "",
        openExternalUrl: this.openExternalUrl,
        sendOpenUrlRequest: (sourceKey: unknown, url: unknown, source: string) => this.sendWebAppOpenUrlRequest(sourceKey, url, source)
      }).then((menu) => {
        if (!webContents.isDestroyed()) {
          menu.popup({ window: this.window });
        }
      });
    });
    webContents.on("did-navigate", (_event: ElectronEvent, url: string) => {
      this.persistWebAppUrl(key, url);
    });
    webContents.on("did-navigate-in-page", (_event: ElectronEvent, url: string, isMainFrame: boolean) => {
      if (isMainFrame) {
        this.persistWebAppUrl(key, url);
      }
    });
    webContents.on("did-finish-load", () => {
      this.sendWebAppLoaded(key, webContents.getURL());
    });
    webContents.on("did-start-loading", () => {
      this.detachWebAppForBackgroundLoad(key, view, webContents);
    });
    webContents.on("did-stop-loading", () => {
      this.restoreWebAppAfterBackgroundLoad(key, view, webContents);
    });
    webContents.on("page-favicon-updated", (_event: ElectronEvent, favicons: string[]) => {
      const url = webContents.getURL();
      this.store.updateWorkspaceWebAppState(this.id, key, {
        faviconPageUrl: url,
        faviconUrl: favicons[0] || "",
        url
      });
      this.sendToRenderer("webapp:favicon-changed", {
        key,
        favicons,
        url
      });
    });
    webContents.on("did-fail-load", (_event: ElectronEvent, errorCode: number, errorDescription: string, validatedUrl: string, isMainFrame: boolean) => {
      if (isMainFrame) {
        this.sendWebAppLoaded(key, validatedUrl || webContents.getURL(), `failed:${errorCode}:${errorDescription}`);
      }
    });
    webContents.on("dom-ready", () => {
      const item = this.webAppViews.get(key);
      void applyDefaultWebAppScrollbarStyle(webContents);
      webContents.send("webapp:autofill-enabled", item?.autofillEnabled === true);
    });
    webContents.once("destroyed", () => {
      const item = this.webAppViews.get(key);
      if (item?.webContents === webContents) {
        this.webAppViews.delete(key);
        if (item.attached) {
          try {
            this.window.contentView.removeChildView(view);
          } catch (error) {
            console.warn(`Could not detach destroyed webapp view: ${(error as Error).message}`);
          }
        }
      }
    });

    this.window.contentView.addChildView(view);
    const item: WorkspaceWebAppItem = {
      view,
      webContents,
      attached: true,
      detachedForBackgroundLoad: false,
      url: null,
      configuredUrl: null,
      backgroundColor: null,
      bounds: null,
      autofillEnabled: false,
      label: "",
      projectId: ""
    };
    this.webAppViews.set(key, item);
    return item;
  }

  getWebAppForWebContents(webContents: ElectronWebContents): WebAppLookup | null {
    for (const [key, item] of this.webAppViews) {
      if (item.webContents.id === webContents.id) {
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

  showWebApp({ key, url, bounds, autofillEnabled, backgroundColor, label, projectId, restoreUrl = true }: ShowWebAppPayload) {
    if (!key) {
      throw new Error("Webapp key is required.");
    }

    if (!url) {
      throw new Error("Webapp URL is required.");
    }

    const configuredUrl = new URL(url).toString();
    const restoredUrl = this.store.getWorkspaceWebAppUrl(this.id, String(key));

    const webApp = this.ensureWebAppView(String(key));
    const nextUrl = resolveWebAppShowNavigation({
      configuredUrl,
      previousConfiguredUrl: webApp.configuredUrl,
      restoredUrl,
      restoreUrl
    });
    const requestedUrl = nextUrl ? new URL(nextUrl).toString() : null;
    webApp.configuredUrl = configuredUrl;
    if (typeof autofillEnabled === "boolean") {
      webApp.autofillEnabled = autofillEnabled;
    }
    if (label !== undefined) {
      webApp.label = String(label || "");
    }
    if (projectId !== undefined) {
      webApp.projectId = String(projectId || "");
    }
    webApp.backgroundColor = backgroundColor;
    webApp.view.setBackgroundColor(getWebAppBackgroundColor(webApp.backgroundColor, this.theme));
    webApp.bounds = normalizeWebAppBounds(bounds);
    webApp.view.setBounds(webApp.bounds);
    webApp.view.setVisible(this.visibleWebAppKeys.has(String(key)) && !this.isWebAppKeyFrozen(String(key)));
    this.activeWebAppKey = String(key);

    const currentUrl = webApp.webContents.getURL();
    if (requestedUrl && webApp.url !== requestedUrl && currentUrl !== requestedUrl) {
      this.loadWebAppUrl(webApp, requestedUrl);
    } else if (!webApp.webContents.isLoadingMainFrame()) {
      this.sendWebAppLoaded(key, webApp.webContents.getURL());
    }
  }

  listWebContentsViewResources() {
    return [...this.webAppViews.entries()].flatMap(([key, item]) => {
      if (item.webContents.isDestroyed()) {
        return [];
      }
      const pid = item.webContents.getOSProcessId();
      return [{
        key,
        label: item.label,
        pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
        projectId: item.projectId,
        url: item.webContents.getURL() || item.url || "",
        windowId: this.id
      }];
    });
  }

  setTheme(theme: unknown) {
    this.theme = normalizeAppTheme(theme);
    this.window.setBackgroundColor(getAppBackgroundColor(this.theme));
    if (this.webAppModalWindow && !this.webAppModalWindow.isDestroyed()) {
      this.webAppModalWindow.setBackgroundColor(getAppBackgroundColor(this.theme));
    }
    for (const item of this.webAppViews.values()) {
      item.view.setBackgroundColor(getWebAppBackgroundColor(item.backgroundColor, this.theme));
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
    if (!webApp || webApp.webContents.isDestroyed()) {
      return { activeIndex: -1, entries: [] };
    }

    const history = webApp.webContents.navigationHistory;
    return {
      activeIndex: history.getActiveIndex(),
      entries: history.getAllEntries().map((entry, index) => ({ index, title: entry.title || "", url: entry.url || "" }))
    };
  }

  async navigateWebApp(key: unknown, action: string, url: string) {
    const webApp = this.webAppViews.get(String(key || ""));
    if (!webApp || webApp.webContents.isDestroyed()) {
      return false;
    }
    if (action === "soft-open") {
      let currentUrl: URL;
      let targetUrl: URL;
      try {
        currentUrl = new URL(webApp.webContents.getURL());
        targetUrl = new URL(url);
      } catch {
        return false;
      }
      if (
        !["http:", "https:"].includes(targetUrl.protocol)
        || currentUrl.origin !== targetUrl.origin
      ) {
        return false;
      }
      try {
        return await webApp.webContents.executeJavaScript(`(() => {
          const targetUrl = ${JSON.stringify(targetUrl.toString())};
          if (window.location.href === targetUrl) {
            return true;
          }
          window.history.pushState(window.history.state, "", targetUrl);
          window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
          return true;
        })()`) === true;
      } catch {
        return false;
      }
    }

    if (action === "open" || action === "home") {
      return this.loadWebAppUrl(webApp, url);
    }

    const history = webApp.webContents.navigationHistory;
    if (action === "history-index") {
      const index = Number(url);
      if (Number.isInteger(index) && index >= 0 && index < history.length() && index !== history.getActiveIndex()) {
        history.goToIndex(index);
        return true;
      }
      return false;
    }
    if (action === "back" && history.canGoBack()) {
      history.goBack();
      return true;
    }
    if (action === "forward" && history.canGoForward()) {
      history.goForward();
      return true;
    }
    if (action === "refresh") {
      webApp.webContents.reload();
      return true;
    }
    if (action === "hard-refresh") {
      await webApp.webContents.session.clearCache();
      webApp.webContents.reloadIgnoringCache();
      return true;
    }
    return false;
  }

  async dispatchWebAppEvent(key: unknown, eventName: unknown, detail: unknown = null) {
    const webApp = this.webAppViews.get(String(key || ""));
    if (!webApp || webApp.webContents.isDestroyed()) {
      return false;
    }

    const normalizedEventName = String(eventName || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9:._-]{0,127}$/.test(normalizedEventName)) {
      return false;
    }

    let serializedDetail: string;
    try {
      serializedDetail = JSON.stringify(detail ?? null);
    } catch {
      return false;
    }

    try {
      return await webApp.webContents.executeJavaScript(`(() => {
        window.dispatchEvent(new CustomEvent(${JSON.stringify(normalizedEventName)}, {
          detail: ${serializedDetail}
        }));
        return true;
      })()`) === true;
    } catch {
      return false;
    }
  }

  async getWebAppTextContent(key: unknown, selector: unknown) {
    const webApp = this.webAppViews.get(String(key || ""));
    if (!webApp || webApp.webContents.isDestroyed()) {
      return null;
    }

    const normalizedSelector = String(selector || "").trim();
    if (!normalizedSelector || normalizedSelector.length > 512) {
      return null;
    }

    try {
      const result = await webApp.webContents.executeJavaScript(`(() => {
        const element = document.querySelector(${JSON.stringify(normalizedSelector)});
        return element?.textContent?.trim() || "";
      })()`);
      return typeof result === "string" ? result : "";
    } catch {
      return null;
    }
  }

  updateWebAppAutofill(key: unknown, enabled: unknown) {
    const webApp = this.webAppViews.get(String(key || ""));
    if (!webApp || webApp.webContents.isDestroyed()) {
      return false;
    }

    webApp.autofillEnabled = enabled === true;
    webApp.webContents.send("webapp:autofill-enabled", webApp.autofillEnabled);
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
    if (!item || item.webContents.isDestroyed()) {
      return null;
    }
    try {
      const image = await withTimeout(item.webContents.capturePage(), WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS, "capture timed out");
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
    for (const timeout of this.webAppPopupReservations.values()) {
      clearTimeout(timeout);
    }
    this.webAppPopupReservations.clear();
    const items = [...this.webAppViews.values()];
    this.webAppViews.clear();
    this.activeWebAppKey = null;
    this.visibleWebAppKeys = new Set();
    this.webAppFreezes.clear();
    const modalWindow = this.webAppModalWindow;
    this.webAppModalWindow = null;
    if (modalWindow && !modalWindow.isDestroyed()) {
      modalWindow.close();
    }

    for (const item of items) {
      if (item.attached) {
        try {
          this.window.contentView.removeChildView(item.view);
        } catch (error) {
          console.warn(`Could not detach webapp view: ${(error as Error).message}`);
        }
      }
      try {
        if (!item.webContents.isDestroyed()) {
          item.webContents.close();
        }
      } catch (error) {
        console.warn(`Could not close webapp contents: ${(error as Error).message}`);
      }
    }
  }
}
