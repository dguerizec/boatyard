import assert from "node:assert/strict";
import test from "node:test";
import { HugescreenMotion } from "../src/main/hugescreenMotion.js";

const point = (x: number, y = 0) => ({ x, y });

test("a firm stop anchors a dead zone and consumes its travel without replay", () => {
  const motion = new HugescreenMotion();
  motion.reset(point(100), 0);
  assert.deepEqual(motion.filter(point(100), point(110), 16), point(10));
  assert.deepEqual(motion.filter(point(110), point(110), 200), point(0));
  assert.deepEqual(motion.filter(point(110), point(130), 216), point(0));
  assert.deepEqual(motion.filter(point(130), point(135), 232), point(0));
  assert.deepEqual(motion.filter(point(135), point(142), 248), point(2));
  assert.deepEqual(motion.filter(point(142), point(147), 264), point(5));
});

test("click dead zone is circular and releases while dragging without a jump", () => {
  const motion = new HugescreenMotion();
  motion.reset(point(100, 100), 0, true);
  assert.deepEqual(motion.filter(point(100, 100), point(118, 124), 16), point(0));
  const delta = motion.filter(point(118, 124), point(121, 128), 32);
  assert.ok(Math.abs(delta.x - 3) < 1e-9 && Math.abs(delta.y - 4) < 1e-9);
});

test("reversal hysteresis ignores jitter and consumes the six-pixel threshold", () => {
  const motion = new HugescreenMotion();
  motion.reset(point(100), 0);
  assert.deepEqual(motion.filter(point(100), point(110), 16), point(10));
  assert.deepEqual(motion.filter(point(110), point(106), 32), point(0));
  assert.deepEqual(motion.filter(point(106), point(109), 48), point(0));
  assert.deepEqual(motion.filter(point(109), point(103), 64), point(-1));
  assert.deepEqual(motion.filter(point(103), point(100), 80), point(-3));
  assert.deepEqual(motion.filter(point(100), point(100), 96), point(0));
});
