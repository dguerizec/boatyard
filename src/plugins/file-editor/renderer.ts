import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { closeSearchPanel, openSearchPanel, searchPanelOpen } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { EditorDocument, type EditorDraft } from "./document";
import type { FileSnapshot } from "./service";

const scope = window as BoatyardPluginRendererGlobal;
const registry = scope.BoatyardPluginRegistry;
const positions = new Map<string, { anchor: number; head: number; scrollTop: number }>();
const pluginId = "boatyard.fileEditor";
const documents = new Map<string, EditorDocument>();
const active = new Map<EditorDocument, number>();
let timer: ReturnType<typeof setInterval> | undefined;

function poll() {
  for (const doc of active.keys()) void doc.refresh();
}
function subscribe(doc: EditorDocument, listener: () => void) {
  doc.listeners.add(listener);
  active.set(doc, (active.get(doc) || 0) + 1);
  if (!timer) {
    timer = setInterval(poll, 3000);
    window.addEventListener("focus", poll);
  }
  return () => {
    doc.listeners.delete(listener);
    const count = (active.get(doc) || 1) - 1;
    if (count) active.set(doc, count);
    else active.delete(doc);
    if (!active.size) {
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener("focus", poll);
    }
  };
}

async function invoke(action: string, projectId: string, payload: Record<string, unknown> = {}) {
  if (!scope.boatyard?.invokePlugin) throw new Error("File access is unavailable.");
  return await scope.boatyard.invokePlugin(pluginId, action, { ...payload, projectId }) as FileSnapshot | null;
}

function language(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(extension || "")) {
    return javascript({ jsx: extension === "jsx" || extension === "tsx", typescript: extension === "ts" || extension === "tsx" });
  }
  if (extension === "json") return json();
  if (extension === "css") return css();
  if (extension === "html" || extension === "htm") return html();
  if (extension === "md" || extension === "markdown") return markdown();
  if (extension === "py") return python();
  return [];
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function button(text: string, action: () => void) {
  const node = element("button", "", text);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
function readDraft(key: string): EditorDraft | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (value && ["path", "text", "baseText", "revision"].every((field) => typeof value[field] === "string")) return value;
  } catch { /* A malformed draft must not prevent opening a file. */ }
  return undefined;
}

function render(container: HTMLElement, props: PluginRegistryRecord = {}) {
  const project = (props.project || {}) as { id: string; sourcePath: string };
  const prefix = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:`;
  const paneKey = `${prefix}pane:${String(props.paneId || "default")}`;
  const draftKey = (path: string) => `${prefix}draft:${path}`;
  const root = element("section", "file-editor");
  const toolbar = element("form", "file-editor-toolbar");
  const pathInput = element("input");
  pathInput.placeholder = "Project-relative file path";
  pathInput.setAttribute("aria-label", "Project-relative file path");
  pathInput.spellcheck = false;
  const status = element("div", "file-editor-status", "Open a UTF-8 text file from this project (up to 2 MiB).");
  status.setAttribute("role", "status");
  const notices = element("div", "file-editor-notices");
  const editorHost = element("div", "file-editor-body");
  const empty = element("p", "file-editor-empty", "Open a file to start editing. Unsaved drafts are kept locally.");
  editorHost.append(empty);
  let doc: EditorDocument | undefined;
  let view: EditorView | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  let opening = false;
  let persistenceError = "";
  let bom = "";
  let syncing = false;
  const theme = new Compartment();
  const lineSeparator = new Compartment();
  const editorTheme = () => document.documentElement.dataset.theme === "light" ? [] : oneDark;
  const themeObserver = new MutationObserver(() => {
    view?.dispatch({ effects: theme.reconfigure(editorTheme()) });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function rememberPosition() {
    if (doc && view) positions.set(`${paneKey}:${doc.base.path}`, {
      anchor: view.state.selection.main.anchor, head: view.state.selection.main.head, scrollTop: view.scrollDOM.scrollTop
    });
  }

  function persist() {
    if (!doc) return;
    try {
      const draft = doc.draft();
      if (draft) localStorage.setItem(draftKey(doc.base.path), JSON.stringify(draft));
      else localStorage.removeItem(draftKey(doc.base.path));
      localStorage.setItem(paneKey, doc.base.path);
      persistenceError = "";
    } catch {
      persistenceError = "Local draft storage is full or unavailable. Save before leaving this editor.";
    }
  }
  function showError(error: unknown) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
  function setNotices(...nodes: Node[]) {
    draftsButton.setAttribute("aria-pressed", "false");
    notices.replaceChildren(...nodes);
  }
  function confirmDiscard(action: () => void) {
    if (!doc?.dirty) { action(); return; }
    setNotices(element("span", "", "Discard this unsaved draft?"),
      button("Discard draft", () => { setNotices(); action(); }),
      button("Cancel", () => setNotices()));
  }

  const openButton = button("Open", () => void openFile(pathInput.value));
  const browseButton = button("Browse…", () => void openFile());
  const saveButton = button("Save", () => { if (doc) void doc.save(); });
  saveButton.title = "Save (Ctrl/Cmd+S)";
  saveButton.disabled = true;
  const findButton = button("Find", () => {
    if (!view) return;
    if (searchPanelOpen(view.state)) closeSearchPanel(view);
    else openSearchPanel(view);
  });
  findButton.setAttribute("aria-pressed", "false");
  findButton.disabled = true;
  const compare = element("details", "file-editor-compare");
  compare.hidden = true;
  const compareText = element("pre");
  const compareActions = element("div", "file-editor-toolbar");
  compareActions.append(
    button("Use disk version", () => confirmDiscard(() => { doc?.useDisk(); rebuild(); })),
    button("Keep my version", () => {
      const comparedRevision = doc?.disk.revision;
      setNotices(element("span", "", "Keep your version for the next save, replacing the disk version shown below?"),
        button("Keep my version", () => {
          if (doc?.disk.revision !== comparedRevision) {
            setNotices(element("span", "", "The disk version changed again. Compare it before continuing."));
            return;
          }
          doc?.keepDraft(); setNotices();
        }),
        button("Cancel", () => setNotices()));
    })
  );
  compare.append(element("summary", "", "File changed on disk — compare before saving"), compareActions, compareText);

  function refreshUi() {
    if (!doc || disposed) return;
    persist();
    saveButton.disabled = !doc.dirty || doc.busy || doc.conflict;
    status.textContent = [doc.base.path, doc.dirty ? "Unsaved changes" : "Saved", doc.busy ? "Working…" : "", doc.error, persistenceError].filter(Boolean).join(" · ");
    compare.hidden = !doc.conflict;
    if (doc.conflict && compareText.textContent !== doc.disk.text) compareText.textContent = doc.disk.text;
    if (view && bom + view.state.sliceDoc() !== doc.text) {
      const nextBom = doc.text.startsWith("\uFEFF") ? "\uFEFF" : "";
      bom = nextBom;
      syncing = true;
      const selection = view.state.selection.main;
      const text = doc.text.slice(bom.length);
      const separator = doc.text.includes("\r\n") ? "\r\n" : "\n";
      const length = text.split(separator).join("\n").length;
      const scrollTop = view.scrollDOM.scrollTop;
      if (view.state.lineBreak !== separator) view.dispatch({ effects: lineSeparator.reconfigure(EditorState.lineSeparator.of(separator)) });
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: Math.min(selection.anchor, length), head: Math.min(selection.head, length) }
      });
      view.scrollDOM.scrollTop = scrollTop;
      syncing = false;
    }
  }

  function rebuild() {
    if (!doc) return;
    view?.destroy();
    editorHost.replaceChildren();
    bom = doc.text.startsWith("\uFEFF") ? "\uFEFF" : "";
    view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: doc.text.slice(bom.length),
        extensions: [basicSetup, theme.of(editorTheme()), language(doc.base.path),
          lineSeparator.of(EditorState.lineSeparator.of(doc.text.includes("\r\n") ? "\r\n" : "\n")),
          EditorView.contentAttributes.of({ "aria-label": "File contents" }),
          EditorView.theme({ "&": { height: "100%", backgroundColor: "var(--panel)" }, ".cm-scroller": { overflow: "auto", fontFamily: "monospace" } }),
          keymap.of([{ key: "Mod-s", run: () => { if (doc) void doc.save(); return true; } }]),
          EditorView.updateListener.of((update) => {
            findButton.setAttribute("aria-pressed", String(searchPanelOpen(update.state)));
            if (update.docChanged && !syncing) doc?.edit(bom + update.state.sliceDoc());
          })]
      })
    });
    const position = positions.get(`${paneKey}:${doc.base.path}`);
    if (position) {
      view.dispatch({ selection: { anchor: Math.min(position.anchor, view.state.doc.length), head: Math.min(position.head, view.state.doc.length) } });
      view.scrollDOM.scrollTop = position.scrollTop;
    }
    findButton.disabled = false;
    findButton.setAttribute("aria-pressed", String(searchPanelOpen(view.state)));
    refreshUi();
  }

  async function openFile(path?: string) {
    if (opening || disposed) return;
    // Switching files preserves the previous draft, including when other panes show it.
    persist();
    if (persistenceError && doc?.dirty) { showError(persistenceError); return; }
    opening = true;
    openButton.disabled = browseButton.disabled = true;
    try {
      let snapshot: FileSnapshot | null;
      try {
        snapshot = await invoke(path === undefined ? "choose" : "read", project.id, path === undefined ? {} : { path });
      } catch (error) {
        const draft = path === undefined ? undefined : readDraft(draftKey(path));
        if (!draft) throw error;
        // Missing or inaccessible files must not make their saved draft inaccessible.
        snapshot = { path: draft.path, text: draft.baseText, revision: draft.revision };
      }
      if (!snapshot || disposed) return;
      const key = draftKey(snapshot.path);
      let next = documents.get(key);
      if (!next) {
        next = new EditorDocument(snapshot, {
          read: async (file) => (await invoke("read", project.id, { path: file }))!,
          save: async (file, text, revision) => (await invoke("save", project.id, { path: file, text, revision }))!
        }, readDraft(key));
        documents.set(key, next);
      }
      rememberPosition();
      unsubscribe?.();
      doc = next;
      pathInput.value = snapshot.path;
      setNotices();
      unsubscribe = subscribe(doc, refreshUi);
      rebuild();
      void doc.refresh();
      view?.focus();
    } catch (error) { if (!disposed) showError(error); }
    finally {
      opening = false;
      openButton.disabled = browseButton.disabled = false;
    }
  }

  const draftsButton = button("Drafts", () => {
    if (draftsButton.getAttribute("aria-pressed") === "true") {
      setNotices();
      return;
    }
    setNotices();
    try {
      const keys = Object.keys(localStorage).filter((key) => key.startsWith(`${prefix}draft:`));
      if (!keys.length) notices.append(element("span", "", "No unsaved drafts."));
      for (const key of keys) {
        const draft = readDraft(key);
        if (draft) notices.append(button(draft.path, () => void openFile(draft.path)));
      }
      draftsButton.setAttribute("aria-pressed", "true");
    } catch (error) { showError(error); }
  });
  draftsButton.setAttribute("aria-pressed", "false");
  toolbar.addEventListener("submit", (event) => { event.preventDefault(); void openFile(pathInput.value); });
  toolbar.append(pathInput, openButton, browseButton, saveButton, findButton, draftsButton);
  root.append(toolbar, notices, compare, editorHost, status);
  container.replaceChildren(root);
  try {
    const path = localStorage.getItem(paneKey);
    if (path) { pathInput.value = path; void openFile(path); }
  } catch { /* Opening files remains available when local storage is disabled. */ }
  return () => {
    persist();
    rememberPosition();
    themeObserver.disconnect();
    disposed = true;
    unsubscribe?.();
    view?.destroy();
  };
}

registry?.register({
  id: pluginId, name: "File Editor", version: "0.1.0", apiVersion: "0.1",
  contributes: { panes: ["boatyard.fileEditor.editor"] }, permissions: ["pane:dom", "projectConfig:read"]
}, {
  activate(ctx) {
    ctx.status.set({ state: "ready", summary: "Project file editing is available" });
    ctx.panes.register({
      id: "boatyard.fileEditor.editor", webAppId: "boatyard.fileEditor.editor", key: "file-editor",
      title: "File Editor", icon: "fileEditor", kind: "dom", scope: "project",
      isAvailable: ({ project } = {}) => Boolean(project?.sourcePath), render
    });
  }
});
