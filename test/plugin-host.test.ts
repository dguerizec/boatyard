"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PluginHost, getPluginEventChannel } = require(`${process.cwd()}/build/main/pluginHost`);

function createPluginFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-plugin-host-"));
  const pluginDir = path.join(root, "example");
  fs.mkdirSync(pluginDir);
  fs.writeFileSync(path.join(pluginDir, "plugin.json"), JSON.stringify({
    id: "vendor.example",
    name: "Example",
    version: "1.0.0",
    renderer: "renderer.js",
    main: "main.js"
  }));
  fs.writeFileSync(path.join(pluginDir, "renderer.js"), "\"use strict\";\n");
  fs.writeFileSync(path.join(pluginDir, "main.js"), `
    "use strict";
    module.exports.activate = (ctx) => {
      ctx.actions.handle("echo", ({ value } = {}) => ({ value, userData: ctx.paths.userData }));
      ctx.actions.handle("emit", () => ctx.events.emit("updated", { ok: true }));
      ctx.projectInspectors.register(({ sourcePath } = {}) => ({ sourcePath, inspected: true }));
      ctx.stateMigrations.register(({ state }) => ({
        projectPluginConfig: (state.projects || [])
          .filter((project) => project.previewUrl)
          .map((project) => ({ projectId: project.id, config: { previewUrl: project.previewUrl } }))
      }));
    };
  `);
  return root;
}

test("PluginHost discovers runtime plugins and routes actions", async () => {
  const pluginRoot = createPluginFixture();
  const store = {
    getState: () => ({ plugins: { enabled: {} } })
  };
  const sentEvents = [];
  const host = new PluginHost({
    pluginRoot,
    store,
    userDataPath: "/workspace/example/user-data",
    sendToRenderer: (channel, payload) => {
      sentEvents.push({ channel, payload });
    }
  });

  host.discover();

  assert.deepEqual(host.listRendererPlugins(), [{
    id: "vendor.example",
    name: "Example",
    version: "1.0.0",
    apiVersion: "0.1",
    rendererPath: path.relative(path.join(process.cwd(), "src/renderer"), path.join(pluginRoot, "example/renderer.js")).replaceAll(path.sep, "/"),
    stylePaths: []
  }]);
  assert.deepEqual(await host.invoke("vendor.example", "echo", { value: "ok" }), {
    value: "ok",
    userData: "/workspace/example/user-data"
  });
  assert.deepEqual(await host.inspectSourcePath({ sourcePath: "/workspace/example/project" }), {
    "vendor.example": {
      sourcePath: "/workspace/example/project",
      inspected: true
    }
  });
  await host.invoke("vendor.example", "emit");
  assert.deepEqual(sentEvents, [{
    channel: getPluginEventChannel("vendor.example", "updated"),
    payload: { ok: true }
  }]);
});

test("PluginHost skips disabled plugin actions and inspectors", async () => {
  const pluginRoot = createPluginFixture();
  const store = {
    getState: () => ({ plugins: { enabled: { "vendor.example": false } } })
  };
  const host = new PluginHost({ pluginRoot, store });

  host.discover();

  await assert.rejects(
    host.invoke("vendor.example", "echo", { value: "ok" }),
    /Plugin is disabled/
  );
  assert.deepEqual(await host.inspectSourcePath({ sourcePath: "/workspace/example/project" }), {});
});

test("PluginHost applies plugin-owned state migrations", async () => {
  const pluginRoot = createPluginFixture();
  const migrated = [];
  const store = {
    getState: () => ({
      plugins: { enabled: {} },
      projects: [{
        id: "project-id",
        previewUrl: "https://preview.example/"
      }]
    }),
    updateProjectPluginConfig: (projectId, pluginId, config) => {
      migrated.push({ projectId, pluginId, config });
    },
    updateGlobalPluginConfig: () => {}
  };
  const host = new PluginHost({ pluginRoot, store });

  host.discover();
  await host.applyStateMigrations();

  assert.deepEqual(migrated, [{
    projectId: "project-id",
    pluginId: "vendor.example",
    config: { previewUrl: "https://preview.example/" }
  }]);
});

export {};
