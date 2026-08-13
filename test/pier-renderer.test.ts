"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { canReusePaneElement } = require(`${process.cwd()}/build/renderer/paneLayoutView`);
const { createPaneContributionsRefreshHandler } = require(`${process.cwd()}/build/renderer/rendererEventBindings`);
const { registerPluginRegistry } = require(`${process.cwd()}/build/renderer/pluginRegistry`);
const { registerWidgetRegistry } = require(`${process.cwd()}/build/renderer/widgetRegistry`);

type EventHandler = (...args: unknown[]) => unknown;

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  className = "";
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  href = "";
  isConnected = false;
  open = false;
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
    const handlers = this.listeners.get(name) || [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  append(...children: FakeElement[]) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  closest(selector: string): FakeElement | null {
    if (selector.startsWith(".") && this.classList.contains(selector.slice(1))) {
      return this;
    }
    return this.parentElement?.closest(selector) || null;
  }

  getAttribute(name: string) {
    return this.attributes.get(name) || null;
  }

  querySelectorAll<T extends FakeElement = FakeElement>(selector: string): T[] {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    return this.children.flatMap((child) => [
      ...(className && child.classList.contains(className) ? [child as T] : []),
      ...child.querySelectorAll<T>(selector)
    ]);
  }

  remove() {
    if (!this.parentElement) {
      return;
    }
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  replaceChildren(...children: FakeElement[]) {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children = [];
    this.append(...children);
  }

  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }

  async trigger(name: string, event: unknown = { preventDefault() {} }) {
    for (const handler of this.listeners.get(name) || []) {
      await handler(event);
    }
  }
}

function findAllByClass(root: FakeElement, className: string): FakeElement[] {
  return [
    ...(root.classList.contains(className) ? [root] : []),
    ...root.children.flatMap((child) => findAllByClass(child, className))
  ];
}

function getTextContent(root: FakeElement): string {
  return [root.textContent, ...root.children.map(getTextContent)].filter(Boolean).join(" ");
}

function createPierResourceRendererUi() {
  function element(_tagName: string, className = "", text = "") {
    const node = new FakeElement();
    node.className = className;
    node.textContent = text;
    return node;
  }

  function createStat(label: string, value: string, detail = "") {
    const stat = element("div", "system-resources-stat");
    stat.append(element("span", "", label), element("strong", "", value));
    if (detail) {
      stat.append(element("small", "", detail));
    }
    return stat;
  }

  function createShareBar(shareOptions: { label: string; total: unknown; unitLabel: string; value: unknown }) {
    const share = Number(shareOptions.total) > 0
      ? Math.min(100, (Number(shareOptions.value) / Number(shareOptions.total)) * 100)
      : 0;
    const indicator = element("div", "system-resources-share");
    const track = element("div", "system-resources-share-track");
    const fill = element("span", "system-resources-share-fill");
    fill.setAttribute("style", `width: ${share.toFixed(1)}%`);
    track.setAttribute("aria-label", shareOptions.label);
    track.setAttribute("aria-valuenow", share.toFixed(1));
    track.append(fill);
    indicator.append(track, element("small", "system-resources-share-value", `${Math.round(share)}% ${shareOptions.unitLabel}`));
    return indicator;
  }

  function createResourceMetrics(metrics: Array<{ label: string; tone?: string; value: string }> = []) {
    const values = element("div", "system-resources-resource-metrics");
    for (const metric of metrics) {
      values.append(element(
        "span",
        `system-resources-resource-metric is-${metric.tone || "default"}`,
        `${metric.label} ${metric.value}`
      ));
    }
    return values;
  }

  return {
    addError(container: FakeElement, message: unknown) {
      if (message) {
        container.append(element("p", "system-resources-error", String(message)));
      }
    },
    createCard(title: string, count: string, countLabel: string) {
      const card = element("section", "system-resources-card");
      const header = element("header", "system-resources-card-header", `${title} ${count} ${countLabel}`);
      const stats = element("div", "system-resources-card-stats");
      card.append(header, stats);
      return { card, header, stats };
    },
    createDetailGroup(title: string, subtitle: string, stats: FakeElement[]) {
      const group = element("section", "system-resources-detail-group");
      const header = element("header", "system-resources-detail-group-header");
      const heading = element("div", "system-resources-card-heading", `${title} ${subtitle}`);
      const metrics = element("div", "system-resources-detail-group-metrics");
      metrics.append(...stats);
      header.append(heading, metrics);
      const rows = element("div", "system-resources-detail-rows");
      group.append(header, rows);
      return { group, rows };
    },
    createDetailRow(title: string, subtitle: string, metrics: Array<{ label: string; value: string }>) {
      return element(
        "div",
        "system-resources-detail-row",
        `${title} ${subtitle} ${metrics.map((metric) => `${metric.label} ${metric.value}`).join(" ")}`
      );
    },
    createResourceGroup(options: {
      metrics?: Array<{ label: string; tone?: string; value: string }>;
      share: { label: string; total: unknown; unitLabel: string; value: unknown };
      stateKey: string;
      subtitle?: string;
      title: string;
    }) {
      const group = element("details", "system-resources-resource-group");
      const summary = element("summary", "system-resources-resource-group-summary", `${options.title} ${options.subtitle || ""}`);
      summary.append(createShareBar(options.share), createResourceMetrics(options.metrics));
      const rows = element("div", "system-resources-resource-rows");
      group.append(summary, rows);
      return { group, rows };
    },
    createResourceItem(options: {
      badges?: Array<{ label: string }>;
      metadata?: string[];
      metrics?: Array<{ label: string; tone?: string; value: string }>;
      share: { label: string; total: unknown; unitLabel: string; value: unknown };
      title: string;
    }) {
      const row = element("div", "system-resources-resource-item", [options.title, ...(options.metadata || [])].join(" "));
      for (const badge of options.badges || []) {
        row.append(element("small", "system-resources-resource-badge", badge.label));
      }
      row.append(createShareBar(options.share), createResourceMetrics(options.metrics));
      return row;
    },
    createResourceList() {
      return element("div", "system-resources-resource-list");
    },
    createShareBar,
    createStat,
    element,
    formatCount(value: unknown) {
      return String(Number(value) || 0);
    },
    formatMemory(value: unknown) {
      return `${Number(value) || 0} B`;
    }
  };
}

function loadPierResourceRendererProvider() {
  const CustomEvent = class {
    detail: unknown;
    type: string;

    constructor(type: string, init: { detail?: unknown } = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  const context = {
    CustomEvent,
    HTMLDivElement: FakeElement,
    URL,
    clearInterval: () => {},
    console,
    document: {
      body: new FakeElement(),
      createElement: () => new FakeElement()
    },
    fetch: async () => ({ ok: true, json: async () => [] }),
    setInterval: () => 1,
    window: {
      CustomEvent,
      boatyard: {
        invokePlugin: async () => null,
        openExternal: () => {},
        updateProjectPluginConfig: async () => ({}),
        writeClipboardText: async () => {}
      },
      clearInterval: () => {},
      dispatchEvent: () => true,
      setInterval: () => 1
    } as Record<string, unknown>
  };
  context.window.window = context.window;
  registerWidgetRegistry(context.window);
  const registry = registerPluginRegistry(context.window);
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(`${process.cwd()}/build/plugins/pier/renderer.js`, "utf8"),
    context
  );
  registry.applyEnabledState({});
  return registry.getService("boatyard.pier.systemResources") as {
    renderDetails(content: FakeElement, snapshot: unknown, ui: unknown): void;
  };
}

function plain(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("Pier widget uses one entry-point selector for every worktree and persists pane choices", async () => {
  const project = {
    id: "project-id",
    slug: "pickatube",
    sourcePath: "/workspace/pickatube"
  };
  const persistedPatches: Array<Record<string, unknown>> = [];
  const body = new FakeElement();
  const CustomEvent = class {
    detail: unknown;
    type: string;

    constructor(type: string, init: { detail?: unknown } = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  const worktrees = ["develop", "playlist"].map((slug) => ({
    path: `/workspace/pickatube/worktrees/${slug}`,
    slug,
    branch: slug,
    has_workload: true,
    workload: {
      project: "pickatube",
      slug,
      status: "running",
      urls: [
        {
          url: `http://${slug}.pickatube.test`,
          label: `${slug}.pickatube.test`,
          default: true
        },
        {
          url: `http://admin.${slug}.pickatube.test`,
          label: `admin.${slug}.pickatube.test`
        }
      ],
      worktree_path: `/workspace/pickatube/worktrees/${slug}`
    }
  }));
  const context = {
    CustomEvent,
    HTMLDivElement: FakeElement,
    URL,
    clearInterval: () => {},
    console,
    document: {
      body,
      createElement: () => new FakeElement()
    },
    fetch: async (url: unknown) => {
      if (String(url).endsWith("/api/v1/projects")) {
        return {
          ok: true,
          json: async () => [{ name: "pickatube", repo_path: "/workspace/pickatube" }]
        };
      }
      if (String(url).endsWith("/api/v1/projects/pickatube/worktrees")) {
        return { ok: true, json: async () => worktrees };
      }
      throw new Error(`Unexpected URL ${url}`);
    },
    setInterval: () => 1,
    window: {
      CustomEvent,
      boatyard: {
        invokePlugin: async () => null,
        openExternal: () => {},
        updateProjectPluginConfig: async (projectId: string, pluginId: string, patch: Record<string, unknown>) => {
          assert.equal(projectId, project.id);
          assert.equal(pluginId, "boatyard.pier");
          persistedPatches.push(patch);
          return {};
        },
        writeClipboardText: async () => {}
      },
      clearInterval: () => {},
      dispatchEvent: () => true,
      setInterval: () => 1
    } as Record<string, unknown>
  };
  context.window.window = context.window;
  registerWidgetRegistry(context.window);
  registerPluginRegistry(context.window);
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(`${process.cwd()}/build/plugins/pier/renderer.js`, "utf8"),
    context
  );

  const pluginRegistry = context.window.BoatyardPluginRegistry as {
    applyEnabledState(config: unknown): void;
    listPanes(filter: unknown): Array<{ id: string; resolveWebApps(context: unknown): unknown[] }>;
  };
  const widgetRegistry = context.window.BoatyardWidgetRegistry as {
    get(id: string): {
      createElement(project: Record<string, unknown>, props: Record<string, unknown>): FakeElement;
    };
  };
  pluginRegistry.applyEnabledState({});
  const card = widgetRegistry.get("boatyard.pier.urls").createElement(project, {
    globalPluginConfig: {},
    pluginConfig: {},
    projectId: project.id
  });

  await flush();
  await flush();

  assert.equal(findAllByClass(card, "pier-entry-point-selector").length, 1);
  assert.equal(findAllByClass(card, "pier-entry-point-button").length, 2);
  assert.equal(findAllByClass(card, "pier-url-row").length, 2);
  const buttons = findAllByClass(card, "pier-entry-point-button");
  assert.deepEqual(buttons.map((button) => button.textContent), ["Default", "Admin"]);
  assert.deepEqual(buttons.map((button) => button.getAttribute("aria-pressed")), ["true", "false"]);

  const pane = pluginRegistry
    .listPanes({ scope: "project", kind: "wcv" })
    .find((candidate) => candidate.id === "boatyard.pier.preview");
  if (!pane) {
    throw new Error("Pier pane was not registered.");
  }
  assert.equal(pane.resolveWebApps({ project, projectConfig: {}, globalPluginConfig: {} }).length, 3);

  await buttons[1].trigger("click");

  assert.deepEqual(plain(persistedPatches), [{ pierEnabledEntryPoints: "[\"default\",\"admin\"]" }]);
  const updatedButtons = findAllByClass(card, "pier-entry-point-button");
  assert.deepEqual(updatedButtons.map((button) => button.getAttribute("aria-pressed")), ["true", "true"]);
  assert.deepEqual(
    plain(pane.resolveWebApps({ project, projectConfig: {}, globalPluginConfig: {} })).map(
      (webApp: { id: string }) => webApp.id
    ),
    ["pier", "pier:develop", "pier:develop:admin", "pier:playlist", "pier:playlist:admin"]
  );
});

test("Pier resource details visualize project and workload memory shares", () => {
  const provider = loadPierResourceRendererProvider();
  const content = new FakeElement();
  const ui = createPierResourceRendererUi();

  provider.renderDetails(content, {
    data: {
      containerCount: 4,
      memoryBytes: 100,
      workloads: [{}, {}, {}],
      projects: [
        {
          containerCount: 1,
          memoryBytes: 20,
          pierProject: "eclipse",
          projectName: "Eclipse",
          workloads: [{ containerCount: 1, memoryBytes: 20, slug: "main" }]
        },
        {
          containerCount: 3,
          memoryBytes: 80,
          pierProject: "pickatube",
          projectName: "Pickatube",
          workloads: [
            { containerCount: 1, memoryBytes: 20, slug: "develop" },
            { containerCount: 2, memoryBytes: 60, slug: "pubdev" }
          ]
        }
      ]
    }
  }, ui);

  const projects = findAllByClass(content, "system-resources-resource-group");
  assert.equal(projects.length, 2);
  assert.equal(projects[0].open, false);
  assert.equal(projects[1].open, false);
  assert.ok(getTextContent(projects[0]).includes("Pickatube"));
  assert.ok(getTextContent(projects[1]).includes("Eclipse"));
  const firstProjectRows = findAllByClass(projects[0], "system-resources-resource-item");
  assert.ok(getTextContent(firstProjectRows[0]).includes("pubdev"));
  assert.ok(getTextContent(firstProjectRows[1]).includes("develop"));
  assert.deepEqual(
    findAllByClass(projects[0], "system-resources-share-fill").map((fill) => fill.getAttribute("style")),
    ["width: 80.0%", "width: 75.0%", "width: 25.0%"]
  );
  assert.deepEqual(
    findAllByClass(projects[0], "system-resources-share-track").map((track) => track.getAttribute("aria-valuenow")),
    ["80.0", "75.0", "25.0"]
  );
  assert.equal(findAllByClass(content, "system-resources-resource-badge").length, 3);
  assert.equal(findAllByClass(content, "pier-resource-stat").length, 0);
});

test("Pier menu changes preserve mounted Terminal and TwiCC pane contents", () => {
  for (const webAppKind of ["terminal", "dom"]) {
    const current = {
      mobileDev: "false",
      webAppId: webAppKind === "terminal" ? "terminal" : "twicc-session-flow",
      webAppKind,
      webAppMenuSignature: "before"
    };
    const next = {
      ...current,
      webAppMenuSignature: "after"
    };

    assert.equal(canReusePaneElement(current, next), false);
    assert.equal(canReusePaneElement(current, next, { allowWebAppMenuChanges: true }), true);
    assert.equal(canReusePaneElement(current, {
      ...next,
      webAppId: "pier:develop:admin"
    }, { allowWebAppMenuChanges: true }), false);
  }
});

test("Pane contribution changes schedule one pane-preserving update", () => {
  const project = { id: "project-id", slug: "pickatube" };
  const frames: FrameRequestCallback[] = [];
  const renders: Array<{ options: Record<string, unknown>; project: unknown }> = [];
  let currentView = "project";
  const refresh = createPaneContributionsRefreshHandler({
    getCurrentProject: () => project,
    getCurrentView: () => currentView,
    renderPaneLayoutPreservingPanes: (renderedProject: unknown, options: Record<string, unknown>) => {
      renders.push({ options, project: renderedProject });
    },
    requestFrame: (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }
  });

  refresh();
  refresh();
  assert.equal(frames.length, 1);
  assert.equal(renders.length, 0);

  frames[0](0);
  assert.deepEqual(renders, [{
    options: { allowWebAppMenuChanges: true },
    project
  }]);

  currentView = "global";
  refresh();
  assert.equal(frames.length, 1);

  currentView = "project";
  refresh({ detail: { projectId: "another-project" } } as unknown as Event);
  assert.equal(frames.length, 1);
});

export {};
