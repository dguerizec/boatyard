"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

type LooseVmValue = ((...args: unknown[]) => LooseVmValue) & {
  [key: number]: LooseVmValue;
  [key: string]: LooseVmValue;
};

type PluginRegistryTestWindow = {
  BoatyardPluginRegistry?: LooseVmValue;
  BoatyardWidgetRegistry?: LooseVmValue;
};

type PluginRegistryTestContext = {
  console: Pick<Console, "error"> & Partial<Console>;
  window: PluginRegistryTestWindow;
};

type PluginActivationContext = LooseVmValue;
type ListedPlugin = {
  id: string;
};
type ListedBadge = {
  id: string;
};
type ProjectContext = {
  project: {
    previewUrl?: string;
    slug: string;
  };
};
type RenderContainer = {
  rendered?: boolean;
};
type ProjectFormInspectedEvent = {
  coreFields: {
    slug: string;
  };
  fields: {
    getValue(key: string): string;
  };
};

function createEnvironment() {
  const { registerWidgetRegistry } = require(`${process.cwd()}/build/renderer/widgetRegistry`);
  const { registerPluginRegistry } = require(`${process.cwd()}/build/renderer/pluginRegistry`);
  const context: PluginRegistryTestContext = {
    console: {
      ...console,
      error() {},
    },
    window: {},
  };
  registerWidgetRegistry(context.window);
  registerPluginRegistry(context.window);
  const pluginRegistry = context.window.BoatyardPluginRegistry;
  const widgetRegistry = context.window.BoatyardWidgetRegistry;
  if (!pluginRegistry || !widgetRegistry) {
    throw new Error("Plugin registry test environment was not initialized.");
  }

  return {
    pluginRegistry,
    widgetRegistry,
  };
}

function createRegistry() {
  return createEnvironment().pluginRegistry;
}

function plain(value: unknown) {
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
      activate(ctx: PluginActivationContext) {
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
          resolveUrl: ({ project }: ProjectContext) => project.previewUrl,
        });
        ctx.projectNavBadges.register({
          id: "vendor.preview.badge",
          render: () => ({ nodeType: 1 }),
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

  assert.deepEqual(plain(registry.list().map((plugin: ListedPlugin) => plugin.id)), ["vendor.preview"]);
  assert.equal(registry.getStatus("vendor.preview").summary, "Preview ready");
  assert.equal(registry.listGlobalSettingsSections()[0].fields[0].key, "apiUrl");
  assert.equal(registry.listProjectSettingsSections()[0].fields[0].key, "previewUrl");
  assert.equal(registry.listPanes({ kind: "wcv" })[0].webAppId, "preview");
  assert.equal(registry.listProjectNavBadges()[0].id, "vendor.preview.badge");
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
  assert.deepEqual(plain(registry.listProjectNavBadges()), []);
  assert.equal(widgetRegistry.get("vendor.preview.widget"), null);
  assert.equal(registry.getService("vendor.preview"), null);
  assert.deepEqual(plain(registry.listServices()), []);
});

test("Plugin registry requires project nav badges to provide render", () => {
  const registry = createRegistry();

  registry.register(
    { id: "vendor.badge", name: "Badge" },
    {
      activate(ctx: PluginActivationContext) {
        ctx.projectNavBadges.register({
          id: "vendor.badge.status",
        });
      },
    },
  );

  assert.throws(() => registry.setEnabled("vendor.badge", true), /must provide render/);
});

test("Plugin registry keeps activating remaining plugins after one failure", () => {
  const registry = createRegistry();

  registry.register(
    { id: "vendor.bad", name: "Bad" },
    {
      activate() {
        throw new Error("Broken plugin");
      },
    },
  );
  registry.register(
    { id: "vendor.good", name: "Good" },
    {
      activate(ctx: PluginActivationContext) {
        ctx.projectNavBadges.register({
          id: "vendor.good.status",
          render: () => ({ nodeType: 1 }),
        });
      },
    },
  );

  registry.applyEnabledState({});

  assert.equal(registry.getStatus("vendor.bad").state, "error");
  assert.deepEqual(plain(registry.listProjectNavBadges().map((badge: ListedBadge) => badge.id)), ["vendor.good.status"]);
});

test("Plugin registry still throws direct enable failures", () => {
  const registry = createRegistry();

  registry.register(
    { id: "vendor.bad", name: "Bad" },
    {
      activate() {
        throw new Error("Broken plugin");
      },
    },
  );

  assert.throws(() => registry.setEnabled("vendor.bad", true), /Broken plugin/);
});

test("Plugin registry rejects invalid and duplicate contributions", () => {
  const registry = createRegistry();

  assert.throws(() => registry.register({ name: "Missing id" }), /Plugin id is required/);

  registry.register({ id: "vendor.ok", name: "OK" });
  assert.throws(() => registry.register({ id: "vendor.ok", name: "Duplicate" }), /already registered/);

  registry.register(
    { id: "vendor.bad", name: "Bad" },
    {
      activate(ctx: PluginActivationContext) {
        ctx.panes.register({
          id: "vendor.bad.pane",
          title: "Bad",
          kind: "wcv",
        });
      },
    },
  );
  assert.throws(() => registry.setEnabled("vendor.bad", true), /must provide resolveUrl or resolveWebApps/);
});

test("Plugin registry accepts dynamic WCV pane webapps", () => {
  const registry = createRegistry();

  registry.register(
    { id: "vendor.dynamic", name: "Dynamic" },
    {
      activate(ctx: PluginActivationContext) {
        ctx.panes.register({
          id: "vendor.dynamic.pane",
          title: "Dynamic",
          kind: "wcv",
          resolveWebApps: ({ project }: ProjectContext) => [
            {
              id: `dynamic:${project.slug}`,
              label: `Dynamic ${project.slug}`,
              url: project.previewUrl
            }
          ]
        });
      }
    },
  );

  registry.setEnabled("vendor.dynamic", true);
  const pane = registry.listPanes({ kind: "wcv" })[0];

  assert.deepEqual(
    plain(pane.resolveWebApps({
      project: {
        slug: "demo",
        previewUrl: "https://demo.example"
      }
    })),
    [
      {
        id: "dynamic:demo",
        label: "Dynamic demo",
        url: "https://demo.example"
      }
    ]
  );
});

test("Plugin registry accepts DOM pane renderers", () => {
  const registry = createRegistry();

  registry.register(
    { id: "vendor.dom", name: "DOM" },
    {
      activate(ctx: PluginActivationContext) {
        ctx.panes.register({
          id: "vendor.dom.pane",
          title: "DOM",
          kind: "dom",
          render(container: RenderContainer) {
            container.rendered = true;
          }
        });
      }
    },
  );

  registry.setEnabled("vendor.dom", true);
  const pane = registry.listPanes({ kind: "dom" })[0];
  const container: { rendered?: boolean } = {};

  pane.render(container);

  assert.equal(pane.webAppId, "vendor.dom.pane");
  assert.equal(container.rendered, true);
});

test("Plugin registry requires namespaced contribution ids", () => {
  const registry = createRegistry();

  registry.register(
    { id: "vendor.plugin", name: "Plugin" },
    {
      activate(ctx: PluginActivationContext) {
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
      activate(ctx: PluginActivationContext) {
        ctx.services.provide("unscoped-service", {});
      },
    },
  );

  assert.throws(
    () => registry.setEnabled("vendor.service", true),
    /must be prefixed with plugin id vendor\.service/,
  );
});

test("Plugin registry emits scoped plugin events and cleans handlers", () => {
  const registry = createRegistry();
  const received: string[] = [];

  registry.register(
    { id: "vendor.events", name: "Events" },
    {
      activate(ctx: PluginActivationContext) {
        ctx.events.on("projectForm.sourcePathInspected", (event: ProjectFormInspectedEvent) => {
          received.push(`${event.fields.getValue("url")}:${event.coreFields.slug}`);
        });
      },
    },
  );

  registry.setEnabled("vendor.events", true);
  registry.emit("projectForm.sourcePathInspected", {
    forPlugin: (pluginId: string) => ({
      fields: {
        getValue: (key: string) => `${pluginId}:${key}`,
      },
      coreFields: {
        slug: "project-slug",
      },
    }),
  });

  assert.deepEqual(received, ["vendor.events:url:project-slug"]);

  registry.setEnabled("vendor.events", false);
  registry.emit("projectForm.sourcePathInspected", {
    forPlugin: () => ({
      fields: {
        getValue: () => "stale",
      },
    }),
  });

  assert.deepEqual(received, ["vendor.events:url:project-slug"]);
});

export {};
