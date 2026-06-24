"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { resolveFieldDefault } = require(`${process.cwd()}/build/renderer/pluginSettingsFields`);

const builtinPluginDirs = ["twicc", "pier", "hawser", "telegram", "color-palette"];

function readBuiltinPluginRendererPath(pluginDir) {
  const manifestPath = path.join(process.cwd(), "src/plugins", pluginDir, "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return path.join(process.cwd(), "build/plugins", pluginDir, manifest.renderer);
}

function loadRendererPluginEnvironment(twiccProjectProcessStatuses = {
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
}, mockFetch: (...args: any[]) => Promise<any> = async () => ({ ok: true, json: async () => [] })) {
  return loadRendererPluginContext(twiccProjectProcessStatuses, mockFetch).registry;
}

function loadRendererPluginContext(twiccProjectProcessStatuses = {
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
}, mockFetch: (...args: any[]) => Promise<any> = async () => ({ ok: true, json: async () => [] })) {
  const intervalCallbacks = [];
  const context: any = {
    console,
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
      BoatyardHawserUI: {
        createWidget: () => ({})
      },
      setInterval: (callback) => {
        intervalCallbacks.push(callback);
        return intervalCallbacks.length;
      },
      clearInterval: () => {}
    },
    document: {
      createElement: () => ({
        append() {},
        addEventListener() {},
        setAttribute() {},
        classList: { add() {}, remove() {} }
      })
    },
    fetch: mockFetch
  };
  context.window.window = context.window;
  vm.createContext(context);

  for (const file of [
    path.join(process.cwd(), "build/renderer/widgetRegistry.js"),
    path.join(process.cwd(), "build/renderer/pluginRegistry.js"),
    ...builtinPluginDirs.map(readBuiltinPluginRendererPath)
  ]) {
    vm.runInContext(fs.readFileSync(file, "utf8"), context);
  }

  return {
    registry: context.window.BoatyardPluginRegistry,
    async refreshIntervals() {
      for (const callback of intervalCallbacks) {
        await callback();
      }
    }
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Built-in plugins register project integrations and widgets", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});

  assert.equal(registry.getService("boatyard.twicc.api").version, "0.1.0");
  assert.equal(typeof registry.getService("boatyard.pier").listProjectWorkloads, "function");
  assert.equal(registry.getService("boatyard.hawser.api").version, "0.1.0");
  assert.equal(registry.getService("boatyard.telegram").version, "0.1.0");
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane) => pane.id).sort()),
    ["boatyard.hawser.pane", "boatyard.pier.preview", "boatyard.twicc.pane"]
  );
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "dom" }).map((pane) => pane.id).sort()),
    ["boatyard.telegram.pane"]
  );
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane) => pane.key).sort()),
    ["hawser", "pier", "twicc-plugin"]
  );
  assert.deepEqual(
    plain(registry.listProjectNavBadges().map((badge) => badge.id).sort()),
    ["boatyard.twicc.projectStatus"]
  );
  assert.deepEqual(
    plain(registry.listGlobalSettingsSections().map((section) => section.id).sort()),
    ["boatyard.hawser.global", "boatyard.pier.global", "boatyard.telegram.global", "boatyard.twicc.global"]
  );
  const twiccPlugin = registry.list().find((plugin) => plugin.id === "boatyard.twicc");
  assert.deepEqual(
    plain(twiccPlugin.contributes.widgets),
    ["boatyard.twicc.usage"]
  );
  const colorPalettePlugin = registry.list().find((plugin) => plugin.id === "boatyard.colorPalette");
  assert.deepEqual(plain(colorPalettePlugin.contributes.widgets), ["boatyard.colorPalette.widget"]);
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

test("Twicc global settings expose base URL and API token fields", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const twiccSection = registry
    .listGlobalSettingsSections()
    .find((section) => section.id === "boatyard.twicc.global");
  const fields = Object.fromEntries(twiccSection.fields.map((field) => [field.key, field]));

  assert.equal(fields.twiccBaseUrl.valueType, "url");
  assert.equal(fields.twiccApiToken.type, "password");
  assert.equal(fields.twiccApiToken.valueType, "text");
});

test("Twicc project nav badge matches the configured Twicc project URL", async () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  await new Promise((resolve) => setImmediate(resolve));

  const badge = registry
    .listProjectNavBadges()
    .find((candidate) => candidate.id === "boatyard.twicc.projectStatus");
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

test("Twicc done project nav badge stays visible for the active project", async () => {
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
    .find((candidate) => candidate.id === "boatyard.twicc.projectStatus");
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
  assert.equal(inactiveElement.className, "project-nav-badge project-twicc-status done");
  assert.equal(inactiveElement.textContent, "Done");
  const activeElement = badge.render({ ...input, isActiveProject: true });
  assert.equal(activeElement.className, "project-nav-badge project-twicc-status done");
  assert.equal(activeElement.textContent, "Done");
});

test("Twicc done project nav badge is retained until the project is opened", async () => {
  const twiccProjectProcessStatuses = {
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
    .find((candidate) => candidate.id === "boatyard.twicc.projectStatus");
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
  assert.equal(firstElement.className, "project-nav-badge project-twicc-status done");

  delete twiccProjectProcessStatuses["twicc-project"];
  await refreshIntervals();

  const retainedElement = badge.render({ ...input, isActiveProject: false });
  assert.equal(retainedElement.className, "project-nav-badge project-twicc-status done");

  assert.equal(badge.render({ ...input, isActiveProject: true }), null);
});

test("Hawser global settings expose a copyable install command", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const hawserSection = registry
    .listGlobalSettingsSections()
    .find((section) => section.id === "boatyard.hawser.global");
  const fields = Object.fromEntries(hawserSection.fields.map((field) => [field.key, field]));

  assert.equal(fields.hawserDefaultRuntime.defaultValue, "codex");
  assert.equal(fields.hawserInstallCommand.persist, false);
  assert.equal(fields.hawserInstallCommand.readOnly, true);
  assert.match(fields.hawserInstallCommand.defaultValue, /^bash <\(curl -fsSL https:\/\/raw\.githubusercontent\.com\/dguerizec\/hawser\/main\/install\.sh\)/);
  assert.equal(fields.hawserInstallCommand.action.label, "Copy");
});

test("Pier project settings derive defaults from project identity", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const pierSection = registry
    .listProjectSettingsSections()
    .find((section) => section.id === "boatyard.pier.project");
  const fields = Object.fromEntries(pierSection.fields.map((field) => [field.key, field]));

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
    "http://pier.test/#/projects/jobo"
  );

  const updatedDefaults = {};
  registry.emit("boatyard.projectForm.coreFieldChanged", {
    field: "devBranch",
    coreFields: {
      slug: "Boatyard",
      devBranch: "release/MVP"
    },
    forPlugin: (pluginId) => ({
      fields: {
        setDefaultValue(key, value) {
          if (pluginId === "boatyard.pier") {
            updatedDefaults[key] = value;
          }
        }
      }
    })
  });

  assert.deepEqual(updatedDefaults, {
    pierProjectName: "boatyard",
    pierPreviewUrl: "http://pier.test/#/projects/boatyard"
  });
});

test("Pier pane resolves the project dashboard URL", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const pane = registry
    .listPanes({ scope: "project", kind: "wcv" })
    .find((candidate) => candidate.id === "boatyard.pier.preview");

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
                  url: "http://v1.sshadow.test",
                  default: true
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
      running: true
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
    .find((candidate) => candidate.id === "boatyard.pier.preview");
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
        restoreUrl: false
      }
    ]
  );
});

export {};
