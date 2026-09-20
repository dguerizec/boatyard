import { createBlockNavigation } from "./blockNavigation";
import { createHexView } from "./hexView";
import { imageMimeType, type ImageSnapshot } from "./imageTypes";
import { EditorPaneLinks } from "./paneLinks";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
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
const projectLinks = new Map<string, EditorPaneLinks>();
const linkedHosts = new Map<string, HTMLElement>();
type PaneControl = { open: boolean; enabled: boolean; label: string; button: HTMLButtonElement | null; toggle: (() => void) | null; drag?: (event: DragEvent) => void; highlight?: (active: boolean) => void };
const paneControls = new WeakMap<HTMLElement, Map<string, PaneControl>>();
function getPaneControl(host: HTMLElement, key: "browse" | "preview" | "link" | "hex"): PaneControl {
  let controls = paneControls.get(host);
  if (!controls) {
    controls = new Map();
    paneControls.set(host, controls);
  }
  let control = controls.get(key);
  if (!control) {
    control = { open: false, enabled: false, label: key === "browse" ? "project files" : key === "link" ? "linked files" : key === "hex" ? "hex editor" : "preview", button: null, toggle: null };
    controls.set(key, control);
  }
  return control;
}
function syncPaneControl(control: PaneControl) {
  if (!control.button) return;
  control.button.hidden = control.label === "linked files" && !control.open;
  control.button.draggable = control.enabled && Boolean(control.drag);
  control.button.disabled = !control.enabled || !control.toggle;
  control.button.classList.toggle("active", control.open);
  control.button.setAttribute("aria-pressed", String(control.open));
  if (control.label === "image preview") { control.button.title = "Image preview · Drag to another pane"; return; }
  if (control.label === "linked files") { control.button.title = "Unlink file navigation"; return; }
  control.button.title = `${control.open ? "Hide" : "Show"} ${control.label}${control.drag ? " · Drag to another pane" : ""}`;
}
function renderHeaderActions(container: HTMLElement, props: PluginRegistryRecord = {}) {
  if (!(props.host instanceof HTMLElement)) return undefined;
  const cleanups: Array<() => void> = [];
  for (const definition of [
    { key: "browse", icon: "folderTree", label: "Browse project files" },
    { key: "preview", icon: "eye", label: "Preview" },
    { key: "hex", icon: "binary", label: "Hex editor" },
    { key: "link", icon: "link", label: "Unlink file navigation" }
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
    if (definition.key === "link") {
      action.addEventListener("mouseenter", () => control.highlight?.(true));
      action.addEventListener("mouseleave", () => control.highlight?.(false));
      action.addEventListener("focus", () => control.highlight?.(true));
      action.addEventListener("blur", () => control.highlight?.(false));
      cleanups.push(() => control.highlight?.(false));
    }
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
    else {
      active.delete(doc);
      // Block drafts are persisted before detaching; do not retain visited file contents.
      if (doc.base.block) {
        const release = () => {
          if (doc.busy) return;
          doc.listeners.delete(release);
          if (!active.has(doc)) for (const [key, value] of documents) if (value === doc) documents.delete(key);
        };
        if (doc.busy) doc.listeners.add(release);
        else release();
      }
    }
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
    if (value && ["path", "text", "baseText", "revision"].every((field) => typeof value[field] === "string")
      && ["encoding", "baseEncoding"].every((field) => value[field] === undefined || value[field] === "hex")
      && (value.encoding !== "hex" || /^(?:[\da-f]{2})*$/i.test(value.text))
      && (value.baseEncoding !== "hex" || /^(?:[\da-f]{2})*$/i.test(value.baseText))) return value;
  } catch { /* A malformed draft must not prevent opening a file. */ }
  return undefined;
}

function render(container: HTMLElement, props: PluginRegistryRecord = {}) {
  const previewControl = getPaneControl(container, "preview");
  previewControl.enabled = false;
  const project = (props.project || {}) as { id: string; sourcePath: string };
  const prefix = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:`;
  const paneKey = `${prefix}pane:${String(props.paneId || "default")}`;
  const paneId = String(props.paneId || "default");
  let links = projectLinks.get(prefix);
  if (!links) {
    let saved: unknown;
    try { saved = JSON.parse(localStorage.getItem(`${prefix}links`) || "[]"); } catch { /* Ignore unavailable link preferences. */ }
    links = new EditorPaneLinks((groups) => {
      try { localStorage.setItem(`${prefix}links`, JSON.stringify(groups)); } catch { /* Navigation still works in memory. */ }
    }, saved);
    projectLinks.set(prefix, links);
  }
  const paneLinks = links;
  const linkControl = getPaneControl(container, "link");
  let pendingLinkedPath: string | undefined;
  let linkVersion = 0;
  const hexControl = getPaneControl(container, "hex");
  let hexMode = false;
  try { hexMode = localStorage.getItem(`${paneKey}:hex`) === "true"; } catch { /* Use text mode by default. */ }
  const persistHexMode = () => {
    try { localStorage.setItem(`${paneKey}:hex`, String(hexMode)); } catch { /* Optional view preference. */ }
  };
  const previewKey = `${paneKey}:preview`;
  const positions = new Map<string, FilePosition>();
  const positionPath = (path: string) => doc?.base.path === path && doc.base.block ? JSON.stringify([path, doc.base.block.index]) : path;
  function positionFor(path: string): FilePosition {
    path = positionPath(path);
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
  const draftKey = (path: string, block?: number) => block === undefined ? `${prefix}draft:${path}` : `${prefix}block-draft:${JSON.stringify([path, block])}`;
  const documentKey = () => doc ? draftKey(doc.base.path, doc.base.block?.index) : "";
  const savedBlock = (path: string): number | undefined => {
    try {
      const raw = localStorage.getItem(`${paneKey}:block:${path}`);
      const value = raw === null ? NaN : Number(raw);
      return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    } catch { return undefined; }
  };
  const root = element("section", "file-editor");
  const toolbar = element("form", "file-editor-toolbar");
  const pathInput = element("input");
  pathInput.placeholder = "Project-relative file path";
  pathInput.setAttribute("aria-label", "Project-relative file path");
  pathInput.spellcheck = false;
  const status = element("div", "file-editor-status", "Open a file from this project.");
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
  let textPreviewPreference = previewVisible;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewSource = "";
  let previewPendingSource = "";
  let previewVersion = 0;
  let previewScrollTop = 0;
  let previewPath = "";
  let loadedPreviewPath = "";
  let openedImage: ImageSnapshot | undefined;
  const currentPath = () => openedImage?.path || doc?.base.path;
  const imageHost = element("div", "file-editor-image");
  imageHost.hidden = true;
  const imageElement = element("img");
  imageHost.append(imageElement);
  let imageInfo = "";
  imageElement.addEventListener("load", () => {
    imageInfo = `${imageElement.naturalWidth} × ${imageElement.naturalHeight} · ${Math.ceil((openedImage?.size ?? doc?.bytes.length ?? 0) / 1024)} KiB`;
    if (openedImage) status.textContent = `${openedImage.path} · ${imageInfo}`;
    else if (doc && previewVisible && imageMimeType(doc.base.path)) refreshUi();
  });
  imageElement.addEventListener("error", () => {
    imageInfo = "This image could not be decoded.";
    if (openedImage) status.textContent = `${openedImage.path} · ${imageInfo}`;
    else if (doc && previewVisible && imageMimeType(doc.base.path)) refreshUi();
  });
  let doc: EditorDocument | undefined;
  let view: EditorView | undefined;
  const hexHost = element("div", "file-editor-hex");
  hexHost.hidden = true;
  const hexView = createHexView(hexHost, (bytes) => doc?.editBytes(bytes), () => { if (doc) void doc.save(); });
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  let opening = false;
  let persistenceError = "";
  let bom = "";
  let syncing = false;
  const theme = new Compartment();
  const lineSeparator = new Compartment();
  const editable = new Compartment();
  const numbering = new Compartment();
  let viewLocked = false;
  let viewFirstLine = 1;
  const editorTheme = () => document.documentElement.dataset.theme === "light" ? [] : oneDark;
  const themeObserver = new MutationObserver(() => {
    view?.dispatch({ effects: theme.reconfigure(editorTheme()) });
    schedulePreview();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function schedulePreview() {
    if (!previewVisible || !doc || doc.base.block || disposed) return;
    const mime = imageMimeType(doc.base.path);
    if (mime) {
      const source = JSON.stringify([doc.base.path, doc.text, doc.encoding]);
      if (previewSource === source) return;
      const bytes = doc.bytes;
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      imageInfo = "";
      imageElement.alt = doc.base.path;
      imageElement.src = `data:${mime};base64,${btoa(binary)}`;
      previewSource = source;
      return;
    }
    if (doc.encoding === "hex") return;
    const source = JSON.stringify([doc.base.path, doc.text, document.documentElement.dataset.theme]);
    if (source === previewSource || source === previewPendingSource) return;
    previewPendingSource = source;
    clearTimeout(previewTimer);
    const version = ++previewVersion;
    previewTimer = setTimeout(async () => {
      if (!previewVisible || !doc || doc.encoding === "hex" || disposed) return;
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
  function setPreview(visible: boolean, focus = true) {
    rememberPosition();
    previewVersion++;
    previewPendingSource = "";
    previewVisible = visible && Boolean(doc && !doc.base.block && (imageMimeType(doc.base.path) || (doc.encoding !== "hex" && supportsPreview(doc.base.path))));
    if (!doc || (!doc.base.block && !imageMimeType(doc.base.path))) {
      textPreviewPreference = previewVisible;
      try { localStorage.setItem(previewKey, String(previewVisible)); }
      catch { /* Optional view preferences must not prevent editing. */ }
    }
    previewControl.open = previewVisible;
    syncPaneControl(previewControl);
    const imagePreview = previewVisible && Boolean(doc && imageMimeType(doc.base.path));
    imageHost.hidden = !imagePreview;
    previewFrame.hidden = !previewVisible || imagePreview;
    editorHost.hidden = previewVisible || hexMode;
    hexHost.hidden = previewVisible || !hexMode;
    hexControl.open = hexMode && !previewVisible;
    syncPaneControl(hexControl);
    findButton.disabled = !view || previewVisible;
    if (previewVisible) {
      if (view) closeSearchPanel(view);
      schedulePreview();
    } else {
      clearTimeout(previewTimer);
      restorePosition();
      if (focus) { if (hexMode) hexView.focus(); else view?.focus(); }
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
    try { localStorage.setItem(`${paneKey}:position:${positionPath(doc.base.path)}`, JSON.stringify(position)); }
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
    if (openedImage && !doc) {
      try { localStorage.setItem(paneKey, openedImage.path); } catch { /* Images have no unsaved edits. */ }
      return;
    }
    if (!doc) return;
    try {
      const draft = doc.draft();
      if (draft) localStorage.setItem(documentKey(), JSON.stringify(draft));
      else localStorage.removeItem(documentKey());
      localStorage.setItem(paneKey, doc.base.path);
      if (doc.base.block) localStorage.setItem(`${paneKey}:block:${doc.base.path}`, String(doc.base.block.index));
      else localStorage.removeItem(`${paneKey}:block:${doc.base.path}`);
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

  function navigateBlock(index: number, fraction?: number) {
    if (!doc?.base.block || opening || doc.saving) return;
    if (index === doc.base.block.index && fraction !== undefined && view) {
      view.scrollDOM.scrollTop = fraction * Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
      return;
    }
    if (doc.dirty) {
      showError("Save or discard this block's changes before navigating to another block.");
      const current = doc;
      setNotices(
        button("Save and continue", () => { void current.save().then(() => {
          if (doc === current && !current.dirty && !current.error) {
            setNotices(); navigateBlock(Math.min(index, (current.base.block?.count ?? 1) - 1), fraction);
          }
        }); }),
        button("Discard changes", () => confirmDiscard(() => {
          if (doc === current) { current.useDisk(); navigateBlock(index, fraction); }
        })),
        button("Cancel", () => setNotices())
      );
      if (view) blockNavigation.sync(view.scrollDOM.scrollTop / Math.max(1, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight));
      return;
    }
    const path = doc.base.path;
    void openFile(path, undefined, index).then(() => {
      if (doc?.base.path !== path || doc.base.block?.index !== index || fraction === undefined) return;
      const target = view;
      target?.requestMeasure({ read: () => undefined, write: () => {
        if (view === target && !disposed) {
          target.scrollDOM.scrollTop = fraction * Math.max(0, target.scrollDOM.scrollHeight - target.scrollDOM.clientHeight);
          blockNavigation.sync(fraction);
        }
      } });
    });
  }
  const blockNavigation = createBlockNavigation(navigateBlock);
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
    editorHost.classList.toggle("file-editor-paged", Boolean(doc.base.block));
    blockNavigation.update(doc.base.block, !hexMode && !previewVisible, opening || doc.saving);
    const locked = Boolean(doc.saving && doc.base.block);
    const firstLine = doc.base.block?.line ?? 1;
    if (view && (viewLocked !== locked || viewFirstLine !== firstLine)) {
      viewLocked = locked; viewFirstLine = firstLine;
      view.dispatch({ effects: [
        editable.reconfigure(EditorView.editable.of(!locked)),
        numbering.reconfigure(lineNumbers({ formatNumber: (number) => String(number + firstLine - 1) }))
      ] });
    }
    if (doc.encoding === "hex" && !hexMode && !(previewVisible && imageMimeType(doc.base.path))) { hexMode = true; previewVisible = false; rebuild(false); return; }
    if (hexMode) hexView.update(doc.bytes, documentKey(), doc.base.block?.offset, doc.saving);
    previewControl.enabled = !doc.base.block && (Boolean(imageMimeType(doc.base.path)) || (doc.encoding !== "hex" && supportsPreview(doc.base.path)));
    syncPaneControl(previewControl);
    if (doc.base.block && previewControl.button) previewControl.button.title = "Preview requires the complete file; this file is loaded in blocks.";
    schedulePreview();
    saveButton.disabled = !doc.dirty || doc.busy || doc.conflict;
    status.textContent = [doc.base.path, doc.dirty ? "Unsaved changes" : "Saved", doc.busy ? "Working…" : "", doc.error, persistenceError, previewVisible && imageMimeType(doc.base.path) ? imageInfo : ""].filter(Boolean).join(" · ");
    compare.hidden = !doc.conflict;
    if (doc.conflict && compareText.textContent !== doc.disk.text) compareText.textContent = doc.disk.text;
    if (view && !hexMode && bom + view.state.sliceDoc() !== doc.text) {
      const nextBom = (!doc.base.block?.offset && doc.text.startsWith("\uFEFF")) ? "\uFEFF" : "";
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

  function rebuild(focus = true) {
    if (!doc) return;
    restoringPosition = true;
    view?.destroy();
    view = undefined;
    editorHost.replaceChildren();
    hexControl.enabled = true;
    if (previewVisible && !doc.base.block && imageMimeType(doc.base.path) && !hexMode) {
      restoringPosition = false;
      setPreview(true, focus);
      refreshUi();
      return;
    }
    if (doc.encoding === "hex") hexMode = true;
    if (hexMode) {
      persistHexMode();
      hexView.update(doc.bytes, documentKey(), doc.base.block?.offset, doc.saving);
      restoringPosition = false;
      setPreview(false, focus);
      refreshUi();
      return;
    }
    bom = (!doc.base.block?.offset && doc.text.startsWith("\uFEFF")) ? "\uFEFF" : "";
    viewLocked = false;
    viewFirstLine = doc.base.block?.line ?? 1;
    view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: doc.text.slice(bom.length),
        extensions: [basicSetup, theme.of(editorTheme()), doc.base.block ? [] : language(doc.base.path),
          editable.of(EditorView.editable.of(true)),
          numbering.of(lineNumbers({ formatNumber: (number) => String(number + (doc?.base.block?.line ?? 1) - 1) })),
          lineSeparator.of(EditorState.lineSeparator.of(doc.text.includes("\r\n") ? "\r\n" : "\n")),
          EditorView.contentAttributes.of({ "aria-label": "File contents" }),
          EditorView.theme({ "&": { height: "100%", backgroundColor: "var(--panel)" }, ".cm-scroller": { overflow: "auto", fontFamily: "monospace" } }),
          keymap.of([{ key: "Mod-s", run: () => { if (doc) void doc.save(); return true; } }]),
          EditorView.domEventHandlers({ scroll: () => {
            if (!restoringPosition) schedulePosition();
            if (view) blockNavigation.sync(view.scrollDOM.scrollTop / Math.max(1, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight));
          } }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) schedulePosition();
            findButton.setAttribute("aria-pressed", String(searchPanelOpen(update.state)));
            if (update.docChanged && !syncing) doc?.edit(bom + update.state.sliceDoc());
          })]
      })
    });
    const position = positionFor(doc.base.path);
    view.dispatch({ selection: { anchor: Math.min(position.anchor, view.state.doc.length), head: Math.min(position.head, view.state.doc.length) } });
    previewControl.enabled = !doc.base.block && (Boolean(imageMimeType(doc.base.path)) || (doc.encoding !== "hex" && supportsPreview(doc.base.path)));
    setPreview(previewVisible, focus);
    if (previewVisible) restoringPosition = false;
    findButton.setAttribute("aria-pressed", String(searchPanelOpen(view.state)));
    refreshUi();
  }

  async function openFile(path: string, linkedVersion?: number, requestedBlock?: number) {
    if (opening || disposed || doc?.saving) return;
    // Switching files preserves the previous draft, including when other panes show it.
    persist();
    if (persistenceError && doc?.dirty) { showError(persistenceError); return; }
    opening = true;
    openButton.disabled = true;
    status.textContent = "Indexing and opening file…";
    const block = requestedBlock ?? savedBlock(path);
    try {
      if (imageMimeType(path) && !hexMode && requestedBlock === undefined) {
        const image = await invoke<ImageSnapshot>("readImage", project.id, { path });
        if (disposed || (linkedVersion !== undefined && linkedVersion !== linkVersion)) return;
        if (image.size > 2 * 1024 * 1024) {
          rememberPosition();
          unsubscribe?.(); unsubscribe = undefined;
          doc = undefined;
          blockNavigation.update(undefined, false, false);
          view?.destroy(); view = undefined;
          editorHost.replaceChildren();
          openedImage = image;
          previewVersion++;
          clearTimeout(previewTimer);
          previewPendingSource = "";
          previewFrame.hidden = true;
          editorHost.hidden = true;
          imageHost.hidden = false;
          hexHost.hidden = true;
          hexControl.enabled = true;
          hexControl.open = false;
          syncPaneControl(hexControl);
          imageElement.alt = image.path;
          status.textContent = `${image.path} · Loading image…`;
          imageElement.src = image.dataUrl;
          pathInput.value = image.path;
          fileBrowser.setSelected(image.path);
          setNotices(); compare.hidden = true;
          saveButton.disabled = true; findButton.disabled = true;
          findButton.setAttribute("aria-pressed", "false");
          previewControl.label = "image preview";
          previewControl.enabled = true;
          previewControl.open = true;
          syncPaneControl(previewControl);
          persistenceError = "";
          persist();
          if (!pendingLinkedPath || pendingLinkedPath === image.path) paneLinks.opened(paneId, image.path);
          return;
        }
        previewVisible = true;
      }
      let snapshot: FileSnapshot | null;
      try {
        snapshot = await invoke("read", project.id, { path, block });
      } catch (error) {
        const draft = readDraft(draftKey(path, block));
        if (draft) {
          // Missing or inaccessible files must not make their saved draft inaccessible.
          snapshot = { block: draft.block, path: draft.path, text: draft.baseText, encoding: draft.baseEncoding, revision: draft.revision };
        } else if (block !== undefined && requestedBlock === undefined && String(error).includes("block no longer exists")) {
          snapshot = await invoke("read", project.id, { path });
        } else throw error;
      }
      if (!snapshot || disposed || (linkedVersion !== undefined && linkedVersion !== linkVersion)) return;
      const key = draftKey(snapshot.path, snapshot.block?.index);
      let next = documents.get(key);
      if (!next) {
        let currentBlock = snapshot.block?.index;
        next = new EditorDocument(snapshot, {
          read: async (file) => (await invoke("read", project.id, { path: file, block: next?.base.block?.index }))!,
          save: async (file, text, revision, encoding) => {
            currentBlock = next?.base.block?.index;
            const saved = (await invoke("save", project.id, { path: file, text, revision, encoding, block: currentBlock }))!;
            const oldKey = draftKey(file, currentBlock);
            currentBlock = saved.block?.index;
            const newKey = draftKey(file, currentBlock);
            if (newKey !== oldKey) {
              const current = documents.get(oldKey);
              documents.delete(oldKey);
              if (current) documents.set(newKey, current);
              try { localStorage.removeItem(oldKey); } catch { /* The saved file is authoritative. */ }
            }
            return saved;
          }
        }, readDraft(key));
        documents.set(key, next);
      }
      persist();
      if (persistenceError && doc?.dirty) { showError(persistenceError); return; }
      rememberPosition();
      if (doc !== next) unsubscribe?.();
      else { unsubscribe?.(); documents.set(key, next); }
      if ((openedImage || (doc && (doc.base.block || imageMimeType(doc.base.path)))) && !imageMimeType(snapshot.path)) previewVisible = textPreviewPreference;
      previewControl.label = "preview";
      openedImage = undefined;
      imageHost.hidden = true;
      imageElement.removeAttribute("src");
      previewSource = "";
      doc = next;
      if (doc.base.block) previewVisible = false;
      pathInput.value = snapshot.path;
      fileBrowser.setSelected(snapshot.path);
      setNotices();
      unsubscribe = subscribe(doc, refreshUi);
      rebuild(linkedVersion === undefined);
      if (!pendingLinkedPath || pendingLinkedPath === snapshot.path) paneLinks.opened(paneId, snapshot.path);
      void doc.refresh();
      if (!previewVisible && linkedVersion === undefined) view?.focus();
    } catch (error) { if (!disposed) showError(error); }
    finally {
      opening = false;
      openButton.disabled = false;
      if (doc) blockNavigation.update(doc.base.block, !hexMode && !previewVisible, doc.saving);
      const pending = pendingLinkedPath;
      pendingLinkedPath = undefined;
      if (pending && pending !== currentPath() && !disposed) void openFile(pending, linkVersion);
    }
  }

  const draftsButton = button("Drafts", () => {
    if (draftsButton.getAttribute("aria-pressed") === "true") {
      setNotices();
      return;
    }
    setNotices();
    try {
      const keys = Object.keys(localStorage).filter((key) => (key.startsWith(`${prefix}draft:`) || key.startsWith(`${prefix}block-draft:`)));
      if (!keys.length) notices.append(element("span", "", "No unsaved drafts."));
      for (const key of keys) {
        const draft = readDraft(key);
        if (draft) notices.append(button(draft.path + (draft.block ? ` · Block ${draft.block.index + 1}` : ""), () => void openFile(draft.path, undefined, draft.block?.index)));
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
  const content = element("div", "file-editor-content");
  content.append(editorHost, hexHost, previewFrame, imageHost, blockNavigation.rail);
  blockNavigation.update(undefined, false, false);
  browserLayout.viewport.append(notices, compare, blockNavigation.toolbar, content);
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
  const togglePreview = () => {
    if (openedImage || doc?.base.block) return;
    if (view && !hexMode) { setPreview(!previewVisible); return; }
    rememberPosition();
    const visible = !previewVisible;
    hexMode = !visible && doc?.encoding === "hex";
    persistHexMode();
    previewVisible = visible;
    rebuild();
  };
  const toggleHex = () => {
    if (opening || doc?.saving) return;
    if (hexMode && doc?.base.block && imageMimeType(doc.base.path)) {
      if (doc.dirty) { showError("Save this block before opening the complete image preview."); return; }
      hexMode = false; persistHexMode();
      void openFile(doc.base.path);
      return;
    }
    rememberPosition();
    if (hexMode && doc?.encoding === "hex" && !imageMimeType(doc.base.path)) { showError("These bytes are not valid UTF-8 text. Continue editing in Hex mode."); return; }
    hexMode = !hexMode;
    persistHexMode();
    if (openedImage) {
      void openFile(openedImage.path).then(() => {
        if (openedImage) { hexMode = false; persistHexMode(); }
      });
    } else { previewVisible = !hexMode && Boolean(doc && imageMimeType(doc.base.path)); rebuild(); }
  };
  hexControl.toggle = toggleHex;
  syncPaneControl(hexControl);
  previewControl.drag = typeof props.startPaneDrag === "function" ? (event) => {
    const path = currentPath();
    if (!path || (!openedImage && !imageMimeType(path) && (doc?.encoding === "hex" || !supportsPreview(path)))) { event.preventDefault(); return; }
    const start = props.startPaneDrag as (event: DragEvent, webAppId: string, prepare: (paneId: string) => void) => void;
    start(event, "boatyard.fileEditor.editor", (targetId) => {
      localStorage.setItem(`${prefix}pane:${targetId}:preview-file`, path);
      localStorage.setItem(`${prefix}pane:${targetId}:preview`, "true");
      paneLinks.link(paneId, targetId, path);
    });
  } : undefined;
  previewControl.toggle = togglePreview;
  syncPaneControl(previewControl);
  browserControl.toggle = toggleBrowser;
  syncPaneControl(browserControl);
  root.append(toolbar, workspace, status);
  container.replaceChildren(root);
  if (browserState.open) fileBrowser.show();
  linkedHosts.set(paneKey, container);
  let highlighted: HTMLElement[] = [];
  const highlight = (active: boolean) => {
    highlighted.forEach((pane) => pane.classList.remove("file-editor-linked-highlight"));
    highlighted = [];
    if (active) for (const id of paneLinks.peers(paneId)) {
      const host = linkedHosts.get(`${prefix}pane:${id}`);
      const pane = host?.closest<HTMLElement>(".webapp-pane") || host;
      if (pane) { pane.classList.add("file-editor-linked-highlight"); highlighted.push(pane); }
    }
  };
  linkControl.highlight = highlight;
  const unlink = () => { highlight(false); paneLinks.unlink(paneId); };
  linkControl.toggle = unlink;
  linkControl.enabled = true;
  let initialLinkedPath: string | undefined;
  let linksReady = false;
  const detachLinks = paneLinks.attach(paneId, (linked, path) => {
    highlight(false);
    linkVersion++;
    linkControl.open = linked;
    syncPaneControl(linkControl);
    if (!linksReady) { initialLinkedPath = path; return; }
    if (!linked) { pendingLinkedPath = undefined; return; }
    if (path && path !== currentPath()) {
      if (opening) pendingLinkedPath = path;
      else void openFile(path, linkVersion);
    }
  });
  linksReady = true;
  try {
    const path = requestedPreviewPath || initialLinkedPath || localStorage.getItem(paneKey);
    if (requestedPreviewPath) localStorage.removeItem(`${paneKey}:preview-file`);
    if (path) { pathInput.value = path; void openFile(path); }
  } catch { /* Opening files remains available when local storage is disabled. */ }
  return () => {
    highlight(false);
    if (linkedHosts.get(paneKey) === container) linkedHosts.delete(paneKey);
    if (linkControl.highlight === highlight) linkControl.highlight = undefined;
    detachLinks();
    if (linkControl.toggle === unlink) { linkControl.toggle = null; syncPaneControl(linkControl); }
    persist();
    rememberPosition();
    clearTimeout(previewTimer);
    clearTimeout(positionTimer);
    window.removeEventListener("pagehide", flushPosition);
    themeObserver.disconnect();
    fileBrowser.cleanup();
    blockNavigation.cleanup();
    browserLayout.cleanup();
    if (browserControl.toggle === toggleBrowser) {
      browserControl.toggle = null;
      syncPaneControl(browserControl);
    }
    if (hexControl.toggle === toggleHex) { hexControl.toggle = null; syncPaneControl(hexControl); }
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
