import { EditorView } from '@codemirror/view';
import '../../src/renderer/styles.css';
import '../../src/plugins/file-editor/style.css';

function check(condition, message) { if (!condition) throw new Error(message); }
const waitFor = async (condition, message) => {
  for (let i = 0; i < 150; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error(message);
};
let pane;
window.BoatyardPluginRegistry = { register(_manifest, plugin) {
  plugin.activate({ settings: { registerGlobalSection() {} }, status: { set() {} }, panes: { register(value) { pane = value; } } });
} };
const original = '\uFEFFname;value;note\r\n"Bob";010;"a; b"\r\nAda;2;"two\r\nlines"\r\n';
let diskText = original, revision = 'one';
const saves = [];
window.boatyard = { invokePlugin: async (_plugin, action, payload) => {
  if (action === 'read') return { path: payload.path, text: diskText, revision };
  if (action === 'save') { saves.push(payload); diskText = payload.text; revision = 'two'; return { path: payload.path, text: diskText, revision }; }
  if (action === 'gitStatus') return { available: false, entries: [] };
  if (action === 'gitBaseline') return { available: false };
  return null;
} };
await import('../../src/plugins/file-editor/renderer');
localStorage.clear();
const project = { id: 'table-test', sourcePath: '/workspace/example' };
const prefix = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:`;
const key = `${prefix}pane:test`;
const openedUrls = [];
localStorage.setItem(key, 'example.csv');
const host = document.createElement('div'), header = document.createElement('div');
host.style.cssText = 'width: 950px; height: 680px;'; document.body.append(header, host);
function mount() {
  const cleanup = pane.render(host, { project, paneId: 'test', openUrl: url => openedUrls.push(url) });
  const cleanHeader = pane.renderHeaderActions(header, { host });
  return () => { cleanHeader(); cleanup(); header.replaceChildren(); };
}
let cleanup = mount();
const table = () => host.querySelector('.file-editor-table');
const cell = (row, col) => table().querySelector(`textarea[data-row="${row}"][data-column="${col}"]`);
// Hidden Electron windows update activeElement without firing native focus events.
const selectCell = (row, col) => { cell(row, col).focus(); cell(row, col).dispatchEvent(new Event('focus')); };
const action = label => Array.from(table().querySelectorAll('button')).find(button => button.textContent === label);
const openMenu = target => {
  const bounds = target.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: bounds.x + 10, clientY: bounds.y + 10 }));
  return table().querySelector('[role="menu"]');
};
const menuAction = (target, label) => {
  const menu = openMenu(target);
  const item = Array.from(menu.querySelectorAll('button')).find(button => button.textContent === label);
  check(item && !item.disabled, `Menu action ${label} is available`); item.click();
};
const rowTarget = row => table().querySelector(`tr[data-row="${row}"] .file-editor-table-grip`) || table().querySelector('thead th:first-child button');
const columnTarget = col => table().querySelectorAll('thead th')[col + 1];
const current = () => EditorView.findFromDOM(host.querySelector('.cm-editor'));
const text = () => JSON.parse(localStorage.getItem(`${prefix}draft:example.csv`) || 'null')?.text || diskText;
await waitFor(() => cell(1, 0), 'CSV opens as a table');
check(!table().hidden && host.querySelector('.file-editor-body').hidden, 'Table is visible instead of Text');
check(cell(1, 1).value === '010' && cell(2, 2).value === 'two\r\nlines'.replace(/\r\n/g, '\n'), 'Table retains numeric strings and multiline values');
check(!table().querySelector('tbody tr[data-row="0"]') && cell(0, 0).closest('thead'), 'Header record appears only in the column headings');
check(table().querySelector('.file-editor-table-grip').textContent === '1' && cell(1, 0).getAttribute('aria-label') === 'Row 1, column 1', 'Data numbering and accessibility labels begin at one');
cell(0, 0).value = 'Company'; cell(0, 0).dispatchEvent(new Event('input', { bubbles: true }));
check(text().startsWith('\uFEFFCompany;') && table().querySelector('[aria-label="Sort Company ascending"]'), 'Integrated headers remain editable and update sort labels');
action('Undo').click();
check(text() === original && cell(0, 0).value === 'name', 'Header editing is undoable without duplicating the record');
check(!table().querySelector('thead .file-editor-table-grip'), 'The integrated header has no data-row deletion target');
// Let the initial pane layout and its ResizeObserver settle before native input.
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
let firstGrip = rowTarget(1); firstGrip.focus();
const gripBounds = firstGrip.getBoundingClientRect();
await window.tableTestInput.send([
  { type: 'mouseMove', x: Math.round(gripBounds.x + 20), y: Math.round(gripBounds.y + 15) },
  { type: 'mouseDown', x: Math.round(gripBounds.x + 20), y: Math.round(gripBounds.y + 15), button: 'right', clickCount: 1 },
  { type: 'mouseUp', x: Math.round(gripBounds.x + 20), y: Math.round(gripBounds.y + 15), button: 'right', clickCount: 1 }
]);
check(table().querySelector('[role="menu"]'), 'A native right-click opens the row context menu');
table().querySelector('[role="menu"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
firstGrip = rowTarget(1);
firstGrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
const keyboardMenu = table().querySelector('[role="menu"]');
check(keyboardMenu && document.activeElement.textContent === 'Add row', 'Shift+F10 opens the context menu with keyboard focus');
keyboardMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
check(document.activeElement.textContent === 'Insert row', 'Arrow keys navigate menu items');
keyboardMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
check(!table().querySelector('[role="menu"]') && document.activeElement === firstGrip && text() === original, 'Escape closes the menu and restores focus without editing');
const paneBounds = table().getBoundingClientRect();
columnTarget(2).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: paneBounds.right, clientY: paneBounds.bottom }));
const edgeMenu = table().querySelector('[role="menu"]'), menuBounds = edgeMenu.getBoundingClientRect();
check(menuBounds.right <= paneBounds.right + 1 && menuBounds.bottom <= paneBounds.bottom + 1, 'Context menus stay inside the file editor pane');
document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
check(!table().querySelector('[role="menu"]'), 'Clicking outside dismisses the context menu');
const linkCell = cell(1, 2), url = 'https://example.com/maps?q=ACB&view=table';
linkCell.value = url; linkCell.dispatchEvent(new Event('input', { bubbles: true }));
check(linkCell.classList.contains('file-editor-table-link'), 'URL cells advertise Ctrl/Cmd+click');
const linkDraft = text();
linkCell.click(); await Promise.resolve();
check(openedUrls.length === 0, 'Normal clicks retain cell editing without opening links');
linkCell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
await waitFor(() => openedUrls.length === 1, 'Ctrl+click routes the URL through the pane link gate');
linkCell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
await waitFor(() => openedUrls.length === 2, 'Cmd+click uses the same link gate');
check(openedUrls.every(value => value === url) && text() === linkDraft, 'Opening links preserves the URL and document');
for (const value of ['javascript:alert(1)', 'file:///workspace/example', 'https://', 'https://example.com and more text']) {
  linkCell.value = value; linkCell.dispatchEvent(new Event('input', { bubbles: true }));
  linkCell.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await Promise.resolve();
  check(!linkCell.classList.contains('file-editor-table-link') && openedUrls.length === 2, 'Invalid or non-HTTP URL cells cannot open links');
}
for (let index = 0; index < 5; index++) action('Undo').click();
check(text() === original, 'Link activation and editing retain exact undo recovery');
const value = cell(1, 1); value.focus(); value.value = '00123'; value.dispatchEvent(new Event('input', { bubbles: true }));
check(text().includes('"Bob";00123;"a; b"') && text().startsWith('\uFEFF'), 'Editing preserves unmodified quotes and BOM');
check(table().querySelector('.file-editor-table-actions').querySelectorAll('button').length === 2 && !table().querySelector('.file-editor-table-actions [aria-label="Sort column"]') && table().querySelectorAll('thead .file-editor-table-sort').length === 6, 'Sort controls live in each column header');
menuAction(columnTarget(1), 'Sort as number');
table().querySelector('thead [data-sort-column="1"][data-sort-direction="ascending"]').click();
check(cell(0, 0).value === 'name' && cell(1, 0).value === 'Ada', 'Numeric sorting protects the header and changes rows');
action('Undo').click();
check(cell(1, 0).value === 'Bob' && cell(1, 1).value === '00123', 'One undo reverses the sort only');
menuAction(columnTarget(0), 'Sort as number');
table().querySelector('thead [data-sort-column="0"][data-sort-direction="descending"]').click();
check(table().querySelector('.file-editor-table-message').textContent && cell(1, 0).value === 'Bob', 'Invalid numeric header sort retains the data');
menuAction(columnTarget(0), 'Sort as text');
table().querySelector('thead [data-sort-column="0"][data-sort-direction="ascending"]').click();
check(cell(1, 0).value === 'Ada', 'Header arrows sort their own column rather than the selected cell');
table().querySelector('thead [data-sort-column="0"][data-sort-direction="descending"]').click();
check(cell(1, 0).value === 'Bob' && cell(0, 0).value === 'name', 'Descending header sorting protects the header');
action('Undo').click(); action('Undo').click();
action('Undo').click();
check(text() === original, 'Undo restores exact source with BOM, quotes and CRLF');
action('Redo').click();
check(cell(1, 1).value === '00123', 'Redo restores a table edit');
const grips = table().querySelectorAll('.file-editor-table-grip');
check(grips.length === 2 && grips[0].textContent === '1' && grips[1].textContent === '2' && grips[0].draggable, 'Only data rows are numbered and draggable');
const transfer = new DataTransfer();
grips[1].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
table().querySelector('tr[data-row="1"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
check(cell(1, 0).value === 'Ada' && cell(2, 0).value === 'Bob', 'Drag and drop changes the file order');
action('Undo').click();
check(cell(1, 0).value === 'Bob', 'Row movement is undoable');
selectCell(2, 0); menuAction(rowTarget(1), 'Add row');
check(cell(2, 0).value === '', 'Add row targets the right-clicked row and inserts after it');
action('Undo').click();
menuAction(rowTarget(1), 'Insert row');
check(cell(1, 0).value === '' && cell(2, 0).value === 'Bob', 'Insert row inserts before the right-clicked row');
action('Undo').click();
selectCell(2, 0); menuAction(rowTarget(1), 'Delete row');
check(cell(1, 0).value === 'Ada' && !cell(2, 0), 'Delete row targets the right-clicked row');
action('Undo').click();
selectCell(1, 0); menuAction(columnTarget(1), 'Add column');
check(cell(1, 2).value === '' && cell(1, 3).value === 'a; b', 'Add column inserts after the right-clicked column');
action('Undo').click();
menuAction(columnTarget(1), 'Insert column');
check(cell(1, 1).value === '' && cell(1, 2).value === '00123', 'Insert column inserts before the right-clicked column');
action('Undo').click();
selectCell(1, 0); menuAction(columnTarget(1), 'Delete column');
check(cell(1, 1).value === 'a; b', 'Deleting the selected column retains other fields');
action('Undo').click();
header.querySelector('.file-editor-table-button').click();
check(table().hidden && !host.querySelector('.file-editor-body').hidden, 'Table toggle reveals Text mode');
check(current().state.sliceDoc().includes('00123'), 'Text mode contains the table draft');
header.querySelector('.file-editor-table-button').click();
check(!table().hidden && cell(1, 1).value === '00123', 'Returning to Table retains the draft');
const resizeHandle = table().querySelector('[data-resize-column="0"]');
const originalWidth = cell(1, 0).getBoundingClientRect().width;
const neighborWidth = cell(1, 1).getBoundingClientRect().width;
const resizeBounds = resizeHandle.getBoundingClientRect();
const resizeX = Math.round(resizeBounds.x + resizeBounds.width / 2), resizeY = Math.round(resizeBounds.y + resizeBounds.height / 2);
await window.tableTestInput.send([
  { type: 'mouseMove', x: resizeX, y: resizeY },
  { type: 'mouseDown', x: resizeX, y: resizeY, button: 'left', clickCount: 1 },
  { type: 'mouseMove', x: resizeX + 80, y: resizeY },
  { type: 'mouseUp', x: resizeX + 80, y: resizeY, button: 'left', clickCount: 1 }
]);
check(Math.abs(cell(1, 0).getBoundingClientRect().width - originalWidth - 80) < 2, 'Native header dragging resizes its column');
check(Math.abs(cell(1, 1).getBoundingClientRect().width - neighborWidth) < 2, 'Column resizing preserves adjacent widths');
resizeHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
const resizedWidth = cell(1, 0).getBoundingClientRect().width;
check(Math.abs(resizedWidth - originalWidth - 96) < 2, 'Column resize supports keyboard arrows');
menuAction(columnTarget(1), 'Sort as number');
const draft = text(); cleanup(); cleanup = mount();
await waitFor(() => cell(1, 1)?.value === '00123', 'Remount restores table and draft');
check(Math.abs(cell(1, 0).getBoundingClientRect().width - resizedWidth) < 2, 'Column widths survive remounting');
check(text() === draft, 'Resizing columns leaves the document unchanged');
const restoredMenu = openMenu(columnTarget(1));
check(Array.from(restoredMenu.querySelectorAll('[role="menuitemradio"]')).find(item => item.textContent === 'Sort as number').getAttribute('aria-checked') === 'true', 'Per-column numeric sorting survives remounting');
restoredMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
host.querySelector('[aria-label="Save"]').click();
await waitFor(() => saves.length === 1 && !localStorage.getItem(`${prefix}draft:example.csv`), 'Table saves through the existing document access');
check(saves[0].text === draft && saves[0].revision === 'one', 'Save uses the protected revision and exact draft');

// A background conflict keeps the table draft, including focused edits.
selectCell(1, 0); cell(1, 0).value = 'Draft'; cell(1, 0).dispatchEvent(new Event('input', { bubbles: true }));
diskText = original.replace('Ada', 'Disk'); revision = 'external';
window.dispatchEvent(new Event('focus'));
await waitFor(() => !host.querySelector('.file-editor-compare').hidden, 'External changes expose a conflict');
check(cell(1, 0).value === 'Draft' && host.querySelector('[aria-label="Save"]').disabled, 'Conflict retains the draft and blocks saving');
cleanup();

// Long tables render a bounded set of rows, including when scrolled to the end.
diskText = 'name,value\n' + Array.from({ length: 3000 }, (_, index) => `row${index},${index}`).join('\n'); revision = 'long';
localStorage.clear(); localStorage.setItem(`${prefix}pane:long`, 'long.csv');
const longCleanup = pane.render(host, { project, paneId: 'long' });
await waitFor(() => table().querySelector('textarea'), 'Long table opens');
check(table().querySelectorAll('tbody textarea').length <= 120, 'Long table has bounded cell DOM');
const viewport = table().querySelector('.file-editor-table-viewport');
cell(1, 0).focus();
const wheelBounds = cell(1, 0).getBoundingClientRect();
await window.tableTestInput.send([{ type: 'mouseWheel', x: Math.round(wheelBounds.x + 20), y: Math.round(wheelBounds.y + 15), deltaY: -144, deltaX: 0 }]);
check(viewport.scrollTop >= 100, 'Native wheel over a cell scrolls the table');
const firstScroll = viewport.scrollTop;
await window.tableTestInput.send([{ type: 'mouseWheel', x: Math.round(wheelBounds.x + 20), y: Math.round(wheelBounds.y + 15), deltaY: -144, deltaX: 0 }]);
check(viewport.scrollTop > firstScroll, 'Repeated native wheel scrolling is not reset by virtualization');
const wideHandle = table().querySelector('[data-resize-column="0"]');
for (let index = 0; index < 55; index++) wideHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
check(viewport.scrollWidth > viewport.clientWidth, 'Wide columns create horizontal overflow');
await window.tableTestInput.send([{ type: 'mouseWheel', x: Math.round(wheelBounds.x + 20), y: Math.round(wheelBounds.y + 15), deltaY: 0, deltaX: -144 }]);
check(viewport.scrollLeft >= 100, 'Native horizontal wheel over a cell scrolls the grid');
viewport.scrollTop = viewport.scrollHeight;
await waitFor(() => table().querySelector('textarea[data-row="3000"]'), 'Virtualized table can reach its last row');
check(table().querySelector('tr[data-row="3000"] .file-editor-table-grip').textContent === '3000', 'Last data row keeps its data number after virtualization');
check(viewport.clientHeight > 0 && table().querySelectorAll('tbody textarea').length <= 120, 'Grid fits the pane and remains bounded');
longCleanup();

// Explicit separators and header choices never rewrite the file by themselves.
diskText = 'name;value\r\n"Bob";010\nAda;2\r'; revision = 'mixed';
localStorage.clear(); localStorage.setItem(`${prefix}pane:mixed`, 'mixed.csv');
const mixedCleanup = pane.render(host, { project, paneId: 'mixed' });
await waitFor(() => cell(1, 1), 'Mixed-line-ending table opens');
const separator = table().querySelector('[aria-label="Field separator"]');
separator.value = ','; separator.dispatchEvent(new Event('change'));
check(table().querySelector('.file-editor-table-message').textContent && !table().querySelector('textarea'), 'Wrong separator reports a parse error');
separator.value = ';'; separator.dispatchEvent(new Event('change'));
check(cell(1, 1).value === '010', 'Choosing the correct separator recovers without losing source');
const headerOption = table().querySelector('input[type="checkbox"]');
headerOption.checked = false; headerOption.dispatchEvent(new Event('change'));
check(cell(0, 0).closest('tbody') && table().querySelector('.file-editor-table-grip').textContent === '1', 'Without headers every record is data, numbered from one');
check(!localStorage.getItem(`${prefix}draft:mixed.csv`), 'Changing header visibility does not edit the file');
headerOption.checked = true; headerOption.dispatchEvent(new Event('change'));
check(!table().querySelector('tbody tr[data-row="0"]') && table().querySelector('.file-editor-table-grip').textContent === '1', 'Restoring headers integrates them and renumbers data');
headerOption.checked = false; headerOption.dispatchEvent(new Event('change'));
const mixedOriginal = diskText;
cell(1, 1).value = '009'; cell(1, 1).dispatchEvent(new Event('input', { bubbles: true }));
check(JSON.parse(localStorage.getItem(`${prefix}draft:mixed.csv`)).text === mixedOriginal.replace('010', '009'), 'Cell edit preserves mixed record endings');
action('Undo').click();
check(!localStorage.getItem(`${prefix}draft:mixed.csv`), 'Undo restores exact mixed-line-ending source');
mixedCleanup();

diskText = ''; revision = 'empty';
localStorage.clear(); localStorage.setItem(`${prefix}pane:empty`, 'empty.csv');
const emptyCleanup = pane.render(host, { project, paneId: 'empty' });
await waitFor(() => host.querySelector('.cm-editor'), 'Empty CSV opens');
const emptyHeader = table().querySelector('input[type="checkbox"]');
emptyHeader.checked = false; emptyHeader.dispatchEvent(new Event('change'));
menuAction(rowTarget(1), 'Add row');
check(cell(0, 0) && JSON.parse(localStorage.getItem(`${prefix}draft:empty.csv`)).text === '""', 'An empty file can gain a real empty record');
action('Undo').click();
check(!localStorage.getItem(`${prefix}draft:empty.csv`), 'Undo restores an empty file');
emptyHeader.checked = true; emptyHeader.dispatchEvent(new Event('change'));
menuAction(rowTarget(1), 'Add row');
check(cell(0, 0).closest('thead') && cell(1, 0).closest('tbody') && table().querySelector('.file-editor-table-grip').textContent === '1', 'Adding to an empty table with headers creates a visible first data row');
menuAction(rowTarget(1), 'Delete row');
check(!table().querySelector('tbody textarea') && cell(0, 0).closest('thead'), 'Deleting the last data row retains the integrated header');
menuAction(rowTarget(1), 'Add row');
check(cell(1, 0) && table().querySelector('.file-editor-table-grip').textContent === '1', 'A header-only table can gain its first data row');
emptyCleanup();
window.browserTestResult = 'passed';
