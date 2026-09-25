import assert from "node:assert/strict";
import test from "node:test";
import { runBrowserTest } from "./helpers/browser";

const { createPaneLayoutState } = require(`${process.cwd()}/build/renderer-esm/paneLayoutState`);

test("keeping an expansion rejects incomplete geometry without changing state", () => {
  const state = createPaneLayoutState({ updatePaneLayout: async () => undefined });
  const project = { id: "project" };
  const a = state.createPaneNode(project, "app-a");
  const layout = state.createSplitNode(project, "vertical", a, "app-b");
  state.setPaneLayout(project.id, layout);
  const b = layout.second;
  assert.equal(state.keepPaneExpansion(project, a.id, [], 6), false);
  state.activatePaneExpansion(project, a.id, [a.id, b.id]);
  assert.equal(state.keepPaneExpansion(project, a.id, [{ id: a.id, left: 0, right: 100, top: 0, bottom: 100 }], 6), false);
  assert.equal(state.getProjectPaneLayout(project), layout);
  assert.equal(a.expansion.active, true);
  assert.equal(state.getSelectedWebAppForPane(b.id), "app-b");
  assert.equal(state.keepPaneExpansion(project, a.id, [
    { id: a.id, left: 0, right: 100, top: 0, bottom: 100 },
    { id: b.id, left: 106, right: 206, top: 0, bottom: 100 }
  ], 6), true);
  assert.equal(state.getProjectPaneLayout(project), a);
  assert.equal(a.expansion, undefined);
  assert.equal(state.getSelectedWebAppForPane(b.id), undefined);
  assert.equal(state.getSelectedWebAppForPane(a.id), "app-a");
});

test("expanded pane menu keeps geometry and content while disposing covered panes", t => {
  runBrowserTest(t, "test/fixtures/pane-expansion-keep.browser.js");
});

test("keeping rectangular expansions preserves geometry across nested split trees", () => {
  const { mergePaneExpansion, resolvePaneExpansionPaneIds } = require(`${process.cwd()}/build/renderer-esm/paneExpansionGeometry`);
  type Node = import("../src/renderer/paneLayoutState").PaneLayoutNode;
  type Rect = import("../src/renderer/paneExpansionGeometry").PaneExpansionRect;
  let seed = 17;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  function geometry(node: Node, area = { left: 13, right: 1613, top: 17, bottom: 1217 }): Rect[] {
    if (node.type === "pane") return [{ ...area, id: node.id }];
    const start = node.direction === "vertical" ? "left" : "top";
    const end = node.direction === "vertical" ? "right" : "bottom";
    const center = area[start] + (area[end] - area[start]) * node.ratio;
    return [...geometry(node.first, { ...area, [end]: center - 3 }),
      ...geometry(node.second, { ...area, [start]: center + 3 })];
  }
  for (let sample = 0; sample < 30; sample++) {
    let id = 0;
    function tree(depth: number): Node {
      const nodeId = String(id++);
      if (!depth) return { type: "pane", id: nodeId };
      return { type: "split", id: nodeId, direction: random() < 0.5 ? "vertical" : "horizontal",
        ratio: 0.3 + random() * 0.4, first: tree(depth - 1), second: tree(depth - 1) };
    }
    const layout = tree(3);
    const rects = geometry(layout);
    for (let first = 0; first < rects.length; first++) {
      for (let second = first + 1; second < rects.length; second++) {
        const source = { type: "pane" as const, id: rects[second].id };
        const ids: string[] = resolvePaneExpansionPaneIds(rects, [rects[first].id, source.id]);
        const merged = mergePaneExpansion(layout, source, ids, rects, 6);
        assert.ok(merged, `Sample ${sample}: ${ids.join(",")}`);
        const actual = geometry(merged);
        const covered = rects.filter(rect => ids.includes(rect.id));
        const expected = [...rects.filter(rect => !ids.includes(rect.id)), {
          id: source.id, left: Math.min(...covered.map(rect => rect.left)),
          right: Math.max(...covered.map(rect => rect.right)),
          top: Math.min(...covered.map(rect => rect.top)), bottom: Math.max(...covered.map(rect => rect.bottom))
        }];
        assert.equal(actual.length, expected.length);
        for (const rect of expected) {
          const match = actual.find(candidate => candidate.id === rect.id)!;
          assert.ok(match);
          for (const edge of ["left", "right", "top", "bottom"] as const) {
            assert.ok(Math.abs(rect[edge] - match[edge]) < (rect.id === source.id ? 0.01 : 6.51), `${rect.id}: ${edge}`);
          }
        }
      }
    }
  }
});

test("expanded pane menu handles real native views and stays inside pane and window bounds", t => {
  runBrowserTest(t, "test/fixtures/pane-expansion-menu.browser.js", {
    main: "test/fixtures/pane-expansion-menu.main.cjs",
    preload: "test/fixtures/pane-expansion-menu.preload.cjs"
  });
});
