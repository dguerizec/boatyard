import {
  normalizePaneSplitRatio,
  type PaneLayoutGeometryNode,
  type PaneMinimumAxis,
  type PaneMinimumSizeResolver,
  type PaneSplitGeometryNode
} from "./paneSplitGeometry.js";

type Edge = { position: number; velocity: number };

// Capture divider coordinates once, so dragging is independent of tree nesting
// and every move is calculated from the original pointer position.
export function createPaneTranslation(
  root: PaneLayoutGeometryNode,
  paneId: string,
  axis: PaneMinimumAxis,
  containerSize: number,
  resizerSize: number,
  getMinimumSize: PaneMinimumSizeResolver
) {
  const direction = axis === "width" ? "vertical" : "horizontal";
  let boundaries: [string, string] | null = null;
  function find(node: PaneLayoutGeometryNode, before: string | null, after: string | null) {
    if (node.type === "pane") {
      if (node.id === paneId && before && after) boundaries = [before, after];
      return;
    }
    if (node.expandedChild) return;
    const aligned = node.direction === direction;
    find(node.first, before, aligned ? node.id : after);
    find(node.second, aligned ? node.id : before, after);
  }
  find(root, null, null);
  if (!boundaries || containerSize <= 0) return null;

  const moving = new Set<string>(boundaries);
  const splits: Array<{ node: PaneSplitGeometryNode; start: Edge; end: Edge; center: Edge }> = [];
  let minimum = -Infinity;
  let maximum = Infinity;
  function visit(node: PaneLayoutGeometryNode, start: Edge, end: Edge) {
    if (node.type === "pane") {
      const size = end.position - start.position;
      const velocity = end.velocity - start.velocity;
      // An already undersized neighbor must not shrink further.
      const slack = Math.max(0, size - getMinimumSize(node, axis));
      if (velocity > 0) minimum = Math.max(minimum, -slack / velocity);
      if (velocity < 0) maximum = Math.min(maximum, slack / -velocity);
      return;
    }
    if (node.direction !== direction) {
      visit(node.first, start, end);
      visit(node.second, start, end);
      return;
    }
    const center = {
      position: start.position + normalizePaneSplitRatio(node.ratio) * (end.position - start.position),
      velocity: moving.has(node.id) ? 1 : 0
    };
    splits.push({ node, start, end, center });
    visit(node.first, start, { ...center, position: center.position - resizerSize / 2 });
    visit(node.second, { ...center, position: center.position + resizerSize / 2 }, end);
  }
  visit(root, { position: 0, velocity: 0 }, { position: containerSize, velocity: 0 });
  if (minimum === 0 && maximum === 0) return null;
  return {
    apply(delta: number) {
      const movement = Math.min(maximum, Math.max(minimum, delta));
      for (const { node, start, end, center } of splits) {
        const left = start.position + start.velocity * movement;
        const right = end.position + end.velocity * movement;
        node.ratio = (center.position + center.velocity * movement - left) / (right - left);
      }
      return splits.map(({ node }) => node);
    }
  };
}
