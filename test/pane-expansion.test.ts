import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { createPaneLayoutState } = require(`${process.cwd()}/build/renderer-esm/paneLayoutState`);
const { resolvePaneExpansionPaneIds } = require(`${process.cwd()}/build/renderer-esm/paneExpansionGeometry`);
const { createVisibleWebAppTracker } = require(`${process.cwd()}/build/renderer-esm/visibleWebAppTracker`);

type TestPaneNode = {
  expansion?: {
    active?: boolean;
    paneIds: string[];
  };
  id: string;
  type: "pane";
};

type TestPaneLayoutNode = TestPaneNode | TestSplitNode;

type TestSplitNode = {
  direction: string;
  expandedChild?: "first" | "second";
  first: TestPaneLayoutNode;
  id: string;
  ratio: number;
  second: TestPaneLayoutNode;
  type: "split";
};

function createFourPaneLayout(): TestSplitNode {
  return {
    type: "split",
    id: "project:split:root",
    direction: "horizontal",
    ratio: 0.33,
    first: {
      type: "pane",
      id: "pane-a"
    },
    second: {
      type: "split",
      id: "project:split:right",
      direction: "horizontal",
      ratio: 0.5,
      first: {
        type: "split",
        id: "project:split:middle",
        direction: "vertical",
        ratio: 0.5,
        first: {
          type: "pane",
          id: "pane-b"
        },
        second: {
          type: "pane",
          id: "pane-c"
        }
      },
      second: {
        type: "pane",
        id: "pane-d"
      }
    }
  };
}

const paneRects = [{
  id: "pane-a",
  left: 0,
  right: 100,
  top: 0,
  bottom: 200
}, {
  id: "pane-b",
  left: 100,
  right: 200,
  top: 0,
  bottom: 100
}, {
  id: "pane-c",
  left: 100,
  right: 200,
  top: 100,
  bottom: 200
}, {
  id: "pane-d",
  left: 200,
  right: 300,
  top: 0,
  bottom: 200
}];

test("pane expansion brush closes cumulative selections into rectangles", () => {
  assert.deepEqual(resolvePaneExpansionPaneIds(paneRects, ["pane-b", "pane-c"]), [
    "pane-b",
    "pane-c"
  ]);
  assert.deepEqual(resolvePaneExpansionPaneIds(paneRects, ["pane-b", "pane-a"]), [
    "pane-a",
    "pane-b",
    "pane-c"
  ]);
  assert.deepEqual(resolvePaneExpansionPaneIds(paneRects, ["pane-b", "pane-a", "pane-d"]), [
    "pane-a",
    "pane-b",
    "pane-c",
    "pane-d"
  ]);
});

test("pane expansion uses border previews and one toggle control", () => {
  const styles = readFileSync(`${process.cwd()}/src/renderer/styles.css`, "utf8");
  const view = readFileSync(`${process.cwd()}/src/renderer/paneLayoutView.ts`, "utf8");

  assert.match(styles, /\.webapp-split \.webapp-pane\.pane-expand-preview\s*\{[^}]*border-color:[^}]*outline:\s*3px solid[^}]*outline-offset:\s*-3px;/s);
  assert.doesNotMatch(styles, /pane-expand-preview::after/);
  assert.doesNotMatch(styles, /pane-expansion-preview-active/);
  assert.doesNotMatch(view, /pane-expansion-preview-active/);
  assert.match(view, /const tooltip = isShrink \? label : "Drag to expand pane";/);
  assert.match(view, /if \(!didDrag\) \{\s*suppressExpansionClickUntil = Date\.now\(\) \+ 250;\s*togglePaneExpansion\(project, paneId\);\s*return;/s);
  assert.match(view, /actions\.append\(expansionButton, verticalSplitButton, horizontalSplitButton, closePaneButton\)/);
  assert.doesNotMatch(view, /const shrinkPaneButton/);
});

test("pane expansion can hide covered native web surfaces without forgetting them", () => {
  const tracker = createVisibleWebAppTracker({
    findPaneNode: () => null,
    getCurrentWebAppUrl: () => undefined,
    getPaneLayout: () => createFourPaneLayout(),
    getVisibleWebAppProject: () => null,
    isOnboardingTourActive: () => false,
    persistPaneLayout: () => undefined
  });
  tracker.set("pane-a", {
    host: {},
    webApp: { key: "web-a", url: "https://a.example" }
  });
  tracker.set("pane-b", {
    host: {},
    webApp: { key: "web-b", url: "https://b.example" }
  });

  tracker.setSurfaceHiddenPaneIds(["pane-a"]);
  assert.deepEqual(tracker.getEntries().map(({ paneId }: { paneId: string }) => paneId), ["pane-b"]);
  assert.equal(tracker.getEntryByKey("web-a")?.paneId, "pane-a");

  tracker.setSurfaceHiddenPaneIds([]);
  assert.deepEqual(tracker.getEntries().map(({ paneId }: { paneId: string }) => paneId), ["pane-a", "pane-b"]);
});

test("pane expansion recalls its last area and falls back to the adjacent split", () => {
  const state = createPaneLayoutState({
    updatePaneLayout: async () => undefined
  });
  const project = { id: "project" };
  state.hydratePaneLayouts({
    project: createFourPaneLayout()
  });

  assert.deepEqual(state.getPaneExpansionPaneIds(project, "pane-b"), ["pane-b", "pane-c"]);
  assert.equal(state.activatePaneExpansion(project, "pane-b", ["pane-a", "pane-b", "pane-c", "pane-d"]), true);
  assert.deepEqual(state.getPaneExpansionState(project, "pane-b"), {
    canExpand: false,
    canShrink: true
  });
  assert.deepEqual(state.getPaneExpansionState(project, "pane-a"), {
    canExpand: false,
    canShrink: false
  });

  assert.equal(state.shrinkPaneExpansion(project, "pane-b"), true);
  assert.deepEqual(state.getPaneExpansionPaneIds(project, "pane-b"), [
    "pane-b",
    "pane-a",
    "pane-c",
    "pane-d"
  ]);

  const changedLayout = createFourPaneLayout();
  (changedLayout.second as TestSplitNode).second = {
    type: "pane",
    id: "pane-e"
  };
  state.setPaneLayout(project.id, changedLayout);
  assert.deepEqual(state.getPaneExpansionPaneIds(project, "pane-b"), ["pane-b", "pane-c"]);

  assert.equal(state.activatePaneExpansion(project, "pane-b", ["pane-b", "pane-c"]), true);
  assert.equal(state.shrinkPaneExpansion(project, "pane-b"), true);
  state.clearPaneExpansionMemories(project);
  assert.deepEqual(state.getPaneExpansionPaneIds(project, "pane-b"), ["pane-b", "pane-c"]);
});

test("pane expansions coexist until the newest selection overlaps an active area", () => {
  const state = createPaneLayoutState({
    updatePaneLayout: async () => undefined
  });
  const project = { id: "project" };
  state.hydratePaneLayouts({
    project: createFourPaneLayout()
  });

  assert.equal(state.activatePaneExpansion(project, "pane-b", ["pane-b", "pane-c"]), true);
  assert.deepEqual(state.getPaneExpansionState(project, "pane-a"), {
    canExpand: true,
    canShrink: false
  });
  assert.deepEqual(state.getPaneExpansionState(project, "pane-c"), {
    canExpand: false,
    canShrink: false
  });

  assert.equal(state.activatePaneExpansion(project, "pane-a", ["pane-a", "pane-b"]), true);
  assert.deepEqual(state.findActivePaneExpansions(project).map(({ pane, paneIds }: {
    pane: TestPaneNode;
    paneIds: string[];
  }) => ({ paneId: pane.id, paneIds })), [{
    paneId: "pane-a",
    paneIds: ["pane-a", "pane-b"]
  }]);
  assert.deepEqual(state.getPaneExpansionPaneIds(project, "pane-b"), ["pane-b", "pane-c"]);

  assert.equal(state.shrinkPaneExpansion(project, "pane-a"), true);
  assert.equal(state.activatePaneExpansion(project, "pane-b", ["pane-b", "pane-c"]), true);
  assert.equal(state.activatePaneExpansion(project, "pane-d", ["pane-a", "pane-d"]), true);
  assert.deepEqual(state.findActivePaneExpansions(project).map(({ pane }: { pane: TestPaneNode }) => pane.id), [
    "pane-b",
    "pane-d"
  ]);

  assert.equal(state.shrinkPaneExpansion(project, "pane-d"), true);
  assert.deepEqual(state.findActivePaneExpansions(project).map(({ pane }: { pane: TestPaneNode }) => pane.id), [
    "pane-b"
  ]);
});

test("legacy nested expansion state migrates to one remembered active area", () => {
  const state = createPaneLayoutState({
    updatePaneLayout: async () => undefined
  });
  const project = { id: "project" };
  const layout = createFourPaneLayout();
  const rightSplit = layout.second as TestSplitNode;
  const middleSplit = rightSplit.first as TestSplitNode;
  middleSplit.expandedChild = "first";
  state.hydratePaneLayouts({ project: layout });

  assert.deepEqual(state.findActivePaneExpansions(project), [{
    pane: {
      type: "pane",
      id: "pane-b",
      expansion: {
        active: true,
        paneIds: ["pane-b", "pane-c"]
      }
    },
    paneIds: ["pane-b", "pane-c"]
  }]);
  assert.equal(middleSplit.expandedChild, undefined);
});
