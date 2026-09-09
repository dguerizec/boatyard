import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

const { WorkspaceWindowRuntime } = require(`${process.cwd()}/build/main/workspaceWindowRuntime`);

class MockWebContents extends EventEmitter {
  private static nextId = 1;
  readonly id = MockWebContents.nextId++;
  readonly loadedUrls: string[] = [];
  readonly executedScripts: string[] = [];
  readonly emulations: unknown[] = [];
  disableEmulationCount = 0;
  enableDeviceEmulation(parameters: unknown) {
    this.emulations.push(parameters);
  }
  disableDeviceEmulation() {
    this.disableEmulationCount += 1;
  }
  backCount = 0;
  closeCount = 0;
  forwardCount = 0;
  focused = false;
  loadingMainFrame = false;
  readonly navigationHistory = {
    canGoBack: () => true,
    canGoForward: () => true,
    goBack: () => {
      this.backCount += 1;
    },
    goForward: () => {
      this.forwardCount += 1;
    }
  };
  executedScriptResult: unknown = true;
  private destroyed = false;
  private url = "";
  windowOpenHandler: ((details: { disposition: string; features: string; frameName: string; url: string }) => unknown) | null = null;

  close() {
    this.closeCount += 1;
    this.destroyed = true;
    this.emit("destroyed");
  }

  getURL() {
    return this.url;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isFocused() {
    return this.focused;
  }

  isLoadingMainFrame() {
    return this.loadingMainFrame;
  }

  loadURL(url: string) {
    this.url = url;
    this.loadedUrls.push(url);
    return Promise.resolve();
  }

  executeJavaScript(script: string) {
    this.executedScripts.push(script);
    return Promise.resolve(this.executedScriptResult);
  }

  markDestroyedSilently() {
    this.destroyed = true;
  }

  send() {}

  setWindowOpenHandler(handler: (details: { disposition: string; features: string; frameName: string; url: string }) => unknown) {
    this.windowOpenHandler = handler;
  }
}

class MockModalWindow extends EventEmitter {
  readonly webContents = new MockWebContents();
  readonly loadedUrls: string[] = [];
  closeCount = 0;
  focusCount = 0;
  showCount = 0;
  readonly backgroundColors: string[] = [];
  private destroyed = false;

  constructor(private readonly loadError: Error | null = null) {
    super();
  }

  close() {
    this.closeCount += 1;
    this.destroyed = true;
    this.emit("closed");
  }

  focus() {
    this.focusCount += 1;
  }

  isDestroyed() {
    return this.destroyed;
  }

  loadURL(url: string) {
    this.loadedUrls.push(url);
    return this.loadError ? Promise.reject(this.loadError) : Promise.resolve();
  }

  setBackgroundColor(color: string) {
    this.backgroundColors.push(color);
  }

  show() {
    this.showCount += 1;
  }
}

class MockWebContentsView {
  readonly contents = new MockWebContents();
  private attached = true;
  visible = true;

  get webContents() {
    return this.attached ? this.contents : undefined;
  }

  detach() {
    this.attached = false;
  }

  attach() {
    this.attached = true;
  }

  isAttached() {
    return this.attached;
  }

  setBackgroundColor() {}

  setBounds() {}

  setVisible(value: boolean) {
    this.visible = value;
  }
}

function createRuntime({ modalLoadError = null }: { modalLoadError?: Error | null } = {}) {
  const views: MockWebContentsView[] = [];
  const addedViews: MockWebContentsView[] = [];
  const removedViews: MockWebContentsView[] = [];
  const rendererMessages: Array<{ channel: string; payload: unknown }> = [];
  const externalUrls: unknown[] = [];
  const modalOptions: unknown[] = [];
  const modalWindows: MockModalWindow[] = [];
  let windowFocused = true;
  let parentFocusCount = 0;
  const window = {
    contentView: {
      addChildView(view: MockWebContentsView) {
        view.attach();
        addedViews.push(view);
      },
      removeChildView(view: MockWebContentsView) {
        view.detach();
        removedViews.push(view);
      }
    },
    isDestroyed: () => false,
    isFocused: () => windowFocused,
    focus: () => {
      parentFocusCount += 1;
    },
    setBackgroundColor() {},
    webContents: {
      isDestroyed: () => false,
      send(channel: string, payload: unknown) {
        rendererMessages.push({ channel, payload });
      }
    }
  };
  const runtime = new WorkspaceWindowRuntime({
    createModalWindow(options: unknown) {
      modalOptions.push(options);
      const modalWindow = new MockModalWindow(modalLoadError);
      modalWindows.push(modalWindow);
      return modalWindow as never;
    },
    createWebContentsView() {
      const view = new MockWebContentsView();
      views.push(view);
      return view;
    },
    id: "window-1",
    openExternalUrl(url: unknown) {
      externalUrls.push(url);
    },
    store: {
      getWorkspaceWebAppUrl: () => null,
      updateWorkspaceWebAppState() {}
    },
    window
  });

  return {
    addedViews,
    externalUrls,
    getParentFocusCount: () => parentFocusCount,
    modalOptions,
    modalWindows,
    removedViews,
    rendererMessages,
    runtime,
    setWindowFocused(value: boolean) {
      windowFocused = value;
    },
    views
  };
}

function waitForImmediate() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function showWebApp(runtime: typeof WorkspaceWindowRuntime) {
  runtime.showWebApp({
    bounds: { height: 600, width: 800, x: 0, y: 0 },
    key: "project:twicc",
    url: "https://twicc.example.test/project"
  });
}

test("workspace runtime keeps using stable contents and replaces destroyed web views", () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const firstView = views[0];
  assert.deepEqual(firstView.contents.loadedUrls, ["https://twicc.example.test/project"]);

  firstView.detach();
  assert.doesNotThrow(() => showWebApp(runtime));
  assert.equal(views.length, 1);

  firstView.contents.markDestroyedSilently();
  assert.doesNotThrow(() => showWebApp(runtime));
  assert.equal(views.length, 2);
  assert.deepEqual(views[1].contents.loadedUrls, ["https://twicc.example.test/project"]);

  views[1].contents.close();
  assert.doesNotThrow(() => showWebApp(runtime));
  assert.equal(views.length, 3);
});

test("workspace runtime teardown closes detached contents once and is idempotent", () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const webContents = views[0].contents;

  assert.doesNotThrow(() => runtime.destroy());
  assert.equal(webContents.closeCount, 1);
  assert.doesNotThrow(() => runtime.destroy());
  assert.equal(webContents.closeCount, 1);
});

test("workspace runtime detaches a background web view while it reloads", async () => {
  const { addedViews, removedViews, runtime, views } = createRuntime();
  showWebApp(runtime);
  runtime.showWebApp({
    bounds: { height: 600, width: 800, x: 800, y: 0 },
    key: "project:pier:main",
    url: "https://pier.example.test/"
  });
  const twicc = views[0].contents;
  const pierView = views[1];
  twicc.focused = true;
  runtime.setVisibleWebApps(["project:twicc", "project:pier:main"]);

  pierView.contents.emit("did-start-loading");

  assert.equal(pierView.isAttached(), false);
  assert.deepEqual(removedViews, [pierView]);
  assert.equal(runtime.getWebAppForWebContents(pierView.contents)?.key, "project:pier:main");
  runtime.setVisibleWebApps(["project:twicc"]);

  pierView.contents.emit("did-stop-loading");
  await waitForImmediate();

  assert.equal(pierView.isAttached(), true);
  assert.deepEqual(addedViews, [views[0], pierView, pierView]);
  assert.equal(twicc.focused, true);
  assert.equal(pierView.visible, false);
});

test("workspace runtime leaves a focused reloading web view attached", () => {
  const { removedViews, runtime, views } = createRuntime();
  showWebApp(runtime);
  const view = views[0];
  view.contents.focused = true;

  view.contents.emit("did-start-loading");

  assert.equal(view.isAttached(), true);
  assert.deepEqual(removedViews, []);
});

test("workspace runtime leaves web views attached while their window is unfocused", () => {
  const { removedViews, runtime, setWindowFocused, views } = createRuntime();
  showWebApp(runtime);
  const view = views[0];
  setWindowFocused(false);

  view.contents.emit("did-start-loading");

  assert.equal(view.isAttached(), true);
  assert.deepEqual(removedViews, []);
});

test("workspace runtime keeps a background web view detached across overlapping loads", async () => {
  const { addedViews, runtime, views } = createRuntime();
  showWebApp(runtime);
  const view = views[0];

  view.contents.emit("did-start-loading");
  view.contents.loadingMainFrame = true;
  view.contents.emit("did-stop-loading");
  await waitForImmediate();

  assert.equal(view.isAttached(), false);
  assert.deepEqual(addedViews, [view]);

  view.contents.loadingMainFrame = false;
  view.contents.emit("did-stop-loading");
  await waitForImmediate();

  assert.equal(view.isAttached(), true);
  assert.deepEqual(addedViews, [view, view]);
});

test("workspace runtime does not reattach a background web view after teardown", async () => {
  const { addedViews, runtime, views } = createRuntime();
  showWebApp(runtime);
  const view = views[0];
  view.contents.emit("did-start-loading");
  view.contents.emit("did-stop-loading");

  runtime.destroy();
  await waitForImmediate();

  assert.equal(view.isAttached(), false);
  assert.deepEqual(addedViews, [view]);
  assert.equal(view.contents.closeCount, 1);
});

test("workspace runtime navigates through Electron navigation history", async () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const webContents = views[0].contents;

  assert.equal(await runtime.navigateWebApp("project:twicc", "back", ""), true);
  assert.equal(await runtime.navigateWebApp("project:twicc", "forward", ""), true);
  assert.equal(webContents.backCount, 1);
  assert.equal(webContents.forwardCount, 1);
});

test("workspace runtime can soft-navigate a same-origin webapp without reloading it", async () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const webContents = views[0].contents;
  assert.equal(await runtime.navigateWebApp(
    "project:twicc",
    "soft-open",
    "https://twicc.example.test/project/example/session/session-1"
  ), true);
  assert.deepEqual(webContents.loadedUrls, ["https://twicc.example.test/project"]);
  assert.equal(webContents.executedScripts.length, 1);
  assert.match(webContents.executedScripts[0], /history\.pushState/);
  assert.match(webContents.executedScripts[0], /PopStateEvent/);

  assert.equal(await runtime.navigateWebApp(
    "project:twicc",
    "soft-open",
    "https://other.example.test/project/example/session/session-1"
  ), false);
  assert.equal(webContents.executedScripts.length, 1);
});

test("workspace runtime opens one sandboxed modal webapp and initializes it after loading", async () => {
  const {
    externalUrls,
    getParentFocusCount,
    modalOptions,
    modalWindows,
    runtime
  } = createRuntime();

  assert.equal(runtime.openWebAppModal({
    eventDetail: { source: "toolbar" },
    eventName: "twicc:open-peer-inbox",
    readySelector: "wa-dialog[label=\"Peer inbox\"]",
    title: "TwiCC Peer inbox",
    url: "https://twicc.example.test/project/example"
  }), true);
  assert.equal(modalWindows.length, 1);
  const modalWindow = modalWindows[0];
  assert.deepEqual(modalWindow.loadedUrls, ["https://twicc.example.test/project/example"]);
  assert.deepEqual(modalOptions, [{
    autoHideMenuBar: true,
    backgroundColor: "#101418",
    height: 800,
    minHeight: 560,
    minWidth: 720,
    modal: false,
    parent: runtime.window,
    show: false,
    title: "TwiCC Peer inbox",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:boatyard-webapps",
      sandbox: true
    },
    width: 1100
  }]);
  assert.deepEqual(modalWindow.webContents.executedScripts, []);

  modalWindow.webContents.emit("did-finish-load");
  await waitForImmediate();
  assert.equal(modalWindow.webContents.executedScripts.length, 1);
  assert.match(modalWindow.webContents.executedScripts[0], /twicc:open-peer-inbox/);
  assert.match(modalWindow.webContents.executedScripts[0], /"source":"toolbar"/);
  assert.match(modalWindow.webContents.executedScripts[0], /wa-dialog\[label=\\"Peer inbox\\"\]/);
  assert.match(modalWindow.webContents.executedScripts[0], /document\.querySelector\(readySelector\)/);

  modalWindow.emit("ready-to-show");
  assert.equal(modalWindow.showCount, 1);

  assert.equal(runtime.openWebAppModal({
    eventName: "twicc:open-peer-inbox",
    url: "https://twicc.example.test/project/example"
  }), true);
  assert.equal(modalWindows.length, 1);
  assert.equal(modalWindow.showCount, 2);
  assert.equal(modalWindow.focusCount, 1);

  modalWindow.webContents.windowOpenHandler?.({
    disposition: "foreground-tab",
    features: "",
    frameName: "",
    url: "https://docs.example.test/"
  });
  assert.deepEqual(externalUrls, ["https://docs.example.test/"]);
  let preventedNavigation = false;
  modalWindow.webContents.emit("will-navigate", {
    preventDefault() {
      preventedNavigation = true;
    },
    url: "https://outside.example.test/path"
  });
  assert.equal(preventedNavigation, true);
  assert.deepEqual(externalUrls, [
    "https://docs.example.test/",
    "https://outside.example.test/path"
  ]);

  preventedNavigation = false;
  modalWindow.webContents.emit("will-navigate", {
    preventDefault() {
      preventedNavigation = true;
    },
    url: "https://twicc.example.test/project/other"
  });
  assert.equal(preventedNavigation, false);

  modalWindow.close();
  assert.equal(getParentFocusCount(), 1);
});

test("workspace runtime rejects invalid modal requests and closes its modal during teardown", () => {
  const { modalWindows, runtime } = createRuntime();

  assert.equal(runtime.openWebAppModal({
    eventName: "twicc:open-peer-inbox",
    url: "file:///workspace/example"
  }), false);
  assert.equal(runtime.openWebAppModal({
    eventName: "twicc:open-peer-inbox\ninvalid",
    url: "https://twicc.example.test/"
  }), false);
  assert.equal(runtime.openWebAppModal({
    eventName: "twicc:open-peer-inbox",
    readySelector: ".peer-inbox-button".repeat(33),
    url: "https://twicc.example.test/"
  }), false);
  assert.equal(modalWindows.length, 0);

  assert.equal(runtime.openWebAppModal({
    eventName: "twicc:open-peer-inbox",
    url: "https://twicc.example.test/"
  }), true);
  const modalWindow = modalWindows[0];
  runtime.destroy();
  assert.equal(modalWindow.closeCount, 1);
});

test("workspace runtime releases its parent when the modal webapp fails to load", async () => {
  const { getParentFocusCount, modalWindows, runtime } = createRuntime({
    modalLoadError: new Error("unavailable")
  });

  assert.equal(runtime.openWebAppModal({
    eventName: "twicc:open-peer-inbox",
    url: "https://twicc.example.test/"
  }), true);
  await waitForImmediate();

  assert.equal(modalWindows[0].closeCount, 1);
  assert.equal(getParentFocusCount(), 1);
});

test("workspace runtime dispatches a validated custom event inside a webapp", async () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const webContents = views[0].contents;
  assert.equal(await runtime.dispatchWebAppEvent(
    "project:twicc",
    "twicc:open-peer-inbox",
    { messageId: 42, label: "Inbox's latest" }
  ), true);
  assert.equal(webContents.executedScripts.length, 1);
  assert.match(webContents.executedScripts[0], /new CustomEvent\("twicc:open-peer-inbox"/);
  assert.match(webContents.executedScripts[0], /"messageId":42/);
  assert.match(webContents.executedScripts[0], /"Inbox's latest"/);

  assert.equal(await runtime.dispatchWebAppEvent(
    "project:twicc",
    "twicc:open-peer-inbox\nmalicious",
    null
  ), false);
  assert.equal(webContents.executedScripts.length, 1);
});

test("workspace runtime reads bounded text content from a webapp", async () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const webContents = views[0].contents;
  webContents.executedScriptResult = "2";
  assert.equal(await runtime.getWebAppTextContent(
    "project:twicc",
    ".peer-inbox-button .peer-inbox-badge"
  ), "2");
  assert.equal(webContents.executedScripts.length, 1);
  assert.match(webContents.executedScripts[0], /document\.querySelector\("\.peer-inbox-button \.peer-inbox-badge"\)/);
  assert.match(webContents.executedScripts[0], /textContent/);

  assert.equal(await runtime.getWebAppTextContent("project:twicc", ""), null);
  assert.equal(webContents.executedScripts.length, 1);
});

test("workspace runtime preserves live navigation when a fixed webapp is resynchronized", async () => {
  const { runtime, views } = createRuntime();
  const showFixedWebApp = (url = "http://main.example.test/") => runtime.showWebApp({
    bounds: { height: 600, width: 800, x: 0, y: 0 },
    key: "project:pier:main",
    restoreUrl: false,
    url
  });

  showFixedWebApp();
  const webContents = views[0].contents;
  assert.equal(await runtime.navigateWebApp(
    "project:pier:main",
    "open",
    "https://google.com/"
  ), true);

  showFixedWebApp();
  assert.deepEqual(webContents.loadedUrls, [
    "http://main.example.test/",
    "https://google.com/"
  ]);

  showFixedWebApp("http://renamed.example.test/");
  assert.deepEqual(webContents.loadedUrls, [
    "http://main.example.test/",
    "https://google.com/",
    "http://renamed.example.test/"
  ]);
});

test("workspace runtime preserves a deferred user popup WindowProxy", () => {
  const { externalUrls, rendererMessages, runtime, views } = createRuntime();

  showWebApp(runtime);
  const handler = views[0].contents.windowOpenHandler;
  assert.ok(handler);

  assert.deepEqual(handler({
    disposition: "foreground-tab",
    features: "",
    frameName: "",
    url: "about:blank"
  }), { action: "deny" });
  rendererMessages.length = 0;
  assert.equal(runtime.reserveWebAppPopup(views[0].contents), true);
  assert.deepEqual(handler({
    disposition: "foreground-tab",
    features: "",
    frameName: "",
    url: "about:blank"
  }), { action: "allow" });
  assert.deepEqual(handler({
    disposition: "foreground-tab",
    features: "",
    frameName: "",
    url: "about:blank"
  }), { action: "deny" });
  assert.equal(rendererMessages.length, 1);
  assert.deepEqual(externalUrls, []);
});

test("workspace runtime expires an unused deferred popup reservation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const handler = views[0].contents.windowOpenHandler;
  assert.ok(handler);
  assert.equal(runtime.reserveWebAppPopup(views[0].contents), true);

  t.mock.timers.tick(100);
  assert.deepEqual(handler({
    disposition: "foreground-tab",
    features: "",
    frameName: "",
    url: "about:blank"
  }), { action: "deny" });
});

test("workspace runtime does not share deferred popup reservations between panes", () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  runtime.showWebApp({
    bounds: { height: 600, width: 800, x: 0, y: 0 },
    key: "project:github",
    url: "https://github.example.test/project"
  });
  const firstHandler = views[0].contents.windowOpenHandler;
  const secondHandler = views[1].contents.windowOpenHandler;
  assert.ok(firstHandler);
  assert.ok(secondHandler);
  assert.equal(runtime.reserveWebAppPopup(views[0].contents), true);

  assert.deepEqual(secondHandler({
    disposition: "foreground-tab",
    features: "",
    frameName: "",
    url: "about:blank"
  }), { action: "deny" });
  assert.deepEqual(firstHandler({
    disposition: "foreground-tab",
    features: "",
    frameName: "",
    url: "about:blank"
  }), { action: "allow" });
});

test("workspace runtime keeps ordinary and non-blank popups in the existing navigation flow", () => {
  const { externalUrls, rendererMessages, runtime, views } = createRuntime();

  showWebApp(runtime);
  const handler = views[0].contents.windowOpenHandler;
  assert.ok(handler);

  assert.deepEqual(handler({
    disposition: "foreground-tab",
    features: "",
    frameName: "_blank",
    url: "https://popup.example.test/"
  }), { action: "deny" });
  assert.deepEqual(rendererMessages, [{
    channel: "webapp:open-url-requested",
    payload: {
      sourceWebAppKey: "project:twicc",
      sourceWindowId: "window-1",
      url: "https://popup.example.test/",
      source: "foreground-tab",
      target: "",
      sourceUrl: "https://twicc.example.test/project",
      sourceBounds: { height: 600, width: 800, x: 0, y: 0 }
    }
  }]);
  assert.deepEqual(externalUrls, []);
});

test("workspace runtime denies blank popup requests that are not the deferred user-popup shape", () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const handler = views[0].contents.windowOpenHandler;
  assert.ok(handler);

  assert.deepEqual(handler({
    disposition: "foreground-tab",
    features: "popup",
    frameName: "",
    url: "about:blank"
  }), { action: "deny" });
});


test("mobile virtual dimensions survive pane resizing and reset when mobile mode ends", () => {
  const { runtime, views } = createRuntime();
  const payload = {
    key: "project:mobile",
    url: "https://mobile.example.test",
    viewportSize: { width: 390, height: 718 }
  };
  runtime.showWebApp({ ...payload, bounds: { x: 0, y: 0, width: 390, height: 718 } });
  assert.equal(views[0].contents.emulations.length, 0);
  views[0].contents.emit("dom-ready");
  runtime.showWebApp({ ...payload, bounds: { x: 0, y: 0, width: 300, height: 400 } });
  assert.deepEqual(views[0].contents.emulations, [{
    screenPosition: "desktop",
    screenSize: { width: 390, height: 718 },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    viewSize: { width: 390, height: 718 },
    scale: 1
  }]);
  runtime.showWebApp({ ...payload, viewportSize: { width: 768, height: 1024 } });
  assert.equal(views[0].contents.emulations.length, 2);
  views[0].contents.emit("dom-ready");
  assert.equal(views[0].contents.emulations.length, 3);
  runtime.showWebApp({ ...payload, viewportSize: undefined });
  runtime.showWebApp({ ...payload, viewportSize: undefined });
  assert.equal(views[0].contents.disableEmulationCount, 1);
  views[0].contents.emit("dom-ready");
  assert.equal(views[0].contents.emulations.length, 3);
});


test("mobile viewport requests can be cancelled before the first document is ready", () => {
  const { runtime, views } = createRuntime();
  const payload = { key: "mobile-startup", url: "https://mobile.example.test" };
  runtime.showWebApp({ ...payload, viewportSize: { width: 390, height: 718 } });
  assert.equal(views[0].contents.emulations.length, 0);
  views[0].contents.loadingMainFrame = true;
  runtime.showWebApp(payload);
  views[0].contents.emit("dom-ready");
  assert.equal(views[0].contents.emulations.length, 0);
  assert.equal(views[0].contents.disableEmulationCount, 0);
});
