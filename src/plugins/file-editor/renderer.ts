import { createPagedSearch } from "./pagedSearch";
import { editorLineSeparator, editorText, findInFile, lineInFile, type PagedTextSource, type TextMatch, type TextPoint } from "./pagedText";
import { pasteFileBytes } from "./hexPaste";
import { DEFAULT_BLOCK_BYTES, LEGACY_BLOCK_BYTES } from "./config";
import { TextBytePositions, type ByteSelection } from "./selection";
import { FileTabs, createFileTabs } from "./tabs";
import type { EditorRoot } from "./roots";
import { createEditorSurface } from "./editorSurface";
import { createGitView } from "./gitView";
import { cachedGit } from "./gitCache";
import type { GitBaseline, EditorGitStatus } from "./git";
import { FileChanges, readChangesDraft } from "./changes";
import { byteContent, contentBytes } from "./bytes";
import { createBlockNavigation } from "./blockNavigation";
import { createHexView } from "./hexView";
import { imageMimeType, type ImageSnapshot } from "./imageTypes";
import { EditorPaneLinks } from "./paneLinks";
import { editorVim } from "./vim";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { closeSearchPanel, openSearchPanel, searchPanelOpen } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { language } from "./language";
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
const changesets = new Map<string, FileChanges>();
const active = new Map<EditorDocument, number>();
const projectLinks = new Map<string, EditorPaneLinks>();
const linkedHosts = new Map<string, HTMLElement>();
type PaneControl = { open: boolean; enabled: boolean; label: string; button: HTMLButtonElement | null; toggle: (() => void) | null; drag?: (event: DragEvent) => void; highlight?: (active: boolean) => void };
const paneControls = new WeakMap<HTMLElement, Map<string, PaneControl>>();
function getPaneControl(host: HTMLElement, key: "browse" | "preview" | "link" | "hex" | "diff" | "open" | "vim"): PaneControl {
  let controls = paneControls.get(host);
  if (!controls) {
    controls = new Map();
    paneControls.set(host, controls);
  }
  let control = controls.get(key);
  if (!control) {
    control = { open: false, enabled: false, label: key === "vim" ? "Vim mode" : key === "open" ? "open files" : key === "browse" ? "project files" : key === "link" ? "linked files" : key === "hex" ? "hex editor" : key === "diff" ? "Git diff" : "preview", button: null, toggle: null };
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
  if (control.label === "Vim mode") { control.button.title = control.open ? "Disable Vim mode (standard editing)" : "Enable Vim mode"; return; }
  if (control.label === "open files") { control.button.title = "Open files"; control.button.removeAttribute("aria-pressed"); return; }
  if (control.label === "image preview") { control.button.title = "Image preview · Drag to another pane"; return; }
  if (control.label === "linked files") { control.button.title = "Unlink file navigation"; return; }
  control.button.title = `${control.open ? "Hide" : "Show"} ${control.label}${control.drag ? " · Drag to another pane" : ""}`;
}
function renderHeaderActions(container: HTMLElement, props: PluginRegistryRecord = {}) {
  if (!(props.host instanceof HTMLElement)) return undefined;
  const cleanups: Array<() => void> = [];
  for (const definition of [
    { key: "open", icon: "folderOpen", label: "Open files" },
    { key: "browse", icon: "folderTree", label: "Browse project files" },
    { key: "vim", icon: "", label: "Vim mode" },
    { key: "diff", icon: "gitCompareArrows", label: "Git diff" },
    { key: "hex", icon: "binary", label: "Hex editor" },
    { key: "preview", icon: "eye", label: "Preview" },
    { key: "link", icon: "link", label: "Unlink file navigation" }
  ] as const) {
    const control = getPaneControl(props.host, definition.key);
    const action = button("", () => control.toggle?.());
    action.className = `webapp-tool-button file-editor-${definition.key}-button`;
    action.setAttribute("aria-label", definition.label);
    if (definition.key === "vim") action.textContent = "Vi";
    else action.append(createToolIcon(definition.icon));
    if (definition.key === "preview" || definition.key === "diff" || definition.key === "hex") action.addEventListener("dragstart", (event) => {
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

const gitPollers = new Set<() => void>();
function poll() {
  for (const poller of gitPollers) poller();
  for (const doc of active.keys()) void doc.refresh();
}
function subscribe(doc: EditorDocument, listener: () => void) {
  doc.connectChanges();
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
      doc.disconnectChanges();
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
    if (!active.size && !gitPollers.size) {
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener("focus", poll);
    }
  };
}

async function invokeAction<T = FileSnapshot | null>(action: string, projectId: string, payload: Record<string, unknown> = {}) {
  if (!scope.boatyard?.invokePlugin) throw new Error("File access is unavailable.");
  return await scope.boatyard.invokePlugin(pluginId, action, { ...payload, projectId }) as T;
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
  const project = (props.project || {}) as { id: string; sourcePath: string };
  const rootKey = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:pane:${String(props.paneId || "default")}:root`;
  let disposed = false;
  let cleanup: (() => void) | undefined;
  const mount = (sourcePath: string) => {
    cleanup?.();
    cleanup = renderEditor(container, { ...props, project: { ...project, sourcePath } }, {
      projectRoot: project.sourcePath,
      select(path) {
        try { localStorage.setItem(rootKey, path); } catch { /* Keep the selected root in memory. */ }
        mount(path);
      }
    });
  };
  let saved: string | null = null;
  try { saved = localStorage.getItem(rootKey); } catch { /* Use the project directory. */ }
  if (saved && saved !== project.sourcePath) {
    container.replaceChildren(element("div", "file-browser-message", "Loading worktree…"));
    void invokeAction<string>("resolveRoot", project.id, { root: saved }).then(path => {
      if (!disposed) mount(path);
    }).catch(error => {
      if (disposed) return;
      try { localStorage.removeItem(rootKey); } catch { /* Continue with the project directory. */ }
      mount(project.sourcePath);
      const message = element("div", "file-browser-message", `${error instanceof Error ? error.message : String(error)} Using the project directory.`);
      message.setAttribute("role", "status");
      container.prepend(message);
    });
  } else mount(project.sourcePath);
  return () => { disposed = true; cleanup?.(); };
}

function renderEditor(container: HTMLElement, props: PluginRegistryRecord, roots: {
  projectRoot: string; select(path: string): void;
}) {
  const previewControl = getPaneControl(container, "preview");
  previewControl.enabled = false;
  const project = (props.project || {}) as { id: string; sourcePath: string };
  const invoke = <T = FileSnapshot | null>(action: string, projectId: string, payload: Record<string, unknown> = {}) => {
    let blockBytes: number | undefined;
    const fileKey = changesKey(String(payload.path || ""));
    const changes = changesets.get(fileKey);
    if (changes) blockBytes = changes.blockBytes;
    else try {
      const saved = readChangesDraft(JSON.parse(localStorage.getItem(fileKey) || "null"));
      if (saved) blockBytes = saved.blockBytes ?? LEGACY_BLOCK_BYTES;
      else for (const key of Object.keys(localStorage).filter((key) => key.startsWith(`${prefix}block-draft:`))) {
        const legacy = readDraft(key);
        if (legacy && legacy.path === payload.path && legacy.block) { blockBytes = legacy.block.blockBytes ?? LEGACY_BLOCK_BYTES; break; }
      }
    } catch { /* Invalid drafts are handled when opening the file. */ }
    return invokeAction<T>(action, projectId, { blockBytes, ...payload, root: project.sourcePath });
  };
  const prefix = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:`;
  const paneKey = `${prefix}pane:${String(props.paneId || "default")}`;
  const paneId = String(props.paneId || "default");
  const vimControl = getPaneControl(container, "vim");
  const vimCompartment = new Compartment();
  const globalConfig = (props.globalPluginConfig || {}) as { vimByDefault?: string; wrapLinesByDefault?: string };
  let vimEnabled = globalConfig.vimByDefault === "enabled";
  try {
    const saved = localStorage.getItem(`${paneKey}:vim`);
    if (saved === "true" || saved === "false") vimEnabled = saved === "true";
  } catch { /* Use the plugin default when pane preferences are unavailable. */ }
  const vimExtension = () => vimEnabled ? editorVim({
    save: () => { if (doc) void doc.save(); },
    close: (mode) => {
      const path = currentPath();
      // Let Vim finish handling the command before destroying its editor view.
      if (path) queueMicrotask(() => { void closeTab(path, mode).catch(showError); });
    },
    history: doc?.changes ? (forward) => { void historyChanges(forward); } : undefined,
    jump: doc?.base.block ? (line, relative) => { queueMicrotask(() => { void jumpToLine(line, relative); }); } : undefined,
    search: doc?.base.block ? (backward, repeat) => {
      if (!repeat) { vimSearchActive = true; vimSearchBackward = backward; pagedSearch.open(); syncFindButton(); }
      else void findPaged(backward ? !vimSearchBackward : vimSearchBackward);
    } : undefined,
    error: showError
  }) : [];
  const toggleVim = () => {
    vimEnabled = !vimEnabled;
    try { localStorage.setItem(`${paneKey}:vim`, String(vimEnabled)); } catch { /* Editing remains available in memory. */ }
    view?.dispatch({ effects: vimCompartment.reconfigure(vimExtension()) });
    vimControl.open = vimEnabled;
    syncPaneControl(vimControl);
    if (!editorHost.hidden) view?.focus();
  };
  vimControl.open = vimEnabled;
  vimControl.enabled = true;
  vimControl.toggle = toggleVim;
  syncPaneControl(vimControl);
  const openControl = getPaneControl(container, "open");
  let savedTabs: unknown;
  try { savedTabs = JSON.parse(localStorage.getItem(`${paneKey}:tabs`) || "null"); } catch { /* Ignore malformed tab preferences. */ }
  const tabs = new FileTabs(savedTabs);
  function persistTabs() {
    try { localStorage.setItem(`${paneKey}:tabs`, JSON.stringify(tabs.paths)); } catch { /* Draft persistence is checked separately. */ }
  }
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
  let requestedHexPath: string | null = null;
  try { requestedHexPath = localStorage.getItem(`${paneKey}:hex-file`); } catch { /* Optional navigation request. */ }
  let hexMode = false;
  try { hexMode = localStorage.getItem(`${paneKey}:hex`) === "true"; } catch { /* Use text mode by default. */ }
  const persistHexMode = () => {
    try { localStorage.setItem(`${paneKey}:hex`, String(hexMode)); } catch { /* Optional view preference. */ }
  };
  const diffControl = getPaneControl(container, "diff");
  let diffMode = false;
  let sideBySide = false;
  try { sideBySide = localStorage.getItem(`${paneKey}:diff-layout`) === "side-by-side"; } catch { /* Default to inline diff. */ }
  let requestedDiffPath: string | null = null;
  try { requestedDiffPath = localStorage.getItem(`${paneKey}:diff-file`); diffMode = Boolean(requestedDiffPath) || localStorage.getItem(`${paneKey}:diff`) === "true"; } catch { /* Optional preference. */ }
  function persistDiffMode() { try { localStorage.setItem(`${paneKey}:diff`, String(diffMode)); } catch { /* Optional preference. */ } }
  let deletedGitPath = "";
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
  const changesKey = (path: string) => `${prefix}changes:${path}`;
  const documentKey = () => doc ? draftKey(doc.base.path, doc.base.block?.index) : "";
  const savedBlock = (path: string): number | undefined => {
    try {
      const raw = localStorage.getItem(`${paneKey}:block:${path}`);
      const value = raw === null ? NaN : Number(raw);
      return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    } catch { return undefined; }
  };
  const root = element("section", "file-editor");
  const toolbar = element("div", "file-editor-toolbar file-editor-filebar");
  const fileTabs = createFileTabs(tabs, {
    select: async (path) => { if (path !== currentPath()) await openFile(path); },
    close: closeTab,
    dirty: isTabDirty
  });
  function isTabDirty(path: string): boolean {
    const cached = documents.get(draftKey(path));
    if (cached) return cached.dirty;
    const changes = changesets.get(changesKey(path));
    if (changes) return changes.dirty;
    try { return Boolean(localStorage.getItem(draftKey(path)) || localStorage.getItem(changesKey(path))); } catch { return false; }
  }
  function updateTabs() {
    fileTabs.update(opening || Boolean(doc?.saving || doc?.changes?.saving));
    openControl.enabled = !opening && !pickerPending && !doc?.saving && !doc?.changes?.saving;
    syncPaneControl(openControl);
  }
  function openedTab(path: string) { tabs.open(path); persistTabs(); updateTabs(); fileTabs.reveal(); }
  const status = element("div", "file-editor-status", "Open files from the pane toolbar or browse project files.");
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
  if (diffMode) { previewVisible = false; hexMode = false; }
  if (requestedHexPath) { hexMode = true; diffMode = false; previewVisible = false; persistDiffMode(); }
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewSource = "";
  let previewPendingSource = "";
  let previewVersion = 0;
  let previewScrollTop = 0;
  let previewPath = "";
  let loadedPreviewPath = "";
  let openedImage: ImageSnapshot | undefined;
  const currentBlock = () => doc?.base.block ? (doc.changes?.viewBlock(doc.base.block) ?? doc.base.block) : undefined;
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
  let surface: ReturnType<typeof createEditorSurface> | undefined;
  function destroyView() { surface?.destroy(); surface = undefined; view = undefined; }
  const diffHost = element("div", "file-editor-diff");
  diffHost.hidden = true;
  const hexHost = element("div", "file-editor-hex");
  hexHost.hidden = true;
  const hexView = createHexView(hexHost, (bytes) => doc?.editBytes(bytes), () => { if (doc) void doc.save(); });
  let applyingSelection = false;
  let selectionVersion = 0;
  let pendingSelection: { path: string; value: ByteSelection } | undefined;
  let mappedText = "", mappedBom = false, bytePositions: TextBytePositions | undefined;
  function positionsFor(current: EditorDocument) {
    const stripBom = !current.base.block?.offset;
    if (!bytePositions || mappedText !== current.text || mappedBom !== stripBom) {
      mappedText = current.text; mappedBom = stripBom;
      bytePositions = new TextBytePositions(mappedText, stripBom);
    }
    return bytePositions;
  }
  function selectionBlock(current: EditorDocument, offset: number) {
    const block = current.base.block;
    if (!block) return 0;
    let low = 0, high = block.positions.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((current.changes?.blockOffset(middle, block.positions[middle].offset) ?? block.positions[middle].offset) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }
  function publishSelection(value: ByteSelection) {
    if (applyingSelection || opening || restoringPosition || disposed || !doc) return;
    selectionVersion++;
    pendingSelection = undefined;
    paneLinks.selected(paneId, doc.base.path, value);
  }
  function applyLinkedSelection() {
    const pending = pendingSelection;
    if (!pending || opening || disposed || !doc || doc.base.path !== pending.path) return;
    if (previewVisible && editorHost.hidden && hexHost.hidden) { pendingSelection = undefined; return; }
    if (hexMode) {
      pendingSelection = undefined;
      hexView.setSelection(pending.value);
      return;
    }
    const head = pending.value.head > pending.value.anchor ? pending.value.head - 1 : pending.value.head;
    const block = selectionBlock(doc, head);
    if (doc.base.block && block !== doc.base.block.index) {
      pendingSelection = undefined;
      const version = selectionVersion;
      void openFile(pending.path, linkVersion, block).then(() => {
        if (!disposed && version === selectionVersion && doc?.base.path === pending.path && doc.base.block?.index === block) {
          pendingSelection = pending; applyLinkedSelection();
        }
      });
      return;
    }
    if (!view || doc.encoding === "hex") return;
    pendingSelection = undefined;
    const start = doc.changes?.blockStart(doc.base) ?? doc.base.block?.offset ?? 0;
    const selection = positionsFor(doc).toText({ anchor: pending.value.anchor - start, head: pending.value.head - start });
    applyingSelection = true;
    try { view.dispatch({ selection, effects: EditorView.scrollIntoView(selection.head, { y: "nearest", x: "nearest" }) }); }
    finally { applyingSelection = false; }
  }
  const detachSelection = paneLinks.watchSelection(paneId, (path, value) => {
    selectionVersion++;
    pendingSelection = { path, value };
    applyLinkedSelection();
  });
  function updateHexView() {
    if (!doc) return;
    const current = doc;
    const block = current.base.block;
    const revision = current.base.revision;
    const path = current.base.path;
    const blockAt = (offset: number) => selectionBlock(current, offset);
    const bytes = current.bytes;
    const sizeDelta = block ? bytes.length - block.length : 0;
    const diskOffset = (offset: number) => block && offset >= block.offset + bytes.length ? offset - sizeDelta : offset;
    let initialOffset: number | undefined;
    try {
      const saved = localStorage.getItem(`${paneKey}:hex-position:${path}`);
      if (saved !== null && Number.isSafeInteger(Number(saved)) && Number(saved) >= 0) initialOffset = Number(saved);
    } catch { /* Optional scroll preferences. */ }
    hexView.update(bytes, path, block ? (current.changes?.blockStart(current.base) ?? block.offset) : 0, current.locked || previewVisible, {
      selected: publishSelection,
      size: current.changes?.length ?? (block ? block.size + sizeDelta : bytes.length),
      revision: `${revision}:${current.changes?.version ?? sizeDelta}`, initialOffset,
      history: current.changes ? (forward) => historyChanges(forward) : undefined,
      canUndo: current.changes?.canUndo, canRedo: current.changes?.canRedo,
      paste: current.changes ? (offset, replacement) => pasteFileBytes(current.changes!, current.base, offset, replacement,
        async (index) => (await invoke("read", project.id, { path, block: index }))!,
        () => !disposed && doc === current && !opening && !previewVisible && !current.locked) : undefined,
      scrolled: (offset) => {
        try { localStorage.setItem(`${paneKey}:hex-position:${path}`, String(offset)); } catch { /* Editing remains available. */ }
      },
      read: async (offset) => {
        const snapshot = (await invoke("read", project.id, { path, block: blockAt(current.changes ? offset : diskOffset(offset)) }))!;
        if (snapshot.revision !== revision) throw new Error("The file changed on disk. Reload it before continuing.");
        const start = snapshot.block?.offset ?? 0;
        return { offset: current.changes ? current.changes.blockStart(snapshot) : block && start > block.offset ? start + sizeDelta : start,
          bytes: current.changes ? current.changes.apply(snapshot) : contentBytes(snapshot) };
      },
      activate: async (offset) => {
        if (disposed || doc !== current || opening || current.saving) return false;
        if (current.conflict || current.locked || previewVisible) return false;
        if (current.dirty && !current.changes) {
          showError("Save the current changes before editing another part of the file. Scrolling remains available.");
          return false;
        }
        await openFile(path, undefined, blockAt(offset), true);
        return doc?.base.path === path && doc.base.block?.index === blockAt(offset);
      },
      error: showError
    });
  }
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  let opening = false;
  let pickerPending = false;
  let closingTab = false;
  let persistenceError = "";
  let bom = "";
  let syncing = false;
  const theme = new Compartment();
  const lineSeparator = new Compartment();
  const editable = new Compartment();
  const readOnly = new Compartment();
  const numbering = new Compartment();
  const wrapping = new Compartment();
  let wrapLines = globalConfig.wrapLinesByDefault === "enabled";
  try {
    const saved = localStorage.getItem(`${paneKey}:wrap-lines`);
    if (saved === "true" || saved === "false") wrapLines = saved === "true";
  } catch { /* Use the plugin default when pane preferences are unavailable. */ }
  const wrappingExtension = () => wrapLines ? EditorView.lineWrapping : [];
  let viewLocked = false;
  let viewPaged = false;
  let viewFirstLine = 1;
  const editorTheme = () => document.documentElement.dataset.theme === "light" ? [] : oneDark;
  const editorAppearance = EditorView.theme({ "&": { height: "100%", backgroundColor: "var(--panel)" }, ".cm-scroller": { overflow: "auto", fontFamily: "monospace" } });
  const gitView = createGitView(diffHost, () => setDiff(true), {
    selected: () => sideBySide,
    toggle: () => {
      sideBySide = !sideBySide;
      try { localStorage.setItem(`${paneKey}:diff-layout`, sideBySide ? "side-by-side" : "inline"); } catch { /* Optional layout preference. */ }
      updateGitView(); view?.focus();
    }
  });
  let gitBaseline: GitBaseline | undefined;
  let gitPath = "", gitError = "", gitVersion = 0;
  let gitPending = false;
  let gitUpdateTimer: ReturnType<typeof setTimeout> | undefined;
  function useSideBySide() {
    return Boolean(diffMode && sideBySide && !hexMode && !previewVisible && doc && !doc.base.block
      && doc.encoding !== "hex" && !openedImage && gitPath === doc.base.path && gitBaseline?.available);
  }
  function updateGitView() {
    if (disposed) return;
    const path = doc?.base.path || "";
    const supported = Boolean(doc && !doc.base.block && doc.encoding !== "hex" && !openedImage);
    if (view && useSideBySide() !== Boolean(surface?.originalView)) rebuild(view.hasFocus, true);
    if (useSideBySide() && gitBaseline) surface?.updateOriginal(gitBaseline.text, gitBaseline.label);
    const reason = doc?.base.block ? "Git diff currently requires a complete text file; paged files are not supported." : "Git diff is available for text files only.";
    gitView.update(path, supported && gitPath === path ? gitBaseline : undefined,
      supported ? gitError : reason, supported ? view : undefined, Boolean(surface?.originalView));
    diffControl.enabled = Boolean(doc && !openedImage);
    diffControl.open = diffMode;
    syncPaneControl(diffControl);
    gitView.show(diffMode && Boolean(doc));
  }
  function scheduleGitView() {
    clearTimeout(gitUpdateTimer);
    gitUpdateTimer = setTimeout(updateGitView, 120);
  }
  async function refreshGit() {
    if (disposed || gitPending) return;
    updateTabs();
    const version = gitVersion;
    const path = doc?.base.path;
    gitPending = true;
    try {
      if (browserState.open) {
        try {
          const result = await cachedGit(`${prefix}status`, () => invoke<EditorGitStatus>("gitStatus", project.id));
          if (!disposed) fileBrowser.setGitStatus(result);
        } catch (error) { if (!disposed) fileBrowser.setGitStatus(undefined, `Git status: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (!path || doc?.base.block || doc?.encoding === "hex" || openedImage) return;
      const baseline = await cachedGit(`${prefix}baseline:${path}`, () => invoke<GitBaseline>("gitBaseline", project.id, { path }));
      if (disposed || version !== gitVersion || path !== doc?.base.path) return;
      gitPath = path; gitBaseline = baseline; gitError = ""; scheduleGitView();
    } catch (error) {
      if (!disposed && version === gitVersion) { gitBaseline = undefined; gitError = error instanceof Error ? error.message : String(error); scheduleGitView(); }
    } finally {
      gitPending = false;
      if (!disposed && version !== gitVersion) void refreshGit();
    }
  }
  function resetGit() { gitVersion++; gitPath = ""; gitBaseline = undefined; gitError = ""; scheduleGitView(); void refreshGit(); }
  function setDiff(value: boolean) {
    if (deletedGitPath && !value) { showError("This file was deleted. Its Git diff is read-only."); return; }
    rememberPosition(); diffMode = value; persistDiffMode();
    if (value) { previewVisible = false; hexMode = false; persistHexMode(); }
    if (doc && !deletedGitPath && !view) rebuild(false);
    setPreview(previewVisible, false);
    blockNavigation.update(currentBlock(), !diffMode && !hexMode, false);
    updateGitView();
    if (!value) { restorePosition(); view?.focus(); }
  }
  function showDeletedDiff(path: string) {
    persist(); if (persistenceError && doc?.dirty) return;
    unsubscribe?.(); destroyView(); editorHost.replaceChildren();
    openedImage = undefined; deletedGitPath = path;
    const retainedDraft = readDraft(draftKey(path));
    doc = new EditorDocument({ path, text: retainedDraft?.text || "", encoding: retainedDraft?.encoding, revision: "deleted" }, {
      read: async () => { throw new Error("This file was deleted."); },
      save: async () => { throw new Error("Deleted-file diffs are read-only."); }
    });
    openedTab(path); fileBrowser.setSelected(path); setNotices(); compare.hidden = true;
    saveButton.disabled = true; hexControl.enabled = previewControl.enabled = false;
    status.textContent = `${path} · Deleted from working tree${retainedDraft ? " · Local draft retained" : ""} · Read-only diff`;
    rebuild(false);
    hexControl.enabled = previewControl.enabled = false;
    resetGit(); setDiff(true); persist();
  }
  async function openDiff(path: string, deleted = false) {
    if (opening || doc?.saving || doc?.changes?.saving) return;
    if (deleted) { showDeletedDiff(path); return; }
    await openFile(path);
    if (doc?.base.path === path) setDiff(true);
  }
  const themeObserver = new MutationObserver(() => {
    view?.dispatch({ effects: theme.reconfigure(editorTheme()) });
    surface?.originalView?.dispatch({ effects: theme.reconfigure(editorTheme()) });
    schedulePreview();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function schedulePreview() {
    if (!doc || doc.base.block || disposed || (!previewVisible && imageHost.hidden)) return;
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
    if (doc.encoding === "hex" || !supportsPreview(doc.base.path)) return;
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
        try {
          const path = decodeURIComponent(href.split(/[?#]/)[0]);
          void openFile(path.startsWith("/") ? path : directory + path);
        } catch (error) { showError(error); }
      }
    });
  });
  function setPreview(visible: boolean, focus = true) {
    rememberPosition();
    previewVersion++;
    previewPendingSource = "";
    previewVisible = visible;
    try { localStorage.setItem(previewKey, String(previewVisible)); }
    catch { /* Optional view preferences must not prevent editing. */ }
    previewControl.open = previewVisible;
    syncPaneControl(previewControl);
    const imagePreview = Boolean(doc && !doc.base.block && imageMimeType(doc.base.path) && (previewVisible || !hexMode));
    const rendered = previewVisible && Boolean(doc && !doc.base.block && doc.encoding !== "hex" && supportsPreview(doc.base.path));
    imageHost.hidden = !imagePreview;
    previewFrame.hidden = !rendered || imagePreview;
    editorHost.hidden = rendered || imagePreview || hexMode;
    hexHost.hidden = rendered || imagePreview || !hexMode || diffMode;
    hexControl.open = hexMode && !previewVisible;
    syncPaneControl(hexControl);
    findButton.disabled = !view || previewVisible;
    if (previewVisible || hexMode || !doc?.base.block) pagedSearch.close();
    wrapButton.disabled = !view || previewVisible || hexMode;
    if (view) view.dispatch({ effects: [
      readOnly.reconfigure(EditorState.readOnly.of(previewVisible || Boolean(deletedGitPath) || Boolean(doc?.locked))),
      editable.reconfigure(EditorView.editable.of(!previewVisible && !deletedGitPath && !doc?.locked))
    ] });
    if (hexMode && doc) updateHexView();
    if (!rendered && !imagePreview) restorePosition();
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
    if (deletedGitPath) {
      // A deleted-file comparison must never replace or remove its recoverable draft.
      try { localStorage.setItem(paneKey, deletedGitPath); } catch { /* No draft mutation. */ }
      return;
    }
    if (openedImage && !doc) {
      try { localStorage.setItem(paneKey, openedImage.path); } catch { /* Images have no unsaved edits. */ }
      return;
    }
    if (!doc) return;
    try {
      if (doc.changes) {
        const changes = doc.changes.draft(doc.base.path);
        if (changes) localStorage.setItem(changesKey(doc.base.path), JSON.stringify(changes));
        else localStorage.removeItem(changesKey(doc.base.path));
        for (const key of Object.keys(localStorage).filter((key) => key.startsWith(`${prefix}block-draft:`))) {
          const legacy = readDraft(key);
          if (legacy?.path === doc.base.path && legacy.revision === doc.changes.revision) localStorage.removeItem(key);
        }
      }
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
    notices.replaceChildren(...nodes);
  }
  function confirmDiscard(action: () => void) {
    if (!doc?.dirty) { action(); return; }
    setNotices(element("span", "", "Discard all unsaved changes to this file?"),
      button("Discard draft", () => { setNotices(); action(); }),
      button("Cancel", () => setNotices()));
  }

  async function historyChanges(forward: boolean) {
    if (previewVisible) return;
    const current = doc;
    const index = current?.changes?.history(forward);
    if (index === undefined || !current) return;
    if (index !== current.base.block?.index) await openFile(current.base.path, undefined, index);
  }
  function navigateBlock(index: number, fraction?: number) {
    if (!doc?.base.block || opening || doc.saving || Boolean(doc.changes?.saving)) return;
    if (index === doc.base.block.index && fraction !== undefined && view) {
      view.scrollDOM.scrollTop = fraction * Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
      return;
    }
    if (doc.conflict) { showError("Resolve the file changeset conflict before opening another block."); return; }
    if (doc.dirty && !doc.changes) {
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

  const saveButton = button("Save", () => { if (doc) void doc.save(); });
  saveButton.title = "Save (Ctrl/Cmd+S)";
  saveButton.disabled = true;
  let textOperation = 0;
  let vimSearchBackward = false;
  let vimSearchActive = false;
  const pagedSearch = createPagedSearch((backward) => { void findPaged(backward ?? vimSearchBackward); },
    () => { textOperation++; }, () => { syncFindButton(); view?.focus(); });
  function syncFindButton() { findButton.setAttribute("aria-pressed", String(pagedSearch.visible || Boolean(view && searchPanelOpen(view.state)))); }
  function openFind() {
    if (!view) return false;
    if (doc?.base.block && !hexMode) { vimSearchActive = false; vimSearchBackward = false; pagedSearch.open(); syncFindButton(); return true; }
    openSearchPanel(view); return true;
  }
  const findButton = button("Find", () => {
    if (!view) return;
    if (doc?.base.block && !hexMode) {
      if (pagedSearch.visible) pagedSearch.close(); else openFind();
      return;
    }
    if (searchPanelOpen(view.state)) closeSearchPanel(view);
    else openSearchPanel(view);
  });
  findButton.setAttribute("aria-pressed", "false");
  findButton.disabled = true;
  function textSource(operation: number): PagedTextSource {
    const current = doc!;
    const changes = current.changes;
    const version = changes?.version, revision = current.base.revision, path = current.base.path;
    const valid = () => !disposed && textOperation === operation && doc === current && doc?.base.path === path &&
      doc.base.revision === revision && doc.changes === changes && changes?.version === version && !doc.conflict && !doc.locked;
    return {
      count: current.base.block!.count, lines: currentBlock()!.positions, valid,
      read: async (index) => {
        if (!valid()) throw new Error("The document changed. Try the operation again.");
        if (index === current.base.block!.index) return editorText(current.text, index);
        const snapshot = (await invoke("read", project.id, { path, block: index }))!;
        if (!valid() || snapshot.revision !== revision) throw new Error("The file changed during navigation. Try again.");
        const content = changes ? byteContent(changes.apply(snapshot)) : snapshot;
        if (content.encoding === "hex") throw new Error("Text search and line navigation require UTF-8 text.");
        return editorText(content.text, index);
      }
    };
  }
  async function revealText(point: TextPoint, operation: number, match?: TextMatch, firstNonblank = false) {
    const path = doc!.base.path, revision = doc!.base.revision, changes = doc!.changes, version = changes?.version;
    if (point.block !== doc?.base.block?.index) await openFile(path, undefined, point.block);
    if (disposed || operation !== textOperation || doc?.base.path !== path || doc.base.block?.index !== point.block || !view || doc.base.revision !== revision || doc.changes !== changes || changes?.version !== version) return;
    let from = Math.min(point.offset, view.state.doc.length);
    if (firstNonblank) {
      const line = view.state.doc.lineAt(from);
      from = line.from + (line.text.match(/^\s*/)?.[0].length ?? 0);
    }
    const to = match ? (match.to.block === point.block ? Math.min(match.to.offset, view.state.doc.length) : view.state.doc.length) : from;
    view.dispatch({ selection: { anchor: from, head: vimSearchActive ? from : to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
    if (!pagedSearch.visible || vimSearchActive) view.focus();
    else pagedSearch.input.focus();
  }
  async function findPaged(backward = false) {
    if (!doc?.base.block || !view || previewVisible || hexMode || opening || !pagedSearch.input.value) return;
    const operation = ++textOperation;
    const origin = { block: doc.base.block.index, offset: backward ? view.state.selection.main.from : view.state.selection.main.to + (vimSearchActive ? 1 : 0) };
    const source = textSource(operation);
    pagedSearch.status.textContent = "Searching…";
    try {
      const match = await findInFile(source, pagedSearch.input.value, origin, backward, pagedSearch.matchCase.checked);
      if (!source.valid()) return;
      if (match) await revealText(match.from, operation, match);
      if (textOperation === operation) pagedSearch.status.textContent = match
        ? (match.from.block === match.to.block ? "Match found" : "Match continues in the next text section") : "No matches";
    } catch (error) { if (textOperation === operation) pagedSearch.status.textContent = error instanceof Error ? error.message : String(error); }
  }
  async function jumpToLine(line: number, relative = false) {
    if (!doc?.base.block || !view || opening || previewVisible || hexMode) return;
    const operation = ++textOperation;
    const block = currentBlock()!;
    const currentLine = block.line + view.state.doc.lineAt(view.state.selection.main.head).number - 1;
    const target = Math.max(1, Math.min(block.totalLines, relative ? currentLine + line : line));
    const source = textSource(operation);
    try {
      const point = await lineInFile(source, target);
      if (source.valid()) await revealText(point, operation, undefined, true);
    } catch (error) { if (textOperation === operation) showError(error); }
  }
  const wrapButton = button("Wrap lines", () => {
    wrapLines = !wrapLines;
    try { localStorage.setItem(`${paneKey}:wrap-lines`, String(wrapLines)); } catch { /* Optional view preference. */ }
    wrapButton.setAttribute("aria-pressed", String(wrapLines));
    view?.dispatch({ effects: wrapping.reconfigure(wrappingExtension()) });
    surface?.originalView?.dispatch({ effects: wrapping.reconfigure(wrappingExtension()) });
    view?.focus();
  });
  wrapButton.title = "Wrap lines";
  wrapButton.setAttribute("aria-pressed", String(wrapLines));
  wrapButton.disabled = true;
  const compare = element("details", "file-editor-compare");
  compare.hidden = true;
  const compareText = element("pre");
  const compareActions = element("div", "file-editor-toolbar");
  compareActions.append(
    button("Use disk version", () => confirmDiscard(() => { doc?.useDisk(); rebuild(); })),
    button("Keep my version", () => {
      const comparedRevision = doc?.disk.revision;
      setNotices(element("span", "", doc?.changes ? "Keep all modified ranges against the compared disk revision, including changes in other blocks?" : "Keep your version for the next save, replacing the disk version shown below?"),
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
    if (!doc || disposed || deletedGitPath) return;
    if (doc.changes) changesets.set(changesKey(doc.base.path), doc.changes);
    if (view && viewPaged !== Boolean(doc.base.block)) {
      rebuild(false); return;
    }
    scheduleGitView();
    persist();
    updateTabs();
    editorHost.classList.toggle("file-editor-paged", Boolean(doc.base.block));
    blockNavigation.update(hexMode ? undefined : currentBlock(), !hexMode && !diffMode, opening || doc.saving || Boolean(doc.changes?.saving));
    const locked = previewVisible || doc.locked;
    const firstLine = currentBlock()?.line ?? 1;
    if (view && (viewLocked !== locked || viewFirstLine !== firstLine)) {
      viewLocked = locked; viewFirstLine = firstLine;
      view.dispatch({ effects: [
        editable.reconfigure(EditorView.editable.of(!locked)),
        readOnly.reconfigure(EditorState.readOnly.of(locked)),
        numbering.reconfigure(lineNumbers({ formatNumber: (number) => String(number + firstLine - 1) }))
      ] });
    }
    if (doc.encoding === "hex" && !hexMode && !diffMode && imageHost.hidden) { hexMode = true; rebuild(false); return; }
    if (hexMode) updateHexView();
    previewControl.enabled = true;
    syncPaneControl(previewControl);
    schedulePreview();
    saveButton.disabled = !doc.dirty || doc.busy || doc.changes?.saving || doc.conflict;
    status.textContent = [doc.base.path, doc.dirty ? "Unsaved changes" : "No unsaved changes", (doc.busy || doc.changes?.saving) ? "Working…" : "", doc.changes?.dirty ? `${doc.changes.edits.length} modified ranges` : "", doc.error, persistenceError, previewVisible && imageMimeType(doc.base.path) ? imageInfo : ""].filter(Boolean).join(" · ");
    compare.hidden = !doc.conflict;
    if (doc.conflict && compareText.textContent !== doc.disk.text) compareText.textContent = doc.disk.text;
    if (view && !hexMode && bom + view.state.sliceDoc() !== doc.text) {
      const nextBom = (!doc.base.block?.offset && doc.text.startsWith("\uFEFF")) ? "\uFEFF" : "";
      bom = nextBom;
      syncing = true;
      const selection = view.state.selection.main;
      const text = doc.text.slice(bom.length);
      const separator = editorLineSeparator(doc.text);
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

  function rebuild(focus = true, preserveState = false) {
    if (!doc) return;
    if (preserveState) rememberPosition();
    const previousState = preserveState ? view?.state : undefined;
    restoringPosition = true;
    destroyView();
    editorHost.replaceChildren();
    hexControl.enabled = true;
    if (!doc.base.block && imageMimeType(doc.base.path) && (!hexMode || previewVisible)) {
      restoringPosition = false;
      setPreview(previewVisible, focus);
      refreshUi();
      return;
    }
    if (doc.encoding === "hex") hexMode = true;
    if (hexMode) {
      persistHexMode();
      updateHexView();
      restoringPosition = false;
      setPreview(previewVisible, focus);
      refreshUi();
      return;
    }
    bom = (!doc.base.block?.offset && doc.text.startsWith("\uFEFF")) ? "\uFEFF" : "";
    viewLocked = false;
    viewPaged = Boolean(doc.base.block);
    viewFirstLine = currentBlock()?.line ?? 1;
    surface = createEditorSurface(editorHost, {
        doc: doc.text.slice(bom.length),
        extensions: [doc.base.block ? Prec.highest(EditorView.domEventHandlers({ keydown(event) {
          if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
            event.preventDefault(); return openFind();
          }
          return false;
        } })) : [], vimCompartment.of(vimExtension()), basicSetup, wrapping.of(wrappingExtension()), gitView.extension, theme.of(editorTheme()), language(doc.base.path, doc.base.block),
          readOnly.of(EditorState.readOnly.of(previewVisible || Boolean(deletedGitPath))),
          editable.of(EditorView.editable.of(!deletedGitPath)),
          numbering.of(lineNumbers({ formatNumber: (number) => String(number + viewFirstLine - 1) })),
          lineSeparator.of(EditorState.lineSeparator.of(editorLineSeparator(doc.text))),
          EditorView.contentAttributes.of({ "aria-label": "File contents" }),
          editorAppearance,
          Prec.highest(keymap.of(doc.base.block ? [
            { key: "F3", run: () => { void findPaged(); return true; } },
            { key: "Shift-F3", run: () => { void findPaged(true); return true; } }
          ] : [])),
          Prec.highest(keymap.of(doc.changes ? [
            { key: "Mod-z", run: () => { void historyChanges(false); return true; } },
            { key: "Mod-Shift-z", run: () => { void historyChanges(true); return true; } },
            { key: "Mod-y", run: () => { void historyChanges(true); return true; } }
          ] : [])),
          keymap.of([{ key: "Mod-s", run: () => { if (doc) void doc.save(); return true; } }]),
          EditorView.domEventHandlers({ scroll: () => {
            if (!restoringPosition) schedulePosition();
            if (view) blockNavigation.sync(view.scrollDOM.scrollTop / Math.max(1, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight));
          } }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) schedulePosition();
            syncFindButton();
            if (update.docChanged && !syncing) doc?.edit(bom + update.state.sliceDoc());
            if ((update.selectionSet || update.docChanged) && !syncing && !hexMode && view?.hasFocus && doc) {
              const positions = positionsFor(doc), selection = update.state.selection.main;
              const start = doc.changes?.blockStart(doc.base) ?? doc.base.block?.offset ?? 0;
              publishSelection({ anchor: start + positions.byte(selection.anchor), head: start + positions.byte(selection.head) });
            }
          })]
    }, previousState, useSideBySide() && gitBaseline ? {
      label: gitBaseline.label,
      config: {
        doc: gitBaseline.text.replace(/^\uFEFF/, "").replace(/\r\n|\r/g, "\n"),
        extensions: [basicSetup, wrapping.of(wrappingExtension()), theme.of(editorTheme()), language(doc.base.path), editorAppearance,
          EditorState.readOnly.of(true), EditorView.editable.of(false),
          EditorView.contentAttributes.of({ "aria-label": "Git baseline file contents, read-only" })]
      }
    } : undefined);
    view = surface.view;
    const position = positionFor(doc.base.path);
    if (!previousState) view.dispatch({ selection: { anchor: Math.min(position.anchor, view.state.doc.length), head: Math.min(position.head, view.state.doc.length) } });
    previewControl.enabled = true;
    setPreview(previewVisible, focus);
    if (previewVisible) restoringPosition = false;
    syncFindButton();
    refreshUi();
  }

  async function openFile(path: string, linkedVersion?: number, requestedBlock?: number, preserveHexFocus = false) {
    if (opening || disposed || doc?.saving || doc?.changes?.saving) return;
    // Switching files preserves the previous draft, including when other panes show it.
    persist();
    if (persistenceError && doc?.dirty) { showError(persistenceError); return; }
    const navigationVersion = linkVersion;
    if (doc?.base.path !== path) { textOperation++; pagedSearch.close(); }
    opening = true;
    updateTabs();
    status.textContent = "Indexing and opening file…";
    const block = requestedBlock ?? savedBlock(path);
    try {
      if (imageMimeType(path) && (!hexMode || previewVisible) && requestedBlock === undefined) {
        const image = await invoke<ImageSnapshot>("readImage", project.id, { path });
        if (disposed || (navigationVersion !== linkVersion)) return;
        if (image.size > DEFAULT_BLOCK_BYTES) {
          rememberPosition();
          unsubscribe?.(); unsubscribe = undefined;
          doc = undefined;
          blockNavigation.update(undefined, false, false);
          destroyView();
          editorHost.replaceChildren();
          openedImage = image;
          deletedGitPath = ""; gitVersion++; gitView.show(false); diffControl.enabled = false; diffControl.open = false; syncPaneControl(diffControl);
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
          openedTab(image.path);
          fileBrowser.setSelected(image.path);
          setNotices(); compare.hidden = true;
          saveButton.disabled = true; findButton.disabled = wrapButton.disabled = true;
          findButton.setAttribute("aria-pressed", "false");
          previewControl.label = "image preview";
          previewControl.enabled = true;
          previewControl.open = previewVisible;
          syncPaneControl(previewControl);
          persistenceError = "";
          persist();
          if (linkedVersion === undefined && !closingTab) paneLinks.opened(paneId, image.path, tabs.paths);
          return;
        }
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
      if (!snapshot || disposed || (navigationVersion !== linkVersion)) return;
      const key = draftKey(snapshot.path, snapshot.block?.index);
      let changes: FileChanges | undefined;
      if (snapshot.block) {
        const fileKey = changesKey(snapshot.path);
        changes = changesets.get(fileKey);
        if (!changes) {
          let saved;
          try { saved = readChangesDraft(JSON.parse(localStorage.getItem(fileKey) || "null")); } catch { /* Ignore malformed changesets. */ }
          changes = new FileChanges(snapshot, saved);
          if (!saved) {
            for (const legacyKey of Object.keys(localStorage).filter((key) => key.startsWith(`${prefix}block-draft:`))) {
              const legacy = readDraft(legacyKey);
              if (legacy?.path === snapshot.path && legacy.block && legacy.revision === changes.revision) {
                changes.edit({ ...legacy, text: legacy.baseText, encoding: legacy.baseEncoding }, contentBytes(legacy));
              }
            }
          }
          changesets.set(fileKey, changes);
        } else {
          if (changes.saving) { showError("Wait for the file save to finish before opening another block."); return; }
          if (!changes.dirty && snapshot.revision !== changes.revision) {
            snapshot = (await invoke("read", project.id, { path: snapshot.path, block: snapshot.block.index }))!;
            if (disposed || (navigationVersion !== linkVersion)) return;
          }
          changes.observe(snapshot);
        }
        if (changes.dirty && snapshot.revision !== changes.revision && doc?.base.path === snapshot.path) {
          showError("The file changed on disk. Resolve the changeset conflict before opening another block.");
          doc.notify(); return;
        }
      }
      let next = documents.get(key);
      if (!next) {
        let currentBlock = snapshot.block?.index;
        next = new EditorDocument(snapshot, {
          read: async (file) => (await invoke("read", project.id, { path: file, block: next?.base.block?.index }))!,
          rebaseChanges: async (file, revision, patches, size) =>
            (await invoke<import("./changes").FilePatch[]>("rebaseChanges", project.id, { path: file, revision, patches, size })),
          saveChanges: async (file, revision, patches) => {
            const oldKey = draftKey(file, next?.base.block?.index);
            const saved = (await invoke("saveChanges", project.id, { path: file, revision, patches, block: next?.base.block?.index }))!;
            // Complete draft cleanup even if the initiating pane closed during the save.
            try { localStorage.removeItem(changesKey(file)); } catch { /* Active panes retry persistence. */ }
            const newKey = draftKey(file, saved.block?.index);
            if (oldKey !== newKey && next) { documents.delete(oldKey); documents.set(newKey, next); }
            return saved;
          },
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
        }, readDraft(key), changes);
        documents.set(key, next);
      }
      persist();
      if (persistenceError && doc?.dirty) { showError(persistenceError); return; }
      rememberPosition();
      if (doc !== next) unsubscribe?.();
      else { unsubscribe?.(); documents.set(key, next); }
      previewControl.label = "preview";
      openedImage = undefined;
      imageHost.hidden = true;
      imageElement.removeAttribute("src");
      previewSource = "";
      deletedGitPath = "";
      doc = next;
      if (previewVisible) { hexMode = doc.encoding === "hex"; persistHexMode(); }
      openedTab(snapshot.path);
      fileBrowser.setSelected(snapshot.path);
      setNotices();
      unsubscribe = subscribe(doc, refreshUi);
      rebuild(linkedVersion === undefined && !preserveHexFocus);
      if (linkedVersion === undefined && !closingTab) paneLinks.opened(paneId, snapshot.path, tabs.paths);
      void doc.refresh();
      resetGit();
      if (diffMode) setDiff(true);
      if (!previewVisible && !diffMode && linkedVersion === undefined) view?.focus();
    } catch (error) {
      if (!disposed && navigationVersion === linkVersion && diffMode) {
        try {
          const baseline = await invoke<GitBaseline>("gitBaseline", project.id, { path });
          if (!disposed && navigationVersion === linkVersion && baseline.available && baseline.deleted) { showDeletedDiff(path); return; }
        } catch { /* Show the original open failure. */ }
      }
      if (!disposed) showError(error);
    }
    finally {
      opening = false;
      updateTabs();
      if (doc) blockNavigation.update(hexMode ? undefined : currentBlock(), !hexMode && !diffMode, doc.saving);
      applyLinkedSelection();
      const pending = pendingLinkedPath;
      pendingLinkedPath = undefined;
      if (pending !== undefined && !disposed) {
        if (!pending) { persist(); if (!persistenceError || !doc?.dirty) clearFile(); }
        else if (pending !== currentPath()) void openFile(pending, linkVersion);
      }
    }
  }

  function clearFile() {
    pagedSearch.close();
    unsubscribe?.(); unsubscribe = undefined; destroyView();
    doc = undefined; openedImage = undefined; deletedGitPath = "";
    previewVersion++; clearTimeout(previewTimer); previewPendingSource = ""; previewSource = "";
    gitVersion++; gitBaseline = undefined; gitPath = "";
    editorHost.replaceChildren(empty); editorHost.hidden = false;
    previewFrame.hidden = imageHost.hidden = hexHost.hidden = true;
    imageElement.removeAttribute("src"); previewFrame.removeAttribute("srcdoc");
    compare.hidden = true; setNotices(); fileBrowser.setSelected("");
    blockNavigation.update(undefined, false, false);
    gitView.update("", undefined, "", undefined); gitView.show(false);
    for (const control of [previewControl, hexControl, diffControl]) { control.enabled = false; control.open = false; syncPaneControl(control); }
    saveButton.disabled = findButton.disabled = wrapButton.disabled = true;
    findButton.setAttribute("aria-pressed", "false");
    status.textContent = "Open files from the pane toolbar or browse project files.";
    try { localStorage.removeItem(paneKey); } catch { /* Optional navigation preference. */ }
  }

  let closeDialog: HTMLDialogElement | undefined;
  function confirmTabClose(path: string): Promise<string> {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      closeDialog = dialog;
      dialog.className = "plugin-settings-dialog file-editor-close-dialog";
      dialog.setAttribute("aria-label", "Save changes before closing?");
      const panel = element("div", "plugin-settings-dialog-panel");
      const header = element("header", "plugin-settings-dialog-header");
      header.append(element("h3", "", "Save changes before closing?"));
      const copy = element("p", "", `${path} has unsaved changes. Discarding will remove its local draft and revert the changes in every pane showing this file.`);
      const actions = element("div", "form-actions");
      const cancel = button("Cancel", () => dialog.close("cancel"));
      const discard = button("Discard changes", () => dialog.close("discard"));
      const save = button("Save", () => dialog.close("save"));
      cancel.className = discard.className = "secondary-button";
      save.className = "primary-button";
      actions.append(cancel, discard, save);
      panel.append(header, copy, actions); dialog.append(panel);
      let settled = false;
      const settle = (choice: string) => {
        if (settled) return;
        settled = true;
        if (closeDialog === dialog) closeDialog = undefined;
        dialog.remove(); resolve(choice);
      };
      dialog.addEventListener("close", () => settle(dialog.returnValue || "cancel"), { once: true });
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); dialog.close("cancel"); });
      const overlay = (window as Window & { BoatyardOverlayDialog?: { show(dialog: HTMLDialogElement, options: { freeze: string; freezeMargin: number }): Promise<boolean> } }).BoatyardOverlayDialog;
      if (overlay) void overlay.show(dialog, { freeze: "overlap", freezeMargin: 16 }).then((shown) => {
        if (!shown || disposed) { if (dialog.open) dialog.close("cancel"); settle("cancel"); }
        else cancel.focus();
      }, () => settle("cancel"));
      else { document.body.append(dialog); dialog.showModal(); cancel.focus(); }
    });
  }

  async function closeTab(path: string, mode: "ask" | "quit" | "save" | "discard" = "ask") {
    if (disposed || closingTab || opening || doc?.saving || doc?.changes?.saving) return;
    persist(); rememberPosition();
    closingTab = true;
    try {
      if (isTabDirty(path)) {
        if (mode === "quit") {
          showError("Unsaved changes. Use :wq to save and close or :q! to discard and close.");
          return;
        }
        const choice = mode === "ask" ? await confirmTabClose(path) : mode;
        if (disposed || choice === "cancel" || !tabs.paths.includes(path)) return;
        const previous = currentPath();
        if (previous !== path) await openFile(path);
        const current = doc;
        if (disposed || !current || current.base.path !== path) return;
        if (current.saving || current.changes?.saving) { showError("Wait for the file save to finish before closing."); return; }
        if (choice === "save") {
          await current.save();
          if (disposed) return;
          if (current.dirty || current.error || current.conflict) {
            showError(current.error || "The file could not be saved. Resolve its conflict before closing.");
            paneLinks.opened(paneId, path, tabs.paths);
            return;
          }
        } else current.useDisk();
        persist(); updateTabs();
        if (previous && previous !== path) await openFile(previous);
      }
      if (persistenceError && doc?.dirty) { showError(persistenceError); return; }
      if (currentPath() === path) {
        const next = tabs.neighbor(path);
        if (next) {
          await openFile(next);
          if (currentPath() === path) return;
        } else {
          clearFile();
        }
      }
      tabs.close(path); persistTabs(); updateTabs(); fileTabs.reveal();
      paneLinks.opened(paneId, tabs.active, tabs.paths);
    } finally { closingTab = false; }
  }

  const fileActions = element("div", "file-editor-toolbar file-editor-file-actions");
  for (const [action, icon, label] of [[findButton, "search", "Find"], [wrapButton, "wrapText", "Wrap lines"], [saveButton, "save", "Save"]] as const) {
    action.classList.add("webapp-tool-button");
    action.setAttribute("aria-label", label);
    action.replaceChildren(createToolIcon(icon));
  }
  findButton.title = "Find (Ctrl/Cmd+F)";
  fileActions.setAttribute("role", "toolbar");
  fileActions.setAttribute("aria-label", "Editor actions");
  fileActions.append(saveButton, findButton, wrapButton, diffHost);
  toolbar.append(fileTabs.element);
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
    openFile, openDiff,
    roots: {
      current: project.sourcePath,
      list: () => invokeAction<EditorRoot[]>("roots", project.id),
      async select(path) {
        const validated = await invokeAction<string>("resolveRoot", project.id, { root: path });
        if (disposed) return;
        if (opening || pickerPending || closingTab || doc?.busy || doc?.changes?.saving) {
          throw new Error("Wait for the current file operation before changing worktrees.");
        }
        persist(); rememberPosition();
        if (persistenceError && doc?.dirty) throw new Error(persistenceError);
        const selected = path === roots.projectRoot ? roots.projectRoot : validated;
        const targetKey = `boatyard:file-editor:${JSON.stringify([project.id, selected])}:pane:${paneId}`;
        for (const preference of ["browser", "vim", "wrap-lines", "diff", "diff-layout"]) {
          try {
            const value = localStorage.getItem(`${paneKey}:${preference}`);
            if (value !== null && localStorage.getItem(`${targetKey}:${preference}`) === null) {
              localStorage.setItem(`${targetKey}:${preference}`, value);
            }
          } catch { /* Root switching remains available without optional preferences. */ }
        }
        roots.select(selected);
      }
    }
  });
  browserLayout.panel.append(fileBrowser.element);
  browserLayout.viewport.classList.add("file-editor-main");
  const content = element("div", "file-editor-content");
  content.append(editorHost, hexHost, previewFrame, imageHost, blockNavigation.rail);
  blockNavigation.update(undefined, false, false);
  browserLayout.viewport.append(fileActions, pagedSearch.dom, notices, compare, blockNavigation.toolbar, content);
  const browserControl = getPaneControl(container, "browse");
  browserControl.open = browserState.open;
  browserControl.enabled = true;
  const toggleBrowser = () => {
    browserState.open = !browserState.open;
    browserControl.open = browserState.open;
    syncPaneControl(browserControl);
    browserLayout.sync();
    if (browserState.open) { fileBrowser.show(); void refreshGit(); }
  };
  const togglePreview = () => {
    if (deletedGitPath) return;
    if (diffMode) setDiff(false);
    if (openedImage) {
      previewVisible = !previewVisible;
      try { localStorage.setItem(previewKey, String(previewVisible)); } catch { /* Optional view preference. */ }
      previewControl.open = previewVisible; syncPaneControl(previewControl);
      return;
    }
    if (view && !hexMode) { setPreview(!previewVisible); return; }
    rememberPosition();
    const visible = !previewVisible;
    hexMode = !visible && doc?.encoding === "hex";
    persistHexMode();
    previewVisible = visible;
    rebuild();
  };
  const toggleHex = () => {
    if (deletedGitPath || opening || doc?.saving || doc?.changes?.saving) return;
    if (diffMode) setDiff(false);
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
  const toggleDiff = () => setDiff(!diffMode);
  diffControl.toggle = toggleDiff;
  hexControl.toggle = toggleHex;
  previewControl.toggle = togglePreview;
  for (const [mode, control] of [["diff", diffControl], ["hex", hexControl], ["preview", previewControl]] as const) {
    control.drag = typeof props.startPaneDrag === "function" ? (event) => {
      const path = currentPath();
      if (!path) { event.preventDefault(); return; }
      const start = props.startPaneDrag as (event: DragEvent, webAppId: string, prepare: (paneId: string) => void) => void;
      start(event, "boatyard.fileEditor.editor", (targetId) => {
        const targetKey = `${prefix}pane:${targetId}`;
        const targetRootKey = `boatyard:file-editor:${JSON.stringify([project.id, roots.projectRoot])}:pane:${targetId}:root`;
        localStorage.setItem(targetRootKey, project.sourcePath);
        for (const viewMode of ["diff", "hex", "preview"]) {
          localStorage.removeItem(`${targetKey}:${viewMode}-file`);
          localStorage.setItem(`${targetKey}:${viewMode}`, String(viewMode === mode));
        }
        localStorage.setItem(`${targetKey}:${mode}-file`, path);
        paneLinks.link(paneId, targetId, path, tabs.paths);
      });
    } : undefined;
    syncPaneControl(control);
  }
  browserControl.toggle = toggleBrowser;
  syncPaneControl(browserControl);
  async function pickFiles() {
    if (pickerPending || opening || doc?.saving || doc?.changes?.saving) return;
    pickerPending = true; updateTabs();
    try {
      if (!scope.boatyard?.selectFiles) throw new Error("The native file picker is unavailable.");
      const path = currentPath();
      const initial = path && /^(?:[\\/]|[a-z]:[\\/])/i.test(path) ? path : `${project.sourcePath.replace(/[\\/]+$/, "")}/${path || ""}`;
      const paths = await scope.boatyard.selectFiles(initial);
      for (const path of paths) { if (disposed) return; await openFile(path); }
    } catch (error) { if (!disposed) showError(error); }
    finally { pickerPending = false; if (!disposed) updateTabs(); }
  }
  openControl.toggle = () => { void pickFiles(); };
  updateTabs();
  root.append(toolbar, workspace, status);
  container.replaceChildren(root);
  if (browserState.open) fileBrowser.show();
  gitPollers.add(refreshGit);
  if (!timer) { timer = setInterval(poll, 3000); window.addEventListener("focus", poll); }
  const gitFocus = () => { void refreshGit(); };
  window.addEventListener("focus", gitFocus);
  void refreshGit();
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
  let linkedState = "";
  const detachLinks = paneLinks.attach(paneId, (linked, path, paths) => {
    const state = JSON.stringify([linked, path, paths]);
    if (state === linkedState) return;
    linkedState = state;
    if (pendingSelection?.path !== path) { selectionVersion++; pendingSelection = undefined; }
    highlight(false);
    linkVersion++;
    linkControl.open = linked;
    syncPaneControl(linkControl);
    if (paths) { tabs.paths = [...paths]; tabs.active = path || ""; persistTabs(); updateTabs(); }
    if (!linksReady) { initialLinkedPath = path; return; }
    if (!linked) { selectionVersion++; pendingSelection = undefined; pendingLinkedPath = undefined; return; }
    if (opening) { pendingLinkedPath = path || ""; return; }
    if (!path) { persist(); rememberPosition(); if (!persistenceError || !doc?.dirty) clearFile(); }
    else if (path !== currentPath()) void openFile(path, linkVersion);
  });
  linksReady = true;
  try {
    const previous = localStorage.getItem(paneKey);
    const restore = Array.isArray(savedTabs) ? (tabs.paths.includes(previous || "") ? previous : tabs.paths[0]) : previous;
    const path = initialLinkedPath !== undefined ? initialLinkedPath : requestedHexPath || requestedDiffPath || requestedPreviewPath || restore;
    if (requestedHexPath) localStorage.removeItem(`${paneKey}:hex-file`);
    if (requestedDiffPath) localStorage.removeItem(`${paneKey}:diff-file`);
    if (requestedPreviewPath) localStorage.removeItem(`${paneKey}:preview-file`);
    if (path) void openFile(path, initialLinkedPath !== undefined ? linkVersion : undefined);
  } catch { /* Opening files remains available when local storage is disabled. */ }
  return () => {
    highlight(false);
    if (linkedHosts.get(paneKey) === container) linkedHosts.delete(paneKey);
    if (linkControl.highlight === highlight) linkControl.highlight = undefined;
    if (closeDialog?.open) closeDialog.close("cancel");
    detachSelection();
    detachLinks();
    if (linkControl.toggle === unlink) { linkControl.toggle = null; syncPaneControl(linkControl); }
    persist();
    rememberPosition();
    clearTimeout(previewTimer);
    clearTimeout(gitUpdateTimer);
    gitPollers.delete(refreshGit);
    if (!gitPollers.size && !active.size) { clearInterval(timer); timer = undefined; window.removeEventListener("focus", poll); }
    window.removeEventListener("focus", gitFocus);
    gitView.cleanup();
    if (diffControl.toggle === toggleDiff) { diffControl.toggle = null; diffControl.drag = undefined; syncPaneControl(diffControl); }
    clearTimeout(positionTimer);
    window.removeEventListener("pagehide", flushPosition);
    themeObserver.disconnect();
    fileBrowser.cleanup();
    blockNavigation.cleanup();
    hexView.cleanup();
    browserLayout.cleanup();
    if (browserControl.toggle === toggleBrowser) {
      browserControl.toggle = null;
      syncPaneControl(browserControl);
    }
    if (hexControl.toggle === toggleHex) { hexControl.toggle = null; hexControl.drag = undefined; syncPaneControl(hexControl); }
    if (previewControl.toggle === togglePreview) {
      previewControl.toggle = null;
      previewControl.drag = undefined;
      syncPaneControl(previewControl);
    }
    if (vimControl.toggle === toggleVim) { vimControl.toggle = null; vimControl.enabled = false; syncPaneControl(vimControl); }
    openControl.toggle = null; openControl.enabled = false; syncPaneControl(openControl);
    disposed = true;
    unsubscribe?.();
    destroyView();
  };
}

registry?.register({
  id: pluginId, name: "File Editor", version: "0.1.0", apiVersion: "0.1",
  contributes: { panes: ["boatyard.fileEditor.editor"], globalSettings: ["boatyard.fileEditor.global"] }, permissions: ["pane:dom", "projectConfig:read"]
}, {
  activate(ctx) {
    ctx.settings.registerGlobalSection({
      id: "boatyard.fileEditor.global",
      title: "File Editor",
      fields: [{
        key: "vimByDefault",
        label: "Vim mode by default",
        type: "select",
        valueType: "text",
        defaultValue: "disabled",
        options: [{ value: "disabled", label: "Disabled" }, { value: "enabled", label: "Enabled" }],
        description: "Use Vim when opening an editor pane without a saved Vi preference. A choice made with the pane's Vi button takes precedence."
      }, {
        key: "wrapLinesByDefault",
        label: "Wrap lines by default",
        type: "select",
        valueType: "text",
        defaultValue: "disabled",
        options: [{ value: "disabled", label: "Disabled" }, { value: "enabled", label: "Enabled" }],
        description: "Wrap lines when opening an editor pane without a saved wrapping preference. A choice made with the file toolbar's Wrap lines button takes precedence."
      }]
    });
    ctx.status.set({ state: "ready", summary: "Project file editing is available" });
    ctx.panes.register({
      id: "boatyard.fileEditor.editor", webAppId: "boatyard.fileEditor.editor", key: "file-editor",
      title: "File Editor", icon: "fileEditor", kind: "dom", scope: "project",
      isAvailable: ({ project } = {}) => Boolean(project?.sourcePath), render, renderHeaderActions
    });
  }
});
