import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

const { WorkspaceWindowRuntime } = require(`${process.cwd()}/build/main/workspaceWindowRuntime`);

class MockWebContents extends EventEmitter {
  private static nextId = 1;
  readonly id = MockWebContents.nextId++;
  readonly loadedUrls: string[] = [];
  readonly executedScripts: string[] = [];
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
    return Promise.resolve(true);
  }

  markDestroyedSilently() {
    this.destroyed = true;
  }

  send() {}

  setWindowOpenHandler(handler: (details: { disposition: string; features: string; frameName: string; url: string }) => unknown) {
    this.windowOpenHandler = handler;
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

function createRuntime() {
  const views: MockWebContentsView[] = [];
  const addedViews: MockWebContentsView[] = [];
  const removedViews: MockWebContentsView[] = [];
  const rendererMessages: Array<{ channel: string; payload: unknown }> = [];
  const externalUrls: unknown[] = [];
  let windowFocused = true;
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
    setBackgroundColor() {},
    webContents: {
      isDestroyed: () => false,
      send(channel: string, payload: unknown) {
        rendererMessages.push({ channel, payload });
      }
    }
  };
  const runtime = new WorkspaceWindowRuntime({
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
