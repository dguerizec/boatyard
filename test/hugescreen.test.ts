import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserWindow, Input } from "electron";
import { Hugescreen, calculateHugescreenPan, clampHugescreenPosition } from "../src/main/hugescreen.js";

const key = (type: "keyDown" | "keyUp", name = "Control", extra = {}): Input => ({
  type, key: name, code: name, isAutoRepeat: false, control: type === "keyDown", shift: false,
  alt: false, meta: false, isComposing: false, location: 0, modifiers: [], ...extra
});
const area = { x: 0, y: 30, width: 1000, height: 700 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

function fixture() {
  let cursor = { x: 500, y: 400 };
  const window = {
    bounds: { x: 0, y: 30, width: 10000, height: 7000 },
    maximized: false, fullscreen: false, destroyed: false, focused: true, moves: 0,
    getBounds() { return { ...this.bounds }; },
    isMaximized() { return this.maximized; },
    isFullScreen() { return this.fullscreen; },
    isDestroyed() { return this.destroyed; },
    isFocused() { return this.focused; },
    setPosition(x: number, y: number) { this.bounds = { ...this.bounds, x, y }; this.moves++; }
  };
  const changes: boolean[] = [];
  const mode = new Hugescreen({
    window: window as unknown as BrowserWindow,
    getWorkArea: () => area, getCursor: () => cursor,
    changed: (active) => changes.push(active)
  });
  return { mode, window, changes, move: (x: number, y: number) => { cursor = { x, y }; } };
}

function doubleTap(mode: Hugescreen, at = 1000) {
  for (const [type, offset] of [["keyDown", 0], ["keyUp", 40], ["keyDown", 160], ["keyUp", 200]] as const) {
    assert.equal(mode.handleKey(key(type), at + offset), false, "Ctrl events reach Chromium");
  }
}

test("double Ctrl toggles a persistent pan lock; Escape disables it without resizing", async () => {
  const { mode, window, changes, move } = fixture();
  const original = window.getBounds();
  try {
    mode.handleKey(key("keyDown"), 100);
    mode.handleKey(key("keyUp"), 140);
    assert.equal(mode.active, false);
    doubleTap(mode);
    assert.equal(mode.active, true);
    assert.deepEqual(window.getBounds(), original, "enabling does not move or resize the window");
    move(550, 450);
    await tick();
    assert.ok(window.bounds.x < 0 && window.bounds.y < 30);
    assert.equal(window.bounds.width, original.width);
    assert.equal(window.bounds.height, original.height);
    const moves = window.moves;
    await tick();
    assert.equal(window.moves, moves, "a stationary cursor causes no scrolling or feedback loop");
    doubleTap(mode, 2000);
    move(650, 550);
    await tick();
    assert.equal(mode.active, false);
    assert.equal(window.moves, moves);
    doubleTap(mode, 3000);
    assert.equal(mode.handleKey(key("keyDown", "Escape")), true);
    assert.equal(mode.active, false);
    assert.equal(mode.handleKey(key("keyDown", "Escape")), false, "idle Escape reaches the page");
    assert.deepEqual(changes, [true, false, true, false]);
  } finally { mode.dispose(); }
});

test("Ctrl shortcuts, long presses and Ctrl-clicks are not double taps", () => {
  const { mode } = fixture();
  try {
    mode.handleKey(key("keyDown"), 1000);
    mode.handleKey(key("keyUp"), 1300);
    mode.handleKey(key("keyDown"), 1400);
    mode.handleKey(key("keyUp"), 1450);
    assert.equal(mode.active, false);
    mode.handleKey(key("keyDown", "c"), 1500);
    mode.handleKey(key("keyDown"), 1600);
    mode.handleKey(key("keyUp"), 1640);
    assert.equal(mode.active, false);
    mode.handleMouse({ type: "mouseDown", button: "left", x: 0, y: 0 });
    mode.handleMouse({ type: "mouseUp", button: "left", x: 0, y: 0 });
    mode.handleKey(key("keyDown"), 1700);
    mode.handleKey(key("keyUp"), 1740);
    assert.equal(mode.active, false);
    doubleTap(mode, 3000);
    mode.handleKey(key("keyDown", "c"), 4000);
    mode.handleKey(key("keyUp", "Control"), 4040);
    assert.equal(mode.active, true, "ordinary shortcuts do not unlock pan");
  } finally { mode.dispose(); }
});

test("mouse events remain available while dragging pans without unlocking", async () => {
  const { mode, window, move } = fixture();
  try {
    doubleTap(mode);
    const original = window.getBounds();
    assert.equal(mode.handleMouse({ type: "mouseDown", button: "left", x: 20, y: 20 }), undefined);
    move(700, 600);
    assert.equal(mode.handleMouse({ type: "mouseMove", x: 40, y: 40 }), undefined);
    await tick();
    assert.ok(window.bounds.x < original.x, "dragging continues panning");
    const dragged = window.getBounds();
    mode.handleMouse({ type: "mouseUp", button: "left", x: 40, y: 40 });
    await tick();
    assert.deepEqual(window.getBounds(), dragged, "release does not replay drag movement");
    move(710, 610);
    await tick();
    assert.ok(window.bounds.x < original.x);
    assert.equal(mode.active, true);
    const stopped = window.getBounds();
    mode.handleMouse({ type: "mouseWheel", x: 40, y: 40 });
    move(750, 650);
    await tick();
    assert.deepEqual(window.getBounds(), stopped, "scrolling the page takes priority");
  } finally { mode.dispose(); }
});

test("focus and resize changes rebase the pointer without dropping the lock", async () => {
  const { mode, window, move } = fixture();
  try {
    doubleTap(mode);
    window.focused = false;
    mode.suspend();
    move(900, 600);
    await tick();
    assert.equal(window.moves, 0);
    assert.equal(mode.active, true);
    window.focused = true;
    mode.resume();
    await tick();
    assert.equal(window.moves, 0);
    move(950, 650);
    mode.resetPointer();
    await tick();
    assert.equal(window.moves, 0);
    move(960, 660);
    await tick();
    assert.ok(window.moves > 0);
  } finally { mode.dispose(); }
});

test("maximized and fullscreen windows remain untouched while pan is locked", async () => {
  for (const state of ["maximized", "fullscreen"] as const) {
    const { mode, window, move } = fixture();
    try {
      window[state] = true;
      const original = window.getBounds();
      doubleTap(mode);
      move(990, 700);
      await tick();
      assert.deepEqual(window.getBounds(), original);
      assert.equal(window[state], true);
    } finally { mode.dispose(); }
  }
});

test("amplification increases near the screen edge and with remaining window distance", () => {
  const large = { x: 0, y: 30, width: 10000, height: 7000 };
  const center = calculateHugescreenPan(large, area, { x: 500, y: 400 }, { x: 510, y: 400 });
  const edge = calculateHugescreenPan(large, area, { x: 900, y: 400 }, { x: 910, y: 400 });
  const almostDone = { ...large, x: -8900 };
  const nearWindowEdge = calculateHugescreenPan(almostDone, area, { x: 900, y: 400 }, { x: 910, y: 400 });
  assert.ok(Math.abs(edge.x) > Math.abs(center.x));
  assert.ok(Math.abs(edge.x) > Math.abs(nearWindowEdge.x - almostDone.x));
  assert.equal(center.y, large.y);
});

test("one sweep can reach either window edge regardless of its size, including decorations", () => {
  const frame = { left: 4, right: 6, top: 80, bottom: 8 };
  const bounds = { x: -3000, y: -2000, width: 100000, height: 70000 };
  assert.deepEqual(calculateHugescreenPan(bounds, area, { x: 500, y: 400 }, { x: 999, y: 729 }, frame), {
    x: -99006, y: -69278
  });
  assert.deepEqual(calculateHugescreenPan(bounds, area, { x: 500, y: 400 }, { x: 0, y: 30 }, frame), {
    x: 4, y: 110
  });
  assert.deepEqual(calculateHugescreenPan(bounds, area, { x: 500, y: 400 }, { x: 500, y: 400 }, frame), {
    x: bounds.x, y: bounds.y
  });
});

test("pan limits account for decorated windows and displays with negative origins", () => {
  const display = { x: -1000, y: 30, width: 1000, height: 700 };
  const bounds = { x: -1500, y: -200, width: 2000, height: 1400 };
  const frame = { left: 4, right: 6, top: 28, bottom: 8 };
  assert.deepEqual(clampHugescreenPosition(bounds, display, { x: 9999, y: 9999 }, frame), { x: -996, y: 58 });
  assert.deepEqual(clampHugescreenPosition(bounds, display, { x: -9999, y: -9999 }, frame), { x: -2006, y: -678 });
  assert.deepEqual(clampHugescreenPosition({ x: 50, y: 50, width: 600, height: 400 }, area,
    { x: -900, y: 1000 }), { x: 0, y: 330 });
});


test("pan can be enabled during a held mouse button", async () => {
  const { mode, window, move } = fixture();
  try {
    mode.handleMouse({ type: "mouseDown", button: "left", x: 20, y: 20 });
    doubleTap(mode);
    move(900, 600);
    await tick();
    assert.ok(window.moves > 0);
    assert.equal(mode.active, true);
    mode.handleMouse({ type: "mouseUp", button: "left", x: 40, y: 40 });
    move(910, 610);
    await tick();
    assert.ok(window.moves > 0);
  } finally { mode.dispose(); }
});
