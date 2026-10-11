import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRemoteInput, parseRemoteViewport, remotePoint } from "../src/main/remoteProtocol";

test("remote crop stays inside the shared window and maps scaled client input", () => {
  const view = parseRemoteViewport({ x: 950, y: -20, width: 300, height: 200, revision: 4 }, 1000, 600);
  assert.deepEqual(view, { x: 700, y: 0, width: 300, height: 200, revision: 4 });
  const input = parseRemoteInput({ kind: "pointer", action: "down", x: .5, y: .5, revision: 4, button: "left", deltaX: 0, deltaY: 0 });
  assert.equal(input.kind, "pointer");
  if (input.kind !== "pointer") return;
  assert.deepEqual(remotePoint(view, input), { x: 850, y: 100 });
  assert.throws(() => remotePoint({ ...view, revision: 5 }, input), /Viewport changed/);
  assert.deepEqual(remotePoint(view, { ...input, x: 1, y: 1 }), { x: 999, y: 199 });
});

test("remote messages reject malformed geometry, arbitrary modifiers and unbounded payloads", () => {
  for (const viewport of [null, { x: 0, y: 0, width: Infinity, height: 1, revision: 0 }, { x: 0, y: 0, width: 1, height: 1, revision: -1 }]) {
    assert.throws(() => parseRemoteViewport(viewport, 800, 600));
  }
  assert.throws(() => parseRemoteInput({ kind: "key", action: "down", key: "Enter", modifiers: ["invalid"] }));
  assert.throws(() => parseRemoteInput({ kind: "text", text: "a".repeat(4097) }));
  assert.throws(() => parseRemoteInput({ kind: "pointer", action: "down", x: -1, y: 0 }));
});
