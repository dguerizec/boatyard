import type { BrowserWindow, Input, MouseInputEvent, Rectangle } from "electron";

type Point = { x: number; y: number };
type Options = {
  window: BrowserWindow;
  getWorkArea(): Rectangle;
  getCursor(): Point;
  changed(active: boolean): void;
};

export function clampHugescreenPosition(bounds: Rectangle, area: Rectangle, point: Point): Point {
  return {
    x: Math.round(Math.min(Math.max(area.x, area.x + area.width - bounds.width),
      Math.max(Math.min(area.x, area.x + area.width - bounds.width), point.x))),
    y: Math.round(Math.min(Math.max(area.y, area.y + area.height - bounds.height),
      Math.max(Math.min(area.y, area.y + area.height - bounds.height), point.y)))
  };
}

/** Moves only the native parent. Child view geometry stays unchanged during panning. */
export class Hugescreen {
  private enabled = false;
  private area: Rectangle | null = null;
  private panOrigin: { cursor: Point; bounds: Rectangle } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private controlDownAt: number | null = null;
  private lastControlTap: number | null = null;

  constructor(private readonly options: Options) {}

  get active() { return this.enabled; }

  toggle(): boolean {
    this.stopPan();
    this.enabled = !this.enabled;
    this.area = this.enabled ? this.options.getWorkArea() : null;
    this.options.changed(this.enabled);
    return this.enabled;
  }

  stopPan(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.panOrigin = null;
    this.controlDownAt = null;
    this.lastControlTap = null;
  }

  handleKey(input: Input, now = Date.now()): boolean {
    if (!this.active) return false;
    if (input.key === "Escape") {
      const wasPanning = this.panOrigin !== null;
      if (input.type === "keyDown") this.stopPan();
      return wasPanning;
    }
    if (input.key !== "Control" || input.alt || input.meta || input.shift) {
      this.stopPan();
      return false;
    }
    if (input.isAutoRepeat) return this.panOrigin !== null;
    if (input.type === "keyDown") {
      this.controlDownAt = now;
      if (this.lastControlTap !== null && now - this.lastControlTap <= 350) {
        this.lastControlTap = null;
        this.startPan();
        return this.panOrigin !== null;
      }
      this.lastControlTap = null;
    } else if (input.type === "keyUp") {
      const wasPanning = this.panOrigin !== null;
      const wasTap = this.controlDownAt !== null && now - this.controlDownAt <= 250;
      this.stopPan();
      if (!wasPanning && wasTap) this.lastControlTap = now;
      return wasPanning;
    }
    return false;
  }

  handleMouse(mouse: MouseInputEvent): boolean {
    if (!this.active || !this.panOrigin) return false;
    // before-mouse-event may omit modifiers even while Ctrl is held. Keyboard
    // keyUp and window blur own cancellation; only use modifiers when supplied.
    const modifiers = mouse.modifiers;
    if (modifiers && (!(modifiers.includes("control") || modifiers.includes("ctrl")) ||
      modifiers.includes("shift") || modifiers.includes("alt") || modifiers.includes("meta"))) {
      this.stopPan();
      return false;
    }
    return true;
  }

  private startPan(): void {
    if (this.panOrigin || this.options.window.isMaximized() || this.options.window.isFullScreen()) return;
    this.panOrigin = { cursor: this.options.getCursor(), bounds: this.options.window.getBounds() };
    // Screen coordinates avoid a feedback loop when moving the window under a stationary cursor.
    this.timer = setInterval(() => this.pan(), 16);
  }

  private pan(): void {
    if (!this.panOrigin || !this.area || this.options.window.isDestroyed()) {
      this.stopPan();
      return;
    }
    const cursor = this.options.getCursor();
    const point = clampHugescreenPosition(this.panOrigin.bounds, this.area, {
      x: this.panOrigin.bounds.x - (cursor.x - this.panOrigin.cursor.x),
      y: this.panOrigin.bounds.y - (cursor.y - this.panOrigin.cursor.y)
    });
    const [x, y] = this.options.window.getPosition();
    if (x !== point.x || y !== point.y) this.options.window.setPosition(point.x, point.y);
  }
}
