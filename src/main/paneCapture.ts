export type PaneCaptureRectangle = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type PaneCaptureTarget = {
  bounds: PaneCaptureRectangle;
  paneId: string;
  projectId: string;
  revision: string;
};

export class PaneCaptureError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaneCaptureError";
    this.code = code;
  }
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = typeof source[key] === "string" ? source[key].trim() : "";
  if (!value) {
    throw new PaneCaptureError("INVALID_CAPTURE_TARGET", `The renderer did not provide ${key}.`);
  }
  return value;
}

function readRectangle(value: unknown): PaneCaptureRectangle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaneCaptureError("INVALID_CAPTURE_TARGET", "The renderer did not provide pane bounds.");
  }
  const source = value as Record<string, unknown>;
  for (const key of ["x", "y", "width", "height"] as const) {
    if (typeof source[key] !== "number" || !Number.isSafeInteger(source[key])) {
      throw new PaneCaptureError("INVALID_CAPTURE_TARGET", "The renderer provided invalid pane bounds.");
    }
  }
  const rectangle = {
    x: source.x as number,
    y: source.y as number,
    width: source.width as number,
    height: source.height as number
  };
  if (
    rectangle.x < 0 ||
    rectangle.y < 0 ||
    rectangle.width <= 0 ||
    rectangle.height <= 0
  ) {
    throw new PaneCaptureError("INVALID_CAPTURE_TARGET", "The renderer provided invalid pane bounds.");
  }
  return rectangle;
}

export function parsePaneCaptureTarget(value: unknown): PaneCaptureTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaneCaptureError("INVALID_CAPTURE_TARGET", "The renderer did not provide a capture target.");
  }
  const source = value as Record<string, unknown>;
  return {
    bounds: readRectangle(source.bounds),
    paneId: readString(source, "paneId"),
    projectId: readString(source, "projectId"),
    revision: readString(source, "revision")
  };
}

export function resolvePaneRelativeCaptureRectangle(
  paneBounds: PaneCaptureRectangle,
  requestedRectangle?: PaneCaptureRectangle
): { absolute: PaneCaptureRectangle; relative: PaneCaptureRectangle } {
  const clippedLeft = requestedRectangle ? Math.max(0, requestedRectangle.x) : 0;
  const clippedTop = requestedRectangle ? Math.max(0, requestedRectangle.y) : 0;
  const relative = requestedRectangle
    ? {
        x: clippedLeft,
        y: clippedTop,
        width: Math.min(paneBounds.width, requestedRectangle.x + requestedRectangle.width) - clippedLeft,
        height: Math.min(paneBounds.height, requestedRectangle.y + requestedRectangle.height) - clippedTop
      }
    : { x: 0, y: 0, width: paneBounds.width, height: paneBounds.height };
  if (relative.width <= 0 || relative.height <= 0) {
    throw new PaneCaptureError(
      "CAPTURE_RECT_OUTSIDE_PANE",
      "The requested capture rectangle does not intersect the visible pane."
    );
  }
  return {
    absolute: {
      x: paneBounds.x + relative.x,
      y: paneBounds.y + relative.y,
      width: relative.width,
      height: relative.height
    },
    relative
  };
}
