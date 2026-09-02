"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const { resolveFieldDefault } = require(`${process.cwd()}/build/renderer/pluginSettingsFields`);
const { registerPluginRegistry } = require(`${process.cwd()}/build/renderer/pluginRegistry`);
const { registerWidgetRegistry } = require(`${process.cwd()}/build/renderer/widgetRegistry`);

const builtinPluginDirs = ["twicc", "pier", "telegram", "color-palette", "github", "git-worktrees", "system-resources"];

type MockFetch = (...args: unknown[]) => Promise<unknown>;

type LooseVmValue = ((...args: unknown[]) => LooseVmValue) & {
  [key: number]: LooseVmValue;
  [key: string]: LooseVmValue;
};

type PluginPane = {
  id: string;
  iconUrl?: string;
  isAvailable?: (context: unknown) => boolean;
  key?: string;
  parentLabel?: string;
  parentWebAppId?: string;
  replacesWebAppIds?: string[];
  showInMenu?: boolean;
  renderHeaderActions?: (container: unknown, props?: Record<string, unknown>) => unknown;
  renderSidePanel?: (container: unknown, props?: Record<string, unknown>) => unknown;
  resolveNavigation?: (context: unknown) => {
    browserControls?: "compact" | "full" | "hidden";
    items: Array<{ activeUrlPatterns?: string[]; id: string; label: string; url?: string; webAppId?: string }>;
    showAddressBar?: boolean;
  } | null;
  resolveSidePanel?: (context: unknown) => {
    defaultOpen?: boolean;
    position?: "left" | "right";
    title?: string;
  } | null;
  title?: string;
  resolveUrl(context: unknown): string;
  resolveWebApps(context: unknown): unknown[];
};

type PluginBadge = {
  id: string;
  render(context: unknown): { className: string; textContent: string; title: string } | null;
};

type PluginSection = {
  fields: PluginField[];
  id: string;
};

type PluginField = {
  action?: {
    label: string;
    message?: string;
    run?(context: unknown): Promise<void>;
  };
  defaultValue?: unknown;
  key: string;
  options?: Array<{ label: string; value: string }>;
  persist?: boolean;
  readOnly?: boolean;
  type?: string;
  valueType?: string;
};

type PluginSummary = {
  contributes: {
    globalSettings?: string[];
    panes?: string[];
    projectNavBadges?: string[];
    widgets: string[];
  };
  id: string;
};

type BuiltinRendererContext = {
  CustomEvent: typeof CustomEvent;
  URL: typeof URL;
  console: Console;
  clearInterval(): void;
  document: {
    body: {
      contains(element: unknown): boolean;
    };
    createElement: () => {
      addEventListener(): void;
      append(): void;
      classList: { add(): void; remove(): void; toggle(): void };
      setAttribute(): void;
    };
    currentScript: { src: string } | null;
  };
  fetch: MockFetch;
  queueMicrotask(callback: () => void): void;
  setInterval(callback: () => void): number;
  window: Record<string, unknown> & {
    addEventListener(type: string, listener: (event: unknown) => void): void;
    BoatyardPluginRegistry?: LooseVmValue;
    BoatyardWidgetRegistry?: LooseVmValue;
    boatyard: {
      invokePlugin(pluginId: string, actionName: string, payload?: unknown): Promise<unknown>;
      onPluginEvent(): () => void;
      openExternal(): void;
      writeClipboardText(): void;
    };
    clearInterval(): void;
    dispatchEvent(event: { type: string }): void;
    removeEventListener(type: string, listener: (event: unknown) => void): void;
    setInterval(callback: () => void): number;
    window?: BuiltinRendererContext["window"];
  };
};

function readBuiltinPluginRendererPath(pluginDir: string) {
  const manifestPath = path.join(process.cwd(), "src/plugins", pluginDir, "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return path.join(process.cwd(), "build/plugins", pluginDir, manifest.renderer);
}

function loadRendererPluginEnvironment(twiccProjectProcessStatuses: unknown = {
  "twicc-project": {
    state: "working",
    count: 1,
    sessions: [
      {
        id: "session-id",
        title: "Working session",
        state: "working"
      }
    ]
  }
}, mockFetch: MockFetch = async () => ({ ok: true, json: async (): Promise<unknown[]> => [] })) {
  return loadRendererPluginContext(twiccProjectProcessStatuses, mockFetch).registry;
}

function loadRendererPluginContext(
  twiccProjectProcessStatuses: unknown = {
    "twicc-project": {
      state: "working",
      count: 1,
      sessions: [
        {
          id: "session-id",
          title: "Working session",
          state: "working"
        }
      ]
    }
  },
  mockFetch: MockFetch = async () => ({ ok: true, json: async (): Promise<unknown[]> => [] }),
  exposeTwiccSessionFlowStatus = false
) {
  const intervalCallbacks: Array<() => void | Promise<void>> = [];
  const windowEventListeners = new Map<string, Set<(event: unknown) => void>>();
  const context: BuiltinRendererContext = {
    CustomEvent: class MockCustomEvent {
      detail: unknown;
      type: string;

      constructor(type: string, init: { detail?: unknown } = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    } as unknown as typeof CustomEvent,
    clearInterval: () => {},
    console,
    queueMicrotask: (callback) => callback(),
    setInterval: (callback) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    URL,
    window: {
      addEventListener(type, listener) {
        const listeners = windowEventListeners.get(type) || new Set();
        listeners.add(listener);
        windowEventListeners.set(type, listeners);
      },
      boatyard: {
        openExternal: () => {},
        writeClipboardText: () => {},
        invokePlugin: async (pluginId, actionName) => {
          if (pluginId === "boatyard.twicc" && actionName === "projectProcessStatuses") {
            return twiccProjectProcessStatuses;
          }
          if (pluginId === "boatyard.telegram" && actionName === "status") {
            return {
              state: "notConfigured",
              summary: "Telegram API credentials are not configured."
            };
          }
          if (pluginId === "boatyard.telegram" && actionName === "messages") {
            return {
              status: {
                state: "notConfigured",
                summary: "Telegram API credentials are not configured."
              },
              messages: []
            };
          }
          if (pluginId === "boatyard.telegram" && actionName === "sendMessage") {
            return { sent: true };
          }
          if (pluginId === "boatyard.telegram" && actionName === "startLogin") {
            return { state: "codeRequired", summary: "Enter the Telegram login code." };
          }
          if (pluginId === "boatyard.telegram" && ["completeLoginCode", "completeLoginPassword"].includes(actionName)) {
            return { state: "ready", summary: "Telegram user is authenticated." };
          }
          if (pluginId === "boatyard.telegram" && actionName === "logout") {
            return { state: "notAuthenticated", summary: "Telegram user is not authenticated." };
          }
          return null;
        },
        onPluginEvent: () => (() => {})
      },
      dispatchEvent(event) {
        for (const listener of windowEventListeners.get(event.type) || []) {
          listener(event);
        }
      },
      removeEventListener(type, listener) {
        windowEventListeners.get(type)?.delete(listener);
      },
      setInterval: (callback) => {
        intervalCallbacks.push(callback);
        return intervalCallbacks.length;
      },
      clearInterval: () => {}
    },
    document: {
      body: {
        contains: () => true
      },
      createElement: () => ({
        append() {},
        addEventListener() {},
        setAttribute() {},
        classList: { add() {}, remove() {}, toggle() {} }
      }),
      currentScript: null as { src: string } | null
    },
    fetch: mockFetch
  };
  context.window.window = context.window;
  registerWidgetRegistry(context.window);
  registerPluginRegistry(context.window);
  const registry = context.window.BoatyardPluginRegistry;
  if (!registry) {
    throw new Error("Plugin registry test environment was not initialized.");
  }

  vm.createContext(context);

  for (const file of [
    ...builtinPluginDirs.map(readBuiltinPluginRendererPath)
  ]) {
    context.document.currentScript = { src: pathToFileURL(file).href };
    let source = fs.readFileSync(file, "utf8");
    if (exposeTwiccSessionFlowStatus && file.endsWith(path.join("twicc", "renderer.js"))) {
      source = source.replace(
        /\}\)\(window\);\s*$/,
        `globalScope.__twiccSessionFlowStatusTest = {
          acknowledge: acknowledgeSessionFlowUnread,
          getState: getSessionFlowIndicatorState
        };
      })(window);`
      );
    }
    vm.runInContext(source, context);
  }
  context.document.currentScript = null;

  return {
    context,
    registry,
    widgetRegistry: context.window.BoatyardWidgetRegistry,
    async refreshIntervals() {
      for (const callback of intervalCallbacks) {
        await callback();
      }
    }
  };
}

function plain(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function fieldMap(fields: unknown): Record<string, LooseVmValue> {
  return Object.fromEntries(fields as Iterable<readonly [PropertyKey, LooseVmValue]>) as Record<string, LooseVmValue>;
}

type TestResourceElement = {
  attributes: Record<string, string>;
  className: string;
  children: TestResourceElement[];
  disabled: boolean;
  hidden: boolean;
  isConnected: boolean;
  textContent: string;
  title: string;
  type: string;
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void;
  append(...children: TestResourceElement[]): void;
  classList: {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    toggle(name: string, force?: boolean): void;
  };
  click(): void;
  removeEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void;
  setAttribute(name: string, value: string): void;
};

function createTestResourceElement(textContent = ""): TestResourceElement {
  const listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();
  const classes = new Set<string>();
  const element: TestResourceElement = {
    attributes: {},
    className: "",
    children: [],
    disabled: false,
    hidden: false,
    isConnected: true,
    textContent,
    title: "",
    type: "",
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    append(...children) {
      this.children.push(...children);
    },
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      }
    },
    click() {
      if (this.disabled) {
        return;
      }
      for (const listener of listeners.get("click") || []) {
        listener({ preventDefault() {} });
      }
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((candidate) => candidate !== listener));
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
  return element;
}

function getTestResourceText(element: TestResourceElement): string[] {
  return [element.textContent, ...element.children.flatMap(getTestResourceText)];
}

function createTestResourceUi() {
  return {
    addError(container: TestResourceElement, message: unknown) {
      if (message) {
        container.append(createTestResourceElement(String(message)));
      }
    },
    createCard(title: string, count: string, countLabel: string) {
      const card = createTestResourceElement(`${title} ${count} ${countLabel}`);
      const stats = createTestResourceElement();
      card.append(stats);
      return { card, header: createTestResourceElement(), stats };
    },
    createResourceGroup(options: { title: string; subtitle?: string }) {
      const group = createTestResourceElement(`${options.title} ${options.subtitle || ""}`);
      const rows = createTestResourceElement();
      group.append(rows);
      return { group, rows };
    },
    createResourceItem(options: { title: string; metadata?: string[] }) {
      return createTestResourceElement(`${options.title} ${(options.metadata || []).join(" ")}`);
    },
    createResourceList: () => createTestResourceElement(),
    createStat: (label: string, value: string, detail = "") => (
      createTestResourceElement(`${label} ${value} ${detail}`)
    ),
    element: (_tagName: string, className = "", text = "") => {
      const element = createTestResourceElement(text);
      element.className = className;
      return element;
    },
    formatCount: (value: unknown) => String(Number(value) || 0),
    formatMemory: (value: unknown) => `${Number(value) || 0} B`
  };
}

test("Built-in plugins register project integrations and widgets", () => {
  const { context, registry } = loadRendererPluginContext();

  registry.applyEnabledState({});

  assert.equal(registry.getService("boatyard.twicc.api").version, "0.1.0");
  assert.equal(registry.getService("boatyard.twicc.systemResources").kind, "boatyard.resourceProvider");
  assert.equal(typeof registry.getService("boatyard.pier").listProjectWorkloads, "function");
  assert.equal(typeof registry.getService("boatyard.pier").getProjectAvailability, "function");
  assert.equal(registry.getService("boatyard.telegram").version, "0.1.0");
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane: PluginPane) => pane.id).sort()),
    ["boatyard.github.repository", "boatyard.pier.preview", "boatyard.twicc.pane"]
  );
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "dom" }).map((pane: PluginPane) => pane.id).sort()),
    [
      "boatyard.gitWorktrees.changes",
      "boatyard.github.overview",
      "boatyard.telegram.pane",
      "boatyard.twicc.sessionFlowPane"
    ]
  );
  assert.deepEqual(
    plain(registry.listPanes({ scope: "global", kind: "dom" }).map((pane: PluginPane) => pane.id).sort()),
    [
      "boatyard.pier.systemResources.pane",
      "boatyard.systemResources.pane",
      "boatyard.systemResources.tmux",
      "boatyard.systemResources.wcv",
      "boatyard.twicc.systemResources.pane"
    ]
  );
  const resourcePanes = registry.listPanes({ scope: "global", kind: "dom" });
  const resourcesPane = resourcePanes.find((pane: PluginPane) => pane.id === "boatyard.systemResources.pane");
  assert.equal(resourcesPane.title, "Resources");
  assert.equal(resourcesPane.key, "system-resources");
  assert.equal(typeof resourcesPane.render, "function");
  assert.deepEqual(
    plain(resourcesPane.resolveNavigation?.({})?.items),
    [
      { id: "overview", label: "Overview", webAppId: "boatyard.systemResources.pane" },
      { id: "wcv", label: "Web apps", webAppId: "boatyard.systemResources.wcv" },
      { id: "tmux", label: "tmux", webAppId: "boatyard.systemResources.tmux" },
      {
        id: "boatyard.twicc.systemResources",
        label: "TwiCC",
        webAppId: "boatyard.twicc.systemResources.pane"
      },
      {
        id: "boatyard.pier.systemResources",
        label: "Pier",
        webAppId: "boatyard.pier.systemResources.pane"
      }
    ]
  );
  assert.deepEqual(
    plain(resourcePanes
      .filter((pane: PluginPane) => pane.id !== "boatyard.systemResources.pane")
      .map((pane: PluginPane) => ({
        parentLabel: pane.parentLabel,
        parentWebAppId: pane.parentWebAppId,
        showInMenu: pane.showInMenu
      }))),
    Array.from({ length: 4 }, () => ({
      parentLabel: "Resources",
      parentWebAppId: "boatyard.systemResources.pane",
      showInMenu: false
    }))
  );
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane: PluginPane) => pane.key).sort()),
    ["github", "pier", "twicc-plugin"]
  );
  const githubPane = registry
    .listPanes({ scope: "project", kind: "wcv" })
    .find((pane: PluginPane) => pane.id === "boatyard.github.repository");
  const githubContext = {
    project: {
      gitUrl: "git@github.com:octo-org/example.git",
      repoUrl: "https://github.com/octo-org/example/tree/main/docs"
    }
  };
  assert.equal(githubPane.resolveUrl(githubContext), "https://github.com/octo-org/example");
  assert.equal(githubPane.isAvailable?.(githubContext), true);
  assert.equal(githubPane.parentLabel, "GitHub");
  assert.equal(githubPane.parentWebAppId, "boatyard.github.overview");
  assert.equal(githubPane.paneTypeId, "repo");
  assert.deepEqual(plain(githubPane.replacesWebAppIds), ["repo"]);
  assert.equal(githubPane.showInMenu, false);
  assert.match(githubPane.iconUrl || "", /\/plugins\/github\/github-icon\.svg$/);
  const githubNavigation = githubPane.resolveNavigation?.(githubContext);
  assert.equal(githubNavigation?.showAddressBar, false);
  assert.deepEqual(
    plain(githubNavigation?.items.map((item: {
      id: string;
      label: string;
      url?: string;
      webAppId?: string;
    }) => ({
      id: item.id,
      label: item.label,
      url: item.url || "",
      webAppId: item.webAppId
    }))),
    [
      { id: "overview", label: "Overview", url: "", webAppId: "boatyard.github.overview" },
      { id: "code", label: "Code", url: "https://github.com/octo-org/example", webAppId: "boatyard.github.repository" },
      { id: "issues", label: "Issues", url: "https://github.com/octo-org/example/issues", webAppId: "boatyard.github.repository" },
      { id: "pullRequests", label: "Pull requests", url: "https://github.com/octo-org/example/pulls", webAppId: "boatyard.github.repository" },
      { id: "actions", label: "Actions", url: "https://github.com/octo-org/example/actions", webAppId: "boatyard.github.repository" },
      { id: "settings", label: "Settings", url: "https://github.com/octo-org/example/settings", webAppId: "boatyard.github.repository" }
    ]
  );
  const pullRequestUrl = "https://github.com/octo-org/example/pull/42/files";
  const activeNavigationItems = githubNavigation?.items.filter((item: {
    activeUrlPatterns?: string[];
    id: string;
    webAppId?: string;
  }) => (
    item.webAppId === "boatyard.github.repository"
    && item.activeUrlPatterns?.some((pattern) => new RegExp(pattern).test(pullRequestUrl))
  ));
  assert.deepEqual(
    plain(activeNavigationItems?.map((item: { id: string }) => item.id)),
    ["pullRequests"]
  );
  const settingsUrl = "https://github.com/octo-org/example/settings/actions";
  assert.deepEqual(
    plain(githubNavigation?.items
      .filter((item: { activeUrlPatterns?: string[] }) => (
        item.activeUrlPatterns?.some((pattern) => new RegExp(pattern).test(settingsUrl))
      ))
      .map((item: { id: string }) => item.id)),
    ["settings"]
  );
  const githubOverviewPane = registry
    .listPanes({ scope: "project", kind: "dom" })
    .find((pane: PluginPane) => pane.id === "boatyard.github.overview");
  assert.equal(githubOverviewPane.title, "GitHub");
  assert.equal(githubOverviewPane.parentLabel, "");
  assert.equal(githubOverviewPane.parentWebAppId, "");
  assert.equal(githubOverviewPane.showInMenu, true);
  const twiccPane = registry
    .listPanes({ scope: "project", kind: "wcv" })
    .find((pane: PluginPane) => pane.id === "boatyard.twicc.pane");
  assert.match(twiccPane.iconUrl || "", /\/plugins\/twicc\/twicc-icon\.svg$/);
  assert.equal(typeof twiccPane.renderHeaderActions, "function");
  assert.equal(typeof twiccPane.renderSidePanel, "function");
  assert.deepEqual(plain(twiccPane.resolveNavigation?.({ globalPluginConfig: {} })), {
    browserControls: "compact",
    items: [],
    showAddressBar: true,
    showHomeButton: true
  });
  assert.deepEqual(plain(twiccPane.resolveSidePanel?.({ globalPluginConfig: {} })), {
    defaultOpen: true,
    defaultWidth: 360,
    maxWidth: 720,
    minMainWidth: 360,
    minWidth: 280,
    position: "left",
    title: "Sessions"
  });
  assert.equal(
    twiccPane.resolveNavigation?.({
      globalPluginConfig: { twiccPaneBrowserControls: "hidden" }
    })?.browserControls,
    "hidden"
  );
  assert.deepEqual(
    plain(twiccPane.resolveSidePanel?.({
      globalPluginConfig: {
        twiccPaneSidebarDefaultState: "closed",
        twiccPaneSidebarPosition: "right"
      }
    })),
    {
      defaultOpen: false,
      defaultWidth: 360,
      maxWidth: 720,
      minMainWidth: 360,
      minWidth: 280,
      position: "right",
      title: "Sessions"
    }
  );
  assert.match(
    fs.readFileSync(path.join(process.cwd(), "src", "plugins", "twicc", "twicc-icon.svg"), "utf8"),
    /fill="#3178c0"/
  );
  const twiccSessionFlowPane = registry
    .listPanes({ scope: "project", kind: "dom" })
    .find((pane: PluginPane) => pane.id === "boatyard.twicc.sessionFlowPane");
  assert.equal(twiccSessionFlowPane.key, "twicc-session-flow");
  assert.equal(twiccSessionFlowPane.title, "Session Flow");
  assert.equal(twiccSessionFlowPane.parentLabel, "Twicc");
  assert.equal(twiccSessionFlowPane.parentWebAppId, "twicc-plugin");
  assert.equal(typeof twiccSessionFlowPane.renderHeaderActions, "function");
  assert.match(twiccSessionFlowPane.iconUrl || "", /\/plugins\/twicc\/twicc-icon\.svg$/);
  const telegramPane = registry
    .listPanes({ scope: "project", kind: "dom" })
    .find((pane: PluginPane) => pane.id === "boatyard.telegram.pane");
  assert.match(telegramPane.iconUrl || "", /\/plugins\/telegram\/telegram-icon\.svg$/);
  assert.match(
    fs.readFileSync(path.join(process.cwd(), "src", "plugins", "telegram", "telegram-icon.svg"), "utf8"),
    /#2AABEE[\s\S]*#229ED9/
  );
  assert.deepEqual(
    plain(registry.listProjectNavBadges().map((badge: PluginBadge) => badge.id).sort()),
    ["boatyard.github.projectStatus", "boatyard.twicc.projectStatus"]
  );
  assert.deepEqual(
    plain(registry.listGlobalSettingsSections().map((section: PluginSection) => section.id).sort()),
    [
      "boatyard.github.global",
      "boatyard.pier.global",
      "boatyard.telegram.global",
      "boatyard.twicc.global"
    ]
  );
  const twiccPlugin = registry.list().find((plugin: PluginSummary) => plugin.id === "boatyard.twicc");
  assert.deepEqual(
    plain(twiccPlugin.contributes.widgets),
    ["boatyard.twicc.sessionFlow", "boatyard.twicc.usage"]
  );
  const colorPalettePlugin = registry.list().find((plugin: PluginSummary) => plugin.id === "boatyard.colorPalette");
  assert.deepEqual(plain(colorPalettePlugin.contributes.widgets), ["boatyard.colorPalette.widget"]);
  const githubPlugin = registry.list().find((plugin: PluginSummary) => plugin.id === "boatyard.github");
  assert.deepEqual(
    plain(githubPlugin.contributes.panes),
    ["boatyard.github.repository", "boatyard.github.overview"]
  );
  assert.deepEqual(
    plain(githubPlugin.contributes.widgets),
    ["boatyard.github.actions", "boatyard.github.pullRequests"]
  );
  assert.deepEqual(
    plain(githubPlugin.contributes.projectNavBadges),
    ["boatyard.github.projectStatus"]
  );
  assert.deepEqual(
    plain(githubPlugin.contributes.globalSettings),
    ["boatyard.github.global"]
  );
  const gitWorktreesPlugin = registry.list().find((plugin: PluginSummary) => plugin.id === "boatyard.gitWorktrees");
  assert.deepEqual(
    plain(gitWorktreesPlugin.contributes.panes),
    ["boatyard.gitWorktrees.changes"]
  );
  assert.deepEqual(
    plain(gitWorktreesPlugin.contributes.widgets),
    ["boatyard.gitWorktrees.list"]
  );
  const gitWorktreesWidget = context.window.BoatyardWidgetRegistry?.get("boatyard.gitWorktrees.list");
  if (!gitWorktreesWidget) {
    throw new Error("Git worktrees widget was not registered.");
  }
  assert.equal(gitWorktreesWidget.name, "Git");
  assert.equal(gitWorktreesWidget.status, "stable");
  assert.equal(gitWorktreesWidget.defaultVisible, false);
  assert.equal(
    context.window.BoatyardWidgetRegistry?.list().every((widget: { defaultVisible?: boolean }) => (
      widget.defaultVisible === false
    )),
    true
  );
  assert.deepEqual(plain(gitWorktreesWidget.layout), {
    default: { columns: 4, rows: 3 },
    min: { columns: 3, rows: 2 }
  });

  registry.setEnabled("boatyard.pier", false);
  assert.deepEqual(
    plain(resourcesPane.resolveNavigation?.({})?.items),
    [
      { id: "overview", label: "Overview", webAppId: "boatyard.systemResources.pane" },
      { id: "wcv", label: "Web apps", webAppId: "boatyard.systemResources.wcv" },
      { id: "tmux", label: "tmux", webAppId: "boatyard.systemResources.tmux" },
      {
        id: "boatyard.twicc.systemResources",
        label: "TwiCC",
        webAppId: "boatyard.twicc.systemResources.pane"
      }
    ]
  );
  assert.equal(
    registry.listPanes({ scope: "global", kind: "dom" })
      .some((pane: PluginPane) => pane.id === "boatyard.pier.systemResources.pane"),
    false
  );
});

test("System resources and renderer event bindings remain provider agnostic", () => {
  const systemResourcesSources = ["main.ts", "renderer.ts", "service.ts"]
    .map((fileName) => fs.readFileSync(
      path.join(process.cwd(), "src", "plugins", "system-resources", fileName),
      "utf8"
    ))
    .join("\n");
  const rendererEventBindings = fs.readFileSync(
    path.join(process.cwd(), "src", "renderer", "rendererEventBindings.ts"),
    "utf8"
  );
  const pierRenderer = fs.readFileSync(
    path.join(process.cwd(), "src", "plugins", "pier", "renderer.ts"),
    "utf8"
  );
  const twiccRenderer = fs.readFileSync(
    path.join(process.cwd(), "src", "plugins", "twicc", "renderer.ts"),
    "utf8"
  );

  assert.doesNotMatch(systemResourcesSources, /\bpier\b/i);
  assert.doesNotMatch(systemResourcesSources, /\btwicc\b/i);
  assert.doesNotMatch(rendererEventBindings, /\bpier\b/i);
  assert.match(rendererEventBindings, /boatyard:pane-contributions-changed/);
  assert.match(pierRenderer, /kind: "boatyard\.resourceProvider"/);
  assert.match(pierRenderer, /ui\.createResourceGroup\(/);
  assert.match(pierRenderer, /ui\.createResourceItem\(/);
  assert.doesNotMatch(pierRenderer, /createMemoryShareIndicator|pier-resource-memory/);
  assert.match(twiccRenderer, /kind: "boatyard\.resourceProvider"/);
  assert.match(twiccRenderer, /ui\.createResourceGroup\(/);
  assert.match(twiccRenderer, /ui\.createResourceItem\(/);
});

test("Twicc service extracts the current session id from a pane URL", () => {
  const registry = loadRendererPluginEnvironment();
  registry.applyEnabledState({});
  const service = registry.getService("boatyard.twicc.api");

  assert.equal(
    service.getSessionIdFromUrl("http://localhost:3500/project/project-1/session/session-123/files"),
    "session-123"
  );
  assert.equal(service.getSessionIdFromUrl("http://localhost:3500/project/project-1"), "");
});

test("Twicc plugin routes session URL changes through the generic project webapp activator", async () => {
  const { context, registry } = loadRendererPluginContext();
  const resolvedPayloads: unknown[] = [];
  const activations: unknown[][] = [];
  context.window.boatyard.invokePlugin = async (pluginId: string, actionName: string, payload: unknown) => {
    if (pluginId === "boatyard.twicc" && actionName === "projectProcessStatuses") {
      return {};
    }
    if (pluginId === "boatyard.twicc" && actionName === "resolveSessionNavigationTarget") {
      resolvedPayloads.push(payload);
      return {
        boatyardProjectId: "boatyard-target",
        sessionId: "session-1",
        sourceBoatyardProjectId: "boatyard-source",
        twiccProjectId: "twicc-target",
        url: "http://localhost:3500/project/twicc-target/session/session-1"
      };
    }
    return null;
  };
  context.window.BoatyardPaneNavigation = {
    activateProjectWebApp(...args: unknown[]) {
      activations.push(args);
      return true;
    }
  };
  registry.applyEnabledState({});

  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:github",
      url: "http://localhost:3500/project/current/session/session-1"
    }
  }));
  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      url: "http://localhost:3500/project/current"
    }
  }));
  assert.deepEqual(resolvedPayloads, []);

  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      previousUrl: "http://localhost:3500/project/current/session/source-session",
      sourceProjectId: "boatyard-source",
      url: "http://localhost:3500/project/current/session/session-1"
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(plain(resolvedPayloads), [{
    globalConfig: {},
    sessionId: "session-1",
    sourceTwiccProjectId: "current"
  }]);
  assert.deepEqual(plain(activations), [[
    "boatyard-target",
    "twicc-plugin",
    "http://localhost:3500/project/twicc-target/session/session-1",
    {
      restoreSourceWebAppUrl: "http://localhost:3500/project/current/session/source-session",
      sourceWebAppKey: "pane-1:twicc-plugin"
    }
  ]]);

  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      url: "http://localhost:3500/project/current/session/session-1"
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvedPayloads.length, 1);
  assert.equal(activations.length, 1);

  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      previousUrl: "http://localhost:3500/project/current/session/session-1",
      url: "http://localhost:3500/project/current/session/source-session"
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvedPayloads.length, 1);
  assert.equal(activations.length, 1);

  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      previousUrl: "http://localhost:3500/project/current/session/source-session",
      url: "http://localhost:3500/project/canonical/session/source-session"
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvedPayloads.length, 1);
  assert.equal(activations.length, 1);

  registry.setEnabled("boatyard.twicc", false);
  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      url: "http://localhost:3500/project/current/session/session-2"
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvedPayloads.length, 1);
});

test("Twicc plugin uses resolved source ownership for same-project navigation", async () => {
  const { context, registry } = loadRendererPluginContext();
  const resolvedPayloads: unknown[] = [];
  const activations: unknown[][] = [];
  context.window.boatyard.invokePlugin = async (pluginId: string, actionName: string, payload: unknown) => {
    if (pluginId === "boatyard.twicc" && actionName === "projectProcessStatuses") {
      return {};
    }
    if (pluginId === "boatyard.twicc" && actionName === "resolveSessionNavigationTarget") {
      resolvedPayloads.push(payload);
      return {
        boatyardProjectId: "boatyard-project",
        sessionId: "target-session",
        sourceBoatyardProjectId: "boatyard-project",
        twiccProjectId: "twicc-project",
        url: "http://localhost:3500/project/twicc-project/session/target-session"
      };
    }
    return null;
  };
  context.window.BoatyardPaneNavigation = {
    activateProjectWebApp(...args: unknown[]) {
      activations.push(args);
      return true;
    }
  };
  registry.applyEnabledState({});

  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      previousUrl: "http://localhost:3500/project/twicc-project/session/source-session",
      url: "http://localhost:3500/project/twicc-project/session/target-session"
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(plain(resolvedPayloads), [{
    globalConfig: {},
    sessionId: "target-session",
    sourceTwiccProjectId: "twicc-project"
  }]);
  assert.deepEqual(activations, []);
});

test("Twicc plugin ignores a stale navigation resolution after a newer URL change", async () => {
  const { context, registry } = loadRendererPluginContext();
  const activations: unknown[][] = [];
  let resolveInitialNavigation!: (value: unknown) => void;
  const initialNavigation = new Promise((resolve) => {
    resolveInitialNavigation = resolve;
  });
  context.window.boatyard.invokePlugin = async (pluginId: string, actionName: string, payload: unknown) => {
    if (pluginId === "boatyard.twicc" && actionName === "projectProcessStatuses") {
      return {};
    }
    if (pluginId !== "boatyard.twicc" || actionName !== "resolveSessionNavigationTarget") {
      return null;
    }
    const sessionId = String((payload as { sessionId?: unknown })?.sessionId || "");
    if (sessionId === "source-session") {
      return initialNavigation;
    }
    return {
      boatyardProjectId: "boatyard-project",
      sessionId: "target-session",
      sourceBoatyardProjectId: "boatyard-project",
      twiccProjectId: "twicc-project",
      url: "http://localhost:3500/project/twicc-project/session/target-session"
    };
  };
  context.window.BoatyardPaneNavigation = {
    activateProjectWebApp(...args: unknown[]) {
      activations.push(args);
      return true;
    }
  };
  registry.applyEnabledState({});

  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      url: "http://localhost:3500/project/twicc-project/session/source-session"
    }
  }));
  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      previousUrl: "http://localhost:3500/project/twicc-project/session/source-session",
      url: "http://localhost:3500/project/twicc-project/session/target-session"
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));
  resolveInitialNavigation({
    boatyardProjectId: "boatyard-project",
    sessionId: "source-session",
    twiccProjectId: "twicc-project",
    url: "http://localhost:3500/project/twicc-project/session/source-session"
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(activations, []);
});

test("Twicc plugin leaves same-project session navigation to the existing pane", async () => {
  const { context, registry } = loadRendererPluginContext();
  const resolvedPayloads: unknown[] = [];
  const activations: unknown[][] = [];
  context.window.boatyard.invokePlugin = async (pluginId: string, actionName: string, payload: unknown) => {
    if (pluginId === "boatyard.twicc" && actionName === "projectProcessStatuses") {
      return {};
    }
    if (pluginId === "boatyard.twicc" && actionName === "resolveSessionNavigationTarget") {
      resolvedPayloads.push(payload);
      return {
        boatyardProjectId: "boatyard-parent",
        sessionId: "worktree-session",
        sourceBoatyardProjectId: "boatyard-parent",
        twiccProjectId: "twicc-worktree",
        url: "http://localhost:3500/project/twicc-worktree/session/worktree-session"
      };
    }
    return null;
  };
  context.window.BoatyardPaneNavigation = {
    activateProjectWebApp(...args: unknown[]) {
      activations.push(args);
      return true;
    }
  };
  registry.applyEnabledState({});

  context.window.dispatchEvent(new context.CustomEvent("boatyard:webapp-url-changed", {
    detail: {
      key: "pane-1:twicc-plugin",
      previousUrl: "http://localhost:3500/project/twicc-parent/session/source-session",
      url: "http://localhost:3500/project/twicc-parent/session/worktree-session"
    }
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(plain(resolvedPayloads), [{
    globalConfig: {},
    sessionId: "worktree-session",
    sourceTwiccProjectId: "twicc-parent"
  }]);
  assert.deepEqual(activations, []);
});

test("TwiCC pane toolbar opens the peer inbox and mirrors its attention count", async () => {
  const { context, registry } = loadRendererPluginContext();
  registry.applyEnabledState({});

  context.document.createElement = (() => createTestResourceElement()) as unknown as (
    typeof context.document.createElement
  );
  const pane = registry
    .listPanes({ scope: "project", kind: "wcv" })
    .find((candidate: PluginPane) => candidate.id === "boatyard.twicc.pane");
  if (!pane?.renderHeaderActions) {
    throw new Error("TwiCC pane toolbar actions were not registered.");
  }

  const openedModals: unknown[] = [];
  const queriedSelectors: string[] = [];
  const container = createTestResourceElement();
  const cleanup = pane.renderHeaderActions(container, {
    createToolIcon: () => createTestResourceElement(),
    openWebAppModal: async (options: unknown) => {
      openedModals.push(options);
      return true;
    },
    getWebAppTextContent: async (selector: string) => {
      queriedSelectors.push(selector);
      return "2";
    },
    projectConfig: {
      twiccProjectUrl: "http://localhost:3500/project/current"
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(container.children.length, 1);
  const button = container.children[0];
  const badge = button.children[1];
  assert.equal(button.className, "webapp-tool-button twicc-peer-inbox-button");
  assert.equal(button.disabled, false);
  assert.equal(button.title, "Peer inbox (2 items need attention)");
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "2");
  assert.deepEqual(queriedSelectors, [".peer-inbox-button .peer-inbox-badge"]);

  button.click();
  assert.deepEqual(plain(openedModals), [{
    eventName: "twicc:open-peer-inbox",
    readySelector: "wa-dialog[label=\"Peer inbox\"]",
    title: "TwiCC Peer inbox",
    url: "http://localhost:3500/project/current"
  }]);
  assert.equal(typeof cleanup, "function");
  cleanup?.();
});

test("TwiCC resources render overview and project session details", () => {
  const registry = loadRendererPluginEnvironment();
  registry.applyEnabledState({});
  const provider = registry.getService("boatyard.twicc.systemResources");
  const ui = createTestResourceUi();
  const providerSnapshot = {
    data: {
      available: true,
      backend: { pid: 2497, processCount: 2, pssBytes: 800, rssBytes: 900 },
      processCount: 5,
      projects: [{
        processCount: 3,
        projectId: "boatyard",
        projectName: "Boatyard",
        pssBytes: 300,
        rssBytes: 400,
        sessions: [{
          pid: 3062747,
          processCount: 3,
          provider: "codex",
          pssBytes: 300,
          rssBytes: 400,
          sessionId: "session-1",
          state: "assistant_turn",
          title: "Memory accounting"
        }]
      }],
      pssBytes: 1100,
      rssBytes: 1300,
      sessionCount: 1
    }
  };

  const overview = provider.renderOverview(providerSnapshot, ui) as unknown as TestResourceElement;
  const details = createTestResourceElement();
  provider.renderDetails(details, providerSnapshot, ui);

  const overviewText = getTestResourceText(overview);
  assert.ok(overviewText.some((text) => text.includes("TwiCC 1 active sessions")));
  assert.ok(overviewText.some((text) => text.includes("PSS 1100 B")));
  assert.ok(overviewText.includes("Shared local service, excluded from estimated managed memory."));
  const detailsText = getTestResourceText(details);
  assert.ok(detailsText.some((text) => text.includes("TwiCC service")));
  assert.ok(detailsText.includes("Upgrade"));
  assert.ok(detailsText.includes("Restart"));
  assert.ok(detailsText.some((text) => text.includes("Boatyard")));
  assert.ok(detailsText.some((text) => text.includes("Memory accounting codex assistant turn PID 3062747")));
});

test("TwiCC resource upgrade confirms, rechecks idle sessions, and restarts", async () => {
  const { context, registry } = loadRendererPluginContext();
  registry.applyEnabledState({});
  const provider = registry.getService("boatyard.twicc.systemResources");
  const details = createTestResourceElement();
  const invocations: string[] = [];
  const readiness = [
    { blockingCount: 0, processCount: 2, ready: true },
    { blockingCount: 0, processCount: 2, ready: true }
  ];

  context.window.boatyard.invokePlugin = async (pluginId, actionName) => {
    assert.equal(pluginId, "boatyard.twicc");
    invocations.push(actionName);
    if (actionName === "serviceRestartReadiness") {
      return readiness.shift() || { blockingCount: 0, processCount: 2, ready: true };
    }
    return { ok: true };
  };
  type FakeDialogElement = {
    append(...children: FakeDialogElement[]): void;
    addEventListener(type: string, listener: (event: { preventDefault(): void }) => void): void;
    className: string;
    close(value?: string): void;
    focus(): void;
    remove(): void;
    returnValue: string;
    setAttribute(name: string, value: string): void;
    showModal(): void;
    textContent: string;
    type: string;
  };
  function createFakeDialogElement(): FakeDialogElement {
    const listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();
    return {
      append() {},
      addEventListener(type, listener) {
        const entries = listeners.get(type) || [];
        entries.push(listener);
        listeners.set(type, entries);
      },
      className: "",
      close(value = "") {
        this.returnValue = value;
        for (const listener of listeners.get("close") || []) {
          listener({ preventDefault() {} });
        }
      },
      focus() {},
      remove() {},
      returnValue: "",
      setAttribute() {},
      showModal() {},
      textContent: "",
      type: ""
    };
  }
  context.document.createElement = (() => createFakeDialogElement()) as unknown as BuiltinRendererContext["document"]["createElement"];
  context.window.BoatyardOverlayDialog = {
    async show(dialog: FakeDialogElement) {
      queueMicrotask(() => dialog.close("restart"));
      return true;
    }
  };

  provider.renderDetails(details, {
    data: {
      available: true,
      backend: { processCount: 1, pssBytes: 100, rssBytes: 120 },
      processCount: 1,
      projects: [],
      pssBytes: 100,
      rssBytes: 120,
      serviceControlAvailable: true,
      sessionCount: 0
    }
  }, createTestResourceUi());

  const nodes = (function flatten(element: TestResourceElement): TestResourceElement[] {
    return [element, ...element.children.flatMap(flatten)];
  })(details);
  const upgradeButton = nodes.find((element) => element.textContent === "Upgrade");
  const status = nodes.find((element) => element.className === "twicc-resource-service-status");
  if (!upgradeButton || !status) {
    throw new Error("TwiCC service controls were not rendered.");
  }
  upgradeButton.click();

  for (let attempt = 0; attempt < 20 && invocations.at(-1) !== "restartService"; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(invocations, [
    "upgradeService",
    "serviceRestartReadiness",
    "serviceRestartReadiness",
    "restartService"
  ]);
  assert.equal(status.textContent, "Upgraded and restarted.");
});

test("Telegram plugin defaults project topic titles to the project slug", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const service = registry.getService("boatyard.telegram");

  assert.deepEqual(
    plain(service.getTarget({
      slug: "feature-telegram",
      name: "Feature Telegram"
    }, {}, {
      telegramDefaultChatId: "-1001234567890",
      telegramDefaultChatTitle: "TARS projects",
      telegramBotUsername: "tars_bot"
    })),
    {
      chatId: "-1001234567890",
      threadId: "",
      topicTopMessageId: "",
      topicTitle: "feature-telegram",
      chatTitle: "TARS projects",
      botUsername: "tars_bot"
    }
  );
});

test("Twicc service resolves session URLs from the configured project URL", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});

  assert.equal(
    registry.getService("boatyard.twicc.api").getSessionUrl({}, "session-1", {
      pluginConfig: {
        twiccProjectUrl: "http://localhost:3500/project/boatyard"
      }
    }),
    "http://localhost:3500/project/boatyard/session/session-1"
  );
});

test("Twicc global settings expose connection and project status display fields", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const twiccSection = registry
    .listGlobalSettingsSections()
    .find((section: PluginSection) => section.id === "boatyard.twicc.global");
  const fields = fieldMap(twiccSection.fields.map((field: PluginField) => [field.key, field]));

  assert.equal(fields.twiccBaseUrl.valueType, "url");
  assert.equal(fields.twiccApiToken.type, "password");
  assert.equal(fields.twiccApiToken.valueType, "text");
  assert.equal(fields.twiccProjectStatusDisplay.type, "select");
  assert.equal(fields.twiccProjectStatusDisplay.defaultValue, "labels");
  assert.deepEqual(plain(fields.twiccProjectStatusDisplay.options), [
    { value: "labels", label: "Labels" },
    { value: "icon", label: "Colored icon" }
  ]);
  assert.equal(fields.twiccTopbarUsageDisplay.type, "select");
  assert.equal(fields.twiccTopbarUsageDisplay.defaultValue, "chartsWithValues");
  assert.deepEqual(plain(fields.twiccTopbarUsageDisplay.options), [
    { value: "numbers", label: "Numeric values" },
    { value: "charts", label: "Charts only" },
    { value: "chartsWithValues", label: "Charts with values" },
    { value: "bars", label: "Usage and pace bars" }
  ]);
  assert.equal(fields.twiccPaneSidebarPosition.defaultValue, "left");
  assert.deepEqual(plain(fields.twiccPaneSidebarPosition.options), [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" }
  ]);
  assert.equal(fields.twiccPaneSidebarDefaultState.defaultValue, "open");
  assert.deepEqual(plain(fields.twiccPaneSidebarDefaultState.options), [
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" }
  ]);
  assert.equal(fields.twiccPaneBrowserControls.defaultValue, "compact");
  assert.deepEqual(plain(fields.twiccPaneBrowserControls.options), [
    { value: "compact", label: "Compact menu" },
    { value: "full", label: "Full toolbar" },
    { value: "hidden", label: "Hidden" }
  ]);
});

test("Twicc top bar usage renders usage and pace bars with a projected cutoff", async () => {
  const { context, registry, widgetRegistry } = loadRendererPluginContext(undefined, async () => ({
    ok: true,
    json: async () => ({
      codex: {
        provider: "codex",
        fetched_at: "2026-08-08T13:17:00.000Z",
        five_hour_utilization: 24,
        five_hour_temporal_pct: 12,
        five_hour_burn_rate: 200,
        five_hour_resets_at: "2026-08-08T17:41:00.000Z",
        seven_day_utilization: 45,
        seven_day_temporal_pct: 60,
        seven_day_burn_rate: 75,
        seven_day_resets_at: "2026-08-14T08:54:00.000Z"
      }
    })
  }));

  type MockElement = LooseVmValue & {
    children: MockElement[];
    className: string;
    dataset: Record<string, string>;
    style: {
      values: Record<string, string>;
    };
    textContent: string;
  };

  function createMockElement(): MockElement {
    const children: MockElement[] = [];
    const classes = new Set<string>();
    const styleValues: Record<string, string> = {};
    const element = {
      children,
      dataset: {},
      style: {
        values: styleValues,
        setProperty(name: string, value: string) {
          styleValues[name] = value;
        }
      },
      textContent: "",
      title: "",
      append(...nodes: MockElement[]) {
        children.push(...nodes);
      },
      replaceChildren(...nodes: MockElement[]) {
        children.splice(0, children.length, ...nodes);
      },
      addEventListener() {},
      setAttribute() {},
      classList: {
        add(...names: string[]) {
          names.forEach((name) => classes.add(name));
        },
        remove(...names: string[]) {
          names.forEach((name) => classes.delete(name));
        },
        toggle(name: string, force?: boolean) {
          const enabled = force === undefined ? !classes.has(name) : force;
          if (enabled) {
            classes.add(name);
          } else {
            classes.delete(name);
          }
          return enabled;
        }
      }
    } as unknown as MockElement;
    Object.defineProperty(element, "className", {
      get: () => [...classes].join(" "),
      set: (value: string) => {
        classes.clear();
        String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
      }
    });
    return element;
  }

  context.document.createElement = createMockElement as unknown as BuiltinRendererContext["document"]["createElement"];
  registry.applyEnabledState({});
  if (!widgetRegistry) {
    throw new Error("Widget registry test environment was not initialized.");
  }
  const usageWidget = widgetRegistry.get("boatyard.twicc.usage");
  const chip = usageWidget.createCompact(null, {
    globalPluginConfig: { twiccTopbarUsageDisplay: "bars" }
  }) as MockElement;
  await new Promise((resolve) => setImmediate(resolve));

  function descendants(element: MockElement): MockElement[] {
    return [element, ...element.children.flatMap(descendants)];
  }

  const elements = descendants(chip);
  const withClass = (className: string) => elements.filter((element) =>
    element.className.split(/\s+/).includes(className)
  );
  assert.equal(chip.dataset.displayMode, "bars");
  assert.equal(withClass("twicc-usage-paced-provider").length, 1);
  assert.equal(withClass("twicc-usage-paced-quota").length, 2);
  assert.deepEqual(
    withClass("twicc-usage-paced-fill").map((element) => element.style.values["--twicc-usage-paced-width"]),
    ["24%", "12%", "45%", "60%"]
  );
  assert.deepEqual(
    withClass("twicc-usage-paced-cutoff").map((element) => element.style.values["--twicc-usage-cutoff"]),
    ["50%"]
  );
  assert.ok(elements.some((element) => element.textContent === "Codex"));
  assert.ok(elements.some((element) => element.textContent === "×2.0"));
});

test("GitHub global settings expose all project status priority orders", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const githubSection = registry
    .listGlobalSettingsSections()
    .find((section: PluginSection) => section.id === "boatyard.github.global");
  const fields = fieldMap(githubSection.fields.map((field: PluginField) => [field.key, field]));

  assert.equal(fields.githubProjectStatusPriority.type, "select");
  assert.equal(
    fields.githubProjectStatusPriority.defaultValue,
    "workflowRunning,pullRequest,workflowResult"
  );
  assert.equal(fields.githubProjectStatusPriority.options.length, 6);
  assert.deepEqual(plain(fields.githubProjectStatusPriority.options[0]), {
    value: "workflowRunning,pullRequest,workflowResult",
    label: "Running workflow > Pull request > Workflow result"
  });
});

test("Twicc project settings offer project creation for a missing source path without clearing its configured URL", () => {
  const registry = loadRendererPluginEnvironment();
  const actionVisibility: boolean[] = [];
  const values: Record<string, string> = {
    twiccProjectUrl: "http://localhost:3500/project/restored-project"
  };

  registry.applyEnabledState({});
  registry.emit("boatyard.projectForm.sourcePathInspected", {
    inspected: {
      plugins: {
        "boatyard.twicc": {}
      }
    },
    forPlugin: () => ({
      fields: {
        getValue: (key: string) => values[key] || "",
        isEdited: () => false,
        setActionVisible: (key: string, visible: boolean) => {
          if (key === "twiccProjectUrl") {
            actionVisibility.push(visible);
          }
        },
        setValue: (key: string, value: string) => {
          values[key] = value;
        }
      }
    })
  });

  assert.deepEqual(actionVisibility, [true]);
  assert.equal(values.twiccProjectUrl, "http://localhost:3500/project/restored-project");
  const section = registry
    .listProjectSettingsSections()
    .find((candidate: PluginSection) => candidate.id === "boatyard.twicc.project");
  const field = section.fields.find((candidate: PluginField) => candidate.key === "twiccProjectUrl");
  assert.equal(field.action.message, "TwiCC project not found. Create it as a trusted project?");
});

test("Twicc project creation forwards the Boatyard project name", async () => {
  const { context, registry } = loadRendererPluginContext();
  const invocations: Array<{ actionName: string; payload: unknown; pluginId: string }> = [];
  const values: Record<string, string> = {};

  context.window.boatyard.invokePlugin = async (pluginId: string, actionName: string, payload: unknown) => {
    invocations.push({ actionName, payload, pluginId });
    return { url: "http://localhost:3500/project/example-app" };
  };
  registry.applyEnabledState({});
  invocations.length = 0;
  const section = registry
    .listProjectSettingsSections()
    .find((candidate: PluginSection) => candidate.id === "boatyard.twicc.project");
  const field = section.fields.find((candidate: PluginField) => candidate.key === "twiccProjectUrl");

  await field.action.run({
    coreFields: {
      name: "Example app",
      sourcePath: "/workspace/projects/example-app"
    },
    fields: {
      setActionVisible: () => {},
      setValue: (key: string, value: string) => {
        values[key] = value;
      }
    },
    globalConfig: {
      twiccBaseUrl: "https://twicc.example"
    }
  });

  assert.deepEqual(plain(invocations), [{
    pluginId: "boatyard.twicc",
    actionName: "createProject",
    payload: {
      globalConfig: {
        twiccBaseUrl: "https://twicc.example"
      },
      name: "Example app",
      sourcePath: "/workspace/projects/example-app"
    }
  }]);
  assert.equal(values.twiccProjectUrl, "http://localhost:3500/project/example-app");
});

test("Twicc project nav badge matches the configured Twicc project URL", async () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  await new Promise((resolve) => setImmediate(resolve));

  const badge = registry
    .listProjectNavBadges()
    .find((candidate: PluginBadge) => candidate.id === "boatyard.twicc.projectStatus");
  const element = badge.render({
    project: {
      id: "boatyard-internal-id",
      name: "Project"
    },
    projectConfig: {
      twiccProjectUrl: "http://localhost:3500/project/twicc-project"
    }
  });

  assert.equal(element.className, "project-nav-badge project-twicc-status working");
  assert.equal(element.textContent, "Working");
});

test("Twicc project nav badge renders a colored icon when configured", async () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  await new Promise((resolve) => setImmediate(resolve));

  const badge = registry
    .listProjectNavBadges()
    .find((candidate: PluginBadge) => candidate.id === "boatyard.twicc.projectStatus");
  const element = badge.render({
    project: {
      id: "boatyard-internal-id",
      name: "Project"
    },
    projectConfig: {
      twiccProjectUrl: "http://localhost:3500/project/twicc-project"
    },
    globalConfig: {
      twiccProjectStatusDisplay: "icon"
    }
  });

  assert.equal(element.className, "project-nav-badge project-twicc-status working icon-only");
  assert.equal(element.textContent, "");
  assert.match(element.title, /^Twicc: working/);
});

test("Twicc working and input icons use distinct status animations", () => {
  const styles = fs.readFileSync(`${process.cwd()}/src/plugins/twicc/style.css`, "utf8");

  assert.match(
    styles,
    /\.project-twicc-status\.icon-only\.working::before,\s*\.twicc-session-flow-status\.working::before\s*\{\s*animation: twicc-status-working-spin 1s linear infinite/
  );
  assert.match(
    styles,
    /\.project-twicc-status\.input,\s*\.twicc-session-flow-status\.input\s*\{[\s\S]*?animation: twicc-status-input-pulse 1s linear infinite/
  );
  assert.match(
    styles,
    /@keyframes twicc-status-working-spin[\s\S]*rotate\(0deg\)[\s\S]*rotate\(360deg\)/
  );
  assert.match(styles, /@keyframes twicc-status-input-pulse[\s\S]*opacity: 1[\s\S]*opacity: 0/);
  assert.match(
    styles,
    /\.project-twicc-status\.done\.needs-attention,\s*\.twicc-session-flow-status\.unread\s*\{\s*animation: twicc-status-done-pulse 1\.4s ease-in-out infinite/
  );
});

test("Twicc peer inbox flashes a full-width toolbar alert without changing geometry", () => {
  const styles = fs.readFileSync(`${process.cwd()}/src/plugins/twicc/style.css`, "utf8");

  assert.match(
    styles,
    /\.webapp-pane-header:has\(\.twicc-peer-inbox-button\.has-attention\)::after\s*\{[\s\S]*?right: 0;[\s\S]*?bottom: 0;[\s\S]*?left: 0;[\s\S]*?height: 5px;/
  );
  assert.match(
    styles,
    /\.webapp-pane-header:has\(\.twicc-peer-inbox-button\.has-attention\)::after\s*\{[\s\S]*?animation: twicc-peer-inbox-toolbar-alert 1\.2s steps\(1, end\) infinite/
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.webapp-pane-header:has\(\.twicc-peer-inbox-button\.has-attention\)::after[\s\S]*?animation: none/
  );
});

test("Twicc session indicators retain and acknowledge unread responses by state change", () => {
  const { context } = loadRendererPluginContext(undefined, undefined, true);
  const status = context.window.__twiccSessionFlowStatusTest as unknown as {
    acknowledge(session: Record<string, unknown>): void;
    getState(session: Record<string, unknown>): string;
  };
  const session = {
    id: "session-1",
    lastActivityAt: "2026-08-16T09:00:00Z",
    processState: "user_turn",
    processStateChangedAt: "2026-08-16T09:00:01Z"
  };

  assert.equal(status.getState({ ...session, processState: "assistant_turn" }), "working");
  assert.equal(status.getState({ ...session, processState: "starting" }), "working");
  assert.equal(status.getState({ ...session, processState: "awaiting_user_input" }), "input");
  assert.equal(status.getState(session), "unread");
  assert.equal(status.getState({ ...session, processState: "" }), "unread");

  status.acknowledge(session);
  assert.equal(status.getState(session), "");
  assert.equal(status.getState({ ...session, processState: "" }), "");
  assert.equal(status.getState({
    ...session,
    processStateChangedAt: "2026-08-16T10:00:01Z"
  }), "unread");
});

test("Twicc session flow widget exposes three draggable lanes and an archive target", () => {
  const { registry, widgetRegistry } = loadRendererPluginContext();
  if (!widgetRegistry) {
    throw new Error("Widget registry test environment was not initialized.");
  }
  registry.applyEnabledState({});
  const widget = widgetRegistry.list({ scope: "project" })
    .find((candidate: { id: string }) => candidate.id === "boatyard.twicc.sessionFlow");
  const renderer = fs.readFileSync(`${process.cwd()}/src/plugins/twicc/renderer.ts`, "utf8");
  const styles = fs.readFileSync(`${process.cwd()}/src/plugins/twicc/style.css`, "utf8");
  const rendererEventBindings = fs.readFileSync(`${process.cwd()}/src/renderer/rendererEventBindings.ts`, "utf8");

  assert.equal(widget.name, "TwiCC Session Flow");
  assert.deepEqual(plain(widget.layout), {
    default: { columns: 3, rows: 7 },
    min: { columns: 2, rows: 4 }
  });
  assert.match(styles, /\.twicc-session-flow-lane\.backlog/);
  assert.match(styles, /\.twicc-session-flow-lane\.testing/);
  assert.match(styles, /\.twicc-session-flow-lane\.drop-target/);
  assert.match(styles, /\.twicc-session-flow-widget\.twicc-session-flow-pane/);
  assert.match(styles, /data-orientation="horizontal"/);
  assert.match(styles, /\.twicc-session-flow-orientation-icon/);
  assert.match(styles, /\.twicc-session-flow-archive-dropzone/);
  assert.match(styles, /\.twicc-session-flow-archive-dropzone\.drop-target/);
  assert.doesNotMatch(styles, /\.twicc-session-flow-widget:not\(\.twicc-session-flow-pane\) \.twicc-session-flow-archive-dropzone/);
  assert.match(styles, /\.twicc-session-flow-archive-all/);
  assert.match(styles, /\.twicc-session-flow-archive-dialog/);
  assert.match(styles, /\.twicc-session-flow-composer/);
  assert.match(styles, /\.twicc-session-flow-card\.current-session/);
  assert.match(styles, /\.twicc-session-flow-current-badge/);
  assert.match(styles, /\.twicc-session-flow-status\.working/);
  assert.match(styles, /\.twicc-session-flow-status\.input/);
  assert.match(styles, /\.twicc-session-flow-status\.unread/);
  assert.match(styles, /\.twicc-session-flow-status\.working::before\s*\{\s*animation: twicc-status-working-spin/);
  assert.match(styles, /\.twicc-session-flow-status\.unread\s*\{\s*animation: twicc-status-done-pulse/);
  assert.match(styles, /\.twicc-session-flow-insertion-placeholder/);
  assert.doesNotMatch(styles, /\.twicc-session-flow-heading::before/);
  assert.match(styles, /\.twicc-session-flow-heading::after/);
  assert.match(renderer, /directButton\.title = "New session"/);
  assert.match(renderer, /directButton\.textContent = "\+"/);
  assert.match(renderer, /worktreeButton\.title = "New session in worktree"/);
  assert.match(renderer, /worktreeIcon\.className = "twicc-session-flow-worktree-icon"/);
  assert.match(renderer, /actions\.append\(directButton, worktreeButton\)/);
  assert.match(styles, /\.twicc-session-flow-worktree-icon/);
  assert.match(renderer, /laneHeader\.append\(createCreationActions\(\)\)/);
  assert.match(renderer, /archiveDropzone\.hidden = false/);
  assert.match(renderer, /list\.append\(createSessionComposer\(\)\)/);
  assert.doesNotMatch(renderer, /lane\.id === "in_progress" && widget\.classList\.contains\("twicc-session-flow-pane"\)/);
  assert.match(renderer, /createComposerField\("Title \(optional\)", titleInput\)/);
  assert.match(renderer, /promptInput\.setAttribute\("aria-keyshortcuts", "Control\+Enter"\)/);
  assert.match(renderer, /event\.key === "Enter"[\s\S]*?event\.ctrlKey[\s\S]*?promptInput\.form\?\.requestSubmit\(\)/);
  assert.match(renderer, /promptInput\.addEventListener\("paste"/);
  assert.match(renderer, /Array\.from\(clipboardData\.files \|\| \[\]\)/);
  assert.match(renderer, /Array\.from\(clipboardData\.items \|\| \[\]\)/);
  assert.match(renderer, /attachments: creationDraft\.attachments\.map\(\(attachment\) => attachment\.dataUrl\)/);
  assert.match(renderer, /className = "twicc-session-flow-remove-attachment"/);
  assert.match(renderer, /TWICC_SESSION_CREATION_DRAFT_STORAGE_PREFIX = "boatyard:twicc-session-creation-draft:"/);
  assert.match(renderer, /const projectId = String\(project\.id \|\| project\.sourcePath \|\| projectReference \|\| "default"\)/);
  assert.match(renderer, /const restoredCreation = readSessionCreationDraft\(creationDraftStorageKey\)/);
  assert.match(renderer, /let composerMode: TwiccSessionComposerMode = restoredCreation\?\.mode \|\| ""/);
  assert.match(renderer, /sessionCreationDraftCache\.set\(storageKey,[\s\S]*?attachments: \[\.\.\.draft\.attachments\]/);
  assert.match(renderer, /localStorage\?\.setItem\(storageKey, JSON\.stringify\(stored\)\)/);
  assert.match(renderer, /titleInput\.addEventListener\("input", \(\) => \{[\s\S]*?persistCreationDraft\(\)/);
  assert.match(renderer, /promptInput\.addEventListener\("input", \(\) => \{[\s\S]*?persistCreationDraft\(\)/);
  assert.match(renderer, /function closeCreationComposer\(\): void \{[\s\S]*?clearSessionCreationDraft\(creationDraftStorageKey\)/);
  assert.match(renderer, /pendingCreatedSessions\.set\(created\.sessionId[\s\S]*?clearSessionCreationDraft\(creationDraftStorageKey\)/);
  assert.match(renderer, /if \(composerMode === "worktree"\) \{\s*void loadWorktreeCreationOptions\(\)/);
  assert.match(styles, /\.twicc-session-flow-attachments/);
  assert.match(styles, /\.twicc-session-flow-attachment img/);
  assert.match(renderer, /sessionFlowLane: "in_progress"/);
  assert.match(renderer, /pendingCreatedSessions\.set\(created\.sessionId/);
  assert.match(
    renderer,
    /if \(sessionInsertionPlaceholder\?\.parentElement === list\) \{\s*sessionInsertionPlaceholder\.remove\(\);\s*\}/
  );
  assert.match(renderer, /getSessionInsertionTarget\(list, event\.clientY, lane\)/);
  assert.doesNotMatch(renderer, /draggedSessionPointerOffsetY|draggedSessionGhostHeight \/ 2/);
  assert.match(renderer, /twicc-session-flow-insertion-placeholder/);
  assert.match(renderer, /invokePlugin\("reorderSessionFlow"/);
  assert.match(
    renderer,
    /function getOrderedLaneSessions[\s\S]*?return sessions\s*\.filter\(\(session\) => session\.lane === lane\);/
  );
  assert.match(renderer, /invokePlugin\("renameSession"/);
  assert.match(renderer, /card\.draggable = !isEditingTitle/);
  assert.match(renderer, /card\.addEventListener\("click"/);
  assert.match(renderer, /BoatyardPaneNavigation\?\.openProjectWebAppInPage/);
  assert.match(renderer, /card\.addEventListener\("dblclick"/);
  assert.match(renderer, /event\.key === "F2"/);
  assert.match(renderer, /card\.setAttribute\("aria-keyshortcuts", "F2"\)/);
  assert.match(renderer, /const titleLabel = document\.createElement\("span"\)/);
  assert.doesNotMatch(renderer, /titleButton\.addEventListener\("click"/);
  assert.match(renderer, /startSessionTitleEditing\(session\)/);
  assert.match(renderer, /event\.key === "Escape"/);
  assert.match(styles, /\.twicc-session-flow-card\s*\{[\s\S]*?cursor: pointer/);
  assert.match(styles, /\.twicc-session-flow-card\.dragging\s*\{[\s\S]*?cursor: grabbing/);
  assert.doesNotMatch(styles, /\.twicc-session-flow-title:hover/);
  assert.match(styles, /\.twicc-session-flow-title-input/);
  assert.match(renderer, /archiveAllButton\.textContent = "Archive all"/);
  assert.doesNotMatch(renderer, /lane\.id === "testing" && widget\.classList\.contains\("twicc-session-flow-pane"\)/);
  assert.match(renderer, /\{ id: "testing", label: "Done" \}/);
  assert.match(renderer, /title\.textContent = "Archive all done sessions"/);
  assert.match(renderer, /in-progress, backlog, and done lanes/);
  assert.doesNotMatch(renderer, /Testing & observing/);
  assert.match(renderer, /BoatyardOverlayDialog\?\.show/);
  assert.match(renderer, /card\.setAttribute\("aria-current", "true"\)/);
  assert.match(renderer, /sessionId === activeSessionId/);
  assert.match(renderer, /if \(isCurrentSession\) \{\s*acknowledgeSessionFlowUnread\(session\)/);
  assert.match(renderer, /const indicatorState = isCurrentSession \? "" : getSessionFlowIndicatorState\(session\)/);
  assert.match(renderer, /main\.append\(provider, title, statusIndicator, currentBadge, move\)/);
  assert.match(rendererEventBindings, /boatyard:webapp-url-changed/);
  assert.match(rendererEventBindings, /detail: \{ key, previousUrl, sourceProjectId, url \}/);
  assert.match(renderer, /badge\.textContent = "Pier lifecycle"/);
});

test("Twicc session flow orientation is stored independently for each pane", () => {
  const { context, registry } = loadRendererPluginContext();
  registry.applyEnabledState({});
  const pane = registry
    .listPanes({ scope: "project", kind: "dom" })
    .find((candidate: PluginPane) => candidate.id === "boatyard.twicc.sessionFlowPane");
  if (!pane?.renderHeaderActions) {
    throw new Error("TwiCC session flow header action was not registered.");
  }

  const storedValues = new Map<string, string>();
  context.window.localStorage = {
    getItem(key: string) {
      return storedValues.get(key) || null;
    },
    setItem(key: string, value: string) {
      storedValues.set(key, value);
    }
  };

  type MockElement = {
    childNodes: MockElement[];
    dataset: Record<string, string>;
    addEventListener(type: string, listener: () => void): void;
    append(...children: MockElement[]): void;
    click(): void;
    removeEventListener(type: string, listener: () => void): void;
    setAttribute(name: string, value: string): void;
  };
  function createMockElement(): MockElement {
    const listeners = new Map<string, () => void>();
    return {
      childNodes: [],
      dataset: {},
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      append(...children) {
        this.childNodes.push(...children);
      },
      click() {
        listeners.get("click")?.();
      },
      removeEventListener(type, listener) {
        if (listeners.get(type) === listener) {
          listeners.delete(type);
        }
      },
      setAttribute() {}
    };
  }
  context.document.createElement = (() => createMockElement()) as unknown as
    BuiltinRendererContext["document"]["createElement"];
  const host = { dispatchEvent() {} };
  const renderForPane = (paneId: string) => {
    const container = createMockElement();
    pane.renderHeaderActions?.(container, {
      host,
      paneId,
      project: { id: "project-1" }
    });
    return container.childNodes[0];
  };

  const firstPaneButton = renderForPane("pane-a");
  assert.equal(firstPaneButton.dataset.orientation, "vertical");
  firstPaneButton.click();
  assert.equal(firstPaneButton.dataset.orientation, "horizontal");
  assert.equal(renderForPane("pane-b").dataset.orientation, "vertical");
  assert.equal(renderForPane("pane-a").dataset.orientation, "horizontal");
});

test("Twicc done project nav badge stops requesting attention after the project is opened", async () => {
  const registry = loadRendererPluginEnvironment({
    "twicc-project": {
      state: "done",
      count: 1,
      sessions: [
        {
          id: "session-id",
          title: "Finished session",
          state: "done"
        }
      ]
    }
  });

  registry.applyEnabledState({});
  await new Promise((resolve) => setImmediate(resolve));

  const badge = registry
    .listProjectNavBadges()
    .find((candidate: PluginBadge) => candidate.id === "boatyard.twicc.projectStatus");
  const input = {
    project: {
      id: "boatyard-internal-id",
      name: "Project"
    },
    projectConfig: {
      twiccProjectUrl: "http://localhost:3500/project/twicc-project"
    }
  };

  const inactiveElement = badge.render({ ...input, isActiveProject: false });
  assert.equal(
    inactiveElement.className,
    "project-nav-badge project-twicc-status done needs-attention"
  );
  assert.equal(inactiveElement.textContent, "Done");
  const activeElement = badge.render({ ...input, isActiveProject: true });
  assert.equal(activeElement.className, "project-nav-badge project-twicc-status done");
  assert.equal(activeElement.textContent, "Done");
  const inactiveAgainElement = badge.render({ ...input, isActiveProject: false });
  assert.equal(inactiveAgainElement.className, "project-nav-badge project-twicc-status done");
  assert.equal(inactiveAgainElement.textContent, "Done");
});

test("Twicc project nav badge prioritizes input and working before unread completion", async () => {
  const twiccProjectProcessStatuses: Record<string, unknown> = {
    "twicc-project": {
      state: "working",
      count: 2,
      sessions: [
        {
          id: "done-session",
          lastStateChangeAt: "2026-07-30T10:00:00Z",
          state: "done"
        },
        {
          id: "working-session",
          lastStateChangeAt: "2026-07-30T10:01:00Z",
          state: "working"
        }
      ]
    }
  };
  const { registry, refreshIntervals } = loadRendererPluginContext(twiccProjectProcessStatuses);

  registry.applyEnabledState({});
  await new Promise((resolve) => setImmediate(resolve));

  const badge = registry
    .listProjectNavBadges()
    .find((candidate: PluginBadge) => candidate.id === "boatyard.twicc.projectStatus");
  const input = {
    project: {
      id: "boatyard-internal-id",
      name: "Project"
    },
    projectConfig: {
      twiccProjectUrl: "http://localhost:3500/project/twicc-project"
    }
  };

  assert.equal(
    badge.render({ ...input, isActiveProject: false }).className,
    "project-nav-badge project-twicc-status working"
  );
  assert.equal(
    badge.render({ ...input, isActiveProject: true }).className,
    "project-nav-badge project-twicc-status working"
  );
  assert.equal(
    badge.render({ ...input, isActiveProject: false }).className,
    "project-nav-badge project-twicc-status working"
  );

  twiccProjectProcessStatuses["twicc-project"] = {
    state: "done",
    count: 1,
    sessions: [
      {
        id: "done-session",
        lastStateChangeAt: "2026-07-30T10:00:00Z",
        state: "done"
      }
    ]
  };
  await refreshIntervals();
  assert.equal(
    badge.render({ ...input, isActiveProject: false }).className,
    "project-nav-badge project-twicc-status done"
  );

  twiccProjectProcessStatuses["twicc-project"] = {
    state: "input",
    count: 3,
    sessions: [
      {
        id: "done-session",
        lastStateChangeAt: "2026-07-30T10:02:00Z",
        state: "done"
      },
      {
        id: "working-session",
        lastStateChangeAt: "2026-07-30T10:01:00Z",
        state: "working"
      },
      {
        id: "input-session",
        lastStateChangeAt: "2026-07-30T10:03:00Z",
        state: "input"
      }
    ]
  };
  await refreshIntervals();
  assert.equal(
    badge.render({ ...input, isActiveProject: false }).className,
    "project-nav-badge project-twicc-status input"
  );

  twiccProjectProcessStatuses["twicc-project"] = {
    state: "working",
    count: 2,
    sessions: [
      {
        id: "done-session",
        lastStateChangeAt: "2026-07-30T10:02:00Z",
        state: "done"
      },
      {
        id: "working-session",
        lastStateChangeAt: "2026-07-30T10:01:00Z",
        state: "working"
      }
    ]
  };
  await refreshIntervals();
  assert.equal(
    badge.render({ ...input, isActiveProject: false }).className,
    "project-nav-badge project-twicc-status working"
  );

  twiccProjectProcessStatuses["twicc-project"] = {
    state: "done",
    count: 1,
    sessions: [
      {
        id: "done-session",
        lastStateChangeAt: "2026-07-30T10:02:00Z",
        state: "done"
      }
    ]
  };
  await refreshIntervals();
  assert.equal(
    badge.render({ ...input, isActiveProject: false }).className,
    "project-nav-badge project-twicc-status done needs-attention"
  );
});

test("Twicc done project nav badge requests attention again after new activity", async () => {
  const twiccProjectProcessStatuses: Record<string, unknown> = {
    "twicc-project": {
      state: "done",
      count: 1,
      sessions: [
        {
          id: "session-id",
          lastStateChangeAt: "2026-07-29T12:00:00Z",
          state: "done"
        }
      ]
    }
  };
  const { registry, refreshIntervals } = loadRendererPluginContext(twiccProjectProcessStatuses);

  registry.applyEnabledState({});
  await new Promise((resolve) => setImmediate(resolve));

  const badge = registry
    .listProjectNavBadges()
    .find((candidate: PluginBadge) => candidate.id === "boatyard.twicc.projectStatus");
  const input = {
    project: {
      id: "boatyard-internal-id",
      name: "Project"
    },
    projectConfig: {
      twiccProjectUrl: "http://localhost:3500/project/twicc-project"
    }
  };

  badge.render({ ...input, isActiveProject: true });
  assert.equal(
    badge.render({ ...input, isActiveProject: false }).className,
    "project-nav-badge project-twicc-status done"
  );

  twiccProjectProcessStatuses["twicc-project"] = {
    state: "working",
    count: 1,
    sessions: [
      {
        id: "session-id",
        lastStateChangeAt: "2026-07-29T12:01:00Z",
        state: "working"
      }
    ]
  };
  await refreshIntervals();

  twiccProjectProcessStatuses["twicc-project"] = {
    state: "done",
    count: 1,
    sessions: [
      {
        id: "session-id",
        lastStateChangeAt: "2026-07-29T12:02:00Z",
        state: "done"
      }
    ]
  };
  await refreshIntervals();

  assert.equal(
    badge.render({ ...input, isActiveProject: false }).className,
    "project-nav-badge project-twicc-status done needs-attention"
  );
});

test("Twicc done project nav badge is retained until the project is opened", async () => {
  const twiccProjectProcessStatuses: Record<string, unknown> = {
    "twicc-project": {
      state: "done",
      count: 1,
      sessions: [
        {
          id: "session-id",
          title: "Finished session",
          state: "done"
        }
      ]
    }
  };
  const { registry, refreshIntervals } = loadRendererPluginContext(twiccProjectProcessStatuses);

  registry.applyEnabledState({});
  await new Promise((resolve) => setImmediate(resolve));

  const badge = registry
    .listProjectNavBadges()
    .find((candidate: PluginBadge) => candidate.id === "boatyard.twicc.projectStatus");
  const input = {
    project: {
      id: "boatyard-internal-id",
      name: "Project"
    },
    projectConfig: {
      twiccProjectUrl: "http://localhost:3500/project/twicc-project"
    }
  };

  const firstElement = badge.render({ ...input, isActiveProject: false });
  assert.equal(
    firstElement.className,
    "project-nav-badge project-twicc-status done needs-attention"
  );

  delete twiccProjectProcessStatuses["twicc-project"];
  await refreshIntervals();

  const retainedElement = badge.render({ ...input, isActiveProject: false });
  assert.equal(
    retainedElement.className,
    "project-nav-badge project-twicc-status done needs-attention"
  );

  assert.equal(badge.render({ ...input, isActiveProject: true }), null);
});

test("Pier project settings only default the Pier project name", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const pierSection = registry
    .listProjectSettingsSections()
    .find((section: PluginSection) => section.id === "boatyard.pier.project");
  const fields = fieldMap(pierSection.fields.map((field: PluginField) => [field.key, field]));

  assert.equal(
    resolveFieldDefault(fields.pierProjectName, {
      project: { slug: "Jobo", devBranch: "main" }
    }),
    "jobo"
  );
  assert.equal(
    resolveFieldDefault(fields.pierPreviewUrl, {
      project: { slug: "Jobo", devBranch: "feature/demo" }
    }),
    ""
  );
  assert.equal(fields.pierPreviewUrl.placeholder, "Optional custom Pier pane URL");

  const updatedDefaults: Record<string, unknown> = {};
  registry.emit("boatyard.projectForm.coreFieldChanged", {
    field: "devBranch",
    coreFields: {
      slug: "Boatyard",
      devBranch: "release/MVP"
    },
    forPlugin: (pluginId: string) => ({
      fields: {
        setDefaultValue(key: string, value: unknown) {
          if (pluginId === "boatyard.pier") {
            updatedDefaults[key] = value;
          }
        }
      }
    })
  });

  assert.deepEqual(updatedDefaults, { pierProjectName: "boatyard" });
});

test("Pier pane resolves the project dashboard URL", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const pane = registry
    .listPanes({ scope: "project", kind: "wcv" })
    .find((candidate: PluginPane) => candidate.id === "boatyard.pier.preview");

  assert.equal(
    pane.resolveUrl({
      project: { slug: "Sshadow" },
      projectConfig: {},
      globalPluginConfig: {}
    }),
    "http://pier.test/#/projects/sshadow"
  );
  assert.equal(
    pane.resolveUrl({
      project: { slug: "Sshadow" },
      projectConfig: {},
      globalPluginConfig: { pierUrl: "http://pier.internal/" }
    }),
    "http://pier.internal/#/projects/sshadow"
  );
  assert.equal(
    pane.resolveUrl({
      project: { slug: "Sshadow" },
      projectConfig: { pierPreviewUrl: "http://custom.test/#/pier" },
      globalPluginConfig: { pierUrl: "http://pier.internal/" }
    }),
    "http://custom.test/#/pier"
  );
});

test("Pier service resolves configured worktree path patterns", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const service = registry.getService("boatyard.pier");

  assert.equal(
    service.getDefaultWorktreePath({
      name: "Boatyard",
      slug: "boatyard",
      sourcePath: "/workspace/boatyard"
    }, "feature/session-flow", {
      globalPluginConfig: {
        pierWorktreePattern: "<repo>/../<project>-<worktree>"
      }
    }),
    "/workspace/boatyard/../boatyard-feature-session-flow"
  );
});

test("Pier service matches worktree projects inside the Boatyard source path", async () => {
  const sourcePath = "/workspace/sshadow";
  const worktreePath = `${sourcePath}/worktrees/v1`;
  const registry = loadRendererPluginEnvironment(undefined, async (url) => {
    if (String(url).endsWith("/api/v1/projects")) {
      return {
        ok: true,
        json: async () => [
          {
            name: "sshadow",
            repo_path: worktreePath
          }
        ]
      };
    }

    if (String(url).endsWith("/api/v1/projects/sshadow/worktrees")) {
      return {
        ok: true,
        json: async () => [
          {
            path: worktreePath,
            slug: "v1",
            branch: "v1",
            has_workload: true,
            workload: {
              project: "sshadow",
              slug: "v1",
              status: "running",
              urls: [
                {
                  label: "v1.sshadow.test",
                  url: "http://v1.sshadow.test",
                  default: true
                },
                {
                  label: "admin.v1.sshadow.test",
                  url: "http://admin.v1.sshadow.test"
                }
              ],
              worktree_path: worktreePath
            }
          },
          {
            path: `${sourcePath}/worktrees/stopped`,
            slug: "stopped",
            branch: "stopped",
            has_workload: false
          }
        ]
      };
    }

    throw new Error(`Unexpected URL ${url}`);
  });

  registry.applyEnabledState({});
  const workloads = await registry.getService("boatyard.pier").listProjectWorkloads(
    {
      id: "project-id",
      slug: "sshadow",
      sourcePath
    },
    {}
  );

  assert.deepEqual(plain(workloads), [
    {
      hasWorkload: true,
      project: "sshadow",
      primary: true,
      slug: "v1",
      url: "http://v1.sshadow.test",
      worktreePath,
      status: "running",
      running: true,
      indicatorStatus: "running",
      urls: [
        {
          default: true,
          label: "v1.sshadow.test",
          url: "http://v1.sshadow.test"
        },
        {
          default: false,
          label: "admin.v1.sshadow.test",
          url: "http://admin.v1.sshadow.test"
        }
      ]
    },
    {
      hasWorkload: false,
      project: "sshadow",
      primary: false,
      slug: "stopped",
      url: "",
      worktreePath: `${sourcePath}/worktrees/stopped`,
      status: "stopped",
      running: false,
      indicatorStatus: "stopped"
    }
  ]);

  const pane = registry
    .listPanes({ scope: "project", kind: "wcv" })
    .find((candidate: PluginPane) => candidate.id === "boatyard.pier.preview");
  assert.deepEqual(
    plain(pane.resolveWebApps({
      project: {
        id: "project-id",
        slug: "sshadow",
        sourcePath
      },
      projectConfig: {},
      globalPluginConfig: {}
    })),
    [
      {
        id: "pier",
        key: "dashboard",
        label: "Pier",
        url: "http://pier.test/#/projects/sshadow",
        restoreUrl: false
      },
      {
        id: "pier:v1",
        key: "v1",
        label: "Pier: v1",
        url: "http://v1.sshadow.test",
        mobileDev: true,
        restoreUrl: false
      }
    ]
  );

  assert.deepEqual(
    plain(pane.resolveWebApps({
      project: {
        id: "project-id",
        slug: "sshadow",
        sourcePath
      },
      projectConfig: {
        pierEnabledEntryPoints: "[\"default\",\"admin\"]"
      },
      globalPluginConfig: {}
    })),
    [
      {
        id: "pier",
        key: "dashboard",
        label: "Pier",
        url: "http://pier.test/#/projects/sshadow",
        restoreUrl: false
      },
      {
        id: "pier:v1",
        key: "v1",
        label: "Pier: v1",
        url: "http://v1.sshadow.test",
        mobileDev: true,
        restoreUrl: false
      },
      {
        id: "pier:v1:admin",
        key: "v1:admin",
        label: "Pier: v1 · Admin",
        url: "http://admin.v1.sshadow.test",
        mobileDev: true,
        restoreUrl: false
      }
    ]
  );
});

export {};
