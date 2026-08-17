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

test("Git worktrees widget renders Git-only worktree states and copies paths", async () => {
  const invoked: Array<{ actionName: string; payload: unknown; pluginId: string }> = [];
  const copiedPaths: string[] = [];
  const context = {
    CustomEvent: class {},
    clearInterval: () => {},
    console,
    document: {
      createElement: () => new FakeElement()
    },
    setInterval: () => 1,
    window: {
      boatyard: {
        invokePlugin: async (pluginId: string, actionName: string, payload: unknown) => {
          invoked.push({ pluginId, actionName, payload });
          return {
            linkedCount: 2,
            worktrees: [
              {
                branch: "main",
                current: true,
                name: "example",
                path: "/workspace/example",
                primary: true,
                usable: true
              },
              {
                branch: "feature/widget",
                name: "example-widget",
                path: "/workspace/example-widget",
                usable: true
              },
              {
                detached: true,
                name: "example-stale",
                path: "/workspace/example-stale",
                usable: false
              }
            ]
          };
        },
        writeClipboardText: async (value: string) => {
          copiedPaths.push(value);
        }
      },
      clearInterval: () => {},
      setInterval: () => 1
    } as Record<string, unknown>
  };
  context.window.window = context.window;
  registerWidgetRegistry(context.window);
  const registry = registerPluginRegistry(context.window);
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(`${process.cwd()}/build/plugins/git-worktrees/renderer.js`, "utf8"),
    context
  );
  registry.applyEnabledState({});

  const widgetRegistry = context.window.BoatyardWidgetRegistry as {
    get(id: string): { createElement?: (project: unknown) => unknown } | null;
  } | undefined;
  const widget = widgetRegistry?.get("boatyard.gitWorktrees.list");
  if (!widget || typeof widget.createElement !== "function") {
    throw new Error("Git worktrees widget was not registered.");
  }
  const card = widget.createElement({
    id: "project-id",
    sourcePath: "/workspace/example"
  }) as FakeElement;
  await flush();

  assert.deepEqual(plain(invoked), [{
    pluginId: "boatyard.gitWorktrees",
    actionName: "listForProject",
    payload: { sourcePath: "/workspace/example" }
  }]);
  assert.equal(findAllByClass(card, "git-worktrees-count")[0].textContent, "3");
  assert.equal(findAllByClass(card, "git-worktrees-row").length, 3);
  assert.deepEqual(
    findAllByClass(card, "git-worktrees-badge").map((badge) => badge.textContent),
    ["Current", "Detached", "Prunable"]
  );
  assert.equal(findAllByClass(card, "git-worktrees-summary")[0].hidden, true);

  await findAllByClass(card, "git-worktrees-path")[1].trigger("click");
  assert.deepEqual(copiedPaths, ["/workspace/example-widget"]);
});

export {};
