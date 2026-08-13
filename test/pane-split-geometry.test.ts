import assert from "node:assert/strict";
import test from "node:test";

const {
  clampPaneSplitRatio,
  demoteSplitThroughFirstChild,
  getPaneLayoutMinimumSize,
  normalizePaneMinimumLength,
  resolvePaneMinimumPixels
} = require(`${process.cwd()}/build/renderer-esm/paneSplitGeometry`);

type TestPane = {
  type: "pane";
  id: string;
};

type TestSplit = {
  type: "split";
  id: string;
  direction: "vertical" | "horizontal";
  ratio: number;
  first: TestNode;
  second: TestNode;
};

type TestNode = TestPane | TestSplit;

const minimums: Record<string, { width: number; height: number }> = {
  sessions: { width: 200, height: 160 },
  twicc: { width: 320, height: 200 },
  rest: { width: 400, height: 240 }
};

function getPaneMinimumSize(pane: TestPane, axis: "width" | "height") {
  return minimums[pane.id][axis];
}

test("pane minimum lengths accept px and em with a 200px fallback", () => {
  assert.equal(normalizePaneMinimumLength(" 240PX "), "240px");
  assert.equal(normalizePaneMinimumLength("12.5em"), "12.5em");
  assert.equal(normalizePaneMinimumLength("25%"), undefined);
  assert.equal(resolvePaneMinimumPixels("12.5em", 16), 200);
  assert.equal(resolvePaneMinimumPixels(undefined, 16), 200);
});

test("split ratio clamps use subtree pixel minimums", () => {
  assert.equal(clampPaneSplitRatio(0.1, 1000, 6, 200, 300), 0.203);
  assert.ok(Math.abs(clampPaneSplitRatio(0.9, 1000, 6, 200, 300) - 0.697) < 0.000001);

  const layout: TestSplit = {
    type: "split",
    id: "root",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", id: "sessions" },
    second: {
      type: "split",
      id: "stack",
      direction: "horizontal",
      ratio: 0.5,
      first: { type: "pane", id: "twicc" },
      second: { type: "pane", id: "rest" }
    }
  };

  assert.equal(getPaneLayoutMinimumSize(layout, "width", 6, getPaneMinimumSize), 606);
  assert.equal(getPaneLayoutMinimumSize(layout, "height", 6, getPaneMinimumSize), 446);
});

test("split rotation preserves a narrow pane when it remains above its pixel minimum", () => {
  const containerSize = 4000;
  const resizerSize = 6;
  const splitRatio = 0.3917241543933354;
  const pivotRatio = 0.2742866450174585;
  const layout: TestSplit = {
    type: "split",
    id: "twicc-right-divider",
    direction: "vertical",
    ratio: splitRatio,
    first: {
      type: "split",
      id: "sessions-divider",
      direction: "vertical",
      ratio: pivotRatio,
      first: { type: "pane", id: "sessions" },
      second: { type: "pane", id: "twicc" }
    },
    second: { type: "pane", id: "rest" }
  };
  const originalSessionsDivider = pivotRatio * ((splitRatio * containerSize) - (resizerSize / 2));
  const originalTwiccDivider = splitRatio * containerSize;

  const result = demoteSplitThroughFirstChild(layout, {
    containerSize,
    getPaneMinimumSize,
    resizerSize
  });

  assert.ok(result);
  assert.ok(result.replacement.ratio < 0.15);
  assert.ok(Math.abs((result.replacement.ratio * containerSize) - originalSessionsDivider) < 0.000001);
  const rotatedTwiccDivider = (result.replacement.ratio * containerSize)
    + (resizerSize / 2)
    + (layout.ratio * result.nextContainerSize);
  assert.ok(Math.abs(rotatedTwiccDivider - originalTwiccDivider) < 0.000001);
  assert.equal(result.replacement.first.id, "sessions");
  assert.equal(layout.first.id, "twicc");
});
