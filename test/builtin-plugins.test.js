"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRendererPluginEnvironment() {
  const context = {
    console,
    URL,
    window: {
      dashtop: {
        openExternal: () => {},
        writeClipboardText: () => {},
        getHawserWidgetDataForConfig: async () => ({})
      },
      DashtopHawserUI: {
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
    fetch: async () => ({ ok: true, json: async () => [] })
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

  return context.window.DashtopPluginRegistry;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Built-in plugins register Twicc, Pier, and Hawser contributions", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});

  assert.equal(registry.getService("dashtop.twicc.api").version, "0.1.0");
  assert.equal(typeof registry.getService("dashtop.pier").listProjectWorkloads, "function");
  assert.equal(registry.getService("dashtop.hawser.api").version, "0.1.0");
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane) => pane.id).sort()),
    ["dashtop.hawser.pane", "dashtop.pier.preview", "dashtop.twicc.pane"]
  );
  assert.deepEqual(
    plain(registry.listPanes({ scope: "project", kind: "wcv" }).map((pane) => pane.key).sort()),
    ["hawser", "pier", "twicc-plugin"]
  );
  assert.deepEqual(
    plain(registry.listGlobalSettingsSections().map((section) => section.id).sort()),
    ["dashtop.hawser.global", "dashtop.pier.global", "dashtop.twicc.global"]
  );
});

test("Twicc service resolves session URLs from the configured project URL", () => {
  const registry = loadRendererPluginEnvironment();

  registry.applyEnabledState({});

  assert.equal(
    registry.getService("dashtop.twicc.api").getSessionUrl({}, "session-1", {
      pluginConfig: {
        twiccProjectUrl: "http://localhost:3500/project/dashtop"
      }
    }),
    "http://localhost:3500/project/dashtop/session/session-1"
  );
});
