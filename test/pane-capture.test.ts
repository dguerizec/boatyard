import assert from "node:assert/strict";
import test from "node:test";
import {
  PaneCaptureError,
  parsePaneCaptureTarget,
  resolvePaneRelativeCaptureRectangle
} from "../src/main/paneCapture.js";

test("pane capture clips a pane-relative rectangle without escaping the pane", () => {
  const target = parsePaneCaptureTarget({
    projectId: "project-1",
    paneId: "pane-1",
    revision: "revision-1",
    bounds: { x: 420, y: 80, width: 360, height: 720 }
  });
  const rectangle = resolvePaneRelativeCaptureRectangle(target.bounds, {
    x: 300,
    y: 680,
    width: 200,
    height: 100
  });

  assert.deepEqual(rectangle.relative, { x: 300, y: 680, width: 60, height: 40 });
  assert.deepEqual(rectangle.absolute, { x: 720, y: 760, width: 60, height: 40 });
});

test("pane capture defaults to the full pane and rejects disjoint rectangles", () => {
  const paneBounds = { x: 40, y: 20, width: 640, height: 480 };
  assert.deepEqual(resolvePaneRelativeCaptureRectangle(paneBounds), {
    relative: { x: 0, y: 0, width: 640, height: 480 },
    absolute: paneBounds
  });
  assert.throws(() => resolvePaneRelativeCaptureRectangle(paneBounds, {
    x: 700,
    y: 20,
    width: 100,
    height: 100
  }), (error) => (
    error instanceof PaneCaptureError && error.code === "CAPTURE_RECT_OUTSIDE_PANE"
  ));
});

test("pane capture rejects invalid renderer bounds", () => {
  assert.throws(() => parsePaneCaptureTarget({
    projectId: "project-1",
    paneId: "pane-1",
    revision: "revision-1",
    bounds: { x: 10, y: 10, width: 0, height: 200 }
  }), (error) => (
    error instanceof PaneCaptureError && error.code === "INVALID_CAPTURE_TARGET"
  ));
});
