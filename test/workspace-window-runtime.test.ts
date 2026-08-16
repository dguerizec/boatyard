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

  setWindowOpenHandler() {}
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
      send() {}
    }
  };
  const runtime = new WorkspaceWindowRuntime({
    createWebContentsView() {
      const view = new MockWebContentsView();
      views.push(view);
      return view;
    },
    id: "window-1",
    openExternalUrl() {},
    store: {
      getWorkspaceWebAppUrl: () => null,
      updateWorkspaceWebAppState() {}
    },
    window
  });

  return { runtime, views };
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
