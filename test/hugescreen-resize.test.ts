import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { BrowserWindow, Rectangle } from "electron";
import { Hugescreen } from "../src/main/hugescreen.js";
import { restoreWindowedMode } from "../src/main/windowGeometry.js";

function fixture(maximized = false, fullscreen = false) {
  const calls: string[] = [];
  const window = Object.assign(new EventEmitter(), {
    maximized, fullscreen, destroyed: false,
    bounds: { x: 0, y: 0, width: 1000, height: 700 },
    isDestroyed() { return this.destroyed; },
    isMaximized() { return this.maximized; },
    isFullScreen() { return this.fullscreen; },
    getBounds() { return this.bounds; },
    setFullScreen(value: boolean) {
      assert.equal(value, false);
      calls.push("leave-full-screen");
    },
    unmaximize() { calls.push("unmaximize"); },
    getMinimumSize() { return [640, 480]; },
    setMinimumSize() {},
    setOpacity() {},
    setBounds(bounds: Rectangle) {
      assert.equal(this.fullscreen || this.maximized, false);
      calls.push("resize");
      this.bounds = bounds;
    }
  });
  let frame = { left: 0, right: 0, top: 0, bottom: 0 };
  const native = window as unknown as BrowserWindow;
  const mode = new Hugescreen({
    window: native,
    getWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
    getCursor: () => ({ x: 0, y: 0 }),
    getFrameInsets: () => frame,
    refreshFrameInsets: async () => {
      assert.equal(window.fullscreen || window.maximized, false);
      calls.push("frame");
      frame = { left: 4, right: 4, top: 28, bottom: 4 };
    },
    changed() {}
  });
  return { window, native, mode, calls };
}

for (const [maximized, fullscreen] of [[false, false], [true, false], [false, true], [true, true]]) {
  test(`resize restores native state (maximized=${maximized}, fullscreen=${fullscreen})`, async () => {
    const { window, mode, calls } = fixture(maximized, fullscreen);
    const resized = mode.resizeWindow(2, 2);
    const expected: string[] = [];
    if (fullscreen) {
      expected.push("leave-full-screen");
      assert.deepEqual(calls, expected, "resize waits for fullscreen to finish");
      window.fullscreen = false;
      window.emit("leave-full-screen");
      await Promise.resolve();
    }
    if (maximized) {
      expected.push("unmaximize");
      assert.deepEqual(calls, expected, "resize waits for unmaximize to finish");
      window.maximized = false;
      window.emit("unmaximize");
    }
    await resized;
    assert.deepEqual(calls, [...expected, "frame", "resize"]);
    assert.deepEqual(window.bounds, { x: 0, y: 0, width: 1992, height: 1368 });
    assert.deepEqual(window.eventNames(), [], "transition listeners are removed");
  });
}

test("invalid resize leaves fullscreen and maximized state untouched", async () => {
  const { mode, calls } = fixture(true, true);
  await assert.rejects(mode.resizeWindow(NaN, 2), /between 1 and 5/);
  assert.deepEqual(calls, []);
});

test("closing during a native transition cancels resizing and cleans up listeners", async () => {
  const { window, mode, calls } = fixture(false, true);
  const resized = mode.resizeWindow(2, 2);
  window.destroyed = true;
  window.emit("closed");
  await assert.rejects(resized, /Window closed/);
  assert.deepEqual(calls, ["leave-full-screen"]);
  assert.deepEqual(window.eventNames(), []);
});

test("a missing native transition event times out and cleans up listeners", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { window, native } = fixture(true);
  const restored = restoreWindowedMode(native);
  context.mock.timers.tick(5000);
  await assert.rejects(restored, /Timed out/);
  assert.deepEqual(window.eventNames(), []);
});

test("synchronous native events are observed", async () => {
  const { window, native } = fixture(true);
  window.unmaximize = () => {
    window.maximized = false;
    window.emit("unmaximize");
  };
  await restoreWindowedMode(native);
  assert.deepEqual(window.eventNames(), []);
});

test("restoration respects pan off, decoration-aware multipliers and the screen top-left", async () => {
  const { window, mode } = fixture();
  Object.assign(window, { setPosition(x: number, y: number) { window.bounds = { ...window.bounds, x, y }; } });
  await mode.restoreState({ widthMultiplier: 2, heightMultiplier: 1.5, panMode: "continuous", enabled: false });
  assert.deepEqual(window.bounds, { x: 4, y: 28, width: 1992, height: 1018 });
  mode.onGeometryChanged();
  mode.enableForOversizedWindow();
  assert.equal(mode.active, false, "late geometry events and startup activation cannot override explicit pan off");
  assert.deepEqual(mode.captureState(), { widthMultiplier: 2, heightMultiplier: 1.5, panMode: "continuous", enabled: false });
  mode.dispose();
});

test("an unavailable edge snapshot restores size but visibly disables panning", async () => {
  const { window, mode } = fixture();
  Object.assign(window, { setPosition() {} });
  await mode.restoreState({ widthMultiplier: 2, heightMultiplier: 2, panMode: "edge", enabled: true });
  assert.equal(mode.mode, "edge");
  assert.equal(mode.active, false);
  assert.equal(mode.getSettings().available, false);
  assert.ok(mode.getSettings().edgeUnavailableReason);
  mode.onGeometryChanged();
  assert.equal(mode.active, false);
  mode.dispose();
});
