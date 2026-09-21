import assert from "node:assert/strict";
import test from "node:test";
import { parseX11FrameInsets } from "../src/main/windowFrameInsets.js";

test("X11 decoration sizes use left, right, top, bottom and convert pixels to DIP", () => {
  assert.deepEqual(parseX11FrameInsets("_NET_FRAME_EXTENTS(CARDINAL) = 0, 0, 28, 0\n"), {
    left: 0, right: 0, top: 28, bottom: 0
  });
  assert.deepEqual(parseX11FrameInsets("_NET_FRAME_EXTENTS(CARDINAL) = 3, 6, 42, 9", 1.5), {
    left: 2, right: 4, top: 28, bottom: 6
  });
});

test("missing or invalid X11 frame properties are ignored", () => {
  assert.equal(parseX11FrameInsets("_NET_FRAME_EXTENTS: not found."), null);
  assert.equal(parseX11FrameInsets("_NET_FRAME_EXTENTS(CARDINAL) = 0, 0, -28, 0"), null);
});


test("decoration height is measured rather than limited to a fixed caption size", () => {
  for (const top of [16, 28, 64, 150, 1200]) {
    assert.equal(parseX11FrameInsets(`_NET_FRAME_EXTENTS(CARDINAL) = 0, 0, ${top}, 0`)?.top, top);
  }
});
