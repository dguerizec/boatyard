type Point = { x: number; y: number };
type Rectangle = Point & { width: number; height: number };
type WindowFrameInsets = { left: number; right: number; top: number; bottom: number };
const NO_FRAME_INSETS: WindowFrameInsets = { left: 0, right: 0, top: 0, bottom: 0 };

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
