import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

const { WorkspaceWindowRuntime } = require(`${process.cwd()}/build/main/workspaceWindowRuntime`);

class MockWebContents extends EventEmitter {
  private static nextId = 1;
  readonly id = MockWebContents.nextId++;
  readonly loadedUrls: string[] = [];
  backCount = 0;
  closeCount = 0;
  forwardCount = 0;
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

  isLoadingMainFrame() {
    return false;
  }

  loadURL(url: string) {
    this.url = url;
    this.loadedUrls.push(url);
    return Promise.resolve();
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

  get webContents() {
    return this.attached ? this.contents : undefined;
  }

  detach() {
    this.attached = false;
  }

  setBackgroundColor() {}

  setBounds() {}

  setVisible() {}
}

function createRuntime() {
  const views: MockWebContentsView[] = [];
  const rendererMessages: Array<{ channel: string; payload: unknown }> = [];
  const externalUrls: unknown[] = [];
  const window = {
    contentView: {
      addChildView() {},
      removeChildView(view: MockWebContentsView) {
        view.detach();
      }
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

  return { externalUrls, rendererMessages, runtime, views };
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

test("workspace runtime navigates through Electron navigation history", async () => {
  const { runtime, views } = createRuntime();

  showWebApp(runtime);
  const webContents = views[0].contents;

  assert.equal(await runtime.navigateWebApp("project:twicc", "back", ""), true);
  assert.equal(await runtime.navigateWebApp("project:twicc", "forward", ""), true);
  assert.equal(webContents.backCount, 1);
  assert.equal(webContents.forwardCount, 1);
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
