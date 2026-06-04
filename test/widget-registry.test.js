"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createRegistry() {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/renderer/widgetRegistry.js"),
    "utf8",
  );
  const context = {
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.DashtopWidgetRegistry;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Widget registry normalizes and filters definitions", () => {
  const registry = createRegistry();
  const first = registry.register({
    id: "project-terminal",
    name: "Terminal",
    scope: "project",
    status: "stable",
    category: "Developer tools",
    layout: {
      default: { columns: 2, rows: 3 },
    },
    create: () => ({}),
  });
  registry.register({
    id: "global-usage",
    name: "Usage",
    scope: "global",
    create: () => ({}),
  });

  assert.deepEqual(plain(first.layout), {
    default: { columns: 2, rows: 3 },
    min: { columns: 1, rows: 1 },
    max: { columns: 4, rows: 6 },
  });
  assert.equal(first.status, "stable");
  assert.equal(registry.get("project-terminal").name, "Terminal");
  assert.deepEqual(
    plain(registry.list({ scope: "project" }).map((widget) => widget.id)),
    ["project-terminal"],
  );
  assert.deepEqual(
    plain(registry.list({ status: "experimental" }).map((widget) => widget.id)),
    ["global-usage"],
  );
});

test("Widget registry rejects invalid and duplicate widgets", () => {
  const registry = createRegistry();

  assert.throws(
    () => registry.register({ id: "missing-factory", name: "Missing factory" }),
    /create or createElement/,
  );

  registry.register({
    id: "ok",
    name: "OK",
    create: () => ({}),
  });

  assert.throws(
    () =>
      registry.register({
        id: "ok",
        name: "Duplicate",
        create: () => ({}),
      }),
    /already registered/,
  );
});
