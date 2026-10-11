type Point = { x: number; y: number };

/** Filters pointer travel only; it never generates movement after the pointer stops. */
export class HugescreenMotion {
  private anchor: Point | null = null;
  private lastMotionAt = 0;
  private extreme: Point = { x: 0, y: 0 };
  private direction: Point = { x: 0, y: 0 };

  reset(point: Point, now: number, deadZone = false): void {
    this.anchor = deadZone ? { ...point } : null;
    this.lastMotionAt = now;
    this.extreme = { ...point };
    this.direction = { x: 0, y: 0 };
  }

  filter(from: Point, to: Point, now: number): Point {
    if (!this.anchor && now - this.lastMotionAt >= 160) this.reset(from, now, true);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (!distance) return { x: 0, y: 0 };
    this.lastMotionAt = now;
    if (this.anchor) {
      const radius = Math.hypot(to.x - this.anchor.x, to.y - this.anchor.y);
      if (radius <= 30) return { x: 0, y: 0 };
      // Consume the dead zone instead of replaying it as a jump on exit.
      const fraction = Math.min(1, (radius - 30) / distance);
      this.extreme = { x: to.x - (to.x - from.x) * fraction, y: to.y - (to.y - from.y) * fraction };
      this.direction = { x: 0, y: 0 };
      this.anchor = null;
    }
    const delta = { x: 0, y: 0 };
    for (const axis of ["x", "y"] as const) {
      const travel = to[axis] - this.extreme[axis];
      const direction = Math.sign(travel);
      if (!direction) continue;
      const reversing = this.direction[axis] !== 0 && direction !== this.direction[axis];
      if (reversing && Math.abs(travel) <= 6) continue;
      delta[axis] = travel - (reversing ? direction * 6 : 0);
      this.direction[axis] = direction;
      this.extreme[axis] = to[axis];
    }
    return delta;
  }
}
