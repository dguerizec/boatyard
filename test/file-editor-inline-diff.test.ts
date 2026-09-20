import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, Text, type Transaction } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { inlineDiffState, setInlineDiff, toggleRemovedLines, removedLinesKey, RemovedLines } from "../src/plugins/file-editor/inlineDiff";

function removed(state: EditorState) {
  const widgets: RemovedLines[] = [];
  state.field(inlineDiffState).decorations.between(0, state.doc.length, (_from, _to, decoration) => {
    if (decoration.spec.widget instanceof RemovedLines) widgets.push(decoration.spec.widget);
  });
  return widgets;
}

test("inline diff folds originals without inserting content and expands only read-only widgets", () => {
  const original = Text.of(["before", "unchanged"]);
  let state = EditorState.create({ doc: "after\nunchanged", extensions: [inlineDiffState] });
  state = state.update({ effects: setInlineDiff.of({ original, inline: true }) }).state;
  assert.equal(removed(state).length, 0);
  assert.equal(state.doc.toString(), "after\nunchanged");
  const key = removedLinesKey(original, state.field(inlineDiffState).chunks[0]);
  state = state.update({ effects: toggleRemovedLines.of(key) }).state;
  assert.deepEqual(removed(state).map((widget) => widget.content), ["before"]);
  assert.equal(state.doc.toString(), "after\nunchanged");
  state = state.update({ changes: { from: 0, to: 5, insert: "edited" } }).state;
  assert.equal(state.doc.toString(), "edited\nunchanged");
  assert.equal(removed(state)[0].content, "before");
  state = state.update({ effects: toggleRemovedLines.of(key) }).state;
  assert.equal(removed(state).length, 0);
});

test("switching inline diff preserves selection, editing history, and undo/redo", () => {
  let state = EditorState.create({ doc: "original", extensions: [history(), inlineDiffState] });
  state = state.update({ changes: { from: 0, to: 8, insert: "draft" }, selection: { anchor: 3 } }).state;
  const original = Text.of(["original"]);
  state = state.update({ effects: setInlineDiff.of({ original, inline: true }) }).state;
  assert.equal(state.selection.main.anchor, 3);
  const dispatch = (transaction: Transaction) => { state = transaction.state; };
  assert.equal(undo({ state, dispatch }), true);
  assert.equal(state.doc.toString(), "original");
  assert.equal(state.field(inlineDiffState).chunks.length, 0);
  assert.equal(redo({ state, dispatch }), true);
  assert.equal(state.doc.toString(), "draft");
  state = state.update({ effects: setInlineDiff.of({ original, inline: false }) }).state;
  assert.equal(state.field(inlineDiffState).decorations.size, 0);
  assert.equal(undo({ state, dispatch }), true);
  assert.equal(state.doc.toString(), "original");
});

test("pure deletion at EOF remains foldable and a new baseline resets expanded regions", () => {
  const original = Text.of(["removed"]);
  let state = EditorState.create({ doc: "", extensions: [inlineDiffState] });
  state = state.update({ effects: setInlineDiff.of({ original, inline: true }) }).state;
  const key = removedLinesKey(original, state.field(inlineDiffState).chunks[0]);
  state = state.update({ effects: toggleRemovedLines.of(key) }).state;
  assert.equal(removed(state)[0].content, "removed");
  state = state.update({ effects: setInlineDiff.of({ original: Text.of(["other"]), inline: true }) }).state;
  assert.equal(removed(state).length, 0);
  assert.equal(state.doc.length, 0);
});
