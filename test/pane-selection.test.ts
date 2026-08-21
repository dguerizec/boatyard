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
