import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserWindow, Input } from "electron";
import { Hugescreen, calculateHugescreenPan, clampHugescreenPosition, roundHugescreenPosition, getHugescreenResizeBounds } from "../src/main/hugescreen.js";

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
    setPosition(x: number, y: number) {
      assert.equal(Object.is(x, -0) || Object.is(y, -0), false, "Electron rejects negative zero");
      this.bounds = { ...this.bounds, x, y }; this.moves++;
    }
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

test("double Ctrl toggles a persistent pan lock; Escape passes through without changing it", async () => {
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
    assert.equal(mode.handleKey(key("keyDown", "Escape")), false, "Escape reaches the editor while panning");
    assert.equal(mode.handleKey(key("keyUp", "Escape")), false);
    assert.equal(mode.active, true, "vi mode Escape never disables pan");
    assert.deepEqual(changes, [true, false, true]);
    doubleTap(mode, 4000);
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


test("slow local movement is attenuated and speed progressively restores amplification", () => {
  const bounds = { x: -3000, y: -2000, width: 10000, height: 7000 };
  const from = { x: 500, y: 400 };
  const to = { x: 510, y: 400 };
  const slow = calculateHugescreenPan(bounds, area, from, to, undefined, 100);
  const medium = calculateHugescreenPan(bounds, area, from, to, undefined, 20);
  const fast = calculateHugescreenPan(bounds, area, from, to, undefined, 10);
  assert.equal(bounds.x - slow.x, 2.5);
  assert.ok(slow.x > medium.x && medium.x > fast.x);
  assert.equal(slow.y, bounds.y);
  const reverse = calculateHugescreenPan(bounds, area, from, { x: 490, y: 400 }, undefined, 100);
  assert.equal(reverse.x - bounds.x, 2.5);
  const tiny = calculateHugescreenPan(bounds, area, from, { x: 501, y: 400 }, undefined, 16);
  assert.equal(bounds.x - tiny.x, 0.25, "retain subpixel precision for subsequent movement");
  assert.deepEqual(calculateHugescreenPan(bounds, area, from, from, undefined, 16),
    { x: bounds.x, y: bounds.y }, "no inertia after stopping");
  assert.equal(calculateHugescreenPan(bounds, area, from, { x: 999, y: 400 }, undefined, 10000).x,
    area.x + area.width - bounds.width, "slow movement still reaches the far edge");
});

test("successive slow one-pixel movements accumulate without stationary drift", async () => {
  const { mode, window, move } = fixture();
  try {
    doubleTap(mode);
    const original = window.getBounds();
    for (let step = 1; step <= 4; step++) {
      await tick();
      move(500 + step, 400);
      await tick();
    }
    assert.equal(window.bounds.x, original.x - 1);
    const stopped = window.getBounds();
    await tick();
    assert.deepEqual(window.getBounds(), stopped);
  } finally { mode.dispose(); }
});


test("native coordinates normalize negative zero from subpixel movement", () => {
  for (const value of [-0, -0.1, -0.25, -0.5, 0, 0.25]) {
    assert.deepEqual(roundHugescreenPosition({ x: value, y: value }), { x: 0, y: 0 });
  }
  assert.deepEqual(roundHugescreenPosition({ x: -0.75, y: -10.25 }), { x: -1, y: -10 });
  const point = calculateHugescreenPan({ x: 0, y: 0, width: 10000, height: 7000 },
    area, { x: 500, y: 400 }, { x: 501, y: 404 }, undefined, 100);
  assert.deepEqual(roundHugescreenPosition(point), { x: 0, y: -1 },
    "moving the other axis must not pass negative zero to setPosition");
});

test("nearby off-screen edges can reach screen alignment on every side", () => {
  const topLeft = { x: -50, y: -10, width: 2000, height: 1400 };
  assert.deepEqual(calculateHugescreenPan(topLeft, area, { x: 100, y: 100 }, { x: 0, y: 30 }),
    { x: 0, y: 30 });
  const bottomRight = { x: -950, y: -620, width: 2000, height: 1400 };
  assert.deepEqual(calculateHugescreenPan(bottomRight, area, { x: 900, y: 650 }, { x: 999, y: 729 }),
    { x: -1000, y: -670 });
});

test("edge protection blocks departure only while the pointer is near an aligned edge", () => {
  const topLeft = { x: 0, y: 30, width: 2000, height: 1400 };
  assert.deepEqual(calculateHugescreenPan(topLeft, area, { x: 50, y: 80 }, { x: 60, y: 90 }),
    { x: 0, y: 30 });
  const outside = calculateHugescreenPan(topLeft, area, { x: 200, y: 200 }, { x: 210, y: 210 });
  assert.ok(outside.x < topLeft.x && outside.y < topLeft.y);
  const independent = calculateHugescreenPan(topLeft, area, { x: 50, y: 200 }, { x: 60, y: 210 });
  assert.equal(independent.x, topLeft.x);
  assert.ok(independent.y < topLeft.y);
  const bottomRight = { x: -1000, y: -670, width: 2000, height: 1400 };
  assert.deepEqual(calculateHugescreenPan(bottomRight, area, { x: 950, y: 680 }, { x: 940, y: 670 }),
    { x: -1000, y: -670 });
  const reverse = calculateHugescreenPan(bottomRight, area, { x: 700, y: 500 }, { x: 690, y: 490 });
  assert.ok(reverse.x > bottomRight.x && reverse.y > bottomRight.y);
});

test("alignment protection includes decorations and negative screen origins", () => {
  const display = { x: -1000, y: -700, width: 1000, height: 700 };
  const frame = { left: 4, right: 6, top: 80, bottom: 8 };
  const aligned = { x: -996, y: -620, width: 2000, height: 1400 };
  const from = { x: -950, y: -650 };
  const to = { x: -940, y: -640 };
  assert.deepEqual(calculateHugescreenPan(aligned, display, from, to, frame),
    { x: aligned.x, y: aligned.y });
  const approaching = { ...aligned, x: aligned.x - 10, y: aligned.y - 10 };
  assert.deepEqual(calculateHugescreenPan(approaching, display, from, { x: -1000, y: -700 }, frame),
    { x: aligned.x, y: aligned.y });
});


test("slow movement progressively regains amplification near the screen edge", () => {
  const bounds = { x: -3000, y: -2000, width: 10000, height: 7000 };
  const travel = (x: number) => bounds.x - calculateHugescreenPan(bounds, area,
    { x, y: 400 }, { x: x + 1, y: 400 }, undefined, 100).x;
  assert.equal(travel(500), 0.25);
  assert.ok(travel(800) > travel(700));
  assert.ok(travel(900) > travel(800));
  assert.ok(travel(950) > travel(900));
});

test("slow one-pixel sweeps reach all four edges without a final catch-up jump", () => {
  const frame = { left: 4, right: 6, top: 80, bottom: 8 };
  for (const axis of ["x", "y"] as const) {
    for (const direction of [-1, 1]) {
      let bounds = { x: -3000, y: -2000, width: 10000, height: 7000 };
      let cursor = { x: 500, y: 400 };
      const edge = axis === "x" ? (direction > 0 ? 999 : 0) : (direction > 0 ? 729 : 30);
      const steps: number[] = [];
      while (cursor[axis] !== edge) {
        const next = { ...cursor, [axis]: cursor[axis] + direction };
        const point = calculateHugescreenPan(bounds, area, cursor, next, frame, 100);
        steps.push(Math.abs(point[axis] - bounds[axis]));
        bounds = { ...bounds, ...point };
        cursor = next;
      }
      const expected = axis === "x" ? (direction > 0 ? -9006 : 4) : (direction > 0 ? -6278 : 110);
      assert.equal(bounds[axis], expected);
      assert.ok(steps.at(-1)! <= steps.at(-2)! * 1.05 + 1,
        "arrival should continue the existing travel rate, not catch up abruptly");
      assert.ok(Math.max(...steps) < 150, "travel is distributed across the approach");
      assert.deepEqual(calculateHugescreenPan(bounds, area, cursor, cursor, frame, 100),
        { x: bounds.x, y: bounds.y }, "no motion after stopping");
    }
  }
});


test("reaching screen boundaries completes the last pixels despite a click dead zone", async () => {
  for (const axis of ["x", "y"] as const) {
    for (const direction of [-1, 1]) {
      const { mode, window, move } = fixture();
      try {
        const start = axis === "x" ? area.x : area.y;
        const end = start + (axis === "x" ? area.width : area.height) - 1;
        const edge = direction > 0 ? end : start;
        const target = direction > 0 ? start + (axis === "x" ? area.width - window.bounds.width :
          area.height - window.bounds.height) : start;
        window.bounds[axis] = target + direction * 5;
        const cursor = { x: 500, y: 400, [axis]: edge - direction * 5 };
        move(cursor.x, cursor.y);
        doubleTap(mode);
        mode.handleMouse({ type: "mouseDown", button: "left", x: 0, y: 0 });
        mode.handleMouse({ type: "mouseUp", button: "left", x: 0, y: 0 });
        cursor[axis] = edge;
        move(cursor.x, cursor.y);
        await tick();
        assert.equal(window.bounds[axis], target, "the final five pixels reach alignment");
        const stopped = window.getBounds();
        await tick();
        assert.deepEqual(window.getBounds(), stopped, "no repeated movement at the boundary");
      } finally { mode.dispose(); }
    }
  }
});

test("a stationary pointer at the screen edge does not complete pan on activation", async () => {
  const { mode, window, move } = fixture();
  try {
    window.bounds.x = -8995;
    move(999, 400);
    doubleTap(mode);
    const original = window.getBounds();
    await tick();
    assert.deepEqual(window.getBounds(), original);
  } finally { mode.dispose(); }
});


test("startup enables pan for either oversized axis without changing geometry", () => {
  for (const size of [{ width: 1001, height: 600 }, { width: 900, height: 701 }]) {
    const { mode, window, changes } = fixture();
    try {
      window.bounds = { ...window.bounds, ...size };
      const original = window.getBounds();
      mode.enableForOversizedWindow();
      assert.equal(mode.active, true);
      assert.deepEqual(window.getBounds(), original);
      mode.enableForOversizedWindow();
      assert.deepEqual(changes, [true], "startup initialization never toggles an active lock off");
      doubleTap(mode);
      assert.equal(mode.active, false, "the user can disable automatic panning normally");
    } finally { mode.dispose(); }
  }
});

test("startup leaves fitting, maximized and fullscreen windows inactive", () => {
  for (const state of ["fits", "maximized", "fullscreen"] as const) {
    const { mode, window } = fixture();
    try {
      if (state === "fits") window.bounds = { x: -100, y: -100, width: 1000, height: 700 };
      else window[state] = true;
      mode.enableForOversizedWindow();
      assert.equal(mode.active, false);
    } finally { mode.dispose(); }
  }
});

test("startup includes native decorations when detecting oversized geometry", () => {
  const { window } = fixture();
  window.bounds = { x: 0, y: 28, width: 1000, height: 680 };
  const mode = new Hugescreen({
    window: window as unknown as BrowserWindow,
    getWorkArea: () => area,
    getCursor: () => ({ x: 500, y: 400 }),
    getFrameInsets: () => ({ left: 0, right: 0, top: 28, bottom: 0 }),
    changed: () => {}
  });
  try {
    mode.enableForOversizedWindow();
    assert.equal(mode.active, true);
  } finally { mode.dispose(); }
});


test("manual toggles and double Ctrl cannot enable pan for a fitting window", () => {
  const { mode, window, changes } = fixture();
  try {
    window.bounds = { x: -10, y: -10, width: area.width, height: area.height };
    assert.equal(mode.toggle(), false);
    doubleTap(mode);
    assert.equal(mode.active, false);
    assert.deepEqual(changes, []);
    window.bounds.width++;
    doubleTap(mode, 2000);
    assert.equal(mode.active, true, "the gesture works again once a dimension exceeds the screen");
  } finally { mode.dispose(); }
});

test("resizing recalculates pan eligibility in both directions without changing geometry", () => {
  const { mode, window, changes } = fixture();
  try {
    doubleTap(mode);
    window.bounds.width = area.width + 1;
    window.bounds.height = area.height;
    mode.onGeometryChanged();
    assert.equal(mode.active, true, "one oversized axis is sufficient");
    window.bounds.width = area.width;
    const resized = window.getBounds();
    mode.onGeometryChanged();
    assert.equal(mode.active, false);
    assert.deepEqual(window.getBounds(), resized);
    assert.deepEqual(changes, [true, false]);
    window.bounds.width++;
    mode.onGeometryChanged();
    assert.equal(mode.active, true, "resizing larger enables pan again");
    assert.deepEqual(changes, [true, false, true]);
  } finally { mode.dispose(); }
});


test("screen multipliers resize outer dimensions and keep native decorations reachable", () => {
  const frame = { left: 4, right: 6, top: 28, bottom: 8 };
  const bounds = { x: -3000, y: -2000, width: 5000, height: 4000 };
  const original = { ...bounds };
  assert.deepEqual(getHugescreenResizeBounds(bounds, area, 1, 1, frame),
    { x: 4, y: 58, width: 990, height: 664 });
  assert.deepEqual(getHugescreenResizeBounds(bounds, area, 2, 1.5, frame),
    { x: -996, y: -292, width: 1990, height: 1014 });
  assert.equal(getHugescreenResizeBounds(bounds, area, 5, 5, frame).width, 4990);
  assert.deepEqual(bounds, original);
  const small = getHugescreenResizeBounds(bounds, { x: 0, y: 0, width: 500, height: 400 }, 1, 1, frame);
  assert.equal(small.width, 640);
  assert.equal(small.height, 480);
});

test("invalid screen multipliers are rejected before resizing", () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 700 };
  for (const value of [NaN, Infinity, -1, 0, 0.99, 5.01, '2', null] as unknown[]) {
    assert.throws(() => getHugescreenResizeBounds(bounds, area, value as number, 1));
    assert.throws(() => getHugescreenResizeBounds(bounds, area, 1, value as number));
  }
});
