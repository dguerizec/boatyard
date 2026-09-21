import { EditorState, type EditorStateConfig, type Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { historyField } from "@codemirror/commands";
import { foldState } from "@codemirror/language";
import { MergeView } from "@codemirror/merge";
import { getSearchQuery, openSearchPanel, searchPanelOpen, search, setSearchQuery } from "@codemirror/search";
import { inlineDiffState } from "./inlineDiff";

/** Recreate only the presentation, retaining editing state when changing diff layout. */
export function createEditorSurface(parent: HTMLElement, config: EditorStateConfig, previous?: EditorState,
  original?: { config: EditorStateConfig; label: string }) {
  const preserved: Extension[] = [];
  if (previous) {
    preserved.push(search());
    const history = previous.field(historyField, false);
    const folds = previous.field(foldState, false);
    const diff = previous.field(inlineDiffState, false);
    if (history) preserved.push(historyField.init(() => history));
    if (folds) preserved.push(foldState.init(() => folds));
    if (diff) preserved.push(inlineDiffState.init(() => diff));
  }
  const current = { ...config, selection: previous?.selection ?? config.selection,
    extensions: [config.extensions || [], preserved] };
  const merge = original ? new MergeView({ parent, a: original.config, b: current,
    gutter: false, diffConfig: { scanLimit: 1000, timeout: 100 } }) : undefined;
  const view = merge?.b || new EditorView({ parent, state: EditorState.create(current) });
  const originalLabel = document.createElement("span");
  let detachScroll = () => {};
  if (merge && original) {
    merge.dom.classList.add("file-editor-side-by-side");
    const labels = document.createElement("div");
    labels.className = "file-editor-diff-labels";
    originalLabel.textContent = `${original.label} · Read-only`;
    const currentLabel = document.createElement("span");
    currentLabel.textContent = "Current";
    labels.append(originalLabel, currentLabel);
    merge.dom.prepend(labels);
    const left = merge.a.scrollDOM, right = view.scrollDOM;
    // Search/Vim panels can give the scrollers different heights. Ignore the
    // mirrored event so clamping on the shorter document cannot pull us back.
    const mirrored = new WeakMap<HTMLElement, number>();
    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      const expected = mirrored.get(source);
      mirrored.delete(source);
      if (expected === source.scrollTop || target.scrollTop === source.scrollTop) return;
      target.scrollTop = source.scrollTop;
      mirrored.set(target, target.scrollTop);
    };
    const fromLeft = () => syncScroll(left, right);
    const fromRight = () => syncScroll(right, left);
    left.addEventListener("scroll", fromLeft);
    right.addEventListener("scroll", fromRight);
    detachScroll = () => { left.removeEventListener("scroll", fromLeft); right.removeEventListener("scroll", fromRight); };
  }
  if (previous) {
    if (searchPanelOpen(previous)) openSearchPanel(view);
    view.dispatch({ effects: setSearchQuery.of(getSearchQuery(previous)) });
  }
  return {
    view,
    originalView: merge?.a,
    updateOriginal(text: string, label: string) {
      if (!merge) return;
      const doc = Text.of(text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/));
      if (!merge.a.state.doc.eq(doc)) merge.a.dispatch({ changes: { from: 0, to: merge.a.state.doc.length, insert: doc } });
      originalLabel.textContent = `${label} · Read-only`;
    },
    destroy() { detachScroll(); if (merge) merge.destroy(); else view.destroy(); }
  };
}
