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
import type { FileSnapshot, ProjectDirectoryPage } from "./service";
import { createToolIcon } from "../../renderer/toolIcons";
import { createProjectFileBrowser } from "./browser";
import { createResizablePaneSidePanel } from "../../renderer/resizablePaneSidePanel";
import { normalizePaneSidePanel } from "../../renderer/paneSidePanel";
import { createPreviewDocument, supportsPreview } from "./preview";

const scope = window as BoatyardPluginRendererGlobal;
const registry = scope.BoatyardPluginRegistry;
type FilePosition = { anchor: number; head: number; scrollTop: number; scrollLeft: number; previewScrollTop: number };
const pluginId = "boatyard.fileEditor";
const documents = new Map<string, EditorDocument>();
const active = new Map<EditorDocument, number>();
type PaneControl = { open: boolean; enabled: boolean; label: string; button: HTMLButtonElement | null; toggle: (() => void) | null; drag?: (event: DragEvent) => void };
const paneControls = new WeakMap<HTMLElement, Map<string, PaneControl>>();
function getPaneControl(host: HTMLElement, key: "browse" | "preview"): PaneControl {
  let controls = paneControls.get(host);
  if (!controls) {
    controls = new Map();
    paneControls.set(host, controls);
  }
  let control = controls.get(key);
  if (!control) {
    control = { open: false, enabled: false, label: key === "browse" ? "project files" : "preview", button: null, toggle: null };
    controls.set(key, control);
  }
  return control;
}
function syncPaneControl(control: PaneControl) {
  if (!control.button) return;
  control.button.draggable = control.enabled && Boolean(control.drag);
  control.button.disabled = !control.enabled || !control.toggle;
  control.button.classList.toggle("active", control.open);
  control.button.setAttribute("aria-pressed", String(control.open));
  control.button.title = `${control.open ? "Hide" : "Show"} ${control.label}${control.drag ? " · Drag to another pane" : ""}`;
}
function renderHeaderActions(container: HTMLElement, props: PluginRegistryRecord = {}) {
  if (!(props.host instanceof HTMLElement)) return undefined;
  const cleanups: Array<() => void> = [];
  for (const definition of [
    { key: "browse", icon: "folderTree", label: "Browse project files" },
    { key: "preview", icon: "eye", label: "Preview" }
  ] as const) {
    const control = getPaneControl(props.host, definition.key);
    const action = button("", () => control.toggle?.());
    action.className = `webapp-tool-button file-editor-${definition.key}-button`;
    action.setAttribute("aria-label", definition.label);
    action.append(createToolIcon(definition.icon));
    if (definition.key === "preview") action.addEventListener("dragstart", (event) => {
      if (control.enabled && control.drag) control.drag(event);
      else event.preventDefault();
    });
    control.button = action;
    syncPaneControl(control);
    container.append(action);
    cleanups.push(() => { if (control.button === action) control.button = null; });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
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

async function invoke<T = FileSnapshot | null>(action: string, projectId: string, payload: Record<string, unknown> = {}) {
  if (!scope.boatyard?.invokePlugin) throw new Error("File access is unavailable.");
  return await scope.boatyard.invokePlugin(pluginId, action, { ...payload, projectId }) as T;
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
  const previewControl = getPaneControl(container, "preview");
  previewControl.enabled = false;
  const project = (props.project || {}) as { id: string; sourcePath: string };
  const prefix = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:`;
  const paneKey = `${prefix}pane:${String(props.paneId || "default")}`;
  const previewKey = `${paneKey}:preview`;
  const positions = new Map<string, FilePosition>();
  function positionFor(path: string): FilePosition {
    let position = positions.get(path);
    if (!position) {
      position = { anchor: 0, head: 0, scrollTop: 0, scrollLeft: 0, previewScrollTop: 0 };
      try {
        const saved = JSON.parse(localStorage.getItem(`${paneKey}:position:${path}`) || "null");
        for (const key of Object.keys(position) as Array<keyof FilePosition>) {
          if (Number.isFinite(saved?.[key]) && saved[key] >= 0) position[key] = Math.floor(saved[key]);
        }
      } catch { /* Use defaults when position storage is unavailable or malformed. */ }
      positions.set(path, position);
    }
    return position;
  }
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let restoringPosition = false;
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
  const previewFrame = element("iframe", "file-editor-preview");
  previewFrame.title = "File preview";
  previewFrame.setAttribute("sandbox", "allow-same-origin");
  previewFrame.hidden = true;
  let previewVisible = false;
  let requestedPreviewPath: string | null = null;
  try {
    // A one-shot request survives cleanup of the previous content in the target pane.
    requestedPreviewPath = localStorage.getItem(`${paneKey}:preview-file`);
    previewVisible = Boolean(requestedPreviewPath) || localStorage.getItem(previewKey) === "true";
  } catch { /* Preview remains available without persisted preferences. */ }
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewSource = "";
  let previewPendingSource = "";
  let previewVersion = 0;
  let previewScrollTop = 0;
  let previewPath = "";
  let loadedPreviewPath = "";
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
    schedulePreview();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function schedulePreview() {
    if (!previewVisible || !doc || disposed) return;
    const source = JSON.stringify([doc.base.path, doc.text, document.documentElement.dataset.theme]);
    if (source === previewSource || source === previewPendingSource) return;
    previewPendingSource = source;
    clearTimeout(previewTimer);
    const version = ++previewVersion;
    previewTimer = setTimeout(async () => {
      if (!previewVisible || !doc || disposed) return;
      try {
        const sameFile = previewPath === doc.base.path;
        previewScrollTop = sameFile ? previewFrame.contentDocument?.scrollingElement?.scrollTop || 0 : positionFor(doc.base.path).previewScrollTop;
        previewPath = doc.base.path;
        const styles = getComputedStyle(root);
        const color = (name: string) => styles.getPropertyValue(name).trim();
        const output = await createPreviewDocument(doc.text, doc.base.path, {
          background: color("--panel"), text: color("--text"), muted: color("--muted"),
          accent: color("--accent"), line: color("--line"), dark: document.documentElement.dataset.theme !== "light"
        }, () => !disposed && previewVisible && version === previewVersion);
        if (disposed || !previewVisible || version !== previewVersion) return;
        previewFrame.srcdoc = output;
        previewSource = source;
      } catch (error) { if (!disposed && version === previewVersion) showError(error); }
      finally { if (version === previewVersion) previewPendingSource = ""; }
    }, 150);
  }
  previewFrame.addEventListener("load", () => {
    const content = previewFrame.contentDocument;
    if (!content || disposed) return;
    if (content.scrollingElement) content.scrollingElement.scrollTop = previewScrollTop;
    const loadedPath = previewPath;
    loadedPreviewPath = loadedPath;
    content.addEventListener("scroll", () => {
      if (!previewVisible || !loadedPath || loadedPath !== doc?.base.path) return;
      positionFor(loadedPath).previewScrollTop = content.scrollingElement?.scrollTop || 0;
      schedulePosition();
    });
    content.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const link = target?.closest?.("a");
      if (!link) return;
      const href = link.getAttribute("href") || "";
      if (href.startsWith("#")) return;
      event.preventDefault();
      if (/^https?:\/\//i.test(href)) {
        void scope.boatyard?.openExternal?.(href);
      } else if (href && !/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) {
        const directory = previewPath.replace(/[^/\\]*$/, "");
        try { void openFile(directory + decodeURIComponent(href.split(/[?#]/)[0])); }
        catch (error) { showError(error); }
      }
    });
  });
  function setPreview(visible: boolean) {
    rememberPosition();
    previewVersion++;
    previewPendingSource = "";
    previewVisible = visible && Boolean(doc && supportsPreview(doc.base.path));
    try { localStorage.setItem(previewKey, String(previewVisible)); }
    catch { /* Optional view preferences must not prevent editing. */ }
    previewControl.open = previewVisible;
    syncPaneControl(previewControl);
    previewFrame.hidden = !previewVisible;
    editorHost.hidden = previewVisible;
    findButton.disabled = !view || previewVisible;
    if (previewVisible) {
      if (view) closeSearchPanel(view);
      schedulePreview();
    } else {
      clearTimeout(previewTimer);
      restorePosition();
      view?.focus();
    }
  }
  function rememberPosition() {
    if (!doc || restoringPosition) return;
    const position = positionFor(doc.base.path);
    if (view) {
      position.anchor = view.state.selection.main.anchor;
      position.head = view.state.selection.main.head;
    }
    if (previewVisible && loadedPreviewPath === doc.base.path && previewFrame.contentDocument?.scrollingElement) {
      position.previewScrollTop = previewFrame.contentDocument.scrollingElement.scrollTop;
    }
    if (view && !editorHost.hidden) {
      position.scrollTop = view.scrollDOM.scrollTop;
      position.scrollLeft = view.scrollDOM.scrollLeft;
    }
    try { localStorage.setItem(`${paneKey}:position:${doc.base.path}`, JSON.stringify(position)); }
    catch { /* Editing remains available without persisted positions. */ }
  }
  function schedulePosition() {
    clearTimeout(positionTimer);
    positionTimer = setTimeout(rememberPosition, 150);
  }
  function restorePosition() {
    if (!doc || !view) return;
    const currentView = view;
    const position = { ...positionFor(doc.base.path) };
    restoringPosition = true;
    currentView.requestMeasure({
      read: () => undefined,
      write: () => {
        if (view !== currentView || disposed) return;
        currentView.scrollDOM.scrollTop = position.scrollTop;
        currentView.scrollDOM.scrollLeft = position.scrollLeft;
        restoringPosition = false;
      }
    });
  }
  const flushPosition = () => { rememberPosition(); persist(); };
  window.addEventListener("pagehide", flushPosition);

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
    schedulePreview();
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
    restoringPosition = true;
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
          EditorView.domEventHandlers({ scroll: () => { if (!restoringPosition) schedulePosition(); } }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) schedulePosition();
            findButton.setAttribute("aria-pressed", String(searchPanelOpen(update.state)));
            if (update.docChanged && !syncing) doc?.edit(bom + update.state.sliceDoc());
          })]
      })
    });
    const position = positionFor(doc.base.path);
    view.dispatch({ selection: { anchor: Math.min(position.anchor, view.state.doc.length), head: Math.min(position.head, view.state.doc.length) } });
    previewControl.enabled = supportsPreview(doc.base.path);
    setPreview(previewVisible);
    if (previewVisible) restoringPosition = false;
    findButton.setAttribute("aria-pressed", String(searchPanelOpen(view.state)));
    refreshUi();
  }

  async function openFile(path: string) {
    if (opening || disposed) return;
    // Switching files preserves the previous draft, including when other panes show it.
    persist();
    if (persistenceError && doc?.dirty) { showError(persistenceError); return; }
    opening = true;
    openButton.disabled = true;
    try {
      let snapshot: FileSnapshot | null;
      try {
        snapshot = await invoke("read", project.id, { path });
      } catch (error) {
        const draft = readDraft(draftKey(path));
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
      fileBrowser.setSelected(snapshot.path);
      setNotices();
      unsubscribe = subscribe(doc, refreshUi);
      rebuild();
      void doc.refresh();
      if (!previewVisible) view?.focus();
    } catch (error) { if (!disposed) showError(error); }
    finally {
      opening = false;
      openButton.disabled = false;
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
  toolbar.append(pathInput, openButton, saveButton, findButton, draftsButton);
  const workspace = element("div", "file-editor-workspace");
  const browserKey = `${paneKey}:browser`;
  const browserState = { open: false, width: 240 };
  try {
    const saved = JSON.parse(localStorage.getItem(browserKey) || "null");
    if (saved) {
      browserState.open = saved.open === true;
      if (Number.isFinite(saved.width)) browserState.width = Math.max(160, Math.min(520, saved.width));
    }
  } catch { /* Use defaults when browser settings cannot be restored. */ }
  const browserLayout = createResizablePaneSidePanel(workspace, normalizePaneSidePanel({
    title: "Project files", defaultOpen: false, defaultWidth: 240,
    minWidth: 160, maxWidth: 520, minMainWidth: 160, position: "left"
  })!, browserState, {
    onPersist() {
      try { localStorage.setItem(browserKey, JSON.stringify(browserState)); }
      catch { /* Browsing remains available without persisted layout settings. */ }
    },
    onResize: () => view?.requestMeasure()
  });
  const fileBrowser = createProjectFileBrowser({
    list: (path, offset) => invoke<ProjectDirectoryPage>("list", project.id, { path, offset }),
    openFile
  });
  browserLayout.panel.append(fileBrowser.element);
  browserLayout.viewport.classList.add("file-editor-main");
  browserLayout.viewport.append(notices, compare, editorHost, previewFrame);
  const browserControl = getPaneControl(container, "browse");
  browserControl.open = browserState.open;
  browserControl.enabled = true;
  const toggleBrowser = () => {
    browserState.open = !browserState.open;
    browserControl.open = browserState.open;
    syncPaneControl(browserControl);
    browserLayout.sync();
    if (browserState.open) fileBrowser.show();
  };
  const togglePreview = () => setPreview(!previewVisible);
  previewControl.drag = typeof props.startPaneDrag === "function" ? (event) => {
    if (!doc || !supportsPreview(doc.base.path)) { event.preventDefault(); return; }
    const path = doc.base.path;
    const start = props.startPaneDrag as (event: DragEvent, webAppId: string, prepare: (paneId: string) => void) => void;
    start(event, "boatyard.fileEditor.editor", (targetId) => {
      localStorage.setItem(`${prefix}pane:${targetId}:preview-file`, path);
      localStorage.setItem(`${prefix}pane:${targetId}:preview`, "true");
    });
  } : undefined;
  previewControl.toggle = togglePreview;
  syncPaneControl(previewControl);
  browserControl.toggle = toggleBrowser;
  syncPaneControl(browserControl);
  root.append(toolbar, workspace, status);
  container.replaceChildren(root);
  if (browserState.open) fileBrowser.show();
  try {
    const path = requestedPreviewPath || localStorage.getItem(paneKey);
    if (requestedPreviewPath) localStorage.removeItem(`${paneKey}:preview-file`);
    if (path) { pathInput.value = path; void openFile(path); }
  } catch { /* Opening files remains available when local storage is disabled. */ }
  return () => {
    persist();
    rememberPosition();
    clearTimeout(previewTimer);
    clearTimeout(positionTimer);
    window.removeEventListener("pagehide", flushPosition);
    themeObserver.disconnect();
    fileBrowser.cleanup();
    browserLayout.cleanup();
    if (browserControl.toggle === toggleBrowser) {
      browserControl.toggle = null;
      syncPaneControl(browserControl);
    }
    if (previewControl.toggle === togglePreview) {
      previewControl.toggle = null;
      previewControl.drag = undefined;
      syncPaneControl(previewControl);
    }
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
      isAvailable: ({ project } = {}) => Boolean(project?.sourcePath), render, renderHeaderActions
    });
  }
});
