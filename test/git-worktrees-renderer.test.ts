"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { registerPluginRegistry } = require(`${process.cwd()}/build/renderer/pluginRegistry`);
const { registerWidgetRegistry } = require(`${process.cwd()}/build/renderer/widgetRegistry`);

type EventHandler = (...args: unknown[]) => unknown;

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  className = "";
  disabled = false;
  hidden = false;
  isConnected = true;
  parentElement: FakeElement | null = null;
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
    contains: (name: string) => this.className.split(/\s+/).includes(name),
    remove: (...names: string[]) => {
      const removed = new Set(names);
      this.className = this.className
        .split(/\s+/)
        .filter((name) => name && !removed.has(name))
        .join(" ");
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
    this.listeners.set(name, [...(this.listeners.get(name) || []), handler]);
  }

  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  querySelector<T extends FakeElement = FakeElement>(selector: string): T | null {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    for (const child of this.children) {
      if (className && child.classList.contains(className)) {
        return child as T;
      }
      const match = child.querySelector<T>(selector);
      if (match) {
        return match;
      }
    }
    return null;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children.forEach((child) => {
      child.parentElement = null;
    });
    this.children = [];
    this.append(...children);
  }

  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }

  async trigger(name: string) {
    for (const handler of this.listeners.get(name) || []) {
      await handler({ preventDefault() {} });
    }
  }
}

function findAllByClass(root: FakeElement, className: string): FakeElement[] {
  return [
    ...(root.classList.contains(className) ? [root] : []),
    ...root.children.flatMap((child) => findAllByClass(child, className))
  ];
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function plain(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createWorkspaceSnapshot() {
  return {
    linkedCount: 2,
    totalChangeCount: 3,
    totalPotentialConflictCount: 1,
    worktrees: [
      {
        branch: "main",
        current: true,
        displayPath: "private/example",
        name: "example",
        path: "/workspace/example",
        potentialConflictErrors: [],
        potentialConflicts: [{
          path: "src/shared.ts",
          peers: ["feature/widget"]
        }],
        primary: true,
        status: {
          ahead: 0,
          behind: 0,
          branch: "main",
          changes: [
            {
              indexStatus: ".",
              kind: "modified",
              path: "frontend/src/components/assistant/AssistantPanel.tsx",
              staged: false,
              workingTreeStatus: "M"
            },
            {
              indexStatus: "?",
              kind: "untracked",
              path: "notes with spaces.md",
              staged: false,
              workingTreeStatus: "?"
            }
          ]
        },
        statusError: "",
        usable: true
      },
      {
        branch: "feature/widget",
        displayPath: "worktrees/example-widget",
        name: "example-widget",
        path: "/workspace/example-widget",
        potentialConflictErrors: [],
        potentialConflicts: [{
          path: "src/shared.ts",
          peers: ["main"]
        }],
        status: {
          ahead: 1,
          behind: 0,
          branch: "feature/widget",
          changes: [{
            indexStatus: "M",
            kind: "staged",
            path: "src/widget.ts",
            staged: true,
            workingTreeStatus: "."
          }]
        },
        statusError: "",
        usable: true
      },
      {
        detached: true,
        displayPath: "private/example-stale",
        name: "example-stale",
        path: "/workspace/example-stale",
        potentialConflictErrors: [],
        potentialConflicts: [],
        status: null,
        statusError: "Worktree is unavailable.",
        usable: false
      }
    ]
  };
}

type WorkspaceSnapshot = ReturnType<typeof createWorkspaceSnapshot>;

function loadGitPlugin(
  snapshotSource: WorkspaceSnapshot | (() => WorkspaceSnapshot | Promise<WorkspaceSnapshot>) = createWorkspaceSnapshot()
) {
  const invoked: Array<{ actionName: string; payload: unknown; pluginId: string }> = [];
  const copiedPaths: string[] = [];
  const clearedIntervals: number[] = [];
  const intervalCallbacks: Array<() => void> = [];
  const storedValues = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return storedValues.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storedValues.set(key, value);
    }
  };
  const window = {
    boatyard: {
      invokePlugin: async (pluginId: string, actionName: string, payload: unknown) => {
        invoked.push({ pluginId, actionName, payload });
        return typeof snapshotSource === "function" ? snapshotSource() : snapshotSource;
      },
      writeClipboardText: async (value: string) => {
        copiedPaths.push(value);
      }
    },
    clearInterval: (intervalId: number) => {
      clearedIntervals.push(intervalId);
    },
    localStorage,
    setInterval: (callback: () => void) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    }
  } as Record<string, unknown>;
  window.window = window;
  const context = {
    CustomEvent: class {},
    clearInterval: window.clearInterval,
    console,
    document: {
      createElement: () => new FakeElement()
    },
    localStorage,
    setInterval: window.setInterval,
    window
  };
  registerWidgetRegistry(window);
  const registry = registerPluginRegistry(window);
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(`${process.cwd()}/build/plugins/git-worktrees/renderer.js`, "utf8"),
    context
  );
  registry.applyEnabledState({});

  return {
    clearedIntervals,
    copiedPaths,
    intervalCallbacks,
    invoked,
    registry,
    storedValues,
    widgetRegistry: window.BoatyardWidgetRegistry as {
      get(id: string): { createElement?: (project: unknown) => unknown; name?: string } | null;
    }
  };
}

test("Git widget renders collapsible worktrees with each worktree's changed files", async () => {
  const harness = loadGitPlugin();
  const widget = harness.widgetRegistry.get("boatyard.gitWorktrees.list");
  if (!widget || typeof widget.createElement !== "function") {
    throw new Error("Git widget was not registered.");
  }

  const card = widget.createElement({
    id: "project-id",
    sourcePath: "/workspace/example"
  }) as FakeElement;
  await flush();

  assert.equal(widget.name, "Git");
  assert.deepEqual(plain(harness.invoked), [{
    pluginId: "boatyard.gitWorktrees",
    actionName: "snapshotForProject",
    payload: { sourcePath: "/workspace/example" }
  }]);
  assert.equal(findAllByClass(card, "git-worktrees-count")[0].textContent, "3");
  assert.equal(findAllByClass(card, "git-worktrees-total-changes")[0].textContent, "3 changes");
  assert.equal(findAllByClass(card, "git-worktrees-row").length, 3);
  assert.equal(findAllByClass(card, "git-changes-row").length, 3);
  assert.deepEqual(
    findAllByClass(card, "git-changes-path-prefix").map((pathElement) => pathElement.textContent),
    ["frontend/src/components/assistant", "src"]
  );
  assert.deepEqual(
    findAllByClass(card, "git-changes-path-suffix").map((pathElement) => pathElement.textContent),
    ["/AssistantPanel.tsx", "notes with spaces.md", "/widget.ts"]
  );
  assert.deepEqual(
    findAllByClass(card, "git-changes-path").map((pathElement) => pathElement.attributes.get("aria-label")),
    [
      "frontend/src/components/assistant/AssistantPanel.tsx",
      "notes with spaces.md",
      "src/widget.ts"
    ]
  );
  assert.deepEqual(
    findAllByClass(card, "git-worktrees-path").map((pathElement) => pathElement.textContent),
    ["private/example", "worktrees/example-widget", "private/example-stale"]
  );
  assert.equal(findAllByClass(card, "git-worktrees-conflicts-toggle").length, 0);
  assert.deepEqual(
    findAllByClass(card, "git-worktrees-badge").map((badge) => badge.textContent),
    ["Current", "Detached", "Prunable"]
  );

  const details = findAllByClass(card, "git-worktrees-details");
  assert.deepEqual(details.map((detail) => detail.hidden), [false, true, true]);
  const toggles = findAllByClass(card, "git-worktrees-toggle");
  await toggles[1].trigger("click");
  assert.equal(details[1].hidden, false);
  assert.equal(toggles[1].attributes.get("aria-expanded"), "true");

  await findAllByClass(card, "git-worktrees-path")[1].trigger("click");
  await findAllByClass(card, "git-changes-row")[2].trigger("click");
  assert.deepEqual(harness.copiedPaths, ["/workspace/example-widget", "src/widget.ts"]);
  assert.deepEqual(
    JSON.parse(harness.storedValues.get("boatyard:git-worktrees:expanded:project-id") || "[]"),
    ["/workspace/example", "/workspace/example-widget"]
  );
});

test("Git pane refreshes while mounted and stops polling after detachment", async () => {
  const harness = loadGitPlugin();
  const pane = harness.registry.listPanes({ scope: "project", kind: "dom" })
    .find((candidate: { id?: string }) => candidate.id === "boatyard.gitWorktrees.changes");
  if (!pane || typeof pane.render !== "function") {
    throw new Error("Git pane was not registered.");
  }

  const host = new FakeElement();
  const cleanup = pane.render(host, {
    project: { id: "project-id", sourcePath: "/workspace/example" }
  });
  await flush();

  assert.equal(pane.title, "Git");
  assert.equal(findAllByClass(host, "git-worktrees-pane").length, 1);
  assert.equal(findAllByClass(host, "git-worktrees-row").length, 3);
  assert.equal(findAllByClass(host, "git-changes-row").length, 3);
  assert.deepEqual(plain(harness.invoked), [{
    pluginId: "boatyard.gitWorktrees",
    actionName: "snapshotForProject",
    payload: { sourcePath: "/workspace/example" }
  }]);

  const conflictsToggle = findAllByClass(host, "git-worktrees-conflicts-toggle")[0];
  assert.equal(conflictsToggle.attributes.get("aria-pressed"), "false");
  await conflictsToggle.trigger("click");
  await flush();

  assert.equal(conflictsToggle.attributes.get("aria-pressed"), "true");
  assert.deepEqual(plain(harness.invoked[1]), {
    pluginId: "boatyard.gitWorktrees",
    actionName: "snapshotForProject",
    payload: {
      includePotentialConflicts: true,
      sourcePath: "/workspace/example"
    }
  });
  assert.equal(
    findAllByClass(host, "git-worktrees-total-changes")[0].textContent,
    "1 potential conflict"
  );
  assert.equal(findAllByClass(host, "git-changes-row").length, 2);
  assert.deepEqual(
    findAllByClass(host, "git-worktrees-change-count").map((count) => count.textContent),
    ["1", "1", "0"]
  );
  assert.deepEqual(
    findAllByClass(host, "git-changes-status").map((status) => status.textContent),
    ["UU", "UU"]
  );
  assert.deepEqual(
    findAllByClass(host, "git-changes-original-path").map((detail) => detail.textContent),
    ["with feature/widget", "with main"]
  );

  await conflictsToggle.trigger("click");
  await flush();
  assert.equal(conflictsToggle.attributes.get("aria-pressed"), "false");
  assert.equal(findAllByClass(host, "git-changes-row").length, 3);
  assert.deepEqual(plain(harness.invoked[2]), {
    pluginId: "boatyard.gitWorktrees",
    actionName: "snapshotForProject",
    payload: { sourcePath: "/workspace/example" }
  });

  assert.equal(harness.intervalCallbacks.length, 1);
  harness.intervalCallbacks[0]();
  await flush();
  assert.equal(harness.invoked.length, 4);

  const surface = findAllByClass(host, "git-worktrees-pane")[0];
  surface.isConnected = false;
  harness.intervalCallbacks[0]();
  await flush();
  assert.equal(harness.invoked.length, 4);
  assert.deepEqual(harness.clearedIntervals, [1]);

  assert.equal(typeof cleanup, "function");
  cleanup();
  assert.deepEqual(harness.clearedIntervals, [1]);
});

test("Git pane keeps controls stable and queues view changes during background polling", async () => {
  const backgroundSnapshot = deferred<WorkspaceSnapshot>();
  let requestCount = 0;
  const harness = loadGitPlugin(() => {
    requestCount += 1;
    return requestCount === 2 ? backgroundSnapshot.promise : createWorkspaceSnapshot();
  });
  const pane = harness.registry.listPanes({ scope: "project", kind: "dom" })
    .find((candidate: { id?: string }) => candidate.id === "boatyard.gitWorktrees.changes");
  if (!pane || typeof pane.render !== "function") {
    throw new Error("Git pane was not registered.");
  }

  const host = new FakeElement();
  const cleanup = pane.render(host, {
    project: { id: "project-id", sourcePath: "/workspace/example" }
  });
  await flush();

  const conflictsToggle = findAllByClass(host, "git-worktrees-conflicts-toggle")[0];
  const refreshButton = findAllByClass(host, "git-worktrees-refresh")[0];
  harness.intervalCallbacks[0]();
  assert.equal(conflictsToggle.disabled, false);
  assert.equal(refreshButton.disabled, false);

  await conflictsToggle.trigger("click");
  assert.equal(conflictsToggle.attributes.get("aria-pressed"), "true");
  assert.equal(harness.invoked.length, 2);

  backgroundSnapshot.resolve(createWorkspaceSnapshot());
  await flush();
  await flush();

  assert.equal(harness.invoked.length, 3);
  assert.deepEqual(plain(harness.invoked[2]), {
    pluginId: "boatyard.gitWorktrees",
    actionName: "snapshotForProject",
    payload: {
      includePotentialConflicts: true,
      sourcePath: "/workspace/example"
    }
  });
  assert.equal(
    findAllByClass(host, "git-worktrees-total-changes")[0].textContent,
    "1 potential conflict"
  );

  cleanup();
});

export {};
