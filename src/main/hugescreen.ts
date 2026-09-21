import type { BrowserWindow, Input, MouseInputEvent, Rectangle } from "electron";
import { NO_FRAME_INSETS, type WindowFrameInsets } from "./windowFrameInsets.js";

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
  screenStart: number, screenLength: number): number {
  const delta = to - from;
  if (!delta) return position;
  const direction = Math.sign(delta);
  const remaining = Math.max(0, direction > 0 ? position - minimum : maximum - position);
  const screenEnd = screenStart + screenLength - 1;
  const distanceToEdge = Math.max(0, direction > 0 ? screenEnd - from : from - screenStart);
  // Reaching the screen edge reaches the window edge, even for very large windows.
  // Between edges, quadratic proximity and remaining travel amplify each movement.
  const proximity = 1 - Math.min(1, distanceToEdge / Math.max(1, screenLength));
  const distance = Math.abs(delta);
  const travel = distance >= distanceToEdge ? remaining : Math.min(remaining,
    distance + remaining * (distance / Math.max(1, distanceToEdge)) * proximity ** 2);
  return Math.round(Math.min(maximum, Math.max(minimum, position - direction * travel)));
}

export function calculateHugescreenPan(
  bounds: Rectangle, area: Rectangle, from: Point, to: Point, frame = NO_FRAME_INSETS
): Point {
  const limits = panLimits(bounds, area, frame);
  return {
    x: panAxis(bounds.x, limits.minX, limits.maxX, from.x, to.x, area.x, area.width),
    y: panAxis(bounds.y, limits.minY, limits.maxY, from.y, to.y, area.y, area.height)
  };
}

/** Moves only the native parent. Child view geometry stays unchanged during panning. */
export class Hugescreen {
  private enabled = false;
  private area: Rectangle | null = null;
  private lastCursor: Point | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private controlDownAt: number | null = null;
  private lastControlTap: number | null = null;
  private scrollPauseUntil = 0;

  constructor(private readonly options: Options) {}

  get active() { return this.enabled; }

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

  resetPointer(): void { this.lastCursor = this.options.getCursor(); }

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
    this.lastCursor = cursor;
    if (!previous || !this.area || window.isMaximized() || window.isFullScreen() ||
      Date.now() < this.scrollPauseUntil) return;
    // Global coordinates ignore synthetic motion caused by moving the window itself.
    const bounds = window.getBounds();
    const point = calculateHugescreenPan(bounds, this.area, previous, cursor, this.options.getFrameInsets?.());
    if (bounds.x !== point.x || bounds.y !== point.y) window.setPosition(point.x, point.y);
  }
}
