import assert from "node:assert/strict";
import test from "node:test";

const { createPaneLayoutState } = require(`${process.cwd()}/build/renderer-esm/paneLayoutState`);

function createState() {
  return createPaneLayoutState({
    updatePaneLayout: async () => undefined
  });
}

const webApps = [
  { id: "widgets:widgets-0" },
  { id: "terminal" },
  { id: "empty" }
];

test("unassigned panes default to empty instead of the first widget pane", () => {
  const state = createState();
  const project = { id: "new-project" };
  const pane = state.getProjectPaneLayout(project);

  assert.equal(state.getSelectedWebApp(project, pane.id, webApps).id, "empty");
});

test("panes whose assigned web app is unavailable fall back to empty", () => {
  const state = createState();
  const project = { id: "pier-project" };
  const pane = state.createPaneNode(project, "pier");
  state.setPaneLayout(project.id, pane);

  assert.equal(state.getSelectedWebApp(project, pane.id, webApps).id, "empty");
});

test("available pane assignments remain selected", () => {
  const state = createState();
  const project = { id: "assigned-project" };
  const pane = state.createPaneNode(project, "terminal");
  state.setPaneLayout(project.id, pane);

  assert.equal(state.getSelectedWebApp(project, pane.id, webApps).id, "terminal");
});

test("new panes stay empty even when the project has a previous selection", () => {
  const state = createState();
  const project = { id: "selected-project" };
  state.setSelectedWebAppForProject(project.id, "terminal");
  const pane = state.getProjectPaneLayout(project);

  assert.equal(pane.selectedWebAppId, "empty");
  assert.equal(state.getSelectedWebApp(project, pane.id, webApps).id, "empty");
});

for (const direction of ["vertical", "horizontal"]) {
  test(`${direction} splits preserve the source pane and persist an empty new pane`, () => {
    const state = createState();
    const project = { id: "split-project" };
    state.setSelectedWebAppForProject(project.id, "terminal");
    const source = state.createPaneNode(project, "terminal");
    state.setPaneLayout(project.id, source);
    const split = state.createSplitNode(project, direction, source);

    assert.equal(state.applyPaneSplit(project, source.id, split), true);
    assert.equal(state.getSelectedWebApp(project, source.id, webApps).id, "terminal");
    assert.equal(split.second.selectedWebAppId, "empty");
    assert.equal(state.getSelectedWebApp(project, split.second.id, webApps).id, "empty");

    const restored = createState();
    restored.hydratePaneLayouts({ [project.id]: JSON.parse(JSON.stringify(state.getProjectPaneLayout(project))) });
    assert.equal(restored.getSelectedWebApp(project, source.id, webApps).id, "terminal");
    assert.equal(restored.getSelectedWebApp(project, split.second.id, webApps).id, "empty");
  });
}

test("legacy file preview panes restore as file editors without a separate pane type", () => {
  const state = createState();
  const project = { id: "editor-project" };
  const pane = state.createPaneNode(project, "boatyard.fileEditor.preview");
  state.setPaneLayout(project.id, pane);
  const available = [...webApps, { id: "boatyard.fileEditor.editor" }];

  assert.equal(state.getSelectedWebApp(project, pane.id, available).id, "boatyard.fileEditor.editor");
  assert.equal(state.getSelectedWebApp(project, pane.id, webApps).id, "empty");
});
