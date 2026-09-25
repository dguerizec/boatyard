import type { PaneLayoutNode, PaneNode } from "./paneLayoutState.js";
import type { PaneExpansionRect } from "./paneExpansionGeometry.js";

type ExpansionBounds = Omit<PaneExpansionRect, "id">;

// Reuse existing pane objects while changing only their split-tree geometry.
export function rebuildPaneLayoutFromRects(
  layout: PaneLayoutNode, rects: PaneExpansionRect[], resizerSize: number
): PaneLayoutNode | null {
  const panes = new Map<string, PaneNode>();
  const splitIds: string[] = [];
  function collect(node: PaneLayoutNode) {
    if (node.type === "pane") panes.set(node.id, node);
    else { splitIds.push(node.id); collect(node.first); collect(node.second); }
  }
  collect(layout);
  if (!rects.length || new Set(rects.map(rect => rect.id)).size !== rects.length ||
      rects.some(rect => !panes.has(rect.id) || rect.right <= rect.left || rect.bottom <= rect.top ||
        ![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite))) return null;
  const tolerance = 0.75;
  function bounds(items: PaneExpansionRect[]): ExpansionBounds {
    return {
      left: Math.min(...items.map(rect => rect.left)), right: Math.max(...items.map(rect => rect.right)),
      top: Math.min(...items.map(rect => rect.top)), bottom: Math.max(...items.map(rect => rect.bottom))
    };
  }
  let splitIndex = 0;
  function build(items: PaneExpansionRect[], area: ExpansionBounds): PaneLayoutNode | null {
    if (items.length === 1) {
      const rect = items[0];
      if ((["left", "right", "top", "bottom"] as const)
        .some((edge) => Math.abs(rect[edge] - area[edge]) > tolerance)) return null;
      return panes.get(rect.id) || null;
    }
    for (const direction of ["vertical", "horizontal"]) {
      const start = direction === "vertical" ? "left" : "top";
      const end = direction === "vertical" ? "right" : "bottom";
      for (const edge of [...new Set(items.map((rect) => rect[end]))].sort((a, b) => a - b)) {
        const firstItems = items.filter((rect) => rect[end] <= edge + tolerance);
        const secondItems = items.filter((rect) => rect[end] > edge + tolerance);
        if (!firstItems.length || !secondItems.length) continue;
        const nextStart = Math.min(...secondItems.map((rect) => rect[start]));
        if (Math.abs(nextStart - edge - resizerSize) > tolerance) continue;
        const center = (edge + nextStart) / 2;
        const previousSplitIndex = splitIndex;
        const first = build(firstItems, { ...area, [end]: center - resizerSize / 2 });
        const second = build(secondItems, { ...area, [start]: center + resizerSize / 2 });
        if (!first || !second) {
          splitIndex = previousSplitIndex;
          continue;
        }
        return {
          type: "split", id: splitIds[splitIndex++], direction,
          ratio: (center - area[start]) / (area[end] - area[start]), first, second
        };
      }
    }
    return null;
  }
  return build(rects, bounds(rects));
}
