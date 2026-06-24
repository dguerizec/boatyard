"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

type LooseVmValue = ((...args: unknown[]) => LooseVmValue) & {
  [key: number]: LooseVmValue;
  [key: string]: LooseVmValue;
};

type WidgetRegistryTestContext = {
  window: {
    BoatyardWidgetRegistry?: LooseVmValue;
  };
};

type ListedWidget = {
  id: string;
};

function createRegistry() {
  const { registerWidgetRegistry } = require(`${process.cwd()}/build/renderer/widgetRegistry`);
  const window: WidgetRegistryTestContext["window"] = {};
  return registerWidgetRegistry(window);
}

function plain(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

test("Widget registry normalizes and filters definitions", () => {
  const registry = createRegistry();
  const first = registry.register({
    id: "project-terminal",
    name: "Terminal",
    scopes: ["project", "global"],
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
    min: { columns: 1, rows: 1 }
  });
  assert.equal(first.status, "stable");
  assert.deepEqual(plain(first.scopes), ["project", "global"]);
  assert.equal(registry.get("project-terminal").name, "Terminal");
  assert.deepEqual(
    plain(registry.list({ scope: "project" }).map((widget: ListedWidget) => widget.id)),
    ["project-terminal"],
  );
  assert.deepEqual(
    plain(registry.list({ scope: "global" }).map((widget: ListedWidget) => widget.id)),
    ["project-terminal", "global-usage"],
  );
  assert.deepEqual(
    plain(registry.list({ status: "experimental" }).map((widget: ListedWidget) => widget.id)),
    ["global-usage"],
  );
});

test("Widget registry keeps explicit max sizes only", () => {
  const registry = createRegistry();
  const unlimited = registry.register({
    id: "unlimited",
    name: "Unlimited",
    create: () => ({})
  });
  const limited = registry.register({
    id: "limited",
    name: "Limited",
    layout: {
      max: { columns: 6, rows: 8 }
    },
    create: () => ({})
  });

  assert.equal(unlimited.layout.max, undefined);
  assert.deepEqual(plain(limited.layout.max), { columns: 6, rows: 8 });
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

test("Widget registry unregisters widgets", () => {
  const registry = createRegistry();

  registry.register({
    id: "temporary",
    name: "Temporary",
    create: () => ({}),
  });

  assert.equal(registry.get("temporary").name, "Temporary");
  assert.equal(registry.unregister("temporary"), true);
  assert.equal(registry.get("temporary"), null);
});

export {};
