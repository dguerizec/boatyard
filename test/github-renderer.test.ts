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
  setTimeout(callback: () => void, delay?: number): number;
  window: Record<string, unknown> & {
    BoatyardPluginRegistry?: Record<string, (...args: unknown[]) => unknown>;
    BoatyardWidgetRegistry?: Record<string, (...args: unknown[]) => unknown>;
    boatyard: {
      invokePlugin(pluginId: string, actionName: string, payload: unknown): Promise<unknown>;
      openExternal(url?: unknown): void;
    };
  };
};

function activateGitHubWidgets(context: RendererContext) {
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
  context.window.BoatyardPluginRegistry?.applyEnabledState({});
  return context.window.BoatyardWidgetRegistry;
}

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
  const widgetRegistry = activateGitHubWidgets(context);
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

test("GitHub Actions widgets isolate in-flight responses when a project repository changes", async () => {
  const pending = new Map<string, (value: unknown) => void>();
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
        invokePlugin: async (_pluginId, actionName, payload) => {
          assert.equal(actionName, "actionsSnapshotForProject");
          const project = (payload as { project: { repoUrl: string } }).project;
          return new Promise((resolve) => {
            pending.set(project.repoUrl, resolve);
          });
        },
        openExternal: () => {}
      }
    }
  };
  const widgetRegistry = activateGitHubWidgets(context);
  const definition = widgetRegistry?.get("boatyard.github.actions") as {
    createElement(project: Record<string, unknown>): FakeElement;
  };
  const oldCard = definition.createElement({
    id: "project-id",
    repoUrl: "https://github.com/octo-org/old-repository"
  });
  const newCard = definition.createElement({
    id: "project-id",
    repoUrl: "https://github.com/octo-org/new-repository"
  });
  oldCard.isConnected = true;
  newCard.isConnected = true;

  await flush();
  assert.equal(pending.size, 2);

  pending.get("https://github.com/octo-org/new-repository")?.({
    ...createSnapshot(),
    runs: [{
      conclusion: "success",
      createdAt: "2026-07-29T10:00:00Z",
      event: "push",
      headBranch: "main",
      headSha: "abcdef1",
      htmlUrl: "https://github.com/octo-org/new-repository/actions/runs/2",
      id: 2,
      jobs: [],
      name: "New repository workflow",
      runAttempt: 1,
      startedAt: "2026-07-29T10:00:00Z",
      status: "completed",
      updatedAt: "2026-07-29T10:01:00Z"
    }]
  });
  await flush();
  assert.ok(findByText(newCard, "New repository workflow"));

  pending.get("https://github.com/octo-org/old-repository")?.({
    ...createSnapshot(),
    runs: [{
      conclusion: "failure",
      createdAt: "2026-07-29T09:00:00Z",
      event: "push",
      headBranch: "main",
      headSha: "1234567",
      htmlUrl: "https://github.com/octo-org/old-repository/actions/runs/1",
      id: 1,
      jobs: [],
      name: "Old repository workflow",
      runAttempt: 1,
      startedAt: "2026-07-29T09:00:00Z",
      status: "completed",
      updatedAt: "2026-07-29T09:01:00Z"
    }]
  });
  await flush();

  assert.ok(findByText(oldCard, "Old repository workflow"));
  assert.ok(findByText(newCard, "New repository workflow"));
  assert.equal(findByText(newCard, "Old repository workflow"), null);
});

test("GitHub Actions refresh backs off after failures", async () => {
  const scheduledDelays: number[] = [];
  const context: RendererContext = {
    clearTimeout: () => {},
    console,
    document: {
      createElement: () => new FakeElement()
    },
    queueMicrotask,
    setTimeout: (_callback, delay = 0) => {
      scheduledDelays.push(delay);
      return scheduledDelays.length;
    },
    window: {
      boatyard: {
        invokePlugin: async () => {
          throw new Error("GitHub is temporarily unavailable.");
        },
        openExternal: () => {}
      }
    }
  };
  const widgetRegistry = activateGitHubWidgets(context);
  const definition = widgetRegistry?.get("boatyard.github.actions") as {
    createElement(project: Record<string, unknown>): FakeElement;
  };
  const card = definition.createElement({
    id: "project-id",
    repoUrl: "https://github.com/octo-org/example"
  });
  card.isConnected = true;

  await flush();
  await flush();

  assert.deepEqual(scheduledDelays, [60000]);
  assert.ok(findByText(card, "GitHub is temporarily unavailable."));
});

test("GitHub Actions widget renders active matrix jobs and terminal conclusions", async () => {
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
        invokePlugin: async () => ({
          ...createSnapshot(),
          activeRunCount: 1,
          runs: [
            {
              conclusion: "",
              createdAt: "2026-07-29T10:00:00Z",
              event: "pull_request",
              headBranch: "feature/widgets",
              headSha: "abcdef123456",
              htmlUrl: "https://github.com/octo-org/example/actions/runs/10",
              id: 10,
              jobs: [
                {
                  completedAt: "",
                  conclusion: "",
                  htmlUrl: "https://github.com/octo-org/example/actions/runs/10/job/1",
                  id: 1,
                  labels: ["ubuntu-latest"],
                  name: "Test (Node 22)",
                  runnerName: "",
                  startedAt: "2026-07-29T10:01:00Z",
                  status: "in_progress",
                  steps: [
                    { completedAt: "2026-07-29T10:01:10Z", conclusion: "success", name: "Checkout", number: 1, startedAt: "2026-07-29T10:01:00Z", status: "completed" },
                    { completedAt: "", conclusion: "", name: "Run tests", number: 2, startedAt: "2026-07-29T10:01:10Z", status: "in_progress" }
                  ]
                },
                {
                  completedAt: "",
                  conclusion: "",
                  htmlUrl: "https://github.com/octo-org/example/actions/runs/10/job/2",
                  id: 2,
                  labels: ["windows-latest"],
                  name: "Test (Node 24)",
                  runnerName: "",
                  startedAt: "",
                  status: "queued",
                  steps: []
                },
                {
                  completedAt: "2026-07-29T10:01:30Z",
                  conclusion: "skipped",
                  htmlUrl: "https://github.com/octo-org/example/actions/runs/10/job/3",
                  id: 3,
                  labels: ["ubuntu-latest"],
                  name: "Optional integration",
                  runnerName: "",
                  startedAt: "",
                  status: "completed",
                  steps: []
                },
                {
                  completedAt: "2026-07-29T10:01:40Z",
                  conclusion: "action_required",
                  htmlUrl: "https://github.com/octo-org/example/actions/runs/10/job/4",
                  id: 4,
                  labels: ["production"],
                  name: "Protected deployment",
                  runnerName: "",
                  startedAt: "2026-07-29T10:01:30Z",
                  status: "completed",
                  steps: []
                }
              ],
              name: "CI matrix",
              runAttempt: 1,
              startedAt: "2026-07-29T10:01:00Z",
              status: "in_progress",
              updatedAt: "2026-07-29T10:02:00Z"
            },
            ...["success", "failure", "cancelled", "timed_out", "neutral"].map((conclusion, index) => ({
              conclusion,
              createdAt: `2026-07-29T0${9 - index}:00:00Z`,
              event: "push",
              headBranch: "main",
              headSha: `abcdef${index}`,
              htmlUrl: `https://github.com/octo-org/example/actions/runs/${index + 20}`,
              id: index + 20,
              jobs: [],
              name: `Completed ${conclusion}`,
              runAttempt: 1,
              startedAt: `2026-07-29T0${9 - index}:00:00Z`,
              status: "completed",
              updatedAt: `2026-07-29T0${9 - index}:01:00Z`
            }))
          ]
        }),
        openExternal: () => {}
      }
    }
  };
  const widgetRegistry = activateGitHubWidgets(context);
  const definition = widgetRegistry?.get("boatyard.github.actions") as {
    createElement(project: Record<string, unknown>): FakeElement;
  };
  const card = definition.createElement({
    id: "project-id",
    repoUrl: "https://github.com/octo-org/example"
  });
  card.isConnected = true;
  await flush();

  assert.equal(findAllByClass(card, "github-job-row").length, 4);
  assert.equal(findAllByClass(card, "github-run-progress-segment").length, 4);
  assert.ok(findByText(card, "Run tests"));
  assert.ok(findByText(card, "Test (Node 24)"));
  assert.ok(findByText(card, "Optional integration"));
  assert.ok(findByText(card, "Protected deployment"));
  assert.ok(findByText(card, "Completed success"));
  assert.ok(findByText(card, "Completed failure"));
  assert.ok(findByText(card, "Completed cancelled"));
  assert.ok(findByText(card, "Completed timed_out"));
  assert.ok(findByText(card, "Completed neutral"));
  assert.ok(findAllByClass(card, "running").length >= 2);
  assert.ok(findAllByClass(card, "queued").length >= 2);
  assert.ok(findAllByClass(card, "success").length >= 1);
  assert.ok(findAllByClass(card, "failure").length >= 2);
  assert.ok(findAllByClass(card, "muted").length >= 1);
  assert.ok(findAllByClass(card, "warning").length >= 1);
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
  const widgetRegistry = activateGitHubWidgets(context);
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
