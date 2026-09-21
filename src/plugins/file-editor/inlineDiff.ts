import { StateEffect, StateField, Text, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { Chunk } from "@codemirror/merge";

const diffConfig = { scanLimit: 1000, timeout: 100 };
export const toggleRemovedLines = StateEffect.define<string>();
export const removedLinesKey = (original: Text, chunk: Chunk) => `${chunk.fromA}:${original.sliceString(chunk.fromA, chunk.endA)}`;
export const setInlineDiff = StateEffect.define<{ original: Text | null; inline: boolean }>();
export type InlineDiffState = {
  original: Text | null;
  inline: boolean;
  chunks: readonly Chunk[];
  decorations: DecorationSet;
  expanded: Set<string>;
};

export class RemovedLines extends WidgetType {
  constructor(readonly content: string, readonly key: string, readonly changes: readonly { from: number; to: number }[] = []) { super(); }
  eq(other: RemovedLines) {
    return other.key === this.key && other.changes.length === this.changes.length &&
      this.changes.every((change, index) => change.from === other.changes[index].from && change.to === other.changes[index].to);
  }
  toDOM() {
    const before = document.createElement("pre");
    before.className = "file-editor-removed-lines";
    before.contentEditable = "false";
    let offset = 0;
    for (const change of this.changes) {
      before.append(this.content.slice(offset, change.from));
      const highlight = document.createElement("span");
      highlight.className = "file-editor-removed-text";
      highlight.textContent = this.content.slice(change.from, change.to);
      before.append(highlight);
      offset = change.to;
    }
    before.append(this.content.slice(offset));
    before.setAttribute("aria-label", "Original lines from HEAD, read-only");
    return before;
  }
  ignoreEvent() { return true; }
}

function decorate(value: InlineDiffState, doc: Text): DecorationSet {
  if (!value.inline || !value.original) return Decoration.none;
  const decorations: Range<Decoration>[] = [];
  for (const chunk of value.chunks) {
    const position = Math.min(chunk.fromB, doc.length);
    if (chunk.fromA < chunk.toA) {
      const content = value.original.sliceString(chunk.fromA, chunk.endA);
      const key = removedLinesKey(value.original, chunk);
      const changes = chunk.changes.map((change) => ({ from: Math.min(content.length, change.fromA), to: Math.min(content.length, change.toA) }))
        .filter((change) => change.from < change.to);
      if (value.expanded.has(key)) decorations.push(Decoration.widget({ block: true, side: -1,
        widget: new RemovedLines(content, key, changes) }).range(position));
    }
    if (chunk.fromB < chunk.toB) {
      for (let number = doc.lineAt(position).number; number <= doc.lines; number++) {
        const line = doc.line(number);
        if (line.from >= chunk.toB) break;
        decorations.push(Decoration.line({ class: "file-editor-added-line" }).range(line.from));
      }
      for (const change of chunk.changes) {
        const from = Math.min(doc.length, chunk.fromB + change.fromB), to = Math.min(doc.length, chunk.fromB + change.toB);
        if (from < to) decorations.push(Decoration.mark({ class: "file-editor-added-text" }).range(from, to));
      }
    }
  }
  return Decoration.set(decorations, true);
}

/** Old lines are widgets, never part of the editable document or its undo history. */
export const inlineDiffState = StateField.define<InlineDiffState>({
  create: () => ({ original: null, inline: false, chunks: [], decorations: Decoration.none, expanded: new Set() }),
  update(value, transaction) {
    const config = transaction.effects.find((effect) => effect.is(setInlineDiff));
    const toggles = transaction.effects.filter((effect) => effect.is(toggleRemovedLines));
    if (!config && !transaction.docChanged && !toggles.length) return value;
    let next = { ...value };
    if (config?.is(setInlineDiff)) {
      const originalChanged = !value.original?.eq(config.value.original || Text.empty);
      next = { ...next, ...config.value, expanded: originalChanged ? new Set() : value.expanded };
      next.chunks = next.original ? Chunk.build(next.original, transaction.newDoc, diffConfig) : [];
    } else if (next.original && transaction.docChanged) {
      next.chunks = Chunk.updateB(value.chunks, next.original, transaction.newDoc, transaction.changes, diffConfig);
    }
    if (toggles.length) {
      next.expanded = new Set(next.expanded);
      for (const effect of toggles) { if (next.expanded.has(effect.value)) next.expanded.delete(effect.value); else next.expanded.add(effect.value); }
    }
    next.decorations = decorate(next, transaction.newDoc);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});
