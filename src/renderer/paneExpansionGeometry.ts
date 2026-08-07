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
