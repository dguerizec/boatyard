"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createEnvironment() {
  const widgetRegistrySource = fs.readFileSync(
    path.join(__dirname, "../src/renderer/widgetRegistry.js"),
    "utf8",
  );
  const pluginRegistrySource = fs.readFileSync(
    path.join(__dirname, "../src/renderer/pluginRegistry.js"),
    "utf8",
  );
  const context = {
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(widgetRegistrySource, context);
  vm.runInContext(pluginRegistrySource, context);
  return {
    pluginRegistry: context.window.DashtopPluginRegistry,
    widgetRegistry: context.window.DashtopWidgetRegistry,
  };
}

function createRegistry() {
  return createEnvironment().pluginRegistry;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Plugin registry activates plugins and records contributions", () => {
  const { pluginRegistry: registry, widgetRegistry } = createEnvironment();
  let activateCount = 0;

  registry.register(
    {
      id: "vendor.preview",
      name: "Preview",
      version: "1.0.0",
      apiVersion: "0.1",
    },
    {
      activate(ctx) {
        activateCount += 1;
        ctx.status.set({ state: "ready", summary: "Preview ready" });
        ctx.settings.registerGlobalSection({
          id: "vendor.preview.global",
          title: "Preview",
          fields: [
            {
              key: "apiUrl",
              label: "API URL",
            },
          ],
        });
        ctx.settings.registerProjectSection({
          id: "vendor.preview.project",
          title: "Preview",
          fields: [
            {
              key: "previewUrl",
              label: "Preview URL",
              placeholder: "http://localhost:5173",
            },
          ],
        });
        ctx.panes.register({
          id: "vendor.preview.pane",
          webAppId: "preview",
          title: "Preview",
          kind: "wcv",
          resolveUrl: ({ project }) => project.previewUrl,
        });
        ctx.widgets.register({
          id: "vendor.preview.widget",
          name: "Preview",
          create: () => ({}),
        });
        ctx.services.provide("vendor.preview", {
          ping: () => "pong",
        });
      },
    },
  );

  assert.equal(registry.getStatus("vendor.preview").state, "disabled");
  assert.deepEqual(plain(registry.listGlobalSettingsSections()), []);
  assert.deepEqual(plain(registry.listProjectSettingsSections()), []);
  assert.deepEqual(plain(registry.listServices()), []);

  registry.setEnabled("vendor.preview", true);

  assert.deepEqual(plain(registry.list().map((plugin) => plugin.id)), ["vendor.preview"]);
  assert.equal(registry.getStatus("vendor.preview").summary, "Preview ready");
  assert.equal(registry.listGlobalSettingsSections()[0].fields[0].key, "apiUrl");
  assert.equal(registry.listProjectSettingsSections()[0].fields[0].key, "previewUrl");
  assert.equal(registry.listPanes({ kind: "wcv" })[0].webAppId, "preview");
  assert.equal(widgetRegistry.get("vendor.preview.widget").name, "Preview");
  assert.equal(registry.getService("vendor.preview").ping(), "pong");
  assert.deepEqual(plain(registry.listServices()), [{ id: "vendor.preview", pluginId: "vendor.preview" }]);

  registry.reload("vendor.preview");
  assert.equal(activateCount, 2);
  assert.equal(registry.getStatus("vendor.preview").summary, "Preview ready");
  assert.equal(registry.getService("vendor.preview").ping(), "pong");

  registry.setEnabled("vendor.preview", false);

  assert.equal(registry.getStatus("vendor.preview").state, "disabled");
  assert.deepEqual(plain(registry.listGlobalSettingsSections()), []);
  assert.deepEqual(plain(registry.listProjectSettingsSections()), []);
  assert.deepEqual(plain(registry.listPanes({ kind: "wcv" })), []);
  assert.equal(widgetRegistry.get("vendor.preview.widget"), null);
  assert.equal(registry.getService("vendor.preview"), null);
  assert.deepEqual(plain(registry.listServices()), []);
});

test("Plugin registry rejects invalid and duplicate contributions", () => {
  const registry = createRegistry();

  assert.throws(() => registry.register({ name: "Missing id" }), /Plugin id is required/);

  registry.register({ id: "vendor.ok", name: "OK" });
  assert.throws(() => registry.register({ id: "vendor.ok", name: "Duplicate" }), /already registered/);

  registry.register(
    { id: "vendor.bad", name: "Bad" },
    {
      activate(ctx) {
        ctx.panes.register({
          id: "vendor.bad.pane",
          title: "Bad",
          kind: "wcv",
        });
      },
    },
  );
  assert.throws(() => registry.setEnabled("vendor.bad", true), /must provide resolveUrl/);
});

test("Plugin registry requires namespaced contribution ids", () => {
  const registry = createRegistry();

  registry.register(
    { id: "vendor.plugin", name: "Plugin" },
    {
      activate(ctx) {
        ctx.widgets.register({
          id: "unscoped-widget",
          name: "Unscoped",
          create: () => ({}),
        });
      },
    },
  );

  assert.throws(
    () => registry.setEnabled("vendor.plugin", true),
    /must be prefixed with plugin id vendor\.plugin/,
  );
  assert.equal(registry.getStatus("vendor.plugin").state, "error");
});

test("Plugin registry requires namespaced service ids", () => {
  const registry = createRegistry();

  registry.register(
    { id: "vendor.service", name: "Service" },
    {
      activate(ctx) {
        ctx.services.provide("unscoped-service", {});
      },
    },
  );

  assert.throws(
    () => registry.setEnabled("vendor.service", true),
    /must be prefixed with plugin id vendor\.service/,
  );
});
