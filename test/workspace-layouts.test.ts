"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  captureWorkspaceLayoutPane,
  instantiateWorkspaceLayout,
  resolveWorkspaceLayoutAspectRatio
} = require(`${process.cwd()}/build/renderer/workspaceLayouts`);
const {
  resolveWorkspaceLayoutSaveScope
} = require(`${process.cwd()}/build/renderer/workspaceLayoutPicker`);
const { createProjectWebApps } = require(`${process.cwd()}/build/renderer/projectWebApps`);

function createIds() {
  let next = 0;
  return (prefix: string) => `${prefix}-${++next}`;
}

test("workspace layout capture keeps only geometry and master pane types", () => {
  const runtime = {
    type: "split",
    id: "runtime-split",
    direction: "vertical",
    ratio: 0.7,
    expandedChild: "first",
    first: {
      type: "pane",
      id: "runtime-pier",
      selectedWebAppId: "pier:feature:admin",
      transientWebApp: { url: "https://feature.example.test" }
    },
    second: {
      type: "pane",
      id: "runtime-url",
      selectedWebAppId: "url:documentation"
    }
  };

  const captured = captureWorkspaceLayoutPane(runtime, (pane: { id: string }) => (
    pane.id === "runtime-pier" ? "pier" : null
  ), createIds());

  assert.deepEqual(captured, {
    type: "split",
    id: "layout-split-1",
    direction: "vertical",
    ratio: 0.7,
    first: { type: "pane", id: "layout-pane-2", paneTypeId: "pier" },
    second: { type: "pane", id: "layout-pane-3", paneTypeId: null }
  });
});

test("workspace layout instantiation resolves project defaults and leaves missing types empty", () => {
  const paneLayout = instantiateWorkspaceLayout({
    id: "development",
    name: "Development",
    paneLayout: {
      type: "split",
      id: "template-split",
      direction: "horizontal",
      ratio: 0.55,
      first: { type: "pane", id: "template-pier", paneTypeId: "pier" },
      second: { type: "pane", id: "template-git", paneTypeId: "git" }
    }
  }, {
    createId: createIds(),
    resolveCurrentPaneType: () => null,
    resolveDefaultPaneType: (paneTypeId: string) => paneTypeId === "pier" ? "pier" : null
  });

  assert.deepEqual(paneLayout, {
    type: "split",
    id: "split-1",
    direction: "horizontal",
    ratio: 0.55,
    first: { type: "pane", id: "pane-2", selectedWebAppId: "pier" },
    second: { type: "pane", id: "pane-3", selectedWebAppId: "empty" }
  });
});

test("workspace layout restoration moves matching panes without resetting their active webapps", () => {
  const currentLayout = {
    type: "split",
    id: "current-split",
    direction: "vertical",
    ratio: 0.4,
    first: {
      type: "pane",
      id: "current-twicc",
      selectedWebAppId: "twicc:session:active",
      transientWebApp: {
        id: "twicc:session:active",
        label: "Active session",
        url: "https://twicc.example.test/sessions/active"
      },
      expansion: { active: true, paneIds: ["current-twicc", "current-pier"] }
    },
    second: {
      type: "pane",
      id: "current-pier",
      selectedWebAppId: "pier:feature:admin"
    }
  };
  const restored = instantiateWorkspaceLayout({
    id: "reordered",
    name: "Reordered",
    paneLayout: {
      type: "split",
      id: "template-root",
      direction: "horizontal",
      ratio: 0.6,
      first: { type: "pane", id: "template-pier", paneTypeId: "pier" },
      second: {
        type: "split",
        id: "template-side",
        direction: "vertical",
        ratio: 0.7,
        first: { type: "pane", id: "template-twicc", paneTypeId: "twicc-plugin" },
        second: { type: "pane", id: "template-terminal", paneTypeId: "terminal" }
      }
    }
  }, {
    createId: createIds(),
    currentLayout,
    resolveCurrentPaneType: (pane: { id: string }) => (
      pane.id === "current-twicc" ? "twicc-plugin" : "pier"
    ),
    resolveCurrentWebAppId: (pane: { selectedWebAppId?: string }) => pane.selectedWebAppId,
    resolveDefaultPaneType: (paneTypeId: string) => paneTypeId
  });

  assert.deepEqual(restored, {
    type: "split",
    id: "split-1",
    direction: "horizontal",
    ratio: 0.6,
    first: {
      type: "pane",
      id: "current-pier",
      selectedWebAppId: "pier:feature:admin"
    },
    second: {
      type: "split",
      id: "split-2",
      direction: "vertical",
      ratio: 0.7,
      first: {
        type: "pane",
        id: "current-twicc",
        selectedWebAppId: "twicc:session:active",
        transientWebApp: {
          id: "twicc:session:active",
          label: "Active session",
          url: "https://twicc.example.test/sessions/active"
        }
      },
      second: {
        type: "pane",
        id: "pane-3",
        selectedWebAppId: "terminal"
      }
    }
  });
});

test("dynamic provider entries inherit their master pane type", () => {
  const runtime = createProjectWebApps({
    findPaneNode: () => null,
    getGlobalPluginConfig: () => ({}),
    getPaneLayout: () => ({ type: "pane", id: "pane" }),
    getPluginPaneDefinitions: (filter: { kind?: string }) => filter.kind === "wcv" ? [{
      icon: "anchor",
      key: "pier",
      kind: "wcv",
      paneTypeId: "pier",
      pluginId: "boatyard.pier",
      scope: "project",
      title: "Pier",
      webAppId: "pier",
      resolveWebApps: () => [{
        id: "pier:feature:admin",
        key: "feature:admin",
        label: "feature — admin",
        url: "https://admin.feature.example.test"
      }]
    }] : [],
    getProjectPluginConfig: () => ({}),
    getProjectWidgetPanes: () => [],
    getWebAppFavicon: () => "",
    isGlobalWorkspace: () => false
  });

  const dynamic = runtime.getProjectWebApps({
    id: "project",
    name: "Project",
    sourcePath: "/workspace/project"
  }, "pane").find((webApp: { id?: string }) => webApp.id === "pier:feature:admin");

  assert.equal(dynamic.paneTypeId, "pier");
});

test("workspace layout previews use the current window aspect ratio", () => {
  assert.equal(resolveWorkspaceLayoutAspectRatio({ windowAspectRatio: 2.75 }), 2.75);
  assert.equal(resolveWorkspaceLayoutAspectRatio({ windowAspectRatio: 0 }), 1);
});

test("workspace layout saves default to the current project unless Global is enabled", () => {
  assert.equal(resolveWorkspaceLayoutSaveScope(true, false), "project");
  assert.equal(resolveWorkspaceLayoutSaveScope(true, true), "global");
  assert.equal(resolveWorkspaceLayoutSaveScope(false, false), "global");
});

export {};
