"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createWebAppMenus } = require(`${process.cwd()}/build/renderer/webAppMenus`);

type TestPaneNode = {
  type: "pane";
  id: string;
  selectedWebAppId?: string | null;
  transientWebApp?: {
    id?: string;
    url?: string;
  };
};

type TestSplitNode = {
  type: "split";
  id: string;
  direction: string;
  ratio: number;
  first: TestPaneLayoutNode;
  second: TestPaneLayoutNode;
};

type TestPaneLayoutNode = TestPaneNode | TestSplitNode;

type TestProject = {
  id: string;
  name: string;
};

function findPaneNode(
  node: TestPaneLayoutNode | null | undefined,
  paneId = ""
): TestPaneNode | null {
  if (!node) {
    return null;
  }
  if (node.type === "pane") {
    return node.id === paneId ? node : null;
  }
  return findPaneNode(node.first, paneId) || findPaneNode(node.second, paneId);
}

test("opening successive external links in an existing pane reuses its transient webapp", async () => {
  const sourcePane: TestPaneNode = {
    type: "pane",
    id: "pane-a",
    selectedWebAppId: "source-app"
  };
  const destinationPane: TestPaneNode = {
    type: "pane",
    id: "pane-b",
    selectedWebAppId: "manual"
  };
  const layout: TestPaneLayoutNode = {
    type: "split",
    id: "split-1",
    direction: "vertical",
    ratio: 0.5,
    first: sourcePane,
    second: destinationPane
  };
  const project: TestProject = {
    id: "project-1",
    name: "Project"
  };
  const sourceEntry = {
    host: null,
    paneId: sourcePane.id,
    webApp: {
      id: "source-app",
      key: "pane-a:source-app",
      label: "Source",
      url: "https://source.example/"
    }
  };
  const currentUrlCalls: Array<[string, string]> = [];
  const selectedPaneCalls: Array<[string, string | undefined]> = [];
  const selectedProjectCalls: Array<[string | undefined, string | undefined]> = [];
  const invokedWebAppActions: string[] = [];
  let persistCount = 0;
  let renderCount = 0;

  const menus = createWebAppMenus({
    webAppOpenSplitRatio: 0.5,
    getCurrentWebAppUrl: (webApp: { url?: string }) => webApp.url,
    getSettings: () => ({ webAppOpenRules: [] }),
    getProjectById: () => project,
    getProjectWidgetPanes: () => [],
    getWebAppFavicon: () => "",
    getVisibleWebAppEntryByKey: (key?: string) => key === sourceEntry.webApp.key ? sourceEntry : null,
    getVisibleWebAppEntryByUrl: () => null,
    getVisibleWebAppEntries: () => [sourceEntry],
    getVisibleWebAppProject: () => project,
    getProjectPaneLayout: () => layout,
    getWebAppHostBounds: () => null,
    findPaneNode,
    createSplitNode: (_project: TestProject, direction: string, first: TestPaneLayoutNode) => ({
      type: "split",
      id: "unused-split",
      direction,
      ratio: 0.5,
      first,
      second: {
        type: "pane",
        id: "unused-pane"
      }
    }),
    replacePaneNode: (node: TestPaneLayoutNode) => node,
    setPaneLayout: () => undefined,
    setSelectedWebAppForPane: (paneId: string, webAppId?: string) => {
      selectedPaneCalls.push([paneId, webAppId]);
    },
    setSelectedWebAppForProject: (projectId?: string, webAppId?: string) => {
      selectedProjectCalls.push([projectId, webAppId]);
    },
    setCurrentWebAppUrl: (key: string, url: string) => {
      currentUrlCalls.push([key, url]);
    },
    persistPaneLayout: () => {
      persistCount += 1;
    },
    renderWorkspaceDashboard: () => undefined,
    renderPaneLayoutPreservingPanes: () => {
      renderCount += 1;
    },
    updateWebAppHomeTab: async () => undefined,
    updateSettings: async () => undefined,
    updateProject: async () => undefined,
    getWebAppNavigationHistory: async () => ({ entries: [] }),
    invokeWebApp: async (action: string) => {
      invokedWebAppActions.push(action);
      return true;
    },
    openExternal: async () => undefined,
    showOverlayDialog: async () => false,
    normalizePayloadBounds: () => null,
    freezeWebAppsForOverlay: async () => undefined,
    restoreWebAppsAfterOverlay: () => undefined,
    closeTerminalTabMenu: () => undefined,
    clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    isGlobalWorkspace: () => false,
    isWebAppLoaded: () => true
  });

  await menus.applyWebAppOpenChoice({
    sourceWebAppKey: sourceEntry.webApp.key,
    url: "https://first.example/video"
  }, {
    target: `pane:${destinationPane.id}`,
    persist: false
  });

  const transientId = destinationPane.transientWebApp?.id;
  assert.match(transientId || "", /^transient:/);
  assert.equal(destinationPane.transientWebApp?.url, "https://first.example/video");

  await menus.applyWebAppOpenChoice({
    sourceWebAppKey: sourceEntry.webApp.key,
    url: "https://second.example/page"
  }, {
    target: `pane:${destinationPane.id}`,
    persist: false
  });

  assert.equal(destinationPane.transientWebApp?.id, transientId);
  assert.equal(destinationPane.transientWebApp?.url, "https://second.example/page");
  assert.equal(destinationPane.selectedWebAppId, transientId);
  assert.deepEqual(selectedPaneCalls, [
    [destinationPane.id, transientId],
    [destinationPane.id, transientId]
  ]);
  assert.deepEqual(selectedProjectCalls, [
    [project.id, transientId],
    [project.id, transientId]
  ]);
  assert.deepEqual(currentUrlCalls, [
    [`${destinationPane.id}:transient:${transientId}`, "https://first.example/video"],
    [`${destinationPane.id}:transient:${transientId}`, "https://second.example/page"]
  ]);
  assert.equal(persistCount, 2);
  assert.equal(renderCount, 2);
  assert.deepEqual(invokedWebAppActions, []);
});

export {};
