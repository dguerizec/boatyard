"use strict";

export {};

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

type EventHandler = (...args: unknown[]) => unknown;

type FakeElement = {
  _listeners: Map<string, EventHandler[]>;
  attributes: Map<string, string>;
  children: FakeElement[];
  className: string;
  dataset: Record<string, string>;
  disabled: boolean;
  open: boolean;
  textContent: string;
  title?: string;
  type: string;
  addEventListener(name: string, handler: EventHandler): void;
  append(...children: FakeElement[]): void;
  getAttribute(name: string): string | null;
  replaceChildren(...children: FakeElement[]): void;
  setAttribute(name: string, value: unknown): void;
  trigger(name: string): Promise<void>;
};

type ResourcePane = {
  id: string;
  render(container: FakeElement): unknown;
};

function createFakeElement(): FakeElement {
  return {
    _listeners: new Map(),
    attributes: new Map(),
    children: [],
    className: "",
    dataset: {},
    disabled: false,
    open: false,
    textContent: "",
    type: "",
    addEventListener(name, handler) {
      this._listeners.set(name, [...(this._listeners.get(name) || []), handler]);
    },
    append(...children) {
      this.children.push(...children);
    },
    getAttribute(name) {
      return this.attributes.get(name) || null;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    async trigger(name) {
      for (const handler of this._listeners.get(name) || []) {
        await handler({ preventDefault() {} });
      }
    }
  };
}

function loadSystemResourcesRenderer(
  invokePlugin: (pluginId?: string, actionName?: string, payload?: unknown) => Promise<unknown>
) {
  const panes: ResourcePane[] = [];
  const services = new Map<string, Record<string, unknown>>();
  const intervals = new Map<number, () => void>();
  const timeouts: Array<() => void> = [];
  let nextIntervalId = 1;
  const context = {
    URL,
    document: {
      createElement: () => createFakeElement()
    },
    window: {
      boatyard: { invokePlugin },
      BoatyardPluginRegistry: {
        getService(id: string) {
          return services.get(id) || null;
        },
        listServices() {
          return [...services].map(([id]) => ({ id, pluginId: id }));
        },
        register(_manifest: unknown, plugin: { activate(context: unknown): void }) {
          plugin.activate({
            panes: {
              register(pane: ResourcePane) {
                panes.push(pane);
              }
            },
            services: {
              provide(id: string, service: Record<string, unknown>) {
                services.set(id, service);
              }
            }
          });
        }
      },
      clearInterval(intervalId: number) {
        intervals.delete(intervalId);
      },
      setInterval(callback: () => void) {
        const intervalId = nextIntervalId;
        nextIntervalId += 1;
        intervals.set(intervalId, callback);
        return intervalId;
      },
      setTimeout(callback: () => void) {
        timeouts.push(callback);
        return timeouts.length;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(`${process.cwd()}/build/plugins/system-resources/renderer.js`, "utf8"),
    context
  );
  return {
    panes,
    runStartupTasks() {
      for (const callback of timeouts.splice(0)) {
        callback();
      }
    },
    refreshIntervals() {
      for (const callback of intervals.values()) {
        callback();
      }
    }
  };
}

function findPane(panes: ResourcePane[], paneId: string, section: string) {
  const pane = panes.find((candidate) => candidate.id === paneId);
  if (!pane) {
    throw new Error(`System resources ${section} pane was not registered.`);
  }
  return pane;
}

function getTextContent(element: FakeElement): string[] {
  return [element.textContent, ...element.children.flatMap(getTextContent)];
}

function findByClass(element: FakeElement, className: string): FakeElement[] {
  return [
    ...(element.className.split(/\s+/).includes(className) ? [element] : []),
    ...element.children.flatMap((child) => findByClass(child, className))
  ];
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("system resources starts loading in the background after plugin activation", async () => {
  let invocationCount = 0;
  let resolveSnapshot: (snapshot: unknown) => void = () => {};
  const snapshotRequest = new Promise((resolve) => {
    resolveSnapshot = resolve;
  });
  const renderer = loadSystemResourcesRenderer(async () => {
    invocationCount += 1;
    return snapshotRequest;
  });

  assert.equal(invocationCount, 0);
  renderer.runStartupTasks();
  assert.equal(invocationCount, 1);

  const overview = findPane(renderer.panes, "boatyard.systemResources.pane", "overview");
  const container = createFakeElement();
  overview.render(container);
  assert.equal(invocationCount, 1);

  resolveSnapshot({
    sampledAt: new Date().toISOString(),
    supported: true,
    total: { estimatedBytes: 1024 }
  });
  await flush();
  assert.ok(getTextContent(container).includes("1.00 KiB"));
});

test("system resources sections keep content grid classes off the pane root", () => {
  const { panes } = loadSystemResourcesRenderer(async () => ({
    error: "Resource accounting is unavailable.",
    sampledAt: new Date().toISOString(),
    supported: false
  }));
  for (const [paneId, section] of [
    ["boatyard.systemResources.pane", "overview"],
    ["boatyard.systemResources.wcv", "wcv"],
    ["boatyard.systemResources.tmux", "tmux"]
  ]) {
    const pane = findPane(panes, paneId, section);
    const container = createFakeElement();

    pane.render(container);

    assert.equal(container.children[0].className, "system-resources-pane");
    assert.equal(container.children[0].dataset.section, section);
  }
});

test("web app resources use visual PSS shares and product language", async () => {
  const renderer = loadSystemResourcesRenderer(async () => ({
    sampledAt: "2026-08-13T12:00:00.000Z",
    supported: true,
    wcv: {
      count: 3,
      entries: [
        {
          key: "github",
          label: "GitHub",
          pid: 123,
          projectName: "Boatyard",
          pssBytes: 1536,
          rssBytes: 2048,
          sharedProcessViews: 2,
          url: "https://github.com/example/boatyard"
        },
        {
          key: "twicc",
          label: "Twicc",
          pid: 123,
          projectName: "Boatyard",
          pssBytes: 1536,
          rssBytes: 2048,
          sharedProcessViews: 2,
          url: "http://localhost:3000"
        },
        {
          key: "manual",
          label: "Manual",
          pid: 456,
          projectName: "Global workspace",
          pssBytes: 1024,
          rssBytes: 2048,
          sharedProcessViews: 1,
          url: "https://boatyard.dev"
        }
      ],
      processCount: 2,
      pssBytes: 4096,
      rssBytes: 6144
    }
  }));
  const webApps = findPane(renderer.panes, "boatyard.systemResources.wcv", "web apps");
  const container = createFakeElement();

  webApps.render(container);
  await flush();

  const text = getTextContent(container);
  assert.ok(text.includes("Web apps"));
  assert.ok(text.includes("Embedded web apps grouped by Boatyard project"));
  assert.ok(text.includes("2 web apps"));
  assert.ok(text.includes("github.com"));
  assert.ok(text.includes("PID 123"));
  assert.ok(text.includes("Shared ×2"));
  assert.equal(text.some((value) => /WCV|WebContentsView|renderer/i.test(value)), false);
  assert.deepEqual(
    findByClass(container, "system-resources-resource-group-summary")
      .flatMap((project) => findByClass(project, "system-resources-share-fill"))
      .map((fill) => fill.getAttribute("style")),
    ["width: 75.0%", "width: 25.0%"]
  );
  const projectShareTracks = findByClass(container, "system-resources-resource-group-summary")
    .flatMap((project) => findByClass(project, "system-resources-share-track"));
  assert.deepEqual(
    projectShareTracks.map((track) => [
      track.getAttribute("role"),
      track.getAttribute("aria-label"),
      track.getAttribute("aria-valuenow")
    ]),
    [
      ["progressbar", "Boatyard share of web app PSS", "75.0"],
      ["progressbar", "Global workspace share of web app PSS", "25.0"]
    ]
  );
  assert.deepEqual(
    findByClass(container, "system-resources-resource-item")
      .flatMap((row) => findByClass(row, "system-resources-share-fill"))
      .map((fill) => fill.getAttribute("style")),
    ["width: 50.0%", "width: 50.0%", "width: 100.0%"]
  );
  assert.equal(findByClass(container, "system-resources-resource-badge").length, 2);
  const groups = findByClass(container, "system-resources-resource-group");
  assert.deepEqual(groups.map((group) => group.open), [false, false]);

  groups[0].open = true;
  await groups[0].trigger("toggle");
  const remountedContainer = createFakeElement();
  webApps.render(remountedContainer);
  await flush();
  assert.equal(findByClass(remountedContainer, "system-resources-resource-group")[0].open, true);
});

test("system resources renders its cached snapshot immediately after remounting", async () => {
  let invocationCount = 0;
  let failRefresh = false;
  let resolveSnapshot: (snapshot: unknown) => void = () => {};
  const snapshotRequest = new Promise((resolve) => {
    resolveSnapshot = resolve;
  });
  const renderer = loadSystemResourcesRenderer(async () => {
    invocationCount += 1;
    if (failRefresh) {
      throw new Error("Refresh failed.");
    }
    return snapshotRequest;
  });
  const overview = findPane(renderer.panes, "boatyard.systemResources.pane", "overview");
  const firstContainer = createFakeElement();
  const cleanup = overview.render(firstContainer);
  assert.ok(getTextContent(firstContainer).includes("Measuring resources…"));

  resolveSnapshot({
    sampledAt: "2026-08-12T02:00:00.000Z",
    supported: true,
    total: { estimatedBytes: 1024 }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(getTextContent(firstContainer).includes("1.00 KiB"));
  assert.equal(typeof cleanup, "function");
  if (typeof cleanup === "function") {
    cleanup();
  }

  const remountedContainer = createFakeElement();
  overview.render(remountedContainer);

  assert.ok(getTextContent(remountedContainer).includes("1.00 KiB"));
  assert.equal(getTextContent(remountedContainer).includes("Measuring resources…"), false);
  assert.equal(invocationCount, 1);

  failRefresh = true;
  renderer.refreshIntervals();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(getTextContent(remountedContainer).includes("1.00 KiB"));
  assert.ok(getTextContent(remountedContainer).some((text) => text.endsWith(" · Refresh failed")));
  assert.equal(invocationCount, 2);
});

test("tmux details use compact visual project rows and omit transient client sessions", async () => {
  const renderer = loadSystemResourcesRenderer(async () => ({
    sampledAt: "2026-08-12T02:00:00.000Z",
    supported: true,
    tmux: {
      groupCount: 2,
      activeClientSessionCount: 1,
      groups: [
        {
          panes: [{ id: "%1", pid: 135505, processCount: 2, pssBytes: 1024, rssBytes: 2048 }],
          processCount: 2,
          projectName: "Boatyard",
          pssBytes: 1024,
          rssBytes: 2048,
          sessions: [
            { linked: false, name: "boatyard-boatyard", state: "primary" },
            { linked: true, name: "boatyard-boatyard-client-deadbeef", state: "stale" }
          ]
        },
        {
          panes: [
            { id: "%2", pid: 456, processCount: 2, pssBytes: 3072, rssBytes: 6144 },
            { id: "%3", pid: 789, processCount: 1, pssBytes: 1024, rssBytes: 2048 }
          ],
          processCount: 3,
          projectName: "Pickatube",
          pssBytes: 4096,
          rssBytes: 8192,
          sessions: [
            { linked: false, name: "boatyard-pickatube", state: "primary" },
            { linked: true, name: "boatyard-pickatube-client-active01", state: "active" },
            { linked: true, name: "boatyard-pickatube-client-linked01", state: "linked" },
            { linked: true, name: "boatyard-pickatube-client-starting01", state: "starting" }
          ]
        }
      ],
      paneCount: 3,
      pssBytes: 5120,
      rssBytes: 10240,
      sessionCount: 4,
      staleSessionCount: 1
    }
  }));
  const tmux = findPane(renderer.panes, "boatyard.systemResources.tmux", "tmux");
  const container = createFakeElement();

  tmux.render(container);
  await new Promise((resolve) => setImmediate(resolve));

  const text = getTextContent(container);
  assert.equal(text.includes("boatyard-boatyard"), false);
  assert.equal(text.includes("Project session"), false);
  assert.equal(text.includes("Primary project session"), false);
  assert.equal(text.includes("Attached clients"), false);
  assert.ok(text.includes("Stale sessions"));
  assert.ok(text.includes("Stale client session"));
  assert.equal(text.includes("boatyard-pickatube-client-active01"), false);
  assert.equal(text.includes("boatyard-pickatube-client-linked01"), false);
  assert.equal(text.includes("boatyard-pickatube-client-starting01"), false);
  assert.equal(text.includes("Linked client session"), false);
  assert.equal(text.includes("Starting"), false);
  assert.ok(text.includes("Term %1"));
  assert.ok(text.includes("PID 135505"));
  assert.ok(text.includes("2 processes"));
  assert.equal(text.includes("PID 135,505"), false);
  const projects = findByClass(container, "system-resources-resource-group");
  assert.equal(projects.length, 2);
  assert.deepEqual(projects.map((project) => project.open), [false, false]);
  assert.ok(getTextContent(projects[0]).includes("Pickatube"));
  assert.ok(getTextContent(projects[1]).includes("Boatyard"));
  assert.deepEqual(
    findByClass(container, "system-resources-resource-group-summary")
      .flatMap((summary) => findByClass(summary, "system-resources-share-fill"))
      .map((bar) => bar.getAttribute("style")),
    ["width: 80.0%", "width: 20.0%"]
  );
  assert.deepEqual(
    findByClass(container, "system-resources-resource-item")
      .flatMap((row) => findByClass(row, "system-resources-share-fill"))
      .map((bar) => bar.getAttribute("style")),
    ["width: 75.0%", "width: 25.0%", "width: 100.0%"]
  );
  assert.ok(text.includes("75% PSS"));
  assert.equal(findByClass(container, "system-resources-resource-item").length, 3);
  assert.equal(findByClass(container, "system-resources-resource-alert").length, 1);
});

test("tmux cleanup button removes stale sessions and keeps a visible report", async () => {
  const staleSessionName = "boatyard-alpha-client-deadbeef";
  let stale = true;
  let cleanupCalls = 0;
  const renderer = loadSystemResourcesRenderer(async (_pluginId, actionName) => {
    if (actionName === "cleanupStaleTmuxSessions") {
      cleanupCalls += 1;
      stale = false;
      return {
        completedAt: "2026-08-12T03:00:00.000Z",
        error: "",
        failed: [],
        mode: "manual",
        removedSessionNames: [staleSessionName]
      };
    }
    return {
      sampledAt: "2026-08-12T03:00:00.000Z",
      supported: true,
      tmux: {
        activeClientSessionCount: 0,
        cleanup: stale ? null : {
          completedAt: "2026-08-12T03:00:00.000Z",
          error: "",
          failed: [],
          mode: "manual",
          removedSessionNames: [staleSessionName]
        },
        groupCount: 1,
        groups: [{
          panes: [{ id: "%1", pid: 123 }],
          processCount: 2,
          projectName: "Alpha",
          pssBytes: 1024,
          rssBytes: 2048,
          sessions: stale
            ? [
                { linked: false, name: "boatyard-alpha", state: "primary" },
                { linked: true, name: staleSessionName, state: "stale" }
              ]
            : [{ linked: false, name: "boatyard-alpha", state: "primary" }]
        }],
        paneCount: 1,
        pssBytes: 1024,
        rssBytes: 2048,
        sessionCount: stale ? 2 : 1,
        staleSessionCount: stale ? 1 : 0
      }
    };
  });
  const tmux = findPane(renderer.panes, "boatyard.systemResources.tmux", "tmux");
  const container = createFakeElement();

  tmux.render(container);
  await flush();
  const cleanupButton = findByClass(container, "system-resources-cleanup")[0];
  assert.equal(cleanupButton.textContent, "Clean 1 stale");
  assert.equal(cleanupButton.disabled, false);

  await cleanupButton.trigger("click");
  await flush();
  await flush();

  assert.equal(cleanupCalls, 1);
  assert.equal(cleanupButton.textContent, "No stale sessions");
  assert.equal(cleanupButton.disabled, true);
  const text = getTextContent(container);
  assert.ok(text.includes("Manual cleanup removed 1 stale session"));
  assert.ok(text.includes(staleSessionName));
});
