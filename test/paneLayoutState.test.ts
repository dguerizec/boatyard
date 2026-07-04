"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPaneLayoutState } = require(`${process.cwd()}/build/renderer/paneLayoutState`);

type TestPaneNode = {
  type: "pane";
  id: string;
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

function pane(id: string): TestPaneNode {
  return {
    type: "pane",
    id
  };
}

function split(
  id: string,
  first: TestPaneLayoutNode,
  second: TestPaneLayoutNode,
  ratio = 0.5
): TestSplitNode {
  return {
    type: "split",
    id,
    direction: "vertical",
    ratio,
    first,
    second
  };
}

test("pane layout rotates a split with its parent while preserving leaf order", () => {
  const state = createPaneLayoutState({
    updatePaneLayout: async () => undefined
  });
  const project = { id: "project-id" };
  const layout = split(
    "S0",
    pane("A"),
    split(
      "S1",
      pane("B"),
      split("S2", pane("C"), pane("D"), 0.5),
      0.5
    ),
    0.5
  );

  state.setPaneLayout(project.id, layout);

  assert.deepEqual(state.getSplitRotationState(project, "S1"), {
    canRotate: true
  });
  assert.deepEqual(state.getSplitRotationPreview(project, "S1"), {
    current: layout,
    replacementSplitId: "S0",
    rootSplitId: "S0",
    rotated: {
      type: "split",
      id: "S0",
      direction: "vertical",
      ratio: 0.75,
      first: {
        type: "split",
        id: "S1",
        direction: "vertical",
        ratio: 2 / 3,
        first: pane("A"),
        second: pane("B")
      },
      second: split("S2", pane("C"), pane("D"), 0.5)
    }
  });
  assert.equal(layout.first.id, "A");
  assert.equal(state.rotateSplitWithParent(project, "S1"), true);

  assert.deepEqual(layout, {
    type: "split",
    id: "S0",
    direction: "vertical",
    ratio: 0.75,
    first: {
      type: "split",
      id: "S1",
      direction: "vertical",
      ratio: 2 / 3,
      first: pane("A"),
      second: pane("B")
    },
    second: split("S2", pane("C"), pane("D"), 0.5)
  });
});

test("pane layout does not rotate splits across different directions", () => {
  const state = createPaneLayoutState({
    updatePaneLayout: async () => undefined
  });
  const project = { id: "project-id" };
  const pivot = split("S1", pane("B"), pane("C"), 0.5);
  pivot.direction = "horizontal";
  const layout = split("S0", pane("A"), pivot, 0.5);

  state.setPaneLayout(project.id, layout);

  assert.deepEqual(state.getSplitRotationState(project, "S1"), {
    canRotate: false
  });
  assert.equal(state.rotateSplitWithParent(project, "S1"), false);
  assert.equal(layout.second, pivot);
});

test("pane layout rotation preview keeps the full layout tree", () => {
  const state = createPaneLayoutState({
    updatePaneLayout: async () => undefined
  });
  const project = { id: "project-id" };
  const layout = split(
    "S0",
    pane("A"),
    split(
      "S1",
      pane("B"),
      split("S2", pane("C"), pane("D"), 0.5),
      0.5
    ),
    0.5
  );

  state.setPaneLayout(project.id, layout);

  assert.deepEqual(state.getSplitRotationPreview(project, "S2"), {
    current: layout,
    replacementSplitId: "S1",
    rootSplitId: "S0",
    rotated: {
      type: "split",
      id: "S0",
      direction: "vertical",
      ratio: 0.5,
      first: pane("A"),
      second: {
        type: "split",
        id: "S1",
        direction: "vertical",
        ratio: 0.75,
        first: {
          type: "split",
          id: "S2",
          direction: "vertical",
          ratio: 2 / 3,
          first: pane("B"),
          second: pane("C")
        },
        second: pane("D")
      }
    }
  });
});

export {};
