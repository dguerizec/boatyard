import type { Rectangle } from "electron";
import { NO_FRAME_INSETS, type WindowFrameInsets } from "./windowFrameInsets.js";

type Point = { x: number; y: number };
export const EDGE_DWELL_MS = 180;
export const EDGE_ANIMATION_MS = 280;

/** Half-screen steps retain context; the last step stops at the native frame. */
export function edgePanTarget(bounds: Rectangle, area: Rectangle, direction: Point,
  frame: WindowFrameInsets = NO_FRAME_INSETS): Point {
  const axis = (position: number, size: number, start: number, length: number,
    before: number, after: number, sign: number) => size + before + after <= length ? position :
    Math.max(start + length - size - after, Math.min(start + before, position - sign * length / 2));
  return {
    x: direction.x ? Math.round(axis(bounds.x, bounds.width, area.x, area.width, frame.left, frame.right, direction.x)) + 0 : bounds.x,
    y: direction.y ? Math.round(axis(bounds.y, bounds.height, area.y, area.height, frame.top, frame.bottom, direction.y)) + 0 : bounds.y
  };
}

export function edgeAnimationPosition(from: Point, to: Point, elapsed: number): Point {
  const fraction = Math.max(0, Math.min(1, elapsed / EDGE_ANIMATION_MS));
  const eased = fraction * fraction * (3 - 2 * fraction);
  return { x: Math.round(from.x + (to.x - from.x) * eased) + 0,
    y: Math.round(from.y + (to.y - from.y) * eased) + 0 };
}

/** A dwell must start inside the screen, so activation never causes a surprise step. */
export class HugescreenEdge {
  private armed = false;
  private edge = "";
  private since = 0;

  reset(): void { this.armed = false; this.edge = ""; }

  sample(cursor: Point, bounds: Rectangle, area: Rectangle, now: number,
    frame: WindowFrameInsets = NO_FRAME_INSETS): Point | null {
    if (cursor.x < area.x || cursor.y < area.y || cursor.x >= area.x + area.width || cursor.y >= area.y + area.height) {
      this.reset();
      return null;
    }
    const direction = {
      x: cursor.x < area.x + 3 ? -1 : cursor.x >= area.x + area.width - 3 ? 1 : 0,
      y: cursor.y < area.y + 3 ? -1 : cursor.y >= area.y + area.height - 3 ? 1 : 0
    };
    const possible = edgePanTarget(bounds, area, direction, frame);
    if (possible.x === bounds.x) direction.x = 0;
    if (possible.y === bounds.y) direction.y = 0;
    if (!direction.x && !direction.y) {
      this.armed = true;
      this.edge = "";
      return null;
    }
    if (!this.armed) return null;
    const edge = `${direction.x},${direction.y}`;
    if (edge !== this.edge) { this.edge = edge; this.since = now; }
    if (now - this.since < EDGE_DWELL_MS) return null;
    this.reset();
    const target = edgePanTarget(bounds, area, direction, frame);
    return target.x === bounds.x && target.y === bounds.y ? null : target;
  }
}
