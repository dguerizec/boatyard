import type { PaneLayoutNode } from "./paneLayoutState.js";
import type { PaneExpansionRect } from "./paneExpansionGeometry.js";
import { rebuildPaneLayoutFromRects } from "./paneRectLayout.js";
import { snapPaneSplitRatio, type PaneMinimumSizeResolver } from "./paneSplitGeometry.js";

type Bounds = Omit<PaneExpansionRect, "id">;
type Point = { x: number; y: number };
type Edge = {
  paneId: string;
  side: "left" | "right" | "top" | "bottom";
  axis: "x" | "y";
  position: number;
  start: number;
  end: number;
};
type Segment = Omit<Edge, "paneId" | "side"> & { edges: Edge[] };
const tolerance = 0.75;

function collectSegments(rects: PaneExpansionRect[], resizerSize: number): Segment[] {
  const half = resizerSize / 2;
  const edges = rects.flatMap(rect => [
    { paneId: rect.id, side: "left" as const, axis: "x" as const, position: rect.left - half, start: rect.top, end: rect.bottom },
    { paneId: rect.id, side: "right" as const, axis: "x" as const, position: rect.right + half, start: rect.top, end: rect.bottom },
    { paneId: rect.id, side: "top" as const, axis: "y" as const, position: rect.top - half, start: rect.left, end: rect.right },
    { paneId: rect.id, side: "bottom" as const, axis: "y" as const, position: rect.bottom + half, start: rect.left, end: rect.right }
  ]);
  const pending = new Set(edges);
  const segments: Segment[] = [];
  for (const edge of edges) {
    if (!pending.delete(edge)) continue;
    const group = [edge];
    for (const member of group) {
      for (const candidate of pending) {
        // Positive overlap joins a T through its spanning pane. Merely touching
        // at a four-way crossing keeps the opposite branches independent.
        if (candidate.axis === member.axis && Math.abs(candidate.position - member.position) <= tolerance &&
            Math.min(candidate.end, member.end) - Math.max(candidate.start, member.start) > tolerance) {
          group.push(candidate);
          pending.delete(candidate);
        }
      }
    }
    if (new Set(group.map(item => item.side)).size < 2) continue;
    segments.push({ axis: edge.axis, position: edge.position,
      start: Math.min(...group.map(item => item.start)) - half,
      end: Math.max(...group.map(item => item.end)) + half, edges: group });
  }
  return segments;
}

export function createPaneCrossingResize(
  layout: PaneLayoutNode,
  rects: PaneExpansionRect[],
  point: Point,
  handle: Bounds,
  direction: string,
  resizerSize: number,
  getMinimumSize: PaneMinimumSizeResolver,
  hiddenBounds: Bounds[] = []
) {
  const half = resizerSize / 2;
  const segments = collectSegments(rects, resizerSize).filter(segment => !hiddenBounds.some(bounds => (
    segment.axis === "x"
      ? segment.position > bounds.left && segment.position < bounds.right && segment.start >= bounds.top - half && segment.end <= bounds.bottom + half
      : segment.position > bounds.top && segment.position < bounds.bottom && segment.start >= bounds.left - half && segment.end <= bounds.right + half
  )));
  // An expanded pane can hide one arm of a plus, turning its visible boundary
  // into a T. Join the through-edge again in that case.
  for (let first = 0; first < segments.length; first++) {
    for (let second = first + 1; second < segments.length; second++) {
      const a = segments[first], b = segments[second];
      if (a.axis !== b.axis || Math.abs(a.position - b.position) > tolerance) continue;
      const joint = Math.abs(a.end - b.start) <= tolerance ? a.end : Math.abs(b.end - a.start) <= tolerance ? b.end : null;
      if (joint === null) continue;
      const perpendicular = segments.filter(segment => segment.axis !== a.axis && Math.abs(segment.position - joint) <= tolerance);
      const before = perpendicular.some(segment => segment.start < a.position - tolerance && segment.end >= a.position - tolerance);
      const after = perpendicular.some(segment => segment.end > a.position + tolerance && segment.start <= a.position + tolerance);
      if (before && after) continue;
      a.start = Math.min(a.start, b.start);
      a.end = Math.max(a.end, b.end);
      a.edges.push(...b.edges);
      segments.splice(second, 1);
      second = first;
    }
  }
  const hitRadius = Math.max(half, 4);
  const nearPointer = segments.filter(segment => {
    const along = segment.axis === "x" ? point.y : point.x;
    return Math.abs(point[segment.axis] - segment.position) <= hitRadius &&
      along >= segment.start - hitRadius && along <= segment.end + hitRadius;
  });
  const nearest = (axis: "x" | "y") => nearPointer.filter(segment => segment.axis === axis)
    .sort((a, b) => Math.abs(a.position - point[axis]) - Math.abs(b.position - point[axis]))[0];
  const vertical = nearest("x");
  const horizontal = nearest("y");
  const crossing = Boolean(vertical && horizontal &&
    horizontal.position >= vertical.start - tolerance && horizontal.position <= vertical.end + tolerance &&
    vertical.position >= horizontal.start - tolerance && vertical.position <= horizontal.end + tolerance);
  const axis = direction === "vertical" ? "x" : "y";
  // Resolve all branches at the intersection, even when the pointer is a few
  // pixels off its center inside the separator's hit area.
  const selected = crossing ? segments.filter(segment => {
    const position = segment.axis === "x" ? vertical.position : horizontal.position;
    const along = segment.axis === "x" ? horizontal.position : vertical.position;
    return Math.abs(segment.position - position) <= tolerance && along >= segment.start - tolerance && along <= segment.end + tolerance;
  }) : nearPointer.filter(segment => segment.axis === axis &&
    point[axis === "x" ? "y" : "x"] >= segment.start - tolerance &&
    point[axis === "x" ? "y" : "x"] <= segment.end + tolerance);
  if (!selected.length) return null;
  if (!crossing && selected.every(segment => (
    segment.start <= (axis === "x" ? handle.top : handle.left) + tolerance &&
    segment.end >= (axis === "x" ? handle.bottom : handle.right) - tolerance
  ))) return null;

  function axisPlan(axis: "x" | "y") {
    const moving = selected.filter(segment => segment.axis === axis);
    if (!moving.length) return null;
    const edges = moving.flatMap(segment => segment.edges);
    let minimum = -Infinity;
    let maximum = Infinity;
    for (const edge of edges) {
      const rect = rects.find(candidate => candidate.id === edge.paneId)!;
      const size = axis === "x" ? rect.right - rect.left : rect.bottom - rect.top;
      const slack = Math.max(0, size - getMinimumSize({ type: "pane", id: edge.paneId }, axis === "x" ? "width" : "height"));
      if (edge.side === "left" || edge.side === "top") maximum = Math.min(maximum, slack);
      else minimum = Math.max(minimum, -slack);
    }
    const position = moving[0].position;
    const targets = segments.filter(segment => segment.axis === axis && !moving.includes(segment) &&
      moving.some(source => Math.min(Math.abs(source.start - segment.end), Math.abs(source.end - segment.start)) <= tolerance));
    return { edges, minimum, maximum, position, targets };
  }
  const plans = { x: axisPlan("x"), y: axisPlan("y") };
  return {
    crossing,
    apply(nextPoint: Point) {
      const next = rects.map(rect => ({ ...rect }));
      for (const axis of ["x", "y"] as const) {
        const plan = plans[axis];
        if (!plan) continue;
        // Express the allowed interval as a split with no gutter so the same
        // snapping rule used by ordinary separators applies to crossing drags.
        const length = plan.maximum - plan.minimum;
        const delta = length > 0 ? plan.minimum + length * snapPaneSplitRatio(
          (nextPoint[axis] - point[axis] - plan.minimum) / length,
          length, 0, 0, 0,
          plan.targets.map(target => (target.position - plan.position - plan.minimum) / length)
        ) : 0;
        for (const edge of plan.edges) {
          next.find(rect => rect.id === edge.paneId)![edge.side] += delta;
        }
      }
      return rebuildPaneLayoutFromRects(layout, next, resizerSize);
    }
  };
}
