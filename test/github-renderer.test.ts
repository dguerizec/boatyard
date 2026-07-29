"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { registerPluginRegistry } = require(`${process.cwd()}/build/renderer/pluginRegistry`);
const { registerWidgetRegistry } = require(`${process.cwd()}/build/renderer/widgetRegistry`);

type EventHandler = (...args: unknown[]) => void;

class FakeElement {
  children: FakeElement[] = [];
  className = "";
  disabled = false;
  hidden = false;
  isConnected = false;
  textContent = "";
  title = "";
  type = "";
  private listeners = new Map<string, EventHandler[]>();

  classList = {
    add: (...names: string[]) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      names.forEach((name) => classes.add(name));
      this.className = [...classes].join(" ");
    },
    toggle: (name: string, enabled?: boolean) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      const shouldEnable = enabled === undefined ? !classes.has(name) : enabled;
      if (shouldEnable) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
      this.className = [...classes].join(" ");
      return shouldEnable;
    }
  };

  addEventListener(name: string, handler: EventHandler) {
    const handlers = this.listeners.get(name) || [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = [...children];
  }

  setAttribute() {}

  trigger(name: string) {
    for (const handler of this.listeners.get(name) || []) {
      handler();
    }
  }
}

type RendererContext = {
  clearTimeout(timer: number): void;
  console: Console;
  document: {
    createElement(): FakeElement;
  };
  queueMicrotask(callback: () => void): void;
  setTimeout(callback: () => void): number;
  window: Record<string, unknown> & {
    BoatyardPluginRegistry?: Record<string, (...args: unknown[]) => unknown>;
    BoatyardWidgetRegistry?: Record<string, (...args: unknown[]) => unknown>;
    boatyard: {
      invokePlugin(pluginId: string, actionName: string, payload: unknown): Promise<unknown>;
      openExternal(): void;
    };
  };
};

function findByClass(root: FakeElement, className: string): FakeElement | null {
  if (root.className.split(/\s+/).includes(className)) {
    return root;
  }
  for (const child of root.children) {
    const match = findByClass(child, className);
    if (match) {
      return match;
    }
  }
  return null;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createSnapshot() {
  return {
    activeRunCount: 0,
    refreshedAt: "2026-07-29T10:00:00Z",
    repository: {
      host: "github.com",
      owner: "octo-org",
      repo: "example"
    },
    runs: [],
    status: {
      state: "ready",
      summary: "Authenticated."
    }
  };
}

test("GitHub Actions widgets share in-flight refreshes, queue manual refresh, and stop after disconnect", async () => {
  const invocationPayloads: Array<Record<string, unknown>> = [];
  const timers = new Map<number, () => void>();
  let nextTimerId = 1;
  let resolveFirst!: (value: unknown) => void;
  const firstResult = new Promise<unknown>((resolve) => {
    resolveFirst = resolve;
  });
  const context: RendererContext = {
    clearTimeout: (timer) => {
      timers.delete(timer);
    },
    console,
    document: {
      createElement: () => new FakeElement()
    },
    queueMicrotask,
    setTimeout: (callback) => {
      const id = nextTimerId++;
      timers.set(id, () => {
        timers.delete(id);
        callback();
      });
      return id;
    },
    window: {
      boatyard: {
        invokePlugin: async (pluginId, actionName, payload) => {
          assert.equal(pluginId, "boatyard.github");
          assert.equal(actionName, "actionsSnapshotForProject");
          invocationPayloads.push(payload as Record<string, unknown>);
          return invocationPayloads.length === 1
            ? firstResult
            : createSnapshot();
        },
        openExternal: () => {}
      }
    }
  };
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  context.window.window = context.window;
  registerWidgetRegistry(context.window);
  registerPluginRegistry(context.window);
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(`${process.cwd()}/build/plugins/github/renderer.js`, "utf8"),
    context
  );
  const pluginRegistry = context.window.BoatyardPluginRegistry;
  const widgetRegistry = context.window.BoatyardWidgetRegistry;
  pluginRegistry?.applyEnabledState({});
  const definition = widgetRegistry?.get("boatyard.github.actions") as {
    createElement(project: Record<string, unknown>): FakeElement;
  };
  const project = {
    id: "project-id",
    repoUrl: "https://github.com/octo-org/example"
  };
  const firstCard = definition.createElement(project);
  const secondCard = definition.createElement(project);
  firstCard.isConnected = true;
  secondCard.isConnected = true;

  await flush();
  assert.equal(invocationPayloads.length, 1);

  findByClass(firstCard, "github-refresh-button")?.trigger("click");
  resolveFirst(createSnapshot());
  await flush();
  await flush();
  assert.equal(invocationPayloads.length, 2);
  assert.equal(invocationPayloads[1].force, true);
  assert.equal(timers.size, 1);

  firstCard.isConnected = false;
  secondCard.isConnected = false;
  const scheduledRefresh = [...timers.values()][0];
  scheduledRefresh();
  await flush();
  assert.equal(invocationPayloads.length, 2);
  assert.equal(timers.size, 0);
});

export {};
