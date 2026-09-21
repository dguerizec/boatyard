import type { ByteSelection } from "./selection";
import { hexGeometry, hexRowAtScroll, hexScrollAtRow, HEX_ROW_BYTES, HEX_ROW_HEIGHT } from "./hexViewport";

type Change = { offset: number; before: Uint8Array; after: Uint8Array };
type Chunk = { offset: number; bytes: Uint8Array };
export type HexSource = {
  size: number;
  revision: string;
  initialOffset?: number;
  history?(forward: boolean): Promise<void>;
  paste?(offset: number, bytes: Uint8Array): Promise<void>;
  canUndo?: boolean;
  canRedo?: boolean;
  selected?(selection: ByteSelection): void;
  scrolled?(offset: number): void;
  read(offset: number): Promise<Chunk>;
  activate(offset: number): Promise<boolean>;
  error(error: unknown): void;
};
const hex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();

/** Render visible rows only; disk blocks remain an internal, bounded read cache. */
export function createHexView(host: HTMLElement, onEdit: (bytes: Uint8Array) => void, onSave: () => void) {
  let bytes = new Uint8Array();
  let baseOffset = 0, size = 0, generation = 0;
  let disabled = false, changing = false, disposed = false;
  let fileKey = "", revision = "";
  let source: HexSource | undefined;
  let frame = 0, renderedStart = -1, renderedEnd = -1;
  let focusRequest = 0;
  let selection: ByteSelection = { anchor: 0, head: 0 };
  let pivot = 0, focusing = false, dragging = false;
  function bindSelection(cell: HTMLElement, index: number) {
    cell.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); dragging = true;
      void focusByte(index, event.shiftKey);
    });
    cell.addEventListener("pointerenter", (event) => { if (dragging && event.buttons === 1) void focusByte(index, true); });
  }
  function selectByte(index: number, extend = false) {
    if (!extend) pivot = index;
    selection = extend ? (index >= pivot ? { anchor: pivot, head: index + 1 } : { anchor: pivot + 1, head: index }) : { anchor: index, head: index };
    source?.selected?.({ ...selection });
    renderValues();
  }
  function reveal(index: number) {
    const row = Math.floor(Math.max(0, Math.min(size - 1, index)) / HEX_ROW_BYTES);
    const first = hexRowAtScroll(size, viewport.clientHeight, viewport.scrollTop);
    const visible = hexGeometry(size, viewport.clientHeight).visible;
    if (row < first || row >= first + visible) viewport.scrollTop = hexScrollAtRow(size, viewport.clientHeight, row < first ? row : row - visible + 1);
    render();
    const cell = layer.querySelector<HTMLElement>(`input[data-offset="${Math.max(0, Math.min(size - 1, index))}"]`);
    if (cell) {
      const bounds = cell.getBoundingClientRect(), frame = viewport.getBoundingClientRect();
      if (bounds.left < frame.left) viewport.scrollLeft -= frame.left - bounds.left;
      else if (bounds.right > frame.right) viewport.scrollLeft += bounds.right - frame.right;
    }
  }
  let pendingRow: number | undefined;
  let reportedOffset = -1;
  let wheelRemainder = 0;
  const chunks = new Map<number, Chunk>();
  const pending = new Set<number>();
  const undo: Change[] = [], redo: Change[] = [];
  const toolbar = document.createElement("div");
  toolbar.className = "file-editor-toolbar";
  const viewport = document.createElement("div");
  viewport.className = "file-editor-hex-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Hexadecimal file contents");
  const grid = document.createElement("div");
  grid.className = "file-editor-hex-grid";
  const layer = document.createElement("div");
  layer.className = "file-editor-hex-rows";
  grid.append(layer); viewport.append(grid);
  const caption = document.createElement("span");
  const offset = document.createElement("input");
  offset.placeholder = "Hex offset";
  offset.setAttribute("aria-label", "Go to hexadecimal byte offset");
  offset.size = 10;
  function button(label: string, action: () => void) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }
  function go() {
    if (!/^(?:0x)?[\da-f]+$/i.test(offset.value)) { offset.setCustomValidity("Enter a hexadecimal byte offset."); offset.reportValidity(); return; }
    const index = parseInt(offset.value.replace(/^0x/i, ""), 16);
    if (!Number.isSafeInteger(index) || index >= size) { offset.setCustomValidity("Offset is outside this file."); offset.reportValidity(); return; }
    offset.setCustomValidity("");
    void focusByte(index);
  }
  offset.addEventListener("input", () => offset.setCustomValidity(""));
  offset.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); go(); } });
  const undoButton = button("Undo", () => history(false));
  const redoButton = button("Redo", () => history(true));
  toolbar.append(offset, button("Go", go), undoButton, redoButton, caption);
  host.replaceChildren(toolbar, viewport);

  function active(index: number) { return index >= baseOffset && index < baseOffset + bytes.length; }
  function valueAt(index: number): number | undefined {
    if (active(index)) return bytes[index - baseOffset];
    for (const chunk of chunks.values()) if (index >= chunk.offset && index < chunk.offset + chunk.bytes.length) return chunk.bytes[index - chunk.offset];
    return undefined;
  }
  function schedule() {
    if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; render(); });
  }
  function load(index: number) {
    if (!source || pending.size >= 2 || pending.has(index) || valueAt(index) !== undefined) return;
    const version = generation;
    pending.add(index);
    void source.read(index).then((chunk) => {
      if (disposed || version !== generation) return;
      chunks.delete(chunk.offset); chunks.set(chunk.offset, chunk);
      while (chunks.size > 3) chunks.delete(chunks.keys().next().value!);
      renderValues(); schedule();
    }).catch((error) => { if (!disposed && version === generation) source?.error(error); })
      .finally(() => { if (version === generation) pending.delete(index); });
  }
  function notify() {
    changing = true;
    try { onEdit(bytes); } finally { changing = false; }
    renderValues();
  }
  function edit(index: number, replacement: Uint8Array) {
    if (disabled || !active(index) || index + replacement.length > baseOffset + bytes.length) return;
    const local = index - baseOffset;
    const before = bytes.slice(local, local + replacement.length);
    if (before.every((value, i) => value === replacement[i])) return;
    if (!source?.history) {
      undo.push({ offset: index, before, after: replacement.slice() });
      if (undo.length > 100) undo.shift();
      redo.length = 0;
    }
    bytes.set(replacement, local); notify();
  }
  function history(forward: boolean) {
    if (disabled) return;
    if (source?.history) { void source.history(forward); return; }
    const change = (forward ? redo : undo).pop();
    if (!change) return;
    (forward ? undo : redo).push(change);
    bytes.set(forward ? change.after : change.before, change.offset - baseOffset);
    notify(); void focusByte(change.offset);
  }
  async function focusByte(index: number, extend = false) {
    if (!size) { viewport.focus(); return; }
    const request = ++focusRequest, key = fileKey;
    index = Math.max(0, Math.min(size - 1, index));
    selectByte(index, extend);
    reveal(index);
    if (!active(index)) {
      try { if (!await source?.activate(index)) return; }
      catch (error) { source?.error(error); return; }
    }
    if (disposed || request !== focusRequest || key !== fileKey) return;
    renderValues();
    const input = layer.querySelector<HTMLInputElement>(`input[data-offset="${index}"]`);
    focusing = true;
    input?.focus({ preventScroll: true }); input?.select();
    focusing = false;
  }
  function renderValues() {
    const from = Math.min(selection.anchor, selection.head), to = Math.max(selection.anchor, selection.head);
    const isSelected = (index: number) => from === to ? index === Math.min(size - 1, from) : index >= from && index < to;
    for (const input of layer.querySelectorAll<HTMLInputElement>("input[data-offset]")) {
      const index = Number(input.dataset.offset), value = valueAt(index);
      if (document.activeElement !== input || input.readOnly || input.value.length === 2) input.value = value === undefined ? "··" : hex(value);
      input.classList.toggle("selected", isSelected(index));
      input.readOnly = !active(index);
      input.disabled = disabled;
    }
    for (const ascii of layer.querySelectorAll<HTMLElement>("[data-ascii]")) {
      const index = Number(ascii.dataset.ascii), value = valueAt(index);
      ascii.textContent = value === undefined ? " " : value >= 32 && value <= 126 ? String.fromCharCode(value) : ".";
      ascii.classList.toggle("selected", isSelected(index));
    }
    undoButton.disabled = disabled || !(source?.history ? source.canUndo : undo.length);
    redoButton.disabled = disabled || !(source?.history ? source.canRedo : redo.length);
  }
  function render() {
    if (disposed || !viewport.clientHeight) return;
    const geometry = hexGeometry(size, viewport.clientHeight);
    grid.style.height = `${geometry.height}px`;
    if (pendingRow !== undefined) {
      viewport.scrollTop = hexScrollAtRow(size, viewport.clientHeight, pendingRow);
      pendingRow = undefined;
    }
    const first = hexRowAtScroll(size, viewport.clientHeight, viewport.scrollTop);
    if (reportedOffset !== first * 16) { reportedOffset = first * 16; source?.scrolled?.(reportedOffset); }
    const start = Math.max(0, first - 3) * 16;
    const end = Math.min(size, (first + geometry.visible + 4) * 16);
    layer.style.top = `${viewport.scrollTop - (first - start / 16) * HEX_ROW_HEIGHT}px`;
    caption.textContent = size ? `0x${(first * 16).toString(16).toUpperCase()} · ${size.toLocaleString()} bytes` : "Empty file";
    if (start !== renderedStart || end !== renderedEnd) {
      renderedStart = start; renderedEnd = end;
      layer.replaceChildren();
      for (let row = start; row < end; row += 16) {
        const line = document.createElement("div"); line.className = "file-editor-hex-row";
        const address = document.createElement("span"); address.textContent = row.toString(16).padStart(8, "0").toUpperCase(); line.append(address);
        for (let column = 0; column < 16; column++) {
          const index = row + column;
          if (index >= size) { line.append(document.createElement("span")); continue; }
          const input = document.createElement("input");
          input.dataset.offset = String(index); input.maxLength = 2; input.spellcheck = false;
          input.setAttribute("aria-label", `Byte 0x${index.toString(16).toUpperCase()}`);
          bindSelection(input, index);
          input.addEventListener("focus", () => { if (focusing) return; if (!active(index)) void focusByte(index); else { selectByte(index); input.select(); } });
          input.addEventListener("input", () => {
            input.setCustomValidity("");
            if (/^[\da-f]{2}$/i.test(input.value)) edit(index, Uint8Array.of(parseInt(input.value, 16)));
          });
          input.addEventListener("blur", () => { const value = valueAt(index); if (value !== undefined) input.value = hex(value); });
          input.addEventListener("paste", (event) => {
            event.preventDefault();
            const value = (event.clipboardData?.getData("text") || "").replace(/\s+/g, "");
            if (disabled || !/^(?:[\da-f]{2})+$/i.test(value) || value.length / 2 > size - index) {
              input.setCustomValidity("Paste complete hexadecimal byte pairs that fit inside the file."); input.reportValidity(); return;
            }
            input.setCustomValidity("");
            const replacement = Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
            if (source?.paste) void source.paste(index, replacement).catch((error) => source?.error(error));
            else edit(index, replacement);
          });
          input.addEventListener("keydown", (event) => {
            const directions: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16, PageUp: -geometry.visible * 16, PageDown: geometry.visible * 16 };
            if (event.key in directions) { event.preventDefault(); void focusByte(index + directions[event.key], event.shiftKey); }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault(); void focusByte(event.ctrlKey || event.metaKey ? (event.key === "Home" ? 0 : size - 1) : (event.key === "Home" ? row : Math.min(row + 15, size - 1)), event.shiftKey);
            }
          });
          line.append(input);
        }
        const ascii = document.createElement("span");
        for (let index = row; index < Math.min(row + 16, size); index++) {
          const character = document.createElement("span");
          character.dataset.ascii = String(index);
          bindSelection(character, index);
          ascii.append(character);
        }
        line.append(ascii); layer.append(line);
      }
    }
    renderValues();
    // One request per missing region, including rows straddling a UTF-8-aligned block boundary.
    for (let index = start; index < end; index++) if (valueAt(index) === undefined) { load(index); break; }
  }
  const stopDragging = () => { dragging = false; };
  window.addEventListener("pointerup", stopDragging);
  viewport.addEventListener("scroll", schedule);
  viewport.addEventListener("wheel", (event) => {
    if (!event.deltaY || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    const first = hexRowAtScroll(size, viewport.clientHeight, viewport.scrollTop);
    const pixels = event.deltaY * (event.deltaMode === 1 ? HEX_ROW_HEIGHT : event.deltaMode === 2 ? viewport.clientHeight : 1);
    wheelRemainder += pixels;
    const rows = Math.trunc(wheelRemainder / HEX_ROW_HEIGHT);
    wheelRemainder -= rows * HEX_ROW_HEIGHT;
    viewport.scrollLeft += event.deltaX;
    viewport.scrollTop = hexScrollAtRow(size, viewport.clientHeight, first + rows);
    schedule();
  }, { passive: false });
  host.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key.toLowerCase() === "s") { event.preventDefault(); onSave(); }
    if (event.key.toLowerCase() === "z") { event.preventDefault(); history(event.shiftKey); }
    if (event.key.toLowerCase() === "y") { event.preventDefault(); history(true); }
  });
  const observer = new ResizeObserver(schedule); observer.observe(viewport);
  return {
    update(value: Uint8Array, key: string, start = 0, locked = false, nextSource?: HexSource) {
      disabled = locked; source = nextSource;
      size = source?.size ?? value.length;
      const changedFile = key !== fileKey;
      if (changedFile || revision !== (source?.revision ?? "")) {
        generation++; chunks.clear(); pending.clear(); revision = source?.revision ?? "";
      }
      if (!changing && (changedFile || start !== baseOffset || value.length !== bytes.length || value.some((byte, index) => byte !== bytes[index]))) {
        bytes = value.slice(); undo.length = 0; redo.length = 0;
      }
      fileKey = key; baseOffset = start;
      if (changedFile) { selection = { anchor: start, head: start }; pivot = start; pendingRow = Math.floor((source?.initialOffset ?? start) / 16); renderedStart = -1; reportedOffset = -1; }
      renderValues(); schedule();
    },
    setSelection(value: ByteSelection) {
      selection = { anchor: Math.max(0, Math.min(size, value.anchor)), head: Math.max(0, Math.min(size, value.head)) };
      pivot = selection.anchor;
      reveal(selection.head > selection.anchor ? selection.head - 1 : selection.head);
      renderValues();
    },
    focus: () => { void focusByte(baseOffset); },
    cleanup() { window.removeEventListener("pointerup", stopDragging); disposed = true; generation++; cancelAnimationFrame(frame); observer.disconnect(); chunks.clear(); }
  };
}
