"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeBounds,
  normalizePaneLayoutNode,
  normalizePaneLayouts,
  normalizeWidgetLayout,
  normalizeWidgetLayouts,
  normalizeProjectWidgetPanes,
  normalizeProject,
  normalizeProjectUrls,
  normalizeNavigationState,
  normalizeOnboardingState,
  normalizePasswordVault,
  normalizeSettings,
  normalizeSlug,
  deriveRepoUrl,
  normalizeUrl,
  normalizeWebAppHomeTabs,
  normalizeWebAppState,
  normalizeWindowBounds,
  normalizeWindowState
} = require(`${process.cwd()}/build/main/store`);

test("normalizeUrl adds https and rejects unsupported schemes", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com/");
  assert.equal(normalizeUrl("localhost:5173"), "http://localhost:5173/");
  assert.equal(normalizeUrl("http://example.com/path"), "http://example.com/path");
  assert.throws(() => normalizeUrl("file:///tmp/test.html"), /Only http and https/);
});

test("normalizeSlug derives stable project slugs", () => {
  assert.equal(normalizeSlug("", "Boatyard App"), "boatyard-app");
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
    name: "Boatyard",
    sourcePath: "/tmp/boatyard",
    gitUrl: "git@github.com:owner/repo.git",
    previewUrl: "localhost:5173"
  }), {
    id: "project-id",
    slug: "boatyard",
    name: "Boatyard",
    group: "",
    sourcePath: "/tmp/boatyard",
    gitUrl: "git@github.com:owner/repo.git",
    repoUrl: "https://github.com/owner/repo",
    devBranch: "",
    terminalEnv: "",
    previewUrl: "http://localhost:5173/",
    urls: [],
    webAppHomeTabs: [],
    webAppOpenRules: [],
    widgetPanes: [{
      id: "widgets-0",
      label: "Widgets"
    }],
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
    name: "Boatyard",
    sourcePath: "/tmp/boatyard",
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

test("normalizeProjectWidgetPanes keeps named widget panes with stable ids", () => {
  assert.deepEqual(normalizeProjectWidgetPanes([
    {
      label: "Left widgets"
    },
    {
      id: "ops",
      label: "Ops"
    },
    {
      label: ""
    }
  ]), [
    {
      id: "left-widgets",
      label: "Left widgets"
    },
    {
      id: "ops",
      label: "Ops"
    }
  ]);

  assert.deepEqual(normalizeProjectWidgetPanes([]), [{
    id: "widgets-0",
    label: "Widgets"
  }]);
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
    blurWebAppOverlays: false,
    passwordManagerEnabled: false,
    passwordManagerDisclaimerAccepted: false,
    widgetRailWidth: 340,
    terminalEnv: "",
    webAppOpenRules: []
  });
  assert.deepEqual(normalizeSettings({
    projectsBasePath: "  /workspace/projects  ",
    blurWebAppOverlays: true,
    passwordManagerEnabled: true,
    passwordManagerDisclaimerAccepted: true,
    widgetRailWidth: 120,
    terminalEnv: "SSH_ASKPASS=\r\nSSH_ASKPASS_REQUIRE=never\n",
    webAppOpenRules: [
      {
        pattern: "*://accounts.example.com/*",
        target: "same-pane",
        scope: "url-pattern",
        label: "Accounts"
      },
      {
        pattern: "https://popup.example.com/*",
        target: "split-pane",
        scope: "url-pattern",
        label: "Popup"
      },
      {
        pattern: "repo",
        projectId: "project-alpha",
        sourcePaneId: "pane-alpha",
        target: "pane:pane-beta",
        scope: "source-app",
        label: "Pane rule"
      },
      {
        pattern: "https://ignored.example.com/*",
        target: "new-window",
        scope: "url-pattern"
      },
      {
        pattern: "legacy.example.com",
        target: "same-pane",
        scope: "host"
      }
    ]
  }), {
    projectsBasePath: "/workspace/projects",
    blurWebAppOverlays: true,
    passwordManagerEnabled: true,
    passwordManagerDisclaimerAccepted: true,
    widgetRailWidth: 240,
    terminalEnv: "SSH_ASKPASS=\nSSH_ASKPASS_REQUIRE=never",
    webAppOpenRules: [
      {
        pattern: "*://accounts.example.com/*",
        target: "same-pane",
        scope: "url-pattern",
        label: "Accounts"
      },
      {
        pattern: "https://popup.example.com/*",
        target: "split-pane",
        scope: "url-pattern",
        label: "Popup"
      },
      {
        pattern: "repo",
        projectId: "project-alpha",
        sourcePaneId: "pane-alpha",
        target: "pane:pane-beta",
        scope: "source-app",
        label: "Pane rule"
      }
    ]
  });
  assert.equal(normalizeSettings({
    passwordManagerEnabled: true,
    passwordManagerDisclaimerAccepted: false
  }).passwordManagerEnabled, false);
});

test("normalizeOnboardingState keeps completed tour metadata", () => {
  assert.deepEqual(normalizeOnboardingState(), {
    completedVersion: 0,
    completedAt: ""
  });
  assert.deepEqual(normalizeOnboardingState({
    completedVersion: 2.8,
    completedAt: "2026-06-19T10:11:12.000Z"
  }), {
    completedVersion: 2,
    completedAt: "2026-06-19T10:11:12.000Z"
  });
  assert.deepEqual(normalizeOnboardingState({
    completedVersion: -4,
    completedAt: "  done  "
  }), {
    completedVersion: 0,
    completedAt: "done"
  });
});

test("normalizePasswordVault keeps encrypted credentials by origin", () => {
  assert.deepEqual(normalizePasswordVault({
    "https://example.com": {
      username: " user@example.com ",
      encryptedPassword: " encrypted ",
      updatedAt: "2026-06-04T00:00:00.000Z"
    },
    "https://empty.test": {
      username: "",
      encryptedPassword: "encrypted"
    }
  }), {
    "https://example.com": {
      username: "user@example.com",
      encryptedPassword: "encrypted",
      updatedAt: "2026-06-04T00:00:00.000Z"
    }
  });
});

test("normalizeNavigationState keeps restorable app pages", () => {
  assert.deepEqual(normalizeNavigationState(), {
    view: "global",
    projectId: null,
    collapsedProjectGroups: [],
    pinnedProjectIds: []
  });
  assert.deepEqual(normalizeNavigationState({
    view: "project",
    projectId: " project-id ",
    collapsedProjectGroups: ["Raven"],
    pinnedProjectIds: [" project-id ", "project-id", ""]
  }), {
    view: "project",
    projectId: "project-id",
    collapsedProjectGroups: ["Raven"],
    pinnedProjectIds: ["project-id"]
  });
  assert.deepEqual(normalizeNavigationState({
    view: "project-create",
    projectId: "project-id"
  }), {
    view: "global",
    projectId: null,
    collapsedProjectGroups: [],
    pinnedProjectIds: []
  });
  assert.deepEqual(normalizeNavigationState({
    view: "project-edit"
  }), {
    view: "global",
    projectId: null,
    collapsedProjectGroups: [],
    pinnedProjectIds: []
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

test("normalizeWebAppHomeTabs keeps project scoped home tabs", () => {
  assert.deepEqual(normalizeWebAppHomeTabs({
    "project-id": [{
      id: " home:demo ",
      parentWebAppId: " hawser ",
      parentLabel: " Hawser ",
      label: " Localhost ",
      url: "localhost:60082/api/health"
    }, {
      id: "home:invalid",
      parentWebAppId: "hawser",
      label: "Invalid",
      url: "file:///workspace/example"
    }],
    "unknown-project": [{
      id: "home:ignored",
      parentWebAppId: "hawser",
      label: "Ignored",
      url: "example.com"
    }]
  }, [{ id: "project-id" }]), {
    "project-id": [{
      id: "home:demo",
      parentWebAppId: "hawser",
      parentLabel: "Hawser",
      label: "Localhost",
      url: "http://localhost:60082/api/health"
    }]
  });
});

test("normalizePaneLayoutNode clamps split ratios and keeps pane selections", () => {
  assert.deepEqual(normalizePaneLayoutNode({
    type: "split",
    id: "project:split:1",
    direction: "horizontal",
    ratio: 0.94,
    expandedChild: "first",
    first: {
      type: "pane",
      id: "project:pane:1",
      selectedWebAppId: "twicc"
    },
    second: {
      type: "pane",
      id: "project:pane:2",
      selectedWebAppId: "transient:health",
      transientWebApp: {
        id: " transient:health ",
        label: " Health ",
        parentLabel: " Hawser ",
        parentWebAppId: "boatyard.hawser",
        url: "http://localhost:60082/api/health"
      }
    }
  }), {
    type: "split",
    id: "project:split:1",
    direction: "horizontal",
    ratio: 0.85,
    expandedChild: "first",
    first: {
      type: "pane",
      id: "project:pane:1",
      selectedWebAppId: "twicc"
    },
    second: {
      type: "pane",
      id: "project:pane:2",
      selectedWebAppId: "transient:health",
      transientWebApp: {
        id: "transient:health",
        label: "Health",
        parentLabel: "Hawser",
        parentWebAppId: "boatyard.hawser",
        url: "http://localhost:60082/api/health"
      }
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
    order: ["project-summary", "", "project-shell", "project-summary", "widget-two", "widget-one"],
    hidden: ["discord", "", "discord", "widget-one"],
    sizes: {
      "project-summary": {
        columns: 2.4,
        rows: 1
      },
      "project-shell": {
        columns: 0,
        rows: "3"
      },
      "widget-two": {
        columns: 2,
        rows: 2
      },
      ignored: null
    },
    positions: {
      "project-summary": {
        x: 2.4,
        y: 1
      },
      "project-shell": {
        x: -3,
        y: "4"
      },
      "widget-one": {
        x: 1,
        y: 2
      },
      ignored: null
    },
    locked: false
  }), {
    order: ["project-summary", "project-shell", "widget-two", "widget-one"],
    hidden: ["discord", "widget-one"],
    sizes: {
      "project-summary": {
        columns: 2,
        rows: 1
      },
      "project-shell": {
        columns: 1,
        rows: 3
      },
      "widget-two": {
        columns: 2,
        rows: 2
      }
    },
    positions: {
      "project-summary": {
        x: 2,
        y: 1
      },
      "project-shell": {
        x: 0,
        y: 4
      },
      "widget-one": {
        x: 1,
        y: 2
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
      panes: {
        "widgets-0": {
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
      }
    }
  });
});
