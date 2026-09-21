import type { BrowserWindow, Input, MouseInputEvent, Rectangle } from "electron";
import { NO_FRAME_INSETS, type WindowFrameInsets } from "./windowFrameInsets.js";

import { HugescreenMotion } from "./hugescreenMotion.js";

type Point = { x: number; y: number };
type Options = {
  window: BrowserWindow;
  getWorkArea(): Rectangle;
  getFrameInsets?(): WindowFrameInsets;
  getCursor(): Point;
  changed(active: boolean): void;
};

function panLimits(bounds: Rectangle, area: Rectangle, frame: WindowFrameInsets) {
  const left = area.x + frame.left;
  const right = area.x + area.width - bounds.width - frame.right;
  const top = area.y + frame.top;
  const bottom = area.y + area.height - bounds.height - frame.bottom;
  return {
    minX: Math.min(left, right), maxX: Math.max(left, right),
    minY: Math.min(top, bottom), maxY: Math.max(top, bottom)
  };
}

/** Electron's native integer conversion rejects JavaScript's negative zero. */
export function roundHugescreenPosition(point: Point): Point {
  return { x: Math.round(point.x) + 0, y: Math.round(point.y) + 0 };
}

export function clampHugescreenPosition(
  bounds: Rectangle, area: Rectangle, point: Point, frame = NO_FRAME_INSETS
): Point {
  const limits = panLimits(bounds, area, frame);
  return {
    x: Math.round(Math.min(limits.maxX, Math.max(limits.minX, point.x))),
    y: Math.round(Math.min(limits.maxY, Math.max(limits.minY, point.y)))
  };
}

function panAxis(position: number, minimum: number, maximum: number, from: number, to: number,
  screenStart: number, screenLength: number, sensitivity: number, windowStart: number, windowEnd: number): number {
  const delta = to - from;
  if (!delta) return position;
  // Protect departure from an aligned edge, never arrival at an off-screen edge.
  const leavingStart = delta > 0 && Math.round(windowStart) === screenStart &&
    to - windowStart < screenLength * 0.15;
  const leavingEnd = delta < 0 && Math.round(windowEnd) === screenStart + screenLength &&
    windowEnd - to < screenLength * 0.15;
  if (leavingStart || leavingEnd) return position;
  const direction = Math.sign(delta);
  const remaining = Math.max(0, direction > 0 ? position - minimum : maximum - position);
  const screenEnd = screenStart + screenLength - 1;
  const distanceToEdge = Math.max(0, direction > 0 ? screenEnd - from : from - screenStart);
  // Reaching the screen edge reaches the window edge, even for very large windows.
  // Between edges, quadratic proximity and remaining travel amplify each movement.
  const proximity = 1 - Math.min(1, distanceToEdge / Math.max(1, screenLength));
  // Restore gain progressively over the last 30% of the screen even at low speed.
  // Otherwise quarter-speed travel leaves a large catch-up step at the screen edge.
  const edgeBlend = Math.max(0, 1 - distanceToEdge / Math.max(1, screenLength * 0.3));
  const edgeSensitivity = edgeBlend * edgeBlend * (3 - 2 * edgeBlend);
  const effectiveSensitivity = sensitivity + (1 - sensitivity) * edgeSensitivity;
  const distance = Math.abs(delta);
  const amplified = distance + remaining * (distance / Math.max(1, distanceToEdge)) * proximity ** 2;
  const travel = distance >= distanceToEdge ? remaining : Math.min(remaining,
    distance * 0.25 * (1 - effectiveSensitivity) + amplified * effectiveSensitivity);
  return Math.min(maximum, Math.max(minimum, position - direction * travel));
}

export function calculateHugescreenPan(
  bounds: Rectangle, area: Rectangle, from: Point, to: Point, frame = NO_FRAME_INSETS, elapsedMs = 16
): Point {
  const limits = panLimits(bounds, area, frame);
  // Logical pixels per second: precise local motion blends smoothly into full gain.
  const speed = Math.hypot(to.x - from.x, to.y - from.y) * 1000 / Math.max(1, elapsedMs);
  const blend = Math.max(0, Math.min(1, (speed - 120) / (900 - 120)));
  const sensitivity = blend * blend * (3 - 2 * blend);
  return {
    x: panAxis(bounds.x, limits.minX, limits.maxX, from.x, to.x, area.x, area.width, sensitivity,
      bounds.x - frame.left, bounds.x + bounds.width + frame.right),
    y: panAxis(bounds.y, limits.minY, limits.maxY, from.y, to.y, area.y, area.height, sensitivity,
      bounds.y - frame.top, bounds.y + bounds.height + frame.bottom)
  };
}

/** Moves only the native parent. Child view geometry stays unchanged during panning. */
export class Hugescreen {
  private readonly motion = new HugescreenMotion();
  private enabled = false;
  private area: Rectangle | null = null;
  private lastCursor: Point | null = null;
  private lastSampleAt = 0;
  private remainder: Point = { x: 0, y: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private controlDownAt: number | null = null;
  private lastControlTap: number | null = null;
  private scrollPauseUntil = 0;

  constructor(private readonly options: Options) {}

  get active() { return this.enabled; }

  /** Called once after startup geometry and native decorations have been restored. */
  enableForOversizedWindow(): void {
    const window = this.options.window;
    if (this.active || window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return;
    const bounds = window.getBounds();
    const area = this.options.getWorkArea();
    const frame = this.options.getFrameInsets?.() || NO_FRAME_INSETS;
    if (bounds.width + frame.left + frame.right > area.width ||
      bounds.height + frame.top + frame.bottom > area.height) this.toggle();
  }

  toggle(): boolean {
    this.stopPolling();
    this.enabled = !this.enabled;
    this.area = this.enabled ? this.options.getWorkArea() : null;
    if (this.enabled) this.resume();
    this.options.changed(this.enabled);
    return this.enabled;
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastCursor = null;
    this.resetTaps();
  }

  /** Losing focus pauses sampling without clearing the user's pan lock. */
  suspend(): void {
    this.stopPolling();
    this.scrollPauseUntil = 0;
  }

  resume(): void {
    if (!this.enabled || this.timer || this.options.window.isDestroyed()) return;
    this.resetPointer();
    this.timer = setInterval(() => this.pan(), 16);
  }

  resetPointer(deadZone = false): void {
    this.lastCursor = this.options.getCursor();
    this.lastSampleAt = performance.now();
    this.motion.reset(this.lastCursor, this.lastSampleAt, deadZone);
    this.remainder = { x: 0, y: 0 };
  }

  dispose(): void {
    this.suspend();
    this.enabled = false;
  }

  private resetTaps(): void {
    this.controlDownAt = null;
    this.lastControlTap = null;
  }

  handleKey(input: Input, now = Date.now()): boolean {
    if (this.active && input.key === "Escape" && input.type === "keyDown") {
      this.toggle();
      return true;
    }
    if (input.key !== "Control" || input.alt || input.meta || input.shift) {
      this.resetTaps();
      return false;
    }
    if (input.isAutoRepeat) return false;
    if (input.type === "keyDown") {
      this.controlDownAt = now;
    } else if (input.type === "keyUp") {
      const downAt = this.controlDownAt;
      this.controlDownAt = null;
      if (downAt === null || now - downAt > 250) {
        this.resetTaps();
      } else if (this.lastControlTap !== null && downAt - this.lastControlTap <= 350) {
        this.toggle();
      } else {
        this.lastControlTap = now;
      }
    }
    // Modifier events must reach Chromium for their matching keyUp to be delivered.
    return false;
  }

  /** Observe mouse interactions without consuming any page event. */
  handleMouse(mouse: MouseInputEvent, now = Date.now()): void {
    if (mouse.type === "mouseDown") {
      this.resetTaps();
      this.resetPointer(true);
    } else if (mouse.type === "mouseUp") {
      this.resetPointer(true);
    } else if (mouse.type === "mouseWheel") {
      this.scrollPauseUntil = now + 150;
      this.resetPointer();
    }
  }

  private pan(): void {
    const window = this.options.window;
    if (window.isDestroyed()) { this.dispose(); return; }
    if (!window.isFocused()) { this.suspend(); return; }
    const cursor = this.options.getCursor();
    const previous = this.lastCursor;
    const now = performance.now();
    const elapsed = now - this.lastSampleAt;
    this.lastSampleAt = now;
    this.lastCursor = cursor;
    if (!previous || !this.area || window.isMaximized() || window.isFullScreen() ||
      Date.now() < this.scrollPauseUntil) {
      this.remainder = { x: 0, y: 0 };
      this.motion.reset(cursor, now);
      return;
    }
    const delta = this.motion.filter(previous, cursor, now);
    // A dead zone or reversal threshold must not trap the final pixels at a
    // physical boundary. Only a new movement into that boundary can complete pan.
    for (const axis of ["x", "y"] as const) {
      const start = this.area[axis];
      const end = start + (axis === "x" ? this.area.width : this.area.height) - 1;
      if ((cursor[axis] <= start && previous[axis] > start) ||
        (cursor[axis] >= end && previous[axis] < end)) {
        delta[axis] = cursor[axis] - previous[axis];
      }
    }
    if (!delta.x && !delta.y) return;
    // Global coordinates ignore synthetic motion caused by moving the window itself.
    const bounds = window.getBounds();
    const precise = calculateHugescreenPan({ ...bounds,
      x: bounds.x + this.remainder.x, y: bounds.y + this.remainder.y
    }, this.area, { x: cursor.x - delta.x, y: cursor.y - delta.y }, cursor, this.options.getFrameInsets?.(), elapsed);
    const point = roundHugescreenPosition(precise);
    // Carry subpixel travel into the next movement, never into stationary samples.
    this.remainder = { x: precise.x - point.x, y: precise.y - point.y };
    if (bounds.x !== point.x || bounds.y !== point.y) window.setPosition(point.x, point.y);
  }
}
