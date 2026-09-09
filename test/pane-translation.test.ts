import assert from "node:assert/strict";
import test from "node:test";
import type { PaneLayoutGeometryNode, PaneSplitGeometryNode } from "../src/renderer/paneSplitGeometry.js";

const { createPaneTranslation } = require(`${process.cwd()}/build/renderer/paneTranslation`);
const pane = (id: string): PaneLayoutGeometryNode => ({ type: "pane", id });
const split = (id: string, first: PaneLayoutGeometryNode, second: PaneLayoutGeometryNode, direction = "vertical"): PaneSplitGeometryNode => ({
  type: "split", id, first, second, direction, ratio: 0.5
});
function bounds(root: PaneLayoutGeometryNode, direction: string, start = 0, end = 1600, result: Record<string, number[]> = {}) {
  if (root.type === "pane") result[root.id] = [start, end];
  else if (root.direction === direction) {
    const center = start + root.ratio * (end - start);
    bounds(root.first, direction, start, center - 3, result);
    bounds(root.second, direction, center + 3, end, result);
  } else {
    bounds(root.first, direction, start, end, result);
    bounds(root.second, direction, start, end, result);
  }
  return result;
}
function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}
for (const direction of ["vertical", "horizontal"]) {
  const axis = direction === "vertical" ? "width" : "height";
  for (const nesting of ["left", "right"]) {
    test(`toolbar translation preserves pane size and outer edges (${direction}, ${nesting})`, () => {
      const root = nesting === "left"
        ? split("outer", split("inner", pane("a"), pane("b"), direction), pane("c"), direction)
        : split("outer", pane("a"), split("inner", pane("b"), pane("c"), direction), direction);
      const before = bounds(root, direction);
      assert.equal(createPaneTranslation(root, "a", axis, 1600, 6, () => 200), null);
      assert.equal(createPaneTranslation(root, "c", axis, 1600, 6, () => 200), null);
      const drag = createPaneTranslation(root, "b", axis, 1600, 6, () => 200);
      assert.ok(drag);
      drag.apply(70);
      const after = bounds(root, direction);
      close(after.b[0], before.b[0] + 70);
      close(after.b[1], before.b[1] + 70);
      close(after.a[0], before.a[0]);
      close(after.c[1], before.c[1]);
      drag.apply(10000);
      const capped = bounds(root, direction);
      close(capped.c[1] - capped.c[0], 200);
      close(capped.b[1] - capped.b[0], before.b[1] - before.b[0]);
      drag.apply(-10000);
      const negative = bounds(root, direction);
      close(negative.a[1] - negative.a[0], 200);
      drag.apply(0);
      for (const id of ["a", "b", "c"]) {
        bounds(root, direction)[id].forEach((value, index) => close(value, before[id][index]));
      }
    });
  }
}

test("nested neighbors constrain the drag while unrelated dividers stay fixed", () => {
  const root = split("outer", pane("a"), split("middle", pane("b"), split("neighbors", pane("c"), pane("d"))));
  const before = bounds(root, "vertical");
  const drag = createPaneTranslation(root, "b", "width", 1600, 6, () => 100);
  drag.apply(10000);
  const after = bounds(root, "vertical");
  close(after.c[1] - after.c[0], 100);
  close(after.d[0], before.d[0]);
  close(after.d[1], before.d[1]);
  close(after.b[1] - after.b[0], before.b[1] - before.b[0]);
});

test("perpendicular neighbors use the strictest minimum and do not enable an outer axis", () => {
  const root = split("outer", pane("a"), split("middle", pane("b"), split("stack", pane("c"), pane("d"), "horizontal")));
  const drag = createPaneTranslation(root, "b", "width", 1600, 6, (node: { id: string }) => node.id === "d" ? 300 : 100);
  assert.equal(createPaneTranslation(root, "b", "height", 900, 6, () => 100), null);
  drag.apply(10000);
  const after = bounds(root, "vertical");
  close(after.c[1] - after.c[0], 300);
  close(after.d[1] - after.d[0], 300);
});

test("a pane with no available neighbor space cannot start a drag", () => {
  const root = split("outer", pane("a"), split("inner", pane("b"), pane("c")));
  assert.equal(createPaneTranslation(root, "b", "width", 600, 6, () => 400), null);
  assert.equal(createPaneTranslation(pane("only"), "only", "width", 600, 6, () => 100), null);
});

for (const direction of ["vertical", "horizontal"]) {
  const axis = direction === "vertical" ? "width" : "height";
  test(`expanded group translates every internal pane without resizing (${direction})`, () => {
    // The group crosses subtrees, rather than being a single split child.
    const root = split("root", split("left", pane("a"), pane("b"), direction),
      split("right", pane("c"), pane("d"), direction), direction);
    const before = bounds(root, direction);
    const drag = createPaneTranslation(root, ["b", "c"], axis, 1600, 6, () => 200);
    assert.ok(drag);
    drag.apply(70);
    const after = bounds(root, direction);
    for (const id of ["b", "c"]) {
      close(after[id][0], before[id][0] + 70);
      close(after[id][1], before[id][1] + 70);
    }
    close(after.a[0], before.a[0]);
    close(after.d[1], before.d[1]);
    drag.apply(10000);
    const capped = bounds(root, direction);
    close(capped.d[1] - capped.d[0], 200);
    for (const id of ["b", "c"]) close(capped[id][1] - capped[id][0], before[id][1] - before[id][0]);
    drag.apply(-10000);
    close(bounds(root, direction).a[1] - bounds(root, direction).a[0], 200);
    drag.apply(0);
    for (const id of ["a", "b", "c", "d"]) {
      bounds(root, direction)[id].forEach((value, index) => close(value, before[id][index]));
    }
    assert.equal(createPaneTranslation(root, ["a", "b"], axis, 1600, 6, () => 200), null);
    assert.equal(createPaneTranslation(root, ["c", "d"], axis, 1600, 6, () => 200), null);
  });
}

test("stacked expansion preserves both panes and remains blocked on its outer axis", () => {
  const root = split("outer", pane("a"), split("inner", split("stack", pane("b"), pane("c"), "horizontal"), pane("d")));
  const before = bounds(root, "vertical");
  const drag = createPaneTranslation(root, ["b", "c"], "width", 1600, 6, () => 200);
  drag.apply(50);
  const after = bounds(root, "vertical");
  for (const id of ["b", "c"]) {
    close(after[id][0], before[id][0] + 50);
    close(after[id][1], before[id][1] + 50);
  }
  assert.equal(createPaneTranslation(root, ["b", "c"], "height", 900, 6, () => 100), null);
});
