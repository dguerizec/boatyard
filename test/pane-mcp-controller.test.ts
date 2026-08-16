import assert from "node:assert/strict";
import test from "node:test";
import { createPaneMcpController, PaneMcpError } from "../src/renderer/paneMcpController.js";
import type { PaneLayoutNode, PaneNode } from "../src/renderer/paneLayoutState.js";
import type { RendererProject, WebAppDefinition } from "../src/renderer/rendererTypes.js";

function findPane(node: PaneLayoutNode, paneId: string): PaneNode | null {
  if (node.type === "pane") {
    return node.id === paneId ? node : null;
  }
  return findPane(node.first, paneId) || findPane(node.second, paneId);
}

test("pane MCP controller reports exact choices and updates content and viewport in one render", () => {
  const project: RendererProject = { id: "project-1", name: "Example" };
  const layout: PaneLayoutNode = {
    type: "split",
    id: "split-1",
    direction: "horizontal",
    ratio: 0.5,
    first: { type: "pane", id: "pane-1", selectedWebAppId: "pier:feature" },
    second: { type: "pane", id: "pane-2", selectedWebAppId: "terminal" }
  };
  const choices: WebAppDefinition[] = [
    { id: "pier", label: "Pier", paneTypeId: "pier" },
    {
      id: "pier:feature",
      key: "pane-1:pier:feature",
      label: "Feature",
      mobileDev: true,
      parentWebAppId: "pier",
      paneTypeId: "pier",
      url: "https://feature.example.test"
    },
    {
      id: "pier:review",
      key: "pane-1:pier:review",
      label: "Review",
      mobileDev: true,
      parentWebAppId: "pier",
      paneTypeId: "pier",
      url: "https://review.example.test"
    },
    { id: "terminal", label: "Terminal", paneTypeId: "terminal" }
  ];
  const assignments: Array<{ id: string; render?: boolean }> = [];
  const viewports = new Map<string, { enabled: boolean; height: number; width: number }>([
    ["pier:feature", { enabled: false, height: 844, width: 390 }],
    ["pier:review", { enabled: false, height: 844, width: 390 }]
  ]);
  const controller = createPaneMcpController({
    assignWebAppToPane: (_project, pane, webApp, options) => {
      pane.selectedWebAppId = webApp.id;
      assignments.push({ id: String(webApp.id), render: options?.render });
    },
    findPaneNode: findPane,
    getCurrentWebAppUrl: (webApp) => webApp.url,
    getGlobalWorkspace: () => ({ id: "__global__", name: "Global" }),
    getMobileDevViewport: (webApp) => viewports.get(String(webApp.id)) || null,
    getProjectById: (projectId) => projectId === project.id ? project : null,
    getProjectPaneLayout: () => layout,
    getProjectWebApps: () => choices,
    getSelectedWebApp: (_project, paneId, webApps) => {
      const selectedId = findPane(layout, paneId)?.selectedWebAppId;
      return webApps.find((webApp) => webApp.id === selectedId) || webApps[0];
    },
    navigateWebApp: async () => true,
    normalizeAddressInput: (url) => url,
    setCurrentWebAppUrl: () => undefined,
    updateMobileDevViewport: (_project, _paneId, webApp, update) => {
      const current = viewports.get(String(webApp.id));
      assert.ok(current);
      const next = { ...current, ...update };
      viewports.set(String(webApp.id), next);
      return next;
    }
  });

  const before = controller.getPaneLayout({ projectId: "project-1" });
  const listed = controller.listPaneTypes({ projectId: "project-1", paneId: "pane-1" });
  assert.equal(listed.selectedChoiceId, "pier:feature");
  assert.deepEqual(
    listed.choices.flatMap((choice) => [choice.choiceId, ...choice.children.map((child) => child.choiceId)]),
    ["pier", "pier:feature", "pier:review", "terminal"]
  );
  assert.deepEqual(listed.choices[0].children[0].capabilities, {
    navigation: true,
    viewport: true
  });

  const updated = controller.updatePane({
    projectId: "project-1",
    paneId: "pane-1",
    choiceId: "pier:review",
    viewport: { enabled: true, height: 800, width: 360 },
    expectedRevision: before.revision
  });
  assert.deepEqual(assignments, [{ id: "pier:review", render: false }]);
  assert.equal(updated.updatedChoiceId, "pier:review");
  assert.deepEqual(updated.viewport, { enabled: true, height: 800, width: 360 });
  assert.notEqual(updated.revision, before.revision);

  const resized = controller.updatePane({
    projectId: "project-1",
    paneId: "pane-1",
    viewport: { width: 375 },
    expectedRevision: updated.revision
  });
  assert.equal(resized.revision, updated.revision);
  assert.deepEqual(resized.viewport, { enabled: true, height: 800, width: 375 });

  assert.throws(() => controller.updatePane({
    projectId: "project-1",
    paneId: "pane-1",
    choiceId: "terminal",
    expectedRevision: before.revision
  }), (error) => error instanceof PaneMcpError && error.code === "LAYOUT_CHANGED");
});

test("pane MCP controller rejects unavailable choices and viewport capabilities before mutation", () => {
  const project: RendererProject = { id: "project-1" };
  const layout: PaneLayoutNode = { type: "pane", id: "pane-1", selectedWebAppId: "terminal" };
  const choices: WebAppDefinition[] = [{ id: "terminal", label: "Terminal", paneTypeId: "terminal" }];
  let assignments = 0;
  const controller = createPaneMcpController({
    assignWebAppToPane: () => { assignments += 1; },
    findPaneNode: findPane,
    getCurrentWebAppUrl: () => undefined,
    getGlobalWorkspace: () => ({ id: "__global__" }),
    getMobileDevViewport: () => null,
    getProjectById: () => project,
    getProjectPaneLayout: () => layout,
    getProjectWebApps: () => choices,
    getSelectedWebApp: () => choices[0],
    navigateWebApp: async () => false,
    normalizeAddressInput: (url) => url,
    setCurrentWebAppUrl: () => undefined,
    updateMobileDevViewport: () => null
  });

  assert.throws(() => controller.updatePane({
    projectId: "project-1",
    paneId: "pane-1",
    choiceId: "pier:gone"
  }), (error) => error instanceof PaneMcpError && error.code === "PANE_TYPE_NOT_AVAILABLE");
  assert.throws(() => controller.updatePane({
    projectId: "project-1",
    paneId: "pane-1",
    viewport: { enabled: true }
  }), (error) => error instanceof PaneMcpError && error.code === "PANE_VIEWPORT_NOT_AVAILABLE");
  assert.equal(assignments, 0);
});

test("pane MCP controller navigates the selected web pane through the shared runtime", async () => {
  const project: RendererProject = { id: "project-1" };
  const layout: PaneLayoutNode = { type: "pane", id: "pane-1", selectedWebAppId: "preview" };
  const choices: WebAppDefinition[] = [{
    id: "preview",
    key: "pane-1:preview",
    label: "Preview",
    mobileDev: true,
    url: "https://home.example.test"
  }];
  const navigations: Array<{ action: string; key: string; url: string }> = [];
  let currentUrl = choices[0].url;
  const controller = createPaneMcpController({
    assignWebAppToPane: () => undefined,
    findPaneNode: findPane,
    getCurrentWebAppUrl: () => currentUrl,
    getGlobalWorkspace: () => ({ id: "__global__" }),
    getMobileDevViewport: () => ({ enabled: false, height: 844, width: 390 }),
    getProjectById: () => project,
    getProjectPaneLayout: () => layout,
    getProjectWebApps: () => choices,
    getSelectedWebApp: () => choices[0],
    navigateWebApp: async (key, action, url) => {
      navigations.push({ action, key, url });
      return true;
    },
    normalizeAddressInput: (url) => `https://${url}`,
    setCurrentWebAppUrl: (_key, url) => { currentUrl = url; },
    updateMobileDevViewport: () => ({ enabled: false, height: 844, width: 390 })
  });
  const before = controller.getPaneLayout({ projectId: "project-1" });

  const result = await controller.navigatePane({
    projectId: "project-1",
    paneId: "pane-1",
    action: "open",
    url: "next.example.test/path",
    expectedRevision: before.revision
  });

  assert.deepEqual(navigations, [{
    action: "open",
    key: "pane-1:preview",
    url: "https://next.example.test/path"
  }]);
  assert.equal(result.revision, before.revision);
  assert.equal((result.layout.navigation as Record<string, unknown>).currentUrl, "https://next.example.test/path");
});
