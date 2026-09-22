import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { HugescreenEdge, edgePanTarget, edgeAnimationPosition, EDGE_ANIMATION_MS } from "../src/main/hugescreenEdge.js";
import { Hugescreen } from "../src/main/hugescreen.js";

const area = { x: 100, y: 50, width: 1000, height: 800 };
const bounds = { x: 100, y: 50, width: 2500, height: 2000 };

test("half-screen steps overlap, clamp the last step, and reverse", () => {
  let current = bounds;
  for (const expected of [-350, -750, -1150, -1150]) {
    current = { ...current, ...edgePanTarget(current, area, { x: 0, y: 1 }) };
    assert.equal(current.y, expected);
  }
  assert.equal(edgePanTarget(current, area, { x: 0, y: -1 }).y, -750);
  assert.deepEqual(edgePanTarget(bounds, area, { x: 1, y: 1 }), { x: -400, y: -350 });
  assert.deepEqual(edgePanTarget({ ...area }, area, { x: 1, y: 1 }), { x: 100, y: 50 });
  const fractional = { ...bounds, height: 1800, y: -750 };
  assert.equal(edgePanTarget(fractional, area, { x: 0, y: 1 }).y, -950);
});

test("edge limits include decorations and negative screen origins", () => {
  const screen = { x: -1000, y: -800, width: 1000, height: 800 };
  const frame = { left: 4, right: 6, top: 28, bottom: 8 };
  assert.deepEqual(edgePanTarget({ x: -1490, y: -1160, width: 1990, height: 1564 }, screen,
    { x: 1, y: 1 }, frame), { x: -1990, y: -1560 });
  assert.deepEqual(edgePanTarget({ x: -1990, y: -1560, width: 1990, height: 1564 }, screen,
    { x: 1, y: 1 }, frame), { x: -1996, y: -1572 });
});

test("interior motion is inert; edge dwell, corner changes and rearming are deliberate", () => {
  const edge = new HugescreenEdge();
  const bottom = { x: 600, y: 849 };
  assert.equal(edge.sample(bottom, bounds, area, 0), null);
  assert.equal(edge.sample(bottom, bounds, area, 1000), null, "activation at the edge is inert");
  assert.equal(edge.sample({ x: 600, y: 500 }, bounds, area, 1001), null);
  assert.equal(edge.sample(bottom, bounds, area, 1100), null);
  assert.equal(edge.sample(bottom, bounds, area, 1279), null);
  assert.deepEqual(edge.sample(bottom, bounds, area, 1280), { x: 100, y: -350 });
  assert.equal(edge.sample(bottom, bounds, area, 3000), null, "no repeating while still at the edge");
  edge.sample({ x: 600, y: 449 }, bounds, area, 3001);
  edge.sample(bottom, bounds, area, 3100);
  const corner = { x: 1099, y: 849 };
  assert.equal(edge.sample(corner, bounds, area, 3200), null, "changing edges restarts the dwell");
  assert.deepEqual(edge.sample(corner, bounds, area, 3380), { x: -400, y: -350 });
});

test("leaving the selected display cancels the dwell", () => {
  const edge = new HugescreenEdge();
  edge.sample({ x: 600, y: 400 }, bounds, area, 0);
  edge.sample({ x: 1099, y: 400 }, bounds, area, 1);
  edge.sample({ x: 1100, y: 400 }, bounds, area, 100);
  assert.equal(edge.sample({ x: 1099, y: 400 }, bounds, area, 400), null);
});

test("animation interpolates monotonically and arrives exactly without negative zero", () => {
  const from = { x: 0, y: 0 }, to = { x: -500, y: -400 };
  let previous = from;
  for (let time = 0; time <= EDGE_ANIMATION_MS; time += 7) {
    const point = edgeAnimationPosition(from, to, time);
    assert.ok(point.x <= previous.x && point.y <= previous.y);
    assert.equal(Object.is(point.x, -0), false);
    previous = point;
  }
  assert.deepEqual(edgeAnimationPosition(from, to, EDGE_ANIMATION_MS), to);
  assert.deepEqual(edgeAnimationPosition(from, to, EDGE_ANIMATION_MS * 2), to);
});

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function fixture(failWarp = false) {
  let cursor = { x: 600, y: 400 };
  const events = new EventEmitter();
  const window = Object.assign(events, {
    bounds: { ...bounds }, focused: true, moves: 0,
    isDestroyed: () => false, isMaximized: () => false, isFullScreen: () => false,
    isFocused() { return this.focused; }, getBounds() { return { ...this.bounds }; },
    setPosition(x: number, y: number) { this.bounds.x = x; this.bounds.y = y; this.moves++; events.emit("move"); }
  });
  const warped: number[] = [];
  const mode = new Hugescreen({ window: window as unknown as BrowserWindow, panMode: "edge",
    getWorkArea: () => area, getCursor: () => cursor, changed() {},
    edgeDriver: { unavailableReason: async () => null, anchor: async () => {
      const local = { x: cursor.x - window.bounds.x, y: cursor.y - window.bounds.y };
      return async point => {
        window.setPosition(point.x, point.y);
        if (failWarp) throw new Error("Pointer denied");
        cursor = { x: window.bounds.x + local.x, y: window.bounds.y + local.y };
        warped.push(window.bounds.y);
      };
    } }
  });
  return { mode, window, warped, move: (y: number) => { cursor.y = y; } };
}

test("edge animation moves the pointer throughout, then stays still", async () => {
  const { mode, window, warped, move } = fixture();
  try {
    await mode.refreshEdgeSupport();
    mode.toggle();
    await pause(40);
    move(849);
    await pause(650);
    assert.equal(window.bounds.y, -350);
    assert.ok(warped.length > 5);
    assert.ok(warped.some(y => y < 50 && y > -350), "pointer follows intermediate animation frames");
    const moves = window.moves;
    await pause(250);
    assert.equal(window.moves, moves, "no second step after pointer relocation");
  } finally { mode.dispose(); }
});

test("blur cancels an active animation and pointer movement", async () => {
  const { mode, window, warped, move } = fixture();
  try {
    await mode.refreshEdgeSupport();
    mode.toggle();
    await pause(40);
    move(849);
    await pause(280);
    assert.ok(warped.length > 0);
    window.focused = false;
    mode.suspend();
    const moves = window.moves, warps = warped.length;
    await pause(200);
    assert.equal(window.moves, moves);
    assert.equal(warped.length, warps);
    assert.equal(mode.active, true);
  } finally { mode.dispose(); }
});

test("an unavailable pointer prevents edge mode without affecting continuous pan", () => {
  const { mode } = fixture();
  try {
    assert.equal(mode.toggle(), false);
    assert.throws(() => mode.setMode("edge"), /not available/);
    assert.throws(() => mode.setMode("unknown"), /Unknown/);
    mode.setMode("continuous");
    assert.equal(mode.toggle(), true);
  } finally { mode.dispose(); }
});


test("a fitting or exhausted axis does not prevent rearming the other axis", () => {
  const edge = new HugescreenEdge();
  const vertical = { ...bounds, width: area.width };
  edge.sample({ x: area.x, y: 450 }, vertical, area, 0);
  edge.sample({ x: area.x, y: 849 }, vertical, area, 1);
  assert.deepEqual(edge.sample({ x: area.x, y: 849 }, vertical, area, 181), { x: 100, y: -350 });
  const moved = { ...vertical, y: -350 };
  edge.sample({ x: area.x, y: 449 }, moved, area, 182);
  edge.sample({ x: area.x, y: 849 }, moved, area, 183);
  assert.deepEqual(edge.sample({ x: area.x, y: 849 }, moved, area, 363), { x: 100, y: -750 });
});


test("pointer failures stop edge pan instead of leaving an uncontrolled animation", async (context) => {
  context.mock.method(console, "error", () => {});
  const { mode, window, move } = fixture(true);
  try {
    await mode.refreshEdgeSupport();
    mode.toggle();
    await pause(40);
    move(849);
    await pause(500);
    assert.equal(mode.active, false);
    assert.match(mode.getSettings().edgeUnavailableReason, /Pointer movement failed/);
    const moves = window.moves;
    await pause(100);
    assert.equal(window.moves, moves);
  } finally { mode.dispose(); }
});

test("native position rounding by one logical pixel does not stall animation", async () => {
  const { mode, window, warped, move } = fixture();
  const setPosition = window.setPosition.bind(window);
  window.setPosition = (x, y) => {
    setPosition(x, y + 1);
    window.bounds.height = bounds.height - 1;
    mode.onGeometryChanged();
  };
  try {
    await mode.refreshEdgeSupport();
    mode.toggle();
    await pause(40);
    move(849);
    await pause(650);
    assert.ok(Math.abs(window.bounds.y - (-350)) <= 1);
    assert.ok(warped.length > 5);
    assert.equal(mode.active, true);
    assert.equal(window.listenerCount("move"), 0);
  } finally { mode.dispose(); }
});
