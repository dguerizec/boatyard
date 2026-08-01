"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createPaneIcon,
  createPaneIconLabel,
  getPaneFaviconUrl,
  getPaneIconInitial,
  haveSamePaneOrigin,
  needsLightPaneFavicon,
  shouldUseIconOnlyPaneTab,
  updatePaneFaviconElements
} = require(`${process.cwd()}/build/renderer/paneIcons`);
const { createProjectWebApps } = require(`${process.cwd()}/build/renderer/projectWebApps`);
const { createRendererWebAppRuntime } = require(`${process.cwd()}/build/renderer/rendererWebAppRuntime`);

type FakeEventHandler = () => void;

class FakeClassList {
  values = new Set<string>();

  add(...names: string[]) {
    for (const name of names) {
      this.values.add(name);
    }
  }

  contains(name: string) {
    return this.values.has(name);
  }

  remove(...names: string[]) {
    for (const name of names) {
      this.values.delete(name);
    }
  }

  toggle(name: string, force?: boolean) {
    const enabled = force ?? !this.values.has(name);
    if (enabled) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
    return enabled;
  }
}

class FakeElement {
  alt = "";
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  classList = new FakeClassList();
  className = "";
  dataset: Record<string, string> = {};
  src = "";
  tagName: string;
  textContent = "";
  private listeners = new Map<string, FakeEventHandler[]>();

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  addEventListener(name: string, handler: FakeEventHandler) {
    const handlers = this.listeners.get(name) || [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  trigger(name: string) {
    for (const handler of this.listeners.get(name) || []) {
      handler();
    }
  }
}

function withFakeDocument(callback: (elements: FakeElement[]) => void) {
  const originalDocument = globalThis.document;
  const elements: FakeElement[] = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      baseURI: "file:///workspace/example/build/renderer/index.html",
      createElement: (tagName: string) => {
        const element = new FakeElement(tagName);
        elements.push(element);
        return element;
      },
      createElementNS: (_namespace: string, tagName: string) => {
        const element = new FakeElement(tagName);
        elements.push(element);
        return element;
      },
      querySelectorAll: () => elements.filter((element) => element.className === "pane-icon")
    }
  });

  try {
    callback(elements);
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument
    });
  }
}

test("pane icon fallbacks use the content name instead of its menu prefix", () => {
  assert.equal(getPaneIconInitial("URL: PickATube"), "P");
  assert.equal(getPaneIconInitial("Pier"), "P");
  assert.equal(getPaneIconInitial("---"), "?");
});

test("compact pane tabs and plugin overrides both enable icon-only tabs", () => {
  assert.equal(shouldUseIconOnlyPaneTab(false, false), false);
  assert.equal(shouldUseIconOnlyPaneTab(true, false), true);
  assert.equal(shouldUseIconOnlyPaneTab(false, true), true);
});

test("pane favicons resolve from HTTP origins only", () => {
  assert.equal(getPaneFaviconUrl("https://pier.example.test/dashboard"), "https://pier.example.test/favicon.ico");
  assert.equal(getPaneFaviconUrl("http://localhost:4173/worktree"), "http://localhost:4173/favicon.ico");
  assert.equal(getPaneFaviconUrl("file:///workspace/example/index.html"), "");
  assert.equal(getPaneFaviconUrl("not a URL"), "");
});

test("page favicons remain valid for navigation within the same origin", () => {
  assert.equal(
    haveSamePaneOrigin(
      "https://app.example.test/dashboard",
      "https://app.example.test/settings?tab=profile"
    ),
    true
  );
  assert.equal(
    haveSamePaneOrigin("https://app.example.test", "https://admin.example.test"),
    false
  );
  assert.equal(
    haveSamePaneOrigin("http://app.example.test", "https://app.example.test"),
    false
  );
});

test("GitHub favicons use a light variant on the dark pane chrome", () => {
  assert.equal(needsLightPaneFavicon("https://github.com/dguerizec/boatyard"), true);
  assert.equal(needsLightPaneFavicon("https://api.github.com/repos/dguerizec/boatyard"), true);
  assert.equal(needsLightPaneFavicon("https://gitlab.com/dguerizec/boatyard"), false);
});

test("pane icon labels render favicon and name, then fall back to the initial", () => {
  withFakeDocument(() => {
    const content = createPaneIconLabel({
      label: "URL: PickATube",
      url: "https://picka.tube/watch"
    }, "PickATube") as FakeElement;
    const icon = content.children[0];
    const image = icon.children[0];

    assert.equal(content.className, "pane-icon-label");
    assert.equal(image.tagName, "img");
    assert.equal(image.src, "https://picka.tube/favicon.ico");
    assert.equal(content.children[1].textContent, "PickATube");

    image.trigger("error");
    assert.equal(icon.classList.contains("initial"), true);
    assert.equal(icon.children[0].textContent, "P");
  });
});

test("page-reported favicons take precedence over the conventional origin path", () => {
  withFakeDocument(() => {
    const icon = createPaneIcon({
      faviconUrl: "https://app.example.test/assets/favicon.svg",
      key: "pane-1:app",
      label: "App",
      url: "https://app.example.test/dashboard"
    }) as FakeElement;

    assert.equal(icon.children[0].src, "https://app.example.test/assets/favicon.svg");
  });
});

test("page favicon events update icons that are already visible", () => {
  withFakeDocument(() => {
    const icon = createPaneIcon({
      key: "pane-1:app",
      label: "App",
      url: "https://app.example.test/dashboard"
    }) as FakeElement;
    assert.equal(icon.children[0].src, "https://app.example.test/favicon.ico");

    assert.equal(updatePaneFaviconElements(
      "pane-1:app",
      "https://cdn.example.test/app-icon.png",
      "https://app.example.test/dashboard"
    ), 1);
    assert.equal(icon.children[0].src, "https://cdn.example.test/app-icon.png");
  });
});

test("same-origin URL updates preserve the cached page favicon", () => {
  withFakeDocument(() => {
    const project = {
      id: "project-1",
      sourcePath: "/workspace/example",
      urls: [{ id: "app", label: "App", url: "https://app.example.test/dashboard" }]
    };
    const runtime = createRendererWebAppRuntime({
      boatyard: {} as never,
      findFirstPaneNode: () => null,
      findPaneNode: () => null,
      findPaneNodeBySelectedWebApp: () => null,
      getCurrentProject: () => project,
      getCurrentView: () => "project",
      getGlobalPluginConfig: () => ({}),
      getGlobalWorkspace: () => project,
      getPaneLayout: () => ({ type: "pane", id: "pane-1" }),
      getPluginPaneDefinitions: () => [],
      getProjectPluginConfig: () => ({}),
      getProjectWidgetPanes: () => [],
      getProjects: () => [project],
      getSettings: () => ({}),
      isGlobalWorkspace: () => false,
      paneLayoutState: {
        setSelectedWebAppForPane: () => undefined,
        setSelectedWebAppForProject: () => undefined
      },
      persistPaneLayout: () => undefined,
      renderWorkspacePaneArea: () => undefined
    });
    const key = "pane-1:url:app";
    const getFavicon = () => runtime.getProjectWebApps(project, "pane-1")
      .find((webApp: { key?: string }) => webApp.key === key)?.faviconUrl;

    runtime.setCurrentWebAppFavicons(
      key,
      ["https://app.example.test/assets/favicon.svg"],
      "https://app.example.test/dashboard"
    );
    assert.equal(getFavicon(), "https://app.example.test/assets/favicon.svg");

    runtime.setCurrentWebAppUrl(key, "https://app.example.test/settings");
    assert.equal(getFavicon(), "https://app.example.test/assets/favicon.svg");

    runtime.setCurrentWebAppUrl(key, "https://other.example.test/");
    assert.equal(getFavicon(), "");
  });
});

test("persisted same-origin favicons are restored before a webapp is selected", () => {
  withFakeDocument(() => {
    const project = {
      id: "project-1",
      sourcePath: "/workspace/example",
      urls: [{ id: "app", label: "App", url: "https://app.example.test/dashboard" }]
    };
    const runtime = createRendererWebAppRuntime({
      boatyard: {} as never,
      findFirstPaneNode: () => null,
      findPaneNode: () => null,
      findPaneNodeBySelectedWebApp: () => null,
      getCurrentProject: () => project,
      getCurrentView: () => "project",
      getGlobalPluginConfig: () => ({}),
      getGlobalWorkspace: () => project,
      getPaneLayout: () => ({ type: "pane", id: "pane-1" }),
      getPluginPaneDefinitions: () => [],
      getProjectPluginConfig: () => ({}),
      getProjectWidgetPanes: () => [],
      getProjects: () => [project],
      getSettings: () => ({}),
      isGlobalWorkspace: () => false,
      paneLayoutState: {
        setSelectedWebAppForPane: () => undefined,
        setSelectedWebAppForProject: () => undefined
      },
      persistPaneLayout: () => undefined,
      renderWorkspacePaneArea: () => undefined
    });
    const key = "pane-1:url:app";

    runtime.hydrateCurrentWebAppUrls({
      [key]: {
        faviconPageUrl: "https://app.example.test/previous-route",
        faviconUrl: "https://app.example.test/assets/favicon.svg",
        url: "https://app.example.test/dashboard"
      }
    });

    assert.equal(runtime.getWebAppFavicon(key), "https://app.example.test/assets/favicon.svg");
  });
});

test("known pane tool icons take precedence over URL favicons", () => {
  withFakeDocument(() => {
    const icon = createPaneIcon({
      icon: "terminal",
      label: "Terminal",
      url: "https://example.test"
    }) as FakeElement;

    assert.equal(icon.classList.contains("tool"), true);
    assert.equal(icon.children[0].tagName, "svg");

    const linkIcon = createPaneIcon({
      icon: "link",
      label: "URL"
    }) as FakeElement;
    assert.equal(linkIcon.classList.contains("tool"), true);
    assert.equal(linkIcon.children[0].tagName, "svg");
  });
});

test("GitHub pane icons mark their favicon for dark-theme contrast", () => {
  withFakeDocument(() => {
    const icon = createPaneIcon({
      label: "Repo",
      url: "https://github.com/dguerizec/boatyard"
    }) as FakeElement;
    const image = icon.children[0];

    assert.equal(image.classList.contains("light-on-dark"), true);
  });
});

test("project webapps expose built-in icons and leave URL panes eligible for favicons", () => {
  const projectWebApps = createProjectWebApps({
    findPaneNode: () => null,
    getGlobalPluginConfig: () => ({}),
    getPaneLayout: () => ({ type: "pane", id: "pane-1" }),
    getPluginPaneDefinitions: ({ kind }: { kind?: string }) => kind === "wcv"
      ? [{
          key: "pier",
          kind: "wcv",
          pluginId: "boatyard.pier",
          resolveUrl: () => "https://pier.example.test/project",
          title: "Pier",
          webAppId: "pier"
        }]
      : [],
    getProjectPluginConfig: () => ({}),
    getProjectWidgetPanes: () => [{ id: "primary", label: "Widgets" }],
    getWebAppFavicon: () => "",
    isGlobalWorkspace: () => false
  });
  const webApps = projectWebApps.getProjectWebApps({
    id: "project-1",
    sourcePath: "/workspace/example",
    urls: [{ id: "app", label: "App", url: "https://app.example.test/dashboard" }]
  }, "pane-1");

  assert.equal(webApps.find((webApp: { id?: string }) => webApp.id === "widgets:primary")?.icon, "grid");
  assert.equal(webApps.find((webApp: { id?: string }) => webApp.id === "terminal")?.icon, "terminal");
  assert.equal(webApps.find((webApp: { id?: string }) => webApp.id === "manual")?.icon, "info");
  assert.equal(
    getPaneFaviconUrl(webApps.find((webApp: { id?: string }) => webApp.id === "pier")?.url),
    "https://pier.example.test/favicon.ico"
  );
  assert.equal(
    getPaneFaviconUrl(webApps.find((webApp: { id?: string }) => webApp.id === "url:app")?.url),
    "https://app.example.test/favicon.ico"
  );
});

export {};
