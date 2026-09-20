import assert from "node:assert/strict";
import test from "node:test";
import { EditorPaneLinks } from "../src/plugins/file-editor/paneLinks";

test("linked panes share navigation and unlink without changing their current files", () => {
  const links = new EditorPaneLinks(() => {});
  const updates: Array<[boolean, string | undefined]> = [];
  links.attach("preview", (linked, path) => updates.push([linked, path]));
  links.link("editor", "preview", "first.md");
  links.opened("editor", "second.md");
  assert.deepEqual(updates.at(-1), [true, "second.md"]);
  links.opened("preview", "third.md");
  assert.deepEqual(updates.at(-1), [true, "third.md"]);
  const count = updates.length;
  links.opened("editor", "third.md");
  assert.equal(updates.length, count, "opening the synchronized file must not loop");
  links.unlink("preview");
  assert.deepEqual(updates.at(-1), [false, undefined]);
  links.opened("editor", "fourth.md");
  assert.deepEqual(links.peers("editor"), []);
  assert.deepEqual(updates.at(-1), [false, undefined]);
});

test("links and the latest file restore across remounts and restarts", () => {
  let saved: unknown;
  const links = new EditorPaneLinks((groups) => { saved = JSON.parse(JSON.stringify(groups)); });
  links.link("editor", "preview", "first.md");
  links.opened("editor", "latest.md");
  const restored = new EditorPaneLinks(() => {}, saved);
  let path: string | undefined;
  const old = restored.attach("preview", () => {});
  restored.attach("preview", (_linked, file) => { path = file; });
  old();
  restored.opened("editor", "next.md");
  assert.equal(path, "next.md", "old pane cleanup must not detach its replacement");
});

test("multiple previews link together and retarget without leaving old peers linked", () => {
  const links = new EditorPaneLinks(() => {});
  links.link("a", "b", "a.md");
  links.link("a", "c", "a.md");
  assert.deepEqual(links.peers("b"), ["a", "b", "c"]);
  links.link("d", "b", "d.md");
  assert.deepEqual(links.peers("a"), ["a", "c"]);
  assert.deepEqual(links.peers("b"), ["d", "b"]);
  links.unlink("a");
  assert.deepEqual(links.peers("c"), []);
});
