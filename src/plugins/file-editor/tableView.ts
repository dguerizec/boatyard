import { detectTableDelimiter, MAX_TABLE_CELLS, moveTableRow, parseTable, serializeTable, sortTable, tableWidth, type TableData, type TableDelimiter } from "./tableData";
import { attachPanePointerResize } from "../../renderer/panePointerResize";

export type TablePreferences = { delimiter?: TableDelimiter; header: boolean; widths?: number[]; sortKinds?: Array<"text" | "number"> };
const ROW_HEIGHT = 36;
const PAGE_ROWS = 60;
const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 1200;

/** A bounded DOM over the complete document; writes flow through the owning editor. */
export function createTableView(host: HTMLElement, actions: {
  edit(text: string): void; save(): void; history(forward: boolean): void;
  openUrl(url: string): void;
  preference(path: string, value: TablePreferences): void;
}) {
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "") {
    const element = document.createElement(tag); element.textContent = text; return element;
  }
  function button(label: string, run: () => void) {
    const element = node("button", label); element.type = "button";
    element.addEventListener("click", () => { if (!locked && data) run(); });
    return element;
  }
  function select(label: string, options: Array<[string, string]>) {
    const element = node("select"); element.setAttribute("aria-label", label);
    for (const [value, title] of options) { const option = node("option", title); option.value = value; element.append(option); }
    return element;
  }
  const toolbar = node("div"); toolbar.className = "file-editor-table-actions";
  toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "Table actions");
  const delimiter = select("Field separator", [["auto", "Auto separator"], [",", "Comma"], [";", "Semicolon"], ["\t", "Tab"], ["|", "Pipe"]]);
  const headerLabel = node("label"); const header = node("input"); header.type = "checkbox";
  headerLabel.append(header, document.createTextNode("First row is header"));
  const viewport = node("div"); viewport.className = "file-editor-table-viewport";
  const table = node("table"); table.setAttribute("aria-label", "Delimited file data");
  const columns = node("colgroup"), head = node("thead"), body = node("tbody"); table.append(columns, head, body); viewport.append(table);
  const message = node("p"); message.className = "file-editor-table-message"; message.setAttribute("role", "status");
  let data: TableData | undefined, path = "", text = "", locked = false, preference: TablePreferences = { header: true };
  let rowIndex = 0, columnIndex = 0, windowStart = -1, dragging: number | undefined;
  let resizeCleanups: Array<() => void> = [];
  const firstDataRow = () => header.checked && data?.rows.length ? 1 : 0;
  const columnWidth = (index: number) => preference.widths?.[index] || DEFAULT_COLUMN_WIDTH;
  function applyWidths() {
    if (!data) return;
    const width = tableWidth(data);
    table.style.width = `${56 + Array.from({ length: width }, (_, index) => columnWidth(index)).reduce((sum, value) => sum + value, 0)}px`;
    for (let index = 0; index < width; index++) {
      const size = columnWidth(index);
      (columns.children[index + 1] as HTMLElement).style.width = `${size}px`;
      const handle = head.querySelector<HTMLElement>(`[data-resize-column="${index}"]`);
      handle?.setAttribute("aria-valuenow", String(size));
    }
  }
  function resizeColumn(index: number, width: number) {
    preference.widths ??= [];
    preference.widths[index] = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
    applyWidths();
  }
  function clearColumnHandles() { resizeCleanups.forEach(cleanup => cleanup()); resizeCleanups = []; }
  function persist() { actions.preference(path, preference); }
  type MenuItem = { label: string; run(): void; disabled?: boolean; checked?: boolean; danger?: boolean };
  let menuCleanup: (() => void) | undefined;
  function closeMenu() { menuCleanup?.(); menuCleanup = undefined; }
  function rowItems(row: number): MenuItem[] {
    rowIndex = row;
    body.querySelectorAll("tr[data-row]").forEach(element => element.classList.toggle("selected", Number((element as HTMLElement).dataset.row) === row));
    return [
      { label: "Add row", run: () => addRow() },
      { label: "Insert row", run: () => addRow(true) },
      { label: "Delete row", run: deleteRow, disabled: !data?.rows[row] || row < firstDataRow(), danger: true }
    ];
  }
  function columnItems(column: number): MenuItem[] {
    columnIndex = column;
    const kind = preference.sortKinds?.[column] || "text";
    const comparison = (value: "text" | "number") => {
      preference.sortKinds ??= [];
      preference.sortKinds[column] = value; persist();
    };
    return [
      { label: "Add column", run: () => addColumn() },
      { label: "Insert column", run: () => addColumn(true) },
      { label: "Delete column", run: deleteColumn, disabled: !data || tableWidth(data) <= 1, danger: true },
      { label: "Sort as text", run: () => comparison("text"), checked: kind === "text" },
      { label: "Sort as number", run: () => comparison("number"), checked: kind === "number" }
    ];
  }
  function bindMenu(anchor: HTMLElement, items: () => MenuItem[], openOnClick = false) {
    anchor.setAttribute("aria-haspopup", "menu");
    function open(x: number, y: number) {
      closeMenu();
      if (!data || locked) return;
      const menu = node("div"); menu.className = "webapp-tab-menu file-editor-table-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", anchor instanceof HTMLTableCellElement ? "Column actions" : "Row actions");
      for (const entry of items()) {
        const item = node("button", entry.label); item.type = "button";
        item.className = `webapp-tab-menu-item${entry.danger ? " danger" : ""}`;
        item.setAttribute("role", entry.checked === undefined ? "menuitem" : "menuitemradio");
        if (entry.checked !== undefined) item.setAttribute("aria-checked", String(entry.checked));
        item.disabled = Boolean(entry.disabled);
        item.addEventListener("click", () => { closeMenu(); safely(entry.run); });
        menu.append(item);
      }
      host.append(menu);
      menu.style.maxWidth = `${host.clientWidth}px`;
      menu.style.maxHeight = `${host.clientHeight}px`;
      // Keep the popup inside its pane, away from adjacent native web surfaces.
      const bounds = host.getBoundingClientRect(), size = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(bounds.left, Math.min(x, Math.min(bounds.right, innerWidth) - size.width))}px`;
      menu.style.top = `${Math.max(bounds.top, Math.min(y, Math.min(bounds.bottom, innerHeight) - size.height))}px`;
      const buttons = Array.from(menu.querySelectorAll("button")).filter(item => !item.disabled);
      function outside(event: PointerEvent) { if (event.target instanceof Node && !menu.contains(event.target)) closeMenu(); }
      function keyboard(event: KeyboardEvent) {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          closeMenu(); (anchor.querySelector<HTMLElement>("textarea, button") || anchor).focus({ preventScroll: true });
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }
      document.addEventListener("pointerdown", outside); menu.addEventListener("keydown", keyboard);
      menuCleanup = () => { document.removeEventListener("pointerdown", outside); menu.remove(); };
      buttons[0]?.focus({ preventScroll: true });
    }
    anchor.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); open(event.clientX, event.clientY); });
    if (openOnClick) anchor.addEventListener("click", () => {
      const bounds = anchor.getBoundingClientRect(); open(bounds.left, bounds.bottom);
    });
    anchor.addEventListener("keydown", event => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault(); event.stopPropagation();
      const bounds = anchor.getBoundingClientRect(); open(bounds.left, bounds.bottom);
    });
  }
  function write(render = true) {
    closeMenu();
    if (!data || locked) return;
    const selectedRow = rowIndex, selectedColumn = columnIndex;
    text = serializeTable(data);
    actions.edit(text);
    if (render) { renderColumns(); renderRows(true); }
    rowIndex = selectedRow; columnIndex = selectedColumn;
  }
  function safely(run: () => void) {
    try { message.textContent = ""; run(); }
    catch (error) { message.textContent = error instanceof Error ? error.message : String(error); }
  }
  const undo = button("Undo", () => actions.history(false)), redo = button("Redo", () => actions.history(true));
  function addRow(before = false) {
    const width = tableWidth(data!);
    if ((data!.rows.length + 1) * width > MAX_TABLE_CELLS) throw new Error("The table cell limit has been reached.");
    if (!data!.rows.length && header.checked) data!.rows.push(Array.from({ length: width }, () => ({ value: "" })));
    const index = data!.rows.length ? Math.min(data!.rows.length, Math.max(firstDataRow(), rowIndex + (before ? 0 : 1))) : 0;
    data!.rows.splice(index, 0, Array.from({ length: width }, () => ({ value: "" })));
    rowIndex = index; write(); focusCell(rowIndex, columnIndex);
  }
  function deleteRow() {
    if (rowIndex < firstDataRow() || !data!.rows[rowIndex]) return;
    data!.rows.splice(rowIndex, 1); rowIndex = Math.max(firstDataRow(), Math.min(rowIndex, data!.rows.length - 1)); write(); focusCell(rowIndex, columnIndex);
  }
  function addColumn(before = false) {
    const width = tableWidth(data!);
    if (width >= 256 || (width + 1) * Math.max(1, data!.rows.length) > MAX_TABLE_CELLS) throw new Error("The table column or cell limit has been reached.");
    if (!data!.rows.length) data!.rows.push([{ value: "" }]);
    const index = Math.min(columnIndex + (before ? 0 : 1), width);
    if (preference.sortKinds) { preference.sortKinds = Array.from({ length: width }, (_, index) => preference.sortKinds?.[index] || "text"); preference.sortKinds.splice(index, 0, "text"); persist(); }
    if (preference.widths) { preference.widths = Array.from({ length: width }, (_, index) => columnWidth(index)); preference.widths.splice(index, 0, DEFAULT_COLUMN_WIDTH); persist(); }
    for (const row of data!.rows) {
      while (row.length < width) row.push({ value: "" });
      row.splice(index, 0, { value: "" });
    }
    columnIndex = index; write(); focusCell(rowIndex, columnIndex);
  }
  function deleteColumn() {
    if (tableWidth(data!) <= 1) { message.textContent = "Keep at least one column in the table."; return; }
    for (const row of data!.rows) if (columnIndex < row.length) row.splice(columnIndex, 1);
    if (preference.widths) { preference.widths.splice(columnIndex, 1); persist(); }
    if (preference.sortKinds) { preference.sortKinds.splice(columnIndex, 1); persist(); }
    columnIndex = Math.max(0, columnIndex - 1); write(); focusCell(rowIndex, columnIndex);
  }
  function move(to: number) {
    if (moveTableRow(data!, rowIndex, to, header.checked)) { rowIndex = to; write(); focusCell(rowIndex, columnIndex); }
  }
  toolbar.append(delimiter, headerLabel, undo, redo);
  host.append(toolbar, message, viewport);
  function setControls() {
    for (const control of toolbar.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>("button, select, input")) control.disabled = locked || !data;
    // Separator changes can repair a failed automatic interpretation.
    delimiter.disabled = locked;
    for (const control of head.querySelectorAll("button")) control.disabled = locked || !data;
    for (const input of host.querySelectorAll<HTMLTextAreaElement>("textarea")) input.readOnly = locked;
    for (const grip of host.querySelectorAll<HTMLButtonElement>(".file-editor-table-grip")) grip.draggable = !locked && !(header.checked && grip.closest("tr")?.dataset.row === "0");
  }
  function renderColumns() {
    closeMenu();
    if (!data) return;
    const width = tableWidth(data);
    clearColumnHandles(); head.replaceChildren(); columns.replaceChildren();
    const rowColumn = node("col"); rowColumn.style.width = "56px"; columns.append(rowColumn);
    const tr = node("tr"), rowHeading = node("th");
    const rowMenu = button("Row", () => {}); rowMenu.title = "Row actions";
    bindMenu(rowMenu, () => rowItems(Math.max(firstDataRow(), rowIndex)), true);
    rowHeading.append(rowMenu); tr.append(rowHeading);
    for (let index = 0; index < width; index++) {
      const label = header.checked ? data.rows[0]?.[index]?.value || `Column ${index + 1}` : `Column ${index + 1}`;
      const cell = node("th"); cell.scope = "col";
      bindMenu(cell, () => columnItems(index));
      const heading = node("div"); heading.className = "file-editor-table-heading";
      const choose = header.checked && data.rows.length ? createCell(0, index) : button(label, () => { columnIndex = index; focusCell(rowIndex, index); });
      choose.classList.add("file-editor-table-column-label");
      if (choose instanceof HTMLTextAreaElement) choose.placeholder = `Column ${index + 1}`;
      choose.title = `${choose.title || label}\nRight-click for column actions and sort comparison`;
      if (choose instanceof HTMLButtonElement) choose.disabled = locked;
      heading.append(choose);
      for (const descending of [false, true]) {
        const sort = button(descending ? "↓" : "↑", () => safely(() => {
          columnIndex = index;
          sortTable(data!, index, descending, preference.sortKinds?.[index] === "number", header.checked); write();
        }));
        const direction = descending ? "descending" : "ascending";
        sort.className = "file-editor-table-sort"; sort.disabled = locked;
        sort.dataset.sortColumn = String(index); sort.dataset.sortDirection = direction;
        sort.setAttribute("aria-label", `Sort ${label} ${direction}`);
        sort.title = `Sort ${label} ${direction}; changes the file order when saved`;
        heading.append(sort);
      }
      const handle = node("span"); handle.className = "file-editor-table-column-resize";
      handle.tabIndex = 0; handle.dataset.resizeColumn = String(index);
      handle.setAttribute("role", "separator"); handle.setAttribute("aria-orientation", "vertical");
      handle.setAttribute("aria-label", `Resize column ${index + 1}`);
      handle.setAttribute("aria-valuemin", String(MIN_COLUMN_WIDTH)); handle.setAttribute("aria-valuemax", String(MAX_COLUMN_WIDTH));
      handle.title = "Drag to resize column · Arrow Left/Right";
      let startWidth = columnWidth(index);
      resizeCleanups.push(attachPanePointerResize(handle, {
        canStart() { startWidth = columnWidth(index); return true; },
        onMove(event, origin) { resizeColumn(index, startWidth + event.clientX - origin.clientX); },
        onCommit: persist
      }));
      handle.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault(); resizeColumn(index, columnWidth(index) + (event.key === "ArrowRight" ? 16 : -16)); persist();
      });
      handle.addEventListener("dblclick", () => { resizeColumn(index, DEFAULT_COLUMN_WIDTH); persist(); });
      columns.append(node("col")); cell.append(heading, handle); tr.append(cell);
    }
    head.append(tr);
    applyWidths();
  }
  function cellAt(row: number, col: number) { return table.querySelector<HTMLTextAreaElement>(`textarea[data-row="${row}"][data-column="${col}"]`); }
  function cellUrl(value: string) {
    const url = value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return undefined;
    try { new URL(url); return url; } catch { return undefined; }
  }
  function updateCellLink(input: HTMLTextAreaElement) {
    const url = cellUrl(input.value);
    input.classList.toggle("file-editor-table-link", Boolean(url));
    input.title = url ? `${input.value}\nCtrl/Cmd+click to open link` : input.value;
  }
  function createCell(row: number, col: number) {
    const input = node("textarea"); input.rows = 1;
    input.dataset.row = String(row); input.dataset.column = String(col);
    input.setAttribute("aria-label", row < firstDataRow() ? `Header column ${col + 1}` : `Row ${row - firstDataRow() + 1}, column ${col + 1}`);
    input.value = data!.rows[row][col]?.value || ""; updateCellLink(input); input.readOnly = locked;
    input.spellcheck = false;
    input.addEventListener("click", event => {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const url = cellUrl(input.value);
      if (!url) return;
      event.preventDefault(); actions.openUrl(url);
    });
    input.addEventListener("focus", () => { rowIndex = row; columnIndex = col; body.querySelectorAll("tr.selected").forEach(element => element.classList.remove("selected")); if (row >= firstDataRow()) input.closest("tr")?.classList.add("selected"); });
    input.addEventListener("input", () => {
      if (locked || !data) return;
      while (data.rows[row].length <= col) data.rows[row].push({ value: "" });
      data.rows[row][col] = { value: input.value.replace(/\r\n|\r|\n/g, data.newline) }; updateCellLink(input);
      write(false);
      if (header.checked && row === 0) {
        const label = input.value || `Column ${col + 1}`;
        for (const sort of head.querySelectorAll<HTMLButtonElement>(`[data-sort-column="${col}"]`)) {
          sort.setAttribute("aria-label", `Sort ${label} ${sort.dataset.sortDirection}`);
          sort.title = `Sort ${label} ${sort.dataset.sortDirection}; changes the file order when saved`;
        }
      }
    });
    input.addEventListener("keydown", event => {
      if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); if (!locked) move(row + (event.key === "ArrowUp" ? -1 : 1)); }
      else if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); focusCell(row + 1, col); }
      else if (event.key === "Tab") {
        const next = col + (event.shiftKey ? -1 : 1), width = tableWidth(data!);
        const targetRow = row + (next < 0 ? -1 : next >= width ? 1 : 0);
        if (targetRow >= 0 && targetRow < data!.rows.length) { event.preventDefault(); focusCell(targetRow, (next + width) % width); }
      }
    });
    return input;
  }
  function focusCell(row: number, col: number) {
    if (!data || !data.rows.length) return;
    row = Math.max(0, Math.min(row, data.rows.length - 1)); col = Math.max(0, Math.min(col, tableWidth(data) - 1));
    if (!cellAt(row, col)) { viewport.scrollTop = (row - firstDataRow()) * ROW_HEIGHT; renderRows(true); }
    cellAt(row, col)?.focus();
  }
  function spacer(height: number) {
    const row = node("tr"), cell = node("td"); cell.colSpan = tableWidth(data!) + 1;
    row.className = "file-editor-table-spacer"; row.setAttribute("aria-hidden", "true");
    cell.style.height = `${height}px`; row.append(cell); return row;
  }
  function renderRows(force = false) {
    if (!data) return;
    const width = tableWidth(data);
    const offset = firstDataRow();
    const start = offset + Math.max(0, Math.min(Math.max(0, data.rows.length - offset - 1), Math.floor(viewport.scrollTop / ROW_HEIGHT) - 5));
    if (!force && start === windowStart) return;
    windowStart = start;
    const top = viewport.scrollTop, left = viewport.scrollLeft;
    const focused = document.activeElement instanceof HTMLTextAreaElement && body.contains(document.activeElement) ? document.activeElement : undefined;
    const selection = focused ? [focused.selectionStart, focused.selectionEnd] : undefined;
    const focusedRow = focused ? Number(focused.dataset.row) : -1, focusedColumn = focused ? Number(focused.dataset.column) : -1;
    body.replaceChildren(spacer((start - offset) * ROW_HEIGHT));
    const end = Math.min(data.rows.length, start + Math.max(PAGE_ROWS, Math.ceil(viewport.clientHeight / ROW_HEIGHT) + 10));
    table.setAttribute("aria-rowcount", String(data.rows.length - offset + 1));
    for (let row = start; row < end; row++) {
      const tr = node("tr"); tr.dataset.row = String(row); tr.setAttribute("aria-rowindex", String(row - offset + 2));
      tr.classList.toggle("selected", row === rowIndex);
      const number = node("th"); number.scope = "row";
      const grip = button(String(row - offset + 1), () => { rowIndex = row; renderRows(true); focusCell(row, columnIndex); });
      grip.className = "file-editor-table-grip"; grip.title = "Drag to move row · Alt+Arrow Up/Down · Right-click for row actions";
      bindMenu(grip, () => rowItems(row));
      grip.setAttribute("aria-label", `Select or move row ${row - offset + 1}`);
      grip.draggable = !locked && !(header.checked && row === 0);
      grip.addEventListener("dragstart", event => {
        if (!grip.draggable || !event.dataTransfer) { event.preventDefault(); return; }
        dragging = row; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(row));
      });
      grip.addEventListener("dragend", () => { dragging = undefined; body.querySelectorAll(".drop-target").forEach(element => element.classList.remove("drop-target")); });
      tr.addEventListener("dragover", event => {
        if (dragging === undefined || locked || (header.checked && row === 0)) return;
        event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; tr.classList.add("drop-target");
        // Allow dragging through a long virtualized table.
        const bounds = viewport.getBoundingClientRect();
        if (event.clientY > bounds.bottom - ROW_HEIGHT) viewport.scrollTop += ROW_HEIGHT;
        else if (event.clientY < bounds.top + ROW_HEIGHT) viewport.scrollTop -= ROW_HEIGHT;
      });
      tr.addEventListener("dragleave", () => tr.classList.remove("drop-target"));
      tr.addEventListener("drop", event => {
        if (dragging === undefined || locked) return;
        event.preventDefault(); rowIndex = dragging; dragging = undefined; move(row);
      });
      number.append(grip); tr.append(number);
      for (let col = 0; col < width; col++) {
        const td = node("td"), input = createCell(row, col);
        td.append(input); tr.append(td);
      }
      body.append(tr);
    }
    body.append(spacer(Math.max(0, data.rows.length - end) * ROW_HEIGHT));
    if (focused) {
      const input = cellAt(focusedRow, focusedColumn);
      if (input) { input.focus({ preventScroll: true }); if (selection) input.setSelectionRange(selection[0], selection[1]); }
    }
    // Replacing the rows temporarily shrinks the table and can clamp its scroll offsets.
    viewport.scrollTop = top; viewport.scrollLeft = left;
  }
  const scroll = () => { closeMenu(); renderRows(); }; viewport.addEventListener("scroll", scroll);
  const wheel = (event: WheelEvent) => {
    if (!(event.target instanceof HTMLTextAreaElement) || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? ROW_HEIGHT : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1;
    viewport.scrollLeft += (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * unit;
    if (!event.shiftKey) viewport.scrollTop += event.deltaY * unit;
  };
  viewport.addEventListener("wheel", wheel, { passive: false });
  const resize = new ResizeObserver(() => { closeMenu(); renderRows(true); }); resize.observe(viewport);
  function load() {
    closeMenu();
    safely(() => { data = parseTable(text, preference.delimiter || detectTableDelimiter(text, path)); rowIndex = Math.max(firstDataRow(), Math.min(rowIndex, data.rows.length - 1)); renderColumns(); renderRows(true); });
    if (!data) { clearColumnHandles(); columns.replaceChildren(); head.replaceChildren(); body.replaceChildren(); }
    setControls();
  }
  delimiter.addEventListener("change", () => {
    preference.delimiter = delimiter.value === "auto" ? undefined : delimiter.value as TableDelimiter;
    persist(); data = undefined; load();
  });
  header.addEventListener("change", () => { preference.header = header.checked; persist(); rowIndex = Math.max(firstDataRow(), rowIndex); viewport.scrollTop = 0; renderColumns(); renderRows(true); });
  host.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); actions.save(); }
    else if (key === "z" || key === "y") { event.preventDefault(); if (!locked && data) actions.history(key === "y" || event.shiftKey); }
  });
  return {
    update(nextText: string, nextPath: string, readonly: boolean, preferences?: TablePreferences) {
      locked = readonly; if (locked) closeMenu();
      if (path !== nextPath) {
        path = nextPath; preference = preferences || { header: true }; rowIndex = columnIndex = 0; viewport.scrollTop = viewport.scrollLeft = 0;
        delimiter.value = preference.delimiter || "auto"; header.checked = preference.header;
        text = nextText; data = undefined; load();
      } else if (text !== nextText) { text = nextText; data = undefined; load(); }
      setControls();
    },
    focus() { focusCell(rowIndex, columnIndex); },
    clear() { closeMenu(); clearColumnHandles(); path = text = ""; data = undefined; columns.replaceChildren(); head.replaceChildren(); body.replaceChildren(); },
    cleanup() { closeMenu(); clearColumnHandles(); resize.disconnect(); viewport.removeEventListener("scroll", scroll); viewport.removeEventListener("wheel", wheel); host.replaceChildren(); }
  };
}
