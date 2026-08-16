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

test("pane MCP controller reports exact choices and assigns through the shared action", () => {
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
    { id: "pier:feature", label: "Feature", parentWebAppId: "pier", paneTypeId: "pier" },
    { id: "pier:review", label: "Review", parentWebAppId: "pier", paneTypeId: "pier" },
    { id: "terminal", label: "Terminal", paneTypeId: "terminal" }
  ];
  const assignments: string[] = [];
  const controller = createPaneMcpController({
    assignWebAppToPane: (_project, pane, webApp) => {
      pane.selectedWebAppId = webApp.id;
      assignments.push(String(webApp.id));
    },
    findPaneNode: findPane,
    getGlobalWorkspace: () => ({ id: "__global__", name: "Global" }),
    getProjectById: (projectId) => projectId === project.id ? project : null,
    getProjectPaneLayout: () => layout,
    getProjectWebApps: () => choices,
    getSelectedWebApp: (_project, paneId, webApps) => {
      const selectedId = findPane(layout, paneId)?.selectedWebAppId;
      return webApps.find((webApp) => webApp.id === selectedId) || webApps[0];
    }
  });

  const before = controller.getPaneLayout({ projectId: "project-1" });
  const listed = controller.listPaneTypes({ projectId: "project-1", paneId: "pane-1" });
  assert.equal(listed.selectedChoiceId, "pier:feature");
  assert.deepEqual(
    listed.choices.flatMap((choice) => [choice.choiceId, ...choice.children.map((child) => child.choiceId)]),
    ["pier", "pier:feature", "pier:review", "terminal"]
  );

  const assigned = controller.assignPaneType({
    projectId: "project-1",
    paneId: "pane-1",
    choiceId: "pier:review",
    expectedRevision: before.revision
  });
  assert.deepEqual(assignments, ["pier:review"]);
  assert.equal(assigned.assignedChoiceId, "pier:review");
  assert.notEqual(assigned.revision, before.revision);

  assert.throws(() => controller.assignPaneType({
    projectId: "project-1",
    paneId: "pane-1",
    choiceId: "terminal",
    expectedRevision: before.revision
  }), (error) => error instanceof PaneMcpError && error.code === "LAYOUT_CHANGED");
});

test("pane MCP controller rejects entries that are not in the current dropdown", () => {
  const project: RendererProject = { id: "project-1" };
  const layout: PaneLayoutNode = { type: "pane", id: "pane-1", selectedWebAppId: "terminal" };
  const choices: WebAppDefinition[] = [{ id: "terminal", label: "Terminal", paneTypeId: "terminal" }];
  const controller = createPaneMcpController({
    assignWebAppToPane: () => undefined,
    findPaneNode: findPane,
    getGlobalWorkspace: () => ({ id: "__global__" }),
    getProjectById: () => project,
    getProjectPaneLayout: () => layout,
    getProjectWebApps: () => choices,
    getSelectedWebApp: () => choices[0]
  });

  assert.throws(() => controller.assignPaneType({
    projectId: "project-1",
    paneId: "pane-1",
    choiceId: "pier:gone"
  }), (error) => error instanceof PaneMcpError && error.code === "PANE_TYPE_NOT_AVAILABLE");
});
