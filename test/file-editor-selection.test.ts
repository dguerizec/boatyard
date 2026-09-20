import assert from "node:assert/strict";
import test from "node:test";
import { TextBytePositions } from "../src/plugins/file-editor/selection";
import { EditorPaneLinks } from "../src/plugins/file-editor/paneLinks";

test("selection coordinates account for BOM, UTF-8, surrogate pairs and CRLF", () => {
  const positions = new TextBytePositions("\uFEFFAé😀\r\nZ");
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((offset) => positions.byte(offset)), [3, 4, 6, 6, 10, 12, 13]);
  assert.deepEqual(positions.toText({ anchor: 7, head: 9 }), { anchor: 2, head: 4 });
  assert.deepEqual(positions.toText({ anchor: 9, head: 7 }), { anchor: 4, head: 2 });
  assert.deepEqual(positions.toText({ anchor: 8, head: 8 }), { anchor: 2, head: 2 });
  assert.deepEqual(positions.toText({ anchor: 10, head: 11 }), { anchor: 4, head: 5 });
  assert.deepEqual(positions.toText({ anchor: -4, head: 100 }), { anchor: 0, head: 6 });
  assert.equal(new TextBytePositions("\uFEFFa", false).byte(1), 3);
});

test("selection broadcasts stay within linked panes and the active file without echo or persistence", () => {
  let saves = 0;
  const links = new EditorPaneLinks(() => saves++);
  links.link("text", "hex", "a.txt");
  const events: unknown[] = [];
  links.watchSelection("text", () => assert.fail("must not echo"));
  links.watchSelection("other", () => assert.fail("unlinked pane"));
  const detach = links.watchSelection("hex", (path, value) => events.push({ path, value }));
  links.selected("text", "other.txt", { anchor: 1, head: 2 });
  links.selected("text", "a.txt", { anchor: 8, head: 3 });
  assert.deepEqual(events, [{ path: "a.txt", value: { anchor: 8, head: 3 } }]);
  assert.equal(saves, 1);
  detach(); links.selected("text", "a.txt", { anchor: 0, head: 0 });
  assert.equal(events.length, 1);
  links.unlink("hex");
  links.watchSelection("hex", () => assert.fail("unlinked listener"));
  links.selected("text", "a.txt", { anchor: 0, head: 0 });
});
