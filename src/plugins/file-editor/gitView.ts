import { Text } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { GitBaseline } from "./git";
import { inlineDiffState, setInlineDiff, toggleRemovedLines, removedLinesKey, RemovedLines } from "./inlineDiff";
import { createToolIcon } from "../../renderer/toolIcons";

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
export function createGitView(host: HTMLElement, open: () => void, layout?: { selected(): boolean; toggle(): void }) {
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "Git diff controls");
  const description = document.createElement("span");
  description.className = "file-editor-diff-status";
  description.setAttribute("role", "status");
  function button(label: string, icon: string, action: () => void) {
    const button = document.createElement("button"); button.type = "button";
    button.className = "webapp-tool-button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(createToolIcon(icon));
    button.addEventListener("click", action); return button;
  }
  const previous = button("Previous change", "arrowLeft", () => navigate(-1));
  const next = button("Next change", "arrowRight", () => navigate(1));
  previous.disabled = next.disabled = true;
  host.append(description, previous, next);
  const layoutButton = button("Side-by-side diff", "columns", () => layout?.toggle());
  layoutButton.disabled = true;
  layoutButton.classList.add("file-editor-diff-layout");
  layoutButton.setAttribute("aria-pressed", "false");
  if (layout) host.append(layoutButton);
  let editor: EditorView | undefined;
  let original: Text | null = null, identity = "", visible = false, selected = -1, sideBySide = false;
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
    const inline = visible && !sideBySide;
    if (current.inline === inline && (current.original === original || Boolean(current.original && original && current.original.eq(original)))) return;
    editor.dispatch({ effects: setInlineDiff.of({ original, inline }) });
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
    update(path: string, baseline: GitBaseline | undefined, message: string, target?: EditorView, split = false) {
      editor = target;
      sideBySide = split;
      if (identity !== path) selected = -1;
      identity = path;
      original = baseline?.available ? Text.of(baseline.text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) : null;
      configure();
      const chunks = editor?.state.field(inlineDiffState).chunks || [];
      const status = baseline?.available && editor
        ? `${baseline.label} → Current · ${chunks.length ? `${chunks.length} changed region${chunks.length === 1 ? "" : "s"}` : "No changes"}${chunks.some((chunk) => !chunk.precise) ? " · Simplified diff" : ""}`
        : message || baseline?.reason || "Loading Git baseline…";
      description.title = status;
      description.textContent = status;
      previous.disabled = next.disabled = !chunks.length;
      layoutButton.disabled = !baseline?.available || !editor;
      layoutButton.setAttribute("aria-pressed", String(Boolean(layout?.selected())));
      layoutButton.title = layout?.selected() ? "Switch to inline diff" : "Switch to side-by-side diff";
    },
    show(value: boolean) { visible = value; host.hidden = !value; configure(); },
    cleanup() { editor = undefined; }
  };
}
