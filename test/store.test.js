"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ProjectStore,
  DEFAULT_TWICC_URL,
  normalizeBounds,
  normalizePaneLayoutNode,
  normalizePaneLayouts,
  normalizeWidgetLayout,
  normalizeWidgetLayouts,
  normalizeProject,
  normalizeProjectUrls,
  normalizeNavigationState,
  normalizeSettings,
  normalizeSlug,
  deriveRepoUrl,
  normalizeUrl,
  normalizeWebAppState,
  normalizeWindowBounds,
  normalizeWindowState
} = require("../src/main/store");

test("normalizeUrl adds https and rejects unsupported schemes", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com/");
  assert.equal(normalizeUrl("localhost:5173"), "http://localhost:5173/");
  assert.equal(normalizeUrl("http://example.com/path"), "http://example.com/path");
  assert.throws(() => normalizeUrl("file:///tmp/test.html"), /Only http and https/);
});

test("normalizeSlug derives stable project slugs", () => {
  assert.equal(normalizeSlug("", "DashTop App"), "dashtop-app");
  assert.equal(normalizeSlug("Pier_Main", "Fallback"), "pier-main");
  assert.throws(() => normalizeSlug("", ""), /Slug is required/);
});

test("deriveRepoUrl converts git remotes to browser urls", () => {
  assert.equal(deriveRepoUrl("git@github.com:owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(deriveRepoUrl("https://github.com/owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(deriveRepoUrl("ssh://git@github.com/owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(deriveRepoUrl(""), "");
});

test("normalizeProject derives project tool defaults", () => {
  assert.deepEqual(normalizeProject({
    id: "project-id",
    name: "DashTop",
    sourcePath: "/tmp/dashtop",
    gitUrl: "git@github.com:owner/repo.git",
    previewUrl: "localhost:5173"
  }), {
    id: "project-id",
    slug: "dashtop",
    name: "DashTop",
    sourcePath: "/tmp/dashtop",
    gitUrl: "git@github.com:owner/repo.git",
    repoUrl: "https://github.com/owner/repo",
    devBranch: "",
    previewUrl: "http://localhost:5173/",
    twiccUrl: normalizeUrl(DEFAULT_TWICC_URL),
    hawserMainSession: "dashtop:main",
    urls: [],
    bounds: {
      x: 48,
      y: 92,
      width: 720,
      height: 460
    },
    isOpen: true
  });
});

test("normalizeProject keeps explicit repo urls", () => {
  assert.equal(normalizeProject({
    id: "project-id",
    name: "DashTop",
    sourcePath: "/tmp/dashtop",
    gitUrl: "git@github.com:owner/repo.git",
    repoUrl: "https://github.com/owner/repo/tree/main/src/renderer"
  }).repoUrl, "https://github.com/owner/repo/tree/main/src/renderer");
});

test("normalizeProjectUrls keeps provider urls with stable ids", () => {
  assert.deepEqual(normalizeProjectUrls([
    {
      label: "Cloudflare",
      url: "dash.cloudflare.com"
    },
    {
      id: "github-secrets",
      label: "GitHub secrets",
      url: "https://github.com/owner/repo/settings/secrets/actions"
    },
    {
      label: "",
      url: ""
    }
  ]), [
    {
      id: "cloudflare",
      label: "Cloudflare",
      url: "https://dash.cloudflare.com/"
    },
    {
      id: "github-secrets",
      label: "GitHub secrets",
      url: "https://github.com/owner/repo/settings/secrets/actions"
    }
  ]);

  assert.throws(() => normalizeProjectUrls([{ label: "DNS", url: "" }]), /URL is required/);
  assert.throws(() => normalizeProjectUrls([{ label: "", url: "example.com" }]), /URL label is required/);
});

test("normalizeBounds clamps dimensions", () => {
  assert.deepEqual(normalizeBounds({ x: -10, y: -4, width: 8, height: 9 }), {
    x: 0,
    y: 0,
    width: 260,
    height: 200
  });
});

test("normalizeWindowBounds preserves position and enforces app minimum size", () => {
  assert.deepEqual(normalizeWindowBounds({ x: 120, y: 80, width: 500, height: 400 }), {
    x: 120,
    y: 80,
    width: 920,
    height: 620
  });
});

test("normalizeWindowState keeps maximized state", () => {
  assert.deepEqual(normalizeWindowState({
    bounds: {
      x: 12,
      y: 34,
      width: 1440,
      height: 900
    },
    isMaximized: true
  }), {
    bounds: {
      x: 12,
      y: 34,
      width: 1440,
      height: 900
    },
    isMaximized: true
  });
});

test("normalizeSettings keeps global settings defaults", () => {
  assert.deepEqual(normalizeSettings(), {
    projectsBasePath: "",
    blurWebAppOverlays: true,
    widgetRailWidth: 340
  });
  assert.deepEqual(normalizeSettings({
    projectsBasePath: "  /workspace/projects  ",
    blurWebAppOverlays: false,
    widgetRailWidth: 120
  }), {
    projectsBasePath: "/workspace/projects",
    blurWebAppOverlays: false,
    widgetRailWidth: 240
  });
});

test("normalizeNavigationState keeps restorable app pages", () => {
  assert.deepEqual(normalizeNavigationState(), {
    view: "global",
    projectId: null
  });
  assert.deepEqual(normalizeNavigationState({
    view: "project",
    projectId: " project-id "
  }), {
    view: "project",
    projectId: "project-id"
  });
  assert.deepEqual(normalizeNavigationState({
    view: "project-create",
    projectId: "project-id"
  }), {
    view: "global",
    projectId: null
  });
  assert.deepEqual(normalizeNavigationState({
    view: "project-edit"
  }), {
    view: "global",
    projectId: null
  });
});

test("normalizeWebAppState keeps valid urls and drops invalid urls", () => {
  assert.deepEqual(normalizeWebAppState({
    "project:twicc": {
      url: "http://localhost:3500/projects/example"
    },
    "project:file": {
      url: "file:///tmp/example.html"
    },
    "project:empty": {
      url: ""
    }
  }), {
    "project:twicc": {
      url: "http://localhost:3500/projects/example"
    }
  });
});

test("normalizePaneLayoutNode clamps split ratios and keeps pane selections", () => {
  assert.deepEqual(normalizePaneLayoutNode({
    type: "split",
    id: "project:split:1",
    direction: "horizontal",
    ratio: 0.94,
    first: {
      type: "pane",
      id: "project:pane:1",
      selectedWebAppId: "twicc"
    },
    second: {
      type: "pane",
      id: "project:pane:2",
      selectedWebAppId: "preview"
    }
  }), {
    type: "split",
    id: "project:split:1",
    direction: "horizontal",
    ratio: 0.85,
    first: {
      type: "pane",
      id: "project:pane:1",
      selectedWebAppId: "twicc"
    },
    second: {
      type: "pane",
      id: "project:pane:2",
      selectedWebAppId: "preview"
    }
  });
});

test("normalizePaneLayouts drops invalid layouts", () => {
  assert.deepEqual(normalizePaneLayouts({
    ok: {
      type: "pane",
      id: "ok:pane:1"
    },
    invalid: {
      type: "split",
      id: "invalid:split:1",
      first: {
        type: "pane",
        id: ""
      },
      second: {
        type: "pane",
        id: "invalid:pane:2"
      }
    }
  }), {
    ok: {
      type: "pane",
      id: "ok:pane:1"
    }
  });
});

test("normalizeWidgetLayout keeps order unique and defaults locked", () => {
  assert.deepEqual(normalizeWidgetLayout({
    order: ["project-summary", "", "twicc-sessions", "project-summary"],
    hidden: ["discord", "", "discord"],
    sizes: {
      "project-summary": {
        columns: 2.4,
        rows: 1
      },
      "twicc-sessions": {
        columns: 0,
        rows: "3"
      },
      ignored: null
    },
    positions: {
      "project-summary": {
        x: 2.4,
        y: 1
      },
      "twicc-sessions": {
        x: -3,
        y: "4"
      },
      ignored: null
    },
    locked: false
  }), {
    order: ["project-summary", "twicc-sessions"],
    hidden: ["discord"],
    sizes: {
      "project-summary": {
        columns: 2,
        rows: 1
      },
      "twicc-sessions": {
        columns: 1,
        rows: 3
      }
    },
    positions: {
      "project-summary": {
        x: 2,
        y: 1
      },
      "twicc-sessions": {
        x: 0,
        y: 4
      }
    },
    locked: false
  });

  assert.deepEqual(normalizeWidgetLayout(), {
    order: [],
    hidden: [],
    sizes: {},
    positions: {},
    locked: true
  });
});

test("normalizeWidgetLayouts drops invalid containers", () => {
  assert.deepEqual(normalizeWidgetLayouts(null), {});
  assert.deepEqual(normalizeWidgetLayouts({
    "project-id": {
      order: ["discord"],
      sizes: {
        discord: {
          columns: 1,
          rows: 2
        }
      },
      positions: {
        discord: {
          x: 1,
          y: 2
        }
      },
      locked: false
    }
  }), {
    "project-id": {
      order: ["discord"],
      hidden: [],
      sizes: {
        discord: {
          columns: 1,
          rows: 2
        }
      },
      positions: {
        discord: {
          x: 1,
          y: 2
        }
      },
      locked: false
    }
  });
});

test("ProjectStore persists configured projects", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const state = store.addProject({
    name: "Status",
    url: "status.example.com"
  });

  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].name, "Status");
  assert.equal(state.projects[0].slug, "status");
  assert.equal(state.projects[0].previewUrl, "https://status.example.com/");
  assert.equal(state.projects[0].twiccUrl, normalizeUrl(DEFAULT_TWICC_URL));
  assert.equal(state.projects[0].hawserMainSession, "status:main");

  const reloaded = new ProjectStore(filePath);
  const reloadedState = reloaded.load();
  assert.deepEqual(reloadedState, state);
});

test("ProjectStore persists window state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const state = store.updateWindowState({
    bounds: {
      x: 140,
      y: 96,
      width: 1360,
      height: 860
    },
    isMaximized: true
  });

  assert.deepEqual(state, {
    bounds: {
      x: 140,
      y: 96,
      width: 1360,
      height: 860
    },
    isMaximized: true
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().window, state);
});

test("ProjectStore persists global settings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const state = store.updateSettings({
    projectsBasePath: "/workspace/projects",
    blurWebAppOverlays: false
  });

  assert.deepEqual(state.settings, {
    projectsBasePath: "/workspace/projects",
    blurWebAppOverlays: false,
    widgetRailWidth: 340
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().settings, state.settings);
});

test("ProjectStore persists navigation and clears removed active projects", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const state = store.addProject({
    name: "Project",
    sourcePath: "/tmp/project"
  });
  const projectId = state.projects[0].id;
  const navigation = store.updateNavigation({
    view: "project",
    projectId
  });

  assert.deepEqual(navigation, {
    view: "project",
    projectId
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().navigation, navigation);

  const removed = reloaded.removeProject(projectId);
  assert.deepEqual(removed.navigation, {
    view: "global",
    projectId: null
  });
});

test("ProjectStore persists webapp urls", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  store.updateWebAppState("project:twicc", {
    url: "http://localhost:3500/projects/demo/sessions/123"
  });

  const reloaded = new ProjectStore(filePath);
  const state = reloaded.load();

  assert.equal(
    state.webApps["project:twicc"].url,
    "http://localhost:3500/projects/demo/sessions/123"
  );
  assert.equal(
    reloaded.getWebAppUrl("project:twicc"),
    "http://localhost:3500/projects/demo/sessions/123"
  );
});

test("ProjectStore persists pane layouts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const layout = store.updatePaneLayout("project-id", {
    type: "split",
    id: "project-id:split:1",
    direction: "vertical",
    ratio: 0.35,
    first: {
      type: "pane",
      id: "project-id:pane:1",
      selectedWebAppId: "twicc"
    },
    second: {
      type: "pane",
      id: "project-id:pane:2",
      selectedWebAppId: "preview"
    }
  });

  const reloaded = new ProjectStore(filePath);
  const state = reloaded.load();

  assert.deepEqual(state.paneLayouts["project-id"], layout);
  assert.deepEqual(reloaded.getPaneLayout("project-id"), layout);
});

test("ProjectStore persists widget layouts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const layout = store.updateWidgetLayout("project-id", {
    order: ["twicc-sessions", "project-summary", "twicc-sessions"],
    hidden: ["discord", "discord"],
    sizes: {
      "twicc-sessions": {
        columns: 2,
        rows: 3
      }
    },
    positions: {
      "twicc-sessions": {
        x: 1,
        y: 2
      }
    },
    locked: false
  });

  const reloaded = new ProjectStore(filePath);
  const state = reloaded.load();

  assert.deepEqual(layout, {
    order: ["twicc-sessions", "project-summary"],
    hidden: ["discord"],
    sizes: {
      "twicc-sessions": {
        columns: 2,
        rows: 3
      }
    },
    positions: {
      "twicc-sessions": {
        x: 1,
        y: 2
      }
    },
    locked: false
  });
  assert.deepEqual(state.widgetLayouts["project-id"], layout);
  assert.deepEqual(reloaded.getWidgetLayout("project-id"), layout);
});

test("ProjectStore reorders projects", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  store.addProject({
    name: "First",
    sourcePath: "/tmp/first"
  });
  store.addProject({
    name: "Second",
    sourcePath: "/tmp/second"
  });
  store.addProject({
    name: "Third",
    sourcePath: "/tmp/third"
  });

  const ids = store.getState().projects.map((project) => project.id);
  const reordered = store.reorderProjects([ids[2], ids[0], ids[1]]);

  assert.deepEqual(reordered.projects.map((project) => project.name), ["Third", "First", "Second"]);

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().projects.map((project) => project.name), ["Third", "First", "Second"]);
});

test("ProjectStore persists project updates and removals", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const state = store.addProject({
    name: "Project",
    sourcePath: "/tmp/project",
    previewUrl: "project.example.test",
    urls: [{
      label: "Cloudflare",
      url: "dash.cloudflare.com"
    }]
  });
  const id = state.projects[0].id;
  store.updateWebAppState(`${id}:twicc`, {
    url: "http://localhost:3500/projects/demo"
  });
  store.updatePaneLayout(id, {
    type: "pane",
    id: `${id}:pane:1`,
    selectedWebAppId: "twicc"
  });
  store.updateWidgetLayout(id, {
    order: ["discord", "project-summary"],
    locked: false
  });

  const moved = store.updateProject(id, {
    bounds: {
      x: 42,
      y: 24,
      width: 640,
      height: 420
    },
    isOpen: false
  });

  assert.deepEqual(moved.projects[0].urls, [{
    id: "cloudflare",
    label: "Cloudflare",
    url: "https://dash.cloudflare.com/"
  }]);

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load(), moved);

  const removed = reloaded.removeProject(id);
  assert.equal(removed.webApps[`${id}:twicc`], undefined);
  assert.equal(removed.paneLayouts[id], undefined);
  assert.equal(removed.widgetLayouts[id], undefined);
  const reloadedAgain = new ProjectStore(filePath);
  assert.deepEqual(reloadedAgain.load(), removed);
});

test("ProjectStore migrates legacy apps state to projects", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({
    apps: [{
      id: "legacy-id",
      name: "Legacy",
      url: "legacy.example.test"
    }]
  }));

  const store = new ProjectStore(filePath);
  const state = store.load();

  assert.deepEqual(state.projects.map((project) => project.id), ["legacy-id"]);
  assert.equal(state.projects[0].slug, "legacy");
  assert.equal(state.projects[0].previewUrl, "https://legacy.example.test/");
  assert.equal(state.projects[0].twiccUrl, normalizeUrl(DEFAULT_TWICC_URL));
  assert.equal(state.projects[0].hawserMainSession, "legacy:main");
});
