import assert from "node:assert/strict";
import test from "node:test";
import { getOversizedBootstrapBounds, needsOversizedRestore } from "../src/main/windowGeometry.js";

const area = { x: -1920, y: 30, width: 1920, height: 1050 };
const large = { x: -2500, y: -200, width: 3000, height: 1800 };

test("only oversized normal Linux windows need delayed restoration", () => {
  assert.equal(needsOversizedRestore(large, area, {}, "linux"), true);
  assert.equal(needsOversizedRestore(area, area, {}, "linux"), true);
  assert.equal(needsOversizedRestore(large, area, { isMaximized: true }, "linux"), false);
  assert.equal(needsOversizedRestore(large, area, { isFullScreen: true }, "linux"), false);
  assert.equal(needsOversizedRestore(large, area, {}, "darwin"), false);
  assert.equal(needsOversizedRestore({ ...large, width: 1200, height: 800 }, area, {}, "linux"), false);
});

test("bootstrap is inside the selected display and does not mutate saved geometry", () => {
  assert.deepEqual(getOversizedBootstrapBounds(large, area), {
    x: -1870, y: 80, width: 1820, height: 950
  });
  assert.deepEqual(large, { x: -2500, y: -200, width: 3000, height: 1800 });
});
