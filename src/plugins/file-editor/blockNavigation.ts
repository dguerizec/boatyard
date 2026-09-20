import type { FileBlock } from "./blockIndex";

/** Each loaded fragment has its own first line, even when it continues a long line. */
export function blockRows(block: FileBlock): number[] {
  return block.positions.map((position) => position.lineBreaks + 1);
}
export function locateBlock(rows: number[], fraction: number) {
  let remaining = Math.max(0, Math.min(1, fraction)) * rows.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < rows.length; index++) {
    if (remaining < rows[index] || index === rows.length - 1) return { index, fraction: Math.min(1, remaining / rows[index]) };
    remaining -= rows[index];
  }
  return { index: 0, fraction: 0 };
}

/** A bounded native scrollbar for the complete file, independent of the loaded block. */
export function createBlockNavigation(navigate: (index: number, fraction?: number) => void) {
  const toolbar = document.createElement("div");
  toolbar.className = "file-editor-toolbar file-editor-blocks";
  const caption = document.createElement("span");
  const input = document.createElement("input");
  input.type = "number"; input.min = "1"; input.step = "1";
  input.setAttribute("aria-label", "File block number");
  const action = (label: string, click: () => void) => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.addEventListener("click", click);
    return button;
  };
  const previous = action("Previous block", () => { if (block) navigate(block.index - 1); });
  const next = action("Next block", () => { if (block) navigate(block.index + 1); });
  const go = () => { if (block && input.reportValidity()) navigate(Number(input.value) - 1); };
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); go(); } });
  toolbar.append(previous, next, input, action("Go to block", go), caption);
  const rail = document.createElement("div");
  rail.className = "file-editor-file-scroll";
  rail.tabIndex = 0;
  rail.setAttribute("aria-label", "Scroll through the complete file");
  rail.title = "Scroll through the complete file";
  const spacer = document.createElement("div");
  rail.append(spacer);
  let block: FileBlock | undefined;
  let rows: number[] = [];
  let lastTop = 0;
  let position = 0;
  let delay: ReturnType<typeof setTimeout> | undefined;
  function sync(fraction: number) {
    position = fraction;
    if (!block || rail.hidden) return;
    const total = rows.reduce((sum, value) => sum + value, 0);
    const before = rows.slice(0, block.index).reduce((sum, value) => sum + value, 0);
    const relative = (before + rows[block.index] * fraction) / total;
    rail.scrollTop = relative * Math.max(0, rail.scrollHeight - rail.clientHeight);
    lastTop = rail.scrollTop;
  }
  const resize = new ResizeObserver(() => sync(position));
  resize.observe(rail);
  rail.addEventListener("scroll", () => {
    if (!block || Math.abs(rail.scrollTop - lastTop) < 1) return;
    lastTop = rail.scrollTop;
    clearTimeout(delay);
    const target = locateBlock(rows, rail.scrollTop / Math.max(1, rail.scrollHeight - rail.clientHeight));
    delay = setTimeout(() => navigate(target.index, target.fraction), 80);
  });
  return {
    toolbar, rail, sync,
    update(value: FileBlock | undefined, text: boolean, busy: boolean) {
      block = value;
      toolbar.hidden = !block;
      rail.hidden = !block || !text;
      if (!block) return;
      rows = blockRows(block);
      spacer.style.height = `${Math.min(8_000_000, Math.max(rail.clientHeight + 100, rows.reduce((sum, value) => sum + value, 0) * 20))}px`;
      previous.disabled = busy || block.index === 0;
      next.disabled = busy || block.index + 1 === block.count;
      input.disabled = busy;
      input.max = String(block.count); input.value = String(block.index + 1);
      caption.textContent = `${block.index + 1}/${block.count} · ${text ? `From line ${block.line}/${block.totalLines} · ${block.totalCharacters.toLocaleString()} characters` : `${block.size.toLocaleString()} bytes`}`;
      caption.title = `Bytes ${block.offset}–${block.offset + block.length} · ${block.characters} characters · ${block.lineBreaks} line breaks${block.continuation ? " · Continues the previous line" : ""}`;
      sync(position);
    },
    cleanup() { clearTimeout(delay); resize.disconnect(); }
  };
}
