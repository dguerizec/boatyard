const PAGE_BYTES = 256;
type Change = { offset: number; before: Uint8Array; after: Uint8Array };
const hex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();

/** Bounded DOM even for large files; editing overwrites bytes without resizing them. */
export function createHexView(host: HTMLElement, onEdit: (bytes: Uint8Array) => void, onSave: () => void) {
  let bytes = new Uint8Array();
  let page = 0;
  let changing = false;
  let fileKey = "";
  const undo: Change[] = [];
  const redo: Change[] = [];
  const toolbar = document.createElement("div");
  toolbar.className = "file-editor-toolbar";
  const grid = document.createElement("div");
  grid.className = "file-editor-hex-grid";
  const caption = document.createElement("span");
  const offset = document.createElement("input");
  offset.placeholder = "Hex offset";
  offset.setAttribute("aria-label", "Go to hexadecimal byte offset");
  offset.size = 10;
  function button(label: string, action: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }
  const previous = button("Previous", () => { page = Math.max(0, page - 1); render(); });
  const next = button("Next", () => { page++; render(); });
  function go() {
    if (!/^(?:0x)?[\da-f]+$/i.test(offset.value)) { offset.setCustomValidity("Enter a hexadecimal byte offset."); offset.reportValidity(); return; }
    const index = parseInt(offset.value.replace(/^0x/i, ""), 16);
    if (index >= bytes.length) { offset.setCustomValidity("Offset is outside this file."); offset.reportValidity(); return; }
    offset.setCustomValidity("");
    focusByte(index);
  }
  offset.addEventListener("input", () => offset.setCustomValidity(""));
  offset.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); go(); } });
  const undoButton = button("Undo", () => history(false));
  const redoButton = button("Redo", () => history(true));
  toolbar.append(previous, next, offset, button("Go", go), undoButton, redoButton, caption);
  host.replaceChildren(toolbar, grid);

  function notify() {
    changing = true;
    try { onEdit(bytes); } finally { changing = false; }
    renderValues();
  }
  function edit(index: number, replacement: Uint8Array) {
    if (index + replacement.length > bytes.length) return;
    const before = bytes.slice(index, index + replacement.length);
    if (before.every((value, i) => value === replacement[i])) return;
    undo.push({ offset: index, before, after: replacement.slice() });
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    bytes.set(replacement, index);
    notify();
  }
  function history(forward: boolean) {
    const change = (forward ? redo : undo).pop();
    if (!change) return;
    (forward ? undo : redo).push(change);
    bytes.set(forward ? change.after : change.before, change.offset);
    notify();
    focusByte(change.offset);
  }
  function focusByte(index: number) {
    index = Math.max(0, Math.min(bytes.length - 1, index));
    if (Math.floor(index / PAGE_BYTES) !== page) { page = Math.floor(index / PAGE_BYTES); render(); }
    grid.querySelector<HTMLInputElement>(`input[data-offset="${index}"]`)?.focus();
  }
  function renderValues() {
    for (const input of grid.querySelectorAll<HTMLInputElement>("input[data-offset]")) input.value = hex(bytes[Number(input.dataset.offset)]);
    for (const ascii of grid.querySelectorAll<HTMLElement>("[data-ascii]")) {
      const start = Number(ascii.dataset.ascii);
      ascii.textContent = Array.from(bytes.subarray(start, start + 16), (byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".").join("");
    }
    undoButton.disabled = !undo.length;
    redoButton.disabled = !redo.length;
  }
  function render() {
    page = Math.max(0, Math.min(page, Math.ceil(bytes.length / PAGE_BYTES) - 1));
    const start = page * PAGE_BYTES;
    const end = Math.min(bytes.length, start + PAGE_BYTES);
    previous.disabled = page === 0;
    next.disabled = end === bytes.length;
    caption.textContent = bytes.length ? `0x${start.toString(16).toUpperCase()}–0x${(end - 1).toString(16).toUpperCase()} · ${bytes.length} bytes` : "Empty file";
    grid.replaceChildren();
    for (let row = start; row < end; row += 16) {
      const line = document.createElement("div");
      line.className = "file-editor-hex-row";
      const address = document.createElement("span");
      address.textContent = row.toString(16).padStart(8, "0").toUpperCase();
      line.append(address);
      for (let column = 0; column < 16; column++) {
        const index = row + column;
        if (index >= bytes.length) { line.append(document.createElement("span")); continue; }
        const input = document.createElement("input");
        input.dataset.offset = String(index);
        input.maxLength = 2;
        input.spellcheck = false;
        input.setAttribute("aria-label", `Byte 0x${index.toString(16).toUpperCase()}`);
        input.addEventListener("focus", () => input.select());
        input.addEventListener("input", () => {
          input.setCustomValidity("");
          if (/^[\da-f]{2}$/i.test(input.value)) edit(index, Uint8Array.of(parseInt(input.value, 16)));
        });
        input.addEventListener("blur", () => { if (index < bytes.length) input.value = hex(bytes[index]); });
        input.addEventListener("paste", (event) => {
          event.preventDefault();
          const value = (event.clipboardData?.getData("text") || "").replace(/\s+/g, "");
          if (!/^(?:[\da-f]{2})+$/i.test(value) || value.length / 2 > bytes.length - index) {
            input.setCustomValidity("Paste complete hexadecimal byte pairs that fit inside the file."); input.reportValidity(); return;
          }
          input.setCustomValidity("");
          edit(index, Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16)));
        });
        input.addEventListener("keydown", (event) => {
          const direction: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16 };
          if (event.key in direction) { event.preventDefault(); focusByte(index + direction[event.key]); }
        });
        line.append(input);
      }
      const ascii = document.createElement("span");
      ascii.dataset.ascii = String(row);
      line.append(ascii);
      grid.append(line);
    }
    renderValues();
  }
  host.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key.toLowerCase() === "s") { event.preventDefault(); onSave(); }
    if (event.key.toLowerCase() === "z") { event.preventDefault(); history(event.shiftKey); }
    if (event.key.toLowerCase() === "y") { event.preventDefault(); history(true); }
  });
  render();
  return {
    update(value: Uint8Array, key: string) {
      if (changing) return;
      if (fileKey === key && value.length === bytes.length && value.every((byte, index) => byte === bytes[index])) return;
      if (fileKey !== key) page = 0;
      fileKey = key;
      bytes = value.slice();
      undo.length = 0; redo.length = 0;
      render();
    },
    focus: () => grid.querySelector<HTMLInputElement>("input")?.focus()
  };
}
