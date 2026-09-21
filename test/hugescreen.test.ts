import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { BrowserWindow, Input } from "electron";
import { Hugescreen, clampHugescreenPosition } from "../src/main/hugescreen.js";

const key = (type: "keyDown" | "keyUp", name = "Control", extra = {}): Input => ({
  type, key: name, code: name, isAutoRepeat: false, control: type === "keyDown", shift: false,
  alt: false, meta: false, isComposing: false, location: 0, modifiers: [], ...extra
});

function fixture() {
  let cursor = { x: 500, y: 400 };
  class Window extends EventEmitter {
    bounds = { x: 0, y: 30, width: 2000, height: 1400 };
    maximized = false;
    fullscreen = false;
    destroyed = false;
    moves = 0;
    getNormalBounds() { return { ...this.bounds }; }
    getBounds() { return { ...this.bounds }; }
    getPosition() { return [this.bounds.x, this.bounds.y]; }
    isMaximized() { return this.maximized; }
    isFullScreen() { return this.fullscreen; }
    isDestroyed() { return this.destroyed; }
    setFullScreen(value: boolean) { this.fullscreen = value; this.emit("leave-full-screen"); }
    maximize() { this.maximized = true; }
    unmaximize() { this.maximized = false; }
    setBounds(bounds: typeof this.bounds) {
      this.bounds = { ...bounds };
    }
    setPosition(x: number, y: number) {
      this.bounds = { ...this.bounds, x, y };
      this.moves++;
    }
  }
  const window = new Window();
  const changes: boolean[] = [];
  const mode = new Hugescreen({
    window: window as unknown as BrowserWindow,
    getWorkArea: () => ({ x: 0, y: 30, width: 1000, height: 700 }),
    getCursor: () => cursor,
    changed: (active) => changes.push(active)
  });
  return { mode, window, changes, move: (x: number, y: number) => { cursor = { x, y }; } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 35));

test("pan bounds cover displays with negative origins", () => {
  const area = { x: -1200, y: 30, width: 1200, height: 800 };
  const bounds = { x: -1200, y: 30, width: 2400, height: 1600 };
  assert.deepEqual(clampHugescreenPosition(bounds, area, { x: 5000, y: -5000 }), { x: -1200, y: -770 });
  assert.deepEqual(clampHugescreenPosition(bounds, area, { x: -5000, y: 5000 }), { x: -2400, y: 30 });
});

test("double-tap and hold Ctrl pans; release and Escape stop without resizing", async () => {
  const { mode, window, move } = fixture();
  const original = window.getBounds();
  try {
    await mode.toggle();
    assert.deepEqual(window.getBounds(), original, "enabling never changes geometry");
    assert.equal(window.bounds.width, 2000);
    mode.handleKey(key("keyDown"), 1000);
    move(450, 350);
    await tick();
    assert.equal(window.bounds.x, 0, "a single Ctrl press does not pan");
    mode.handleKey(key("keyUp"), 1050);
    assert.equal(mode.handleKey(key("keyDown"), 1200), true);
    assert.equal(mode.handleMouse({ type: "mouseMove", x: 20, y: 20 }), true,
      "real Electron mouse events omit modifiers while Ctrl is held");
    move(650, 550);
    await tick();
    assert.deepEqual(window.getPosition(), [-200, -170], "moving right/down brings content left/up toward the pointer");
    move(550, 450);
    await tick();
    assert.deepEqual(window.getPosition(), [-100, -70], "reversing the pointer reverses the window movement");
    assert.equal(mode.handleMouse({ type: "mouseMove", x: 20, y: 20, modifiers: ["control"] }), true);
    const moves = window.moves;
    await tick();
    assert.equal(window.moves, moves, "stationary cursor does not cause a feedback loop");
    mode.handleKey(key("keyUp"), 1300);
    move(100, 100);
    await tick();
    assert.equal(window.moves, moves);
    const stoppedBounds = window.getBounds();
    mode.handleKey(key("keyDown"), 2000);
    mode.handleKey(key("keyUp"), 2050);
    mode.handleKey(key("keyDown"), 2200);
    assert.equal(mode.handleKey(key("keyDown", "Escape")), true);
    move(0, 0);
    await tick();
    assert.equal(mode.handleKey(key("keyDown", "Escape")), false, "idle Escape reaches the page");
    assert.deepEqual(window.getBounds(), stoppedBounds);
    assert.equal(mode.active, true);
    mode.toggle();
    assert.deepEqual(window.getBounds(), stoppedBounds, "disabling never changes geometry");
  } finally { mode.stopPan(); }
});

test("slow taps and other keyboard shortcuts do not arm panning", async () => {
  const { mode, window, move } = fixture();
  try {
    await mode.toggle();
    mode.handleKey(key("keyDown"), 1000);
    mode.handleKey(key("keyUp"), 1300);
    assert.equal(mode.handleKey(key("keyDown"), 1400), false);
    mode.handleKey(key("keyUp"), 1450);
    mode.handleKey(key("keyDown", "c"), 1500);
    assert.equal(mode.handleKey(key("keyDown"), 1550), false);
    move(100, 100);
    await tick();
    assert.equal(window.bounds.x, 0);
  } finally { mode.stopPan(); }
});

test("maximized and fullscreen windows are never resized or unmaximized", () => {
  const { mode, window } = fixture();
  for (const state of ["maximized", "fullscreen"] as const) {
    window[state] = true;
    const original = window.getBounds();
    mode.toggle();
    mode.handleKey(key("keyDown"), 1000);
    mode.handleKey(key("keyUp"), 1050);
    mode.handleKey(key("keyDown"), 1200);
    assert.deepEqual(window.getBounds(), original);
    assert.equal(window[state], true);
    mode.toggle();
    window[state] = false;
  }
});

test("smaller windows stay within the work area", () => {
  assert.deepEqual(clampHugescreenPosition(
    { x: 50, y: 50, width: 600, height: 400 },
    { x: 0, y: 30, width: 1000, height: 700 },
    { x: -900, y: 1000 }
  ), { x: 0, y: 330 });
});
