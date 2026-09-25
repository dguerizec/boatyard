import { rebuildPaneLayoutFromRects } from "./paneRectLayout.js";
import type { PaneLayoutNode, PaneNode } from "./paneLayoutState.js";

export type PaneExpansionRect = {
  bottom: number;
  id: string;
  left: number;
  right: number;
  top: number;
};

type ExpansionBounds = Omit<PaneExpansionRect, "id">;

const intersectionTolerance = 0.5;

function unionBounds(bounds: ExpansionBounds, rect: PaneExpansionRect): ExpansionBounds {
  return {
    bottom: Math.max(bounds.bottom, rect.bottom),
    left: Math.min(bounds.left, rect.left),
    right: Math.max(bounds.right, rect.right),
    top: Math.min(bounds.top, rect.top)
  };
}

function intersectsBounds(bounds: ExpansionBounds, rect: PaneExpansionRect) {
  return rect.right > bounds.left + intersectionTolerance &&
    rect.left < bounds.right - intersectionTolerance &&
    rect.bottom > bounds.top + intersectionTolerance &&
    rect.top < bounds.bottom - intersectionTolerance;
}

function containsRect(bounds: ExpansionBounds, rect: PaneExpansionRect) {
  return rect.left >= bounds.left - intersectionTolerance &&
    rect.right <= bounds.right + intersectionTolerance &&
    rect.top >= bounds.top - intersectionTolerance &&
    rect.bottom <= bounds.bottom + intersectionTolerance;
}

export function resolvePaneExpansionPaneIds(rects: PaneExpansionRect[], selectedPaneIds: Iterable<string>) {
  const selectedIds = new Set(selectedPaneIds);
  const selectedRects = rects.filter((rect) => selectedIds.has(rect.id));
  if (!selectedRects.length) {
    return [];
  }

  let bounds: ExpansionBounds = {
    bottom: selectedRects[0].bottom,
    left: selectedRects[0].left,
    right: selectedRects[0].right,
    top: selectedRects[0].top
  };
  for (const rect of selectedRects.slice(1)) {
    bounds = unionBounds(bounds, rect);
  }

  let didExpand = true;
  while (didExpand) {
    didExpand = false;
    for (const rect of rects) {
      if (!intersectsBounds(bounds, rect) || containsRect(bounds, rect)) {
        continue;
      }

      bounds = unionBounds(bounds, rect);
      didExpand = true;
    }
  }

  return rects
    .filter((rect) => intersectsBounds(bounds, rect) && containsRect(bounds, rect))
    .map((rect) => rect.id);
}

// Rebuild the split tree from displayed rectangles: closing leaves one by one
// would redistribute their space to siblings outside the expanded area.
export function mergePaneExpansion(
  layout: PaneLayoutNode,
  source: PaneNode,
  paneIds: string[],
  rects: PaneExpansionRect[],
  resizerSize: number
): PaneLayoutNode | null {
  const panes = new Map<string, PaneNode>();
  function collect(node: PaneLayoutNode) {
    if (node.type === "pane") panes.set(node.id, node);
    else {
      collect(node.first);
      collect(node.second);
    }
  }
  collect(layout);
  const selected = new Set(paneIds);
  if (!selected.has(source.id) || selected.size < 2 || rects.length !== panes.size ||
      new Set(rects.map((rect) => rect.id)).size !== panes.size ||
      rects.some((rect) => !panes.has(rect.id) ||
        ![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) ||
        rect.right <= rect.left || rect.bottom <= rect.top) ||
      paneIds.some((id) => !panes.has(id))) return null;

  function bounds(items: PaneExpansionRect[]) {
    return items.slice(1).reduce(unionBounds, items[0]);
  }
  const merged = { ...bounds(rects.filter((rect) => selected.has(rect.id))), id: source.id };
  const remaining = [...rects.filter((rect) => !selected.has(rect.id)).map((rect) => {
    const adjusted = { ...rect };
    // The brush can span slightly staggered dividers when its edge still falls
    // inside their gutters. Make room for one straight divider at that edge.
    for (const [start, end, crossStart, crossEnd] of [
      ["left", "right", "top", "bottom"], ["top", "bottom", "left", "right"]
    ] as const) {
      if (rect[crossEnd] <= merged[crossStart] || rect[crossStart] >= merged[crossEnd]) continue;
      if (rect[start] >= merged[end] - intersectionTolerance &&
          rect[start] < merged[end] + resizerSize) adjusted[start] = merged[end] + resizerSize;
      if (rect[end] <= merged[start] + intersectionTolerance &&
          rect[end] > merged[start] - resizerSize) adjusted[end] = merged[start] - resizerSize;
    }
    return adjusted;
  }), merged];
  return rebuildPaneLayoutFromRects(layout, remaining, resizerSize);
}
