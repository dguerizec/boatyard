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
      openExternal(url?: unknown): void;
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

function findAllByClass(root: FakeElement, className: string): FakeElement[] {
  return [
    ...(root.className.split(/\s+/).includes(className) ? [root] : []),
    ...root.children.flatMap((child) => findAllByClass(child, className))
  ];
}

function findByText(root: FakeElement, text: string): FakeElement | null {
  if (root.textContent === text) {
    return root;
  }
  for (const child of root.children) {
    const match = findByText(child, text);
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

test("GitHub Pull Requests widget renders independent review and CI states and filters locally", async () => {
  const openedUrls: string[] = [];
  const context: RendererContext = {
    clearTimeout: () => {},
    console,
    document: {
      createElement: () => new FakeElement()
    },
    queueMicrotask,
    setTimeout: () => 1,
    window: {
      boatyard: {
        invokePlugin: async (_pluginId, actionName) => {
          assert.equal(actionName, "pullRequestsSnapshotForProject");
          return {
            pullRequests: [
              {
                authorLogin: "contributor",
                baseRefName: "main",
                checks: [],
                ciState: "running",
                headRefName: "feature/review",
                isAuthoredByViewer: false,
                isDraft: false,
                isReadyToMerge: false,
                isReviewRequestedFromViewer: true,
                mergeState: "blocked",
                number: 12,
                reviewState: "required",
                title: "Review this change",
                updatedAt: "2026-07-29T11:00:00Z",
                url: "https://github.com/octo-org/example/pull/12"
              },
              {
                authorLogin: "octocat",
                baseRefName: "main",
                checks: [],
                ciState: "passed",
                headRefName: "feature/ready",
                isAuthoredByViewer: true,
                isDraft: false,
                isReadyToMerge: true,
                isReviewRequestedFromViewer: false,
                mergeState: "clean",
                number: 11,
                reviewState: "approved",
                title: "Ready change",
                updatedAt: "2026-07-29T10:00:00Z",
                url: "https://github.com/octo-org/example/pull/11"
              },
              {
                authorLogin: "octocat",
                baseRefName: "main",
                checks: [],
                ciState: "failed",
                headRefName: "feature/blocked",
                isAuthoredByViewer: true,
                isDraft: false,
                isReadyToMerge: false,
                isReviewRequestedFromViewer: false,
                mergeState: "conflicting",
                number: 10,
                reviewState: "changesRequested",
                title: "Blocked change",
                updatedAt: "2026-07-29T09:00:00Z",
                url: "https://github.com/octo-org/example/pull/10"
              }
            ],
            refreshedAt: "2026-07-29T12:00:00Z",
            repository: {
              host: "github.com",
              owner: "octo-org",
              repo: "example"
            },
            status: {
              state: "ready",
              summary: "Authenticated."
            },
            viewerLogin: "octocat"
          };
        },
        openExternal: (url?: unknown) => {
          openedUrls.push(String(url || ""));
        }
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
  const definition = widgetRegistry?.get("boatyard.github.pullRequests") as {
    createElement(project: Record<string, unknown>): FakeElement;
  };
  const card = definition.createElement({
    id: "project-id",
    repoUrl: "https://github.com/octo-org/example"
  });
  card.isConnected = true;
  await flush();

  assert.equal(findAllByClass(card, "github-pr-row").length, 3);
  assert.equal(findAllByClass(card, "running").length, 1);
  assert.ok(findAllByClass(card, "success").length >= 2);
  assert.ok(findAllByClass(card, "failure").length >= 2);

  findByClass(card, "github-pr-link")?.trigger("click");
  assert.deepEqual(openedUrls, ["https://github.com/octo-org/example/pull/12"]);

  findByText(card, "Review requested 1")?.trigger("click");
  assert.equal(findAllByClass(card, "github-pr-row").length, 1);
  assert.ok(findByText(card, "Review this change"));
});

export {};
