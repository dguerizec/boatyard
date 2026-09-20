import assert from "node:assert/strict";
import { test } from "node:test";
import { hexGeometry, hexRowAtScroll, hexScrollAtRow } from "../src/plugins/file-editor/hexViewport";

test("hex viewport spans small files and a partial final row", () => {
  assert.equal(hexGeometry(0, 560).rows, 0);
  assert.equal(hexScrollAtRow(256, 560, 10), 0);
  const geometry = hexGeometry(1025, 560);
  assert.equal(geometry.rows, 65);
  assert.equal(geometry.visible, 20);
  assert.equal(hexRowAtScroll(1025, 560, geometry.height), 45);
});

test("hex scrollbar maps the complete file within browser height limits", () => {
  for (const size of [4_636_696, 2 ** 30, 2 ** 40]) {
    const geometry = hexGeometry(size, 840);
    assert.ok(geometry.height <= 8_000_000);
    for (const row of [0, 131071, 131072, Math.floor(geometry.last / 2), geometry.last]) {
      const target = Math.min(row, geometry.last);
      assert.equal(hexRowAtScroll(size, 840, hexScrollAtRow(size, 840, target)), target);
    }
  }
});
