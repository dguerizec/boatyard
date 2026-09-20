import { Text } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { GitBaseline } from "./git";
import { inlineDiffState, setInlineDiff, toggleRemovedLines, removedLinesKey, RemovedLines } from "./inlineDiff";

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: string, readonly open: () => void, readonly expanded?: boolean) { super(); }
  toDOM() {
    const button = document.createElement("button");
    button.className = `file-editor-git-marker ${this.kind}`;
    button.title = this.expanded === undefined ? `${this.kind} lines · Open diff` : `${this.expanded ? "Collapse" : "Expand"} original lines from HEAD`;
    if (this.expanded !== undefined) button.setAttribute("aria-expanded", String(this.expanded));
    button.setAttribute("aria-label", button.title);
    button.textContent = this.expanded !== undefined ? (this.expanded ? "▾" : "▸") : this.kind === "Deleted" ? "−" : this.kind === "Added" ? "+" : "│";
    button.addEventListener("click", this.open);
    return button;
  }
}

/** Adds inline changes to the original editor without replacing its document or history. */
export function createGitView(host: HTMLElement, open: () => void) {
  const toolbar = document.createElement("div");
  toolbar.className = "file-editor-toolbar";
  const description = document.createElement("span");
  description.setAttribute("role", "status");
  function button(label: string, action: () => void) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.addEventListener("click", action); return button;
  }
  const previous = button("Previous change", () => navigate(-1));
  const next = button("Next change", () => navigate(1));
  toolbar.append(previous, next, description);
  host.append(toolbar);
  let editor: EditorView | undefined;
  let original: Text | null = null, identity = "", visible = false, selected = -1;
  function navigate(direction: number) {
    const chunks = editor?.state.field(inlineDiffState).chunks || [];
    if (!chunks.length) return;
    selected = selected < 0 ? (direction > 0 ? 0 : chunks.length - 1) : (selected + direction + chunks.length) % chunks.length;
    jump(selected);
  }
  function jump(index: number) {
    selected = index;
    const chunk = editor?.state.field(inlineDiffState).chunks[index];
    if (editor && chunk) {
      const pos = Math.min(chunk.fromB, editor.state.doc.length);
      editor.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      editor.focus();
    }
  }
  function configure() {
    if (!editor) return;
    const current = editor.state.field(inlineDiffState);
    if (current.inline === visible && (current.original === original || Boolean(current.original && original && current.original.eq(original)))) return;
    editor.dispatch({ effects: setInlineDiff.of({ original, inline: visible }) });
  }
  const markers = gutter({ class: "file-editor-git-gutter",
    lineMarker: (view, line) => {
      const chunks = view.state.field(inlineDiffState).chunks;
      let low = 0, high = chunks.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (Math.min(chunks[middle].fromB, view.state.doc.length) <= line.from) low = middle + 1; else high = middle;
      }
      const chunk = chunks[low - 1];
      if (!chunk || line.from > Math.min(Math.max(chunk.fromB, chunk.toB - 1), view.state.doc.length)) return null;
      const kind = chunk.fromA === chunk.toA ? "Added" : chunk.fromB === chunk.toB ? "Deleted" : "Modified";
      const state = view.state.field(inlineDiffState);
      if (state.inline && state.original && chunk.fromA < chunk.toA
        && line.from === view.state.doc.lineAt(Math.min(chunk.fromB, view.state.doc.length)).from) {
        const key = removedLinesKey(state.original, chunk);
        if (!state.expanded.has(key)) return new ChangeMarker(kind, () => view.dispatch({ effects: toggleRemovedLines.of(key) }), false);
      }
      return new ChangeMarker(kind, () => { open(); jump(low - 1); });
    },
    widgetMarker: (view, widget) => widget instanceof RemovedLines
      ? new ChangeMarker("Deleted", () => view.dispatch({ effects: toggleRemovedLines.of(widget.key) }), true) : null,
    lineMarkerChange: (update) => update.startState.field(inlineDiffState) !== update.state.field(inlineDiffState)
  });
  return {
    extension: [inlineDiffState, markers],
    update(path: string, baseline: GitBaseline | undefined, message: string, target?: EditorView) {
      editor = target;
      if (identity !== path) selected = -1;
      identity = path;
      original = baseline?.available ? Text.of(baseline.text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) : null;
      configure();
      const chunks = editor?.state.field(inlineDiffState).chunks || [];
      description.textContent = baseline?.available && editor
        ? `${baseline.label} → Current · ${chunks.length ? `${chunks.length} changed regions` : "No changes"}${chunks.some((chunk) => !chunk.precise) ? " · Simplified diff" : ""}`
        : message || baseline?.reason || "Loading Git baseline…";
      previous.disabled = next.disabled = !chunks.length;
    },
    show(value: boolean) { visible = value; host.hidden = !value; configure(); },
    cleanup() { editor = undefined; }
  };
}
