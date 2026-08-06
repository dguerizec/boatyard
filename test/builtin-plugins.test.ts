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

const builtinPluginDirs = ["twicc", "pier", "hawser", "telegram", "color-palette", "github"];

type MockFetch = (...args: unknown[]) => Promise<unknown>;

type LooseVmValue = ((...args: unknown[]) => LooseVmValue) & {
  [key: number]: LooseVmValue;
  [key: string]: LooseVmValue;
};

type PluginPane = {
  id: string;
  iconUrl?: string;
  key?: string;
  parentLabel?: string;
  parentWebAppId?: string;
  renderHeaderActions?: (container: unknown, props?: Record<string, unknown>) => unknown;
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
    BoatyardPluginRegistry?: LooseVmValue;
    BoatyardWidgetRegistry?: LooseVmValue;
    boatyard: {
      invokePlugin(pluginId: string, actionName: string): Promise<unknown>;
      onPluginEvent(): () => void;
      openExternal(): void;
      writeClipboardText(): void;
    };
    clearInterval(): void;
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

function loadRendererPluginContext(twiccProjectProcessStatuses: unknown = {
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
  const intervalCallbacks: Array<() => void | Promise<void>> = [];
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
      boatyard: {
        openExternal: () => {},
        writeClipboardText: () => {},
        invokePlugin: async (pluginId, actionName) => {
          if (pluginId === "boatyard.twicc" && actionName === "projectProcessStatuses") {
            return twiccProjectProcessStatuses;
          }
          if (pluginId === "boatyard.hawser" && actionName === "statusForConfig") {
            return {
              state: "ready",
              summary: "Hawser service is available."
            };
          }
          if (pluginId === "boatyard.hawser" && actionName === "widgetDataForConfig") {
            return {};
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
    vm.runInContext(fs.readFileSync(file, "utf8"), context);
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

test("Built-in plugins register project integrations and widgets", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});

  assert.equal(registry.getService("boatyard.twicc.api").version, "0.1.0");
  assert.equal(typeof registry.getService("boatyard.pier").listProjectWorkloads, "function");
  assert.equal(typeof registry.getService("boatyard.pier").getProjectAvailability, "function");
  assert.equal(registry.getService("boatyard.hawser.api").version, "0.1.0");
  assert.equal(registry.getService("boatyard.telegram").version, "0.1.0");
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane: PluginPane) => pane.id).sort()),
    ["boatyard.hawser.pane", "boatyard.pier.preview", "boatyard.twicc.pane"]
  );
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "dom" }).map((pane: PluginPane) => pane.id).sort()),
    ["boatyard.telegram.pane", "boatyard.twicc.sessionFlowPane"]
  );
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane: PluginPane) => pane.key).sort()),
    ["hawser", "pier", "twicc-plugin"]
  );
  const twiccPane = registry
    .listPanes({ scope: "project", kind: "wcv" })
    .find((pane: PluginPane) => pane.id === "boatyard.twicc.pane");
  assert.match(twiccPane.iconUrl || "", /\/plugins\/twicc\/twicc-icon\.svg$/);
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
      "boatyard.hawser.global",
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
    /\.project-twicc-status\.icon-only\.working::before\s*\{\s*animation: twicc-status-working-spin 1s linear infinite/
  );
  assert.match(
    styles,
    /\.project-twicc-status\.input\s*\{[\s\S]*?animation: twicc-status-input-pulse 1s linear infinite/
  );
  assert.match(
    styles,
    /@keyframes twicc-status-working-spin[\s\S]*rotate\(0deg\)[\s\S]*rotate\(360deg\)/
  );
  assert.match(styles, /@keyframes twicc-status-input-pulse[\s\S]*opacity: 1[\s\S]*opacity: 0/);
  assert.match(
    styles,
    /\.project-twicc-status\.done\.needs-attention\s*\{\s*animation: twicc-status-done-pulse 1\.4s ease-in-out infinite/
  );
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
  assert.match(styles, /\.twicc-session-flow-attachments/);
  assert.match(styles, /\.twicc-session-flow-attachment img/);
  assert.match(renderer, /sessionFlowLane: "in_progress"/);
  assert.match(renderer, /pendingCreatedSessions\.set\(created\.sessionId/);
  assert.match(renderer, /draggedSessionPointerOffsetY/);
  assert.match(renderer, /draggedSessionGhostHeight \/ 2/);
  assert.match(renderer, /twicc-session-flow-insertion-placeholder/);
  assert.match(renderer, /invokePlugin\("reorderSessionFlow"/);
  assert.match(renderer, /invokePlugin\("renameSession"/);
  assert.match(renderer, /card\.draggable = !isEditingTitle/);
  assert.match(renderer, /card\.addEventListener\("click"/);
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
  assert.match(rendererEventBindings, /boatyard:webapp-url-changed/);
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

test("Twicc project nav badge prioritizes unread completion over working and read completion below it", async () => {
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
    "project-nav-badge project-twicc-status done needs-attention"
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

test("Hawser global settings expose a copyable install command", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const hawserSection = registry
    .listGlobalSettingsSections()
    .find((section: PluginSection) => section.id === "boatyard.hawser.global");
  const fields = fieldMap(hawserSection.fields.map((field: PluginField) => [field.key, field]));

  assert.equal(fields.hawserDefaultRuntime.defaultValue, "codex");
  assert.equal(fields.hawserInstallCommand.persist, false);
  assert.equal(fields.hawserInstallCommand.readOnly, true);
  assert.match(fields.hawserInstallCommand.defaultValue, /^bash <\(curl -fsSL https:\/\/raw\.githubusercontent\.com\/dguerizec\/hawser\/main\/install\.sh\)/);
  assert.equal(fields.hawserInstallCommand.action.label, "Copy");
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
      project: "sshadow",
      slug: "v1",
      url: "http://v1.sshadow.test",
      worktreePath,
      status: "running",
      running: true,
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
      project: "sshadow",
      slug: "stopped",
      url: "",
      worktreePath: `${sourcePath}/worktrees/stopped`,
      status: "stopped",
      running: false
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
