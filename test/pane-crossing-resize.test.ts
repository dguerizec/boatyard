import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import type { PaneLayoutNode } from "../src/renderer/paneLayoutState";
import type { PaneExpansionRect } from "../src/renderer/paneExpansionGeometry";
import { runBrowserTest } from "./helpers/browser";

const { createPaneCrossingResize } = require(`${process.cwd()}/build/renderer-esm/paneCrossingResize`);
const pane = (id: string): PaneLayoutNode => ({ type: "pane", id });
const split = (id: string, direction: string, first: PaneLayoutNode, second: PaneLayoutNode): PaneLayoutNode => ({
  type: "split", id, direction, ratio: 0.5, first, second
});
function geometry(node: PaneLayoutNode, area = { left: 0, right: 1006, top: 0, bottom: 806 }): PaneExpansionRect[] {
  if (node.type === "pane") return [{ ...area, id: node.id }];
  const start = node.direction === "vertical" ? "left" : "top";
  const end = node.direction === "vertical" ? "right" : "bottom";
  const center = area[start] + (area[end] - area[start]) * node.ratio;
  return [...geometry(node.first, { ...area, [end]: center - 3 }), ...geometry(node.second, { ...area, [start]: center + 3 })];
}
function assertRect(actual: PaneExpansionRect | undefined, expected: PaneExpansionRect) {
  assert.ok(actual);
  assert.equal(actual.id, expected.id);
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    assert.ok(Math.abs(actual[edge] - expected[edge]) < 1e-8, `${actual.id}: ${edge}`);
  }
}
function fourPanes(horizontal: boolean) {
  return horizontal
    ? split("root", "horizontal", split("top", "vertical", pane("a"), pane("b")), split("bottom", "vertical", pane("c"), pane("d")))
    : split("root", "vertical", split("left", "horizontal", pane("a"), pane("c")), split("right", "horizontal", pane("b"), pane("d")));
}
const horizontalHandle = { left: 0, right: 1006, top: 400, bottom: 406 };
const verticalHandle = { left: 500, right: 506, top: 0, bottom: 806 };

for (const horizontal of [true, false]) {
  for (const firstBranch of [true, false]) {
    test(`four-way ${horizontal ? "horizontal" : "vertical"} branch resizes independently (${firstBranch ? "first" : "second"})`, () => {
      const layout = fourPanes(horizontal);
      const rects = geometry(layout);
      const point = horizontal ? { x: firstBranch ? 250 : 750, y: 403 } : { x: 503, y: firstBranch ? 200 : 600 };
      const drag = createPaneCrossingResize(layout, rects, point, horizontal ? horizontalHandle : verticalHandle,
        horizontal ? "horizontal" : "vertical", 6, () => 60);
      assert.ok(drag && !drag.crossing);
      const result = drag.apply({ x: point.x + (horizontal ? 0 : 40), y: point.y + (horizontal ? 40 : 0) });
      assert.ok(result);
      const after = geometry(result);
      const affected = horizontal ? (firstBranch ? ["a", "c"] : ["b", "d"]) : (firstBranch ? ["a", "b"] : ["c", "d"]);
      for (const rect of rects) {
        const actual = after.find(item => item.id === rect.id)!;
        if (!affected.includes(rect.id)) assert.deepEqual(actual, rect);
        else if (horizontal) assert.equal(actual[rect.top === 0 ? "bottom" : "top"], rect[rect.top === 0 ? "bottom" : "top"] + 40);
        else assert.equal(actual[rect.left === 0 ? "right" : "left"], rect[rect.left === 0 ? "right" : "left"] + 40);
      }
      assert.deepEqual(geometry(layout), rects, "Preparing and applying a gesture does not mutate its snapshot");
    });
  }
  test(`four-way center moves every connected branch (${horizontal ? "horizontal" : "vertical"} root)`, () => {
    const layout = fourPanes(horizontal);
    const drag = createPaneCrossingResize(layout, geometry(layout), { x: 505, y: 401 },
      horizontal ? horizontalHandle : verticalHandle, horizontal ? "horizontal" : "vertical", 6, () => 60);
    assert.ok(drag.crossing);
    const result = geometry(drag.apply({ x: 555, y: 431 }));
    assertRect(result.find(rect => rect.id === "a"), { id: "a", left: 0, top: 0, right: 550, bottom: 430 });
    assertRect(result.find(rect => rect.id === "d"), { id: "d", left: 556, top: 436, right: 1006, bottom: 806 });
    const limited = geometry(drag.apply({ x: 2000, y: 2000 }));
    const smallest = limited.find(rect => rect.id === "d")!;
    assert.ok(Math.abs(smallest.right - smallest.left - 60) < 1e-8);
    assert.ok(Math.abs(smallest.bottom - smallest.top - 60) < 1e-8);
  });
}

test("a T keeps its through-edge continuous and its center moves all three branches", () => {
  const layout = split("root", "horizontal", pane("top"), split("bottom", "vertical", pane("left"), pane("right")));
  assert.equal(createPaneCrossingResize(layout, geometry(layout), { x: 200, y: 403 }, horizontalHandle, "horizontal", 6, () => 60), null);
  const drag = createPaneCrossingResize(layout, geometry(layout), { x: 503, y: 403 }, horizontalHandle, "horizontal", 6, () => 60);
  assert.ok(drag.crossing);
  const after = geometry(drag.apply({ x: 533, y: 443 }));
  assert.equal(after.find(rect => rect.id === "top")!.bottom, 440);
  assert.equal(after.find(rect => rect.id === "left")!.right, 530);
  assert.equal(after.find(rect => rect.id === "right")!.left, 536);
});

test("dragging a branch between two crossings moves only the middle column", () => {
  const row = (prefix: string) => split(`${prefix}-row`, "vertical", pane(`${prefix}-left`),
    split(`${prefix}-right`, "vertical", pane(`${prefix}-middle`), pane(`${prefix}-right`)));
  const layout = split("root", "horizontal", row("top"), row("bottom"));
  const rects = geometry(layout);
  const middle = rects.find(rect => rect.id === "top-middle")!;
  const drag = createPaneCrossingResize(layout, rects, { x: (middle.left + middle.right) / 2, y: 403 }, horizontalHandle, "horizontal", 6, () => 60);
  assert.ok(drag);
  const after = geometry(drag.apply({ x: (middle.left + middle.right) / 2, y: 453 }));
  for (const rect of rects.filter(rect => !rect.id.endsWith("-middle"))) {
    assert.deepEqual(after.find(item => item.id === rect.id), rect);
  }
});

test("an expansion hiding a crossing arm preserves the visible T through-edge", () => {
  const layout = fourPanes(false);
  const hidden = [{ left: 0, right: 500, top: 0, bottom: 806 }];
  assert.equal(createPaneCrossingResize(layout, geometry(layout), { x: 503, y: 200 },
    verticalHandle, "vertical", 6, () => 60, hidden), null);
  const drag = createPaneCrossingResize(layout, geometry(layout), { x: 503, y: 403 },
    verticalHandle, "vertical", 6, () => 60, hidden);
  const after = geometry(drag.apply({ x: 553, y: 433 }));
  assertRect(after.find(rect => rect.id === "a"), { id: "a", left: 0, right: 550, top: 0, bottom: 400 });
  assertRect(after.find(rect => rect.id === "c"), { id: "c", left: 0, right: 550, top: 406, bottom: 806 });
});

test("crossing and branch gestures preserve mounted panes and snapped alignment in Electron", t => {
  runBrowserTest(t, "test/fixtures/pane-crossing-resize.browser.js");
});


test("crossing dragging retains native pointer capture over WebContentsViews", t => {
  if (process.platform !== "linux" || ["xvfb-run", "xdotool"].some(command => spawnSync("which", [command]).status !== 0)) {
    t.skip("Native pointer coverage requires isolated Xvfb and xdotool");
    return;
  }
  runBrowserTest(t, "test/fixtures/pane-crossing-resize.browser.js", {
    main: "test/fixtures/pane-expansion-menu.main.cjs",
    preload: "test/fixtures/pane-expansion-menu.preload.cjs"
  });
});
