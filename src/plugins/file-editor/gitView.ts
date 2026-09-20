import { Compartment, EditorState, Text, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import { Chunk, MergeView, unifiedMergeView } from "@codemirror/merge";
import { basicSetup } from "codemirror";
import type { GitBaseline } from "./git";

const diffConfig = { scanLimit: 1000, timeout: 100 };
const text = (value: string) => Text.of(value.split(/\r\n|\r|\n/));
class ChangeMarker extends GutterMarker {
  constructor(readonly kind: string, readonly open: () => void) { super(); }
  toDOM() {
    const button = document.createElement("button");
    button.className = `file-editor-git-marker ${this.kind}`;
    button.title = `${this.kind} lines · Open diff`;
    button.setAttribute("aria-label", button.title);
    button.textContent = this.kind === "Deleted" ? "−" : this.kind === "Added" ? "+" : "│";
    button.addEventListener("click", this.open);
    return button;
  }
}

/** Owns read-only diff views and the editable document's Git gutter. */
export function createGitView(host: HTMLElement, theme: () => Extension, open: () => void) {
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
  const labels = document.createElement("div"); labels.className = "file-editor-diff-labels";
  const beforeLabel = document.createElement("span"), afterLabel = document.createElement("span");
  beforeLabel.textContent = "HEAD"; afterLabel.textContent = "Current · including unsaved changes";
  labels.append(beforeLabel, afterLabel);
  const body = document.createElement("div"); body.className = "file-editor-diff-body";
  host.append(toolbar, labels, body);
  const compartment = new Compartment();
  let editor: EditorView | undefined;
  let merge: MergeView | undefined, unified: EditorView | undefined;
  let chunks: readonly Chunk[] = [];
  let original = "", current = "", identity = "", valid = false, visible = false;
  let sideBySide = false, rendered = "", selected = -1, disposed = false;
  let lastTheme: unknown;
  function destroyView() { merge?.destroy(); unified?.destroy(); merge = undefined; unified = undefined; body.replaceChildren(); }
  function navigate(direction: number) {
    if (!chunks.length) return;
    selected = selected < 0 ? (direction > 0 ? 0 : chunks.length - 1) : (selected + direction + chunks.length) % chunks.length;
    jump(selected);
  }
  function jump(index: number) {
    selected = index;
    const chunk = chunks[index];
    const view = merge?.b || unified;
    if (view && chunk) {
      const pos = Math.min(chunk.fromB, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      view.focus();
    }
  }
  function render() {
    if (!visible || disposed || !valid) return;
    const wide = host.clientWidth >= 760;
    const themeValue = document.documentElement.dataset.theme;
    const key = JSON.stringify([identity, original, current, wide, themeValue]);
    if (rendered === key) return;
    const scroll = merge?.dom.scrollTop ?? unified?.scrollDOM.scrollTop ?? 0;
    const sameFile = rendered !== "" && sideBySide === wide && lastTheme === themeValue;
    // Update existing views to preserve their selection and scroll during live edits.
    if (sameFile && merge) {
      for (const [view, value] of [[merge.a, original], [merge.b, current]] as const) {
        if (view.state.sliceDoc() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      }
    } else {
      destroyView();
      const extensions = [basicSetup, theme(), EditorState.readOnly.of(true), EditorView.editable.of(false),
        EditorView.contentAttributes.of({ "aria-label": "Git diff" }),
        EditorView.theme({ "&": { fontSize: "13px" }, ".cm-scroller": { fontFamily: "monospace" } })];
      if (wide) merge = new MergeView({ parent: body, a: { doc: original, extensions }, b: { doc: current, extensions }, diffConfig });
      else unified = new EditorView({ parent: body, doc: current, extensions: [...extensions,
        unifiedMergeView({ original, mergeControls: false, diffConfig }),
        EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { overflow: "auto" } })] });
      if (merge) merge.dom.scrollTop = scroll;
      else if (unified) unified.scrollDOM.scrollTop = scroll;
    }
    sideBySide = wide; lastTheme = themeValue; rendered = key;
    labels.classList.toggle("unified", !wide);
  }
  const resize = new ResizeObserver(render); resize.observe(host);
  function clearGutter() { if (editor) editor.dispatch({ effects: compartment.reconfigure([]) }); }
  return {
    extension: compartment.of([]),
    update(path: string, value: string, baseline: GitBaseline | undefined, message: string, target?: EditorView) {
      if (editor && editor !== target) { editor = undefined; }
      const changed = identity !== path || original !== baseline?.text || current !== value || editor !== target || valid !== Boolean(baseline?.available);
      editor = target;
      if (identity !== path) { rendered = ""; selected = -1; }
      identity = path; current = value; original = baseline?.text ?? ""; valid = Boolean(baseline?.available);
      if (!valid) {
        chunks = []; clearGutter(); destroyView(); rendered = "";
        description.textContent = message || baseline?.reason || "Loading Git baseline…";
      } else {
        if (changed) {
          chunks = Chunk.build(text(original), text(current), diffConfig);
          const doc = editor?.state.doc;
          if (editor && doc) {
            const marks = chunks.map((chunk, index) => {
              const kind = chunk.fromA === chunk.toA ? "Added" : chunk.fromB === chunk.toB ? "Deleted" : "Modified";
              return { from: doc.lineAt(Math.min(chunk.fromB, doc.length)).from,
                to: Math.min(Math.max(chunk.fromB, chunk.toB - 1), doc.length),
                marker: new ChangeMarker(kind, () => { open(); jump(index); }) };
            });
            editor.dispatch({ effects: compartment.reconfigure(gutter({ class: "file-editor-git-gutter",
              lineMarker: (_view, line) => {
                let low = 0, high = marks.length;
                while (low < high) { const middle = (low + high) >>> 1; if (marks[middle].from <= line.from) low = middle + 1; else high = middle; }
                const mark = marks[low - 1];
                return mark && line.from <= mark.to ? mark.marker : null;
              } })) });
          }
        }
        beforeLabel.textContent = baseline!.label;
        description.textContent = `${chunks.length ? `${chunks.length} changed regions` : "No changes against HEAD"}${chunks.some((chunk) => !chunk.precise) ? " · Simplified diff" : ""}`;
        render();
      }
      previous.disabled = next.disabled = !valid || !chunks.length;
      labels.hidden = !valid;
    },
    show(value: boolean) { visible = value; host.hidden = !value; if (value) render(); },
    refreshTheme() { rendered = ""; render(); },
    cleanup() { disposed = true; resize.disconnect(); destroyView(); editor = undefined; }
  };
}
