"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { resolveFieldDefault } = require("../src/renderer/pluginSettingsFields");

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
}, mockFetch = async () => ({ ok: true, json: async () => [] })) {
  const context = {
    console,
    URL,
    window: {
      boatyard: {
        openExternal: () => {},
        writeClipboardText: () => {},
        getHawserStatusForConfig: async () => ({
          state: "ready",
          summary: "Hawser service is available."
        }),
        getHawserWidgetDataForConfig: async () => ({}),
        getTwiccProjectProcessStatuses: async () => twiccProjectProcessStatuses
      },
      BoatyardHawserUI: {
        createWidget: () => ({})
      },
      setInterval: () => 0,
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
    "../src/renderer/widgetRegistry.js",
    "../src/renderer/pluginRegistry.js",
    "../src/renderer/plugins/twicc.js",
    "../src/renderer/plugins/pier.js",
    "../src/renderer/plugins/hawser.js"
  ]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
  }

  return context.window.BoatyardPluginRegistry;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Built-in plugins register Twicc, Pier, and Hawser contributions", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});

  assert.equal(registry.getService("boatyard.twicc.api").version, "0.1.0");
  assert.equal(typeof registry.getService("boatyard.pier").listProjectWorkloads, "function");
  assert.equal(registry.getService("boatyard.hawser.api").version, "0.1.0");
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane) => pane.id).sort()),
    ["boatyard.hawser.pane", "boatyard.pier.preview", "boatyard.twicc.pane"]
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
    ["boatyard.hawser.global", "boatyard.pier.global", "boatyard.twicc.global"]
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

test("Hawser global settings expose a copyable install command", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});
  const hawserSection = registry
    .listGlobalSettingsSections()
    .find((section) => section.id === "boatyard.hawser.global");
  const fields = Object.fromEntries(hawserSection.fields.map((field) => [field.key, field]));

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

    if (String(url).endsWith("/api/v1/workloads")) {
      return {
        ok: true,
        json: async () => [
          {
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
        ]
      };
    }

    throw new Error(`Unexpected URL ${url}`);
  });

  registry.applyEnabledState({});
  const workloads = await registry.getService("boatyard.pier").listProjectWorkloads(
    {
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
      worktreePath
    }
  ]);
});
