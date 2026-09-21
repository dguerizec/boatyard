import { EditorView } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';
import '../../src/renderer/styles.css';
import '../../src/plugins/file-editor/style.css';

window.addEventListener('error', event => console.log(event.error?.stack));
window.addEventListener('unhandledrejection', event => console.log(event.reason?.stack));
function check(condition, message) { if (!condition) throw new Error(message); }
const waitFor = async (condition, message) => {
  for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 15)); }
  throw new Error(message);
};
let pane;
window.BoatyardPluginRegistry = { register(_manifest, plugin) {
  plugin.activate({ settings: { registerGlobalSection() {} }, status: { set() {} }, panes: { register(value) { pane = value; } } });
} };
const parts = ['INFO alpha\none\nprefix AB', 'CD suffix\ntarget\nmiddle\n', 'last\nomega target\n'];
let offset = 0, line = 1;
const positions = parts.map((text, i) => {
  const value = { offset, length: text.length, line, continuation: i > 0 && !parts[i - 1].endsWith('\n'),
    characterOffset: offset, characters: text.length, utf16Offset: offset, utf16Units: text.length, lineBreaks: text.split('\n').length - 1 };
  offset += text.length; line += value.lineBreaks; return value;
});
const read = (block = 0) => ({ path: 'large.log', revision: 'one', text: parts[block], block: {
  ...positions[block], index: block, count: parts.length, size: offset, totalCharacters: offset, totalUtf16Units: offset,
  totalLines: line, positions, blockBytes: 64
} });
window.boatyard = { invokePlugin: async (_plugin, action, payload) => {
  if (action === 'read') return read(payload.block);
  if (action === 'gitBaseline') return { available: false, reason: 'fixture' };
  if (action === 'gitStatus') return { available: true, changes: [] };
  return null;
} };
await import('../../src/plugins/file-editor/renderer');
localStorage.clear();
const project = { id: 'paged-test', sourcePath: '/workspace/example' };
const key = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:pane:test`;
localStorage.setItem(key, 'large.log'); localStorage.setItem(`${key}:vim`, 'true');
const host = document.createElement('div'), header = document.createElement('div');
host.style.cssText = 'position:fixed;left:0;top:40px;width:1100px;height:480px';
document.body.append(header, host);
const cleanup = pane.render(host, { project, paneId: 'test' });
const cleanHeader = pane.renderHeaderActions(header, { host });
const current = () => host.querySelector('.cm-content') && EditorView.findFromDOM(host.querySelector('.cm-content'));
const keys = (...keys) => { const cm = getCM(current()); keys.forEach(key => Vim.handleKey(cm, key, 'user')); };
await waitFor(() => current(), 'Initial block loads');
keys('6', 'G');
await waitFor(() => current()?.state.doc.toString() === parts[2], '6G crosses blocks');
check(current().state.doc.lineAt(current().state.selection.main.head).number === 1, '6G selects logical line six');
keys('g', 'g');
await waitFor(() => current()?.state.doc.toString() === parts[0], 'gg returns to first line');
keys('5', '<CR>');
await waitFor(() => current()?.state.doc.toString() === parts[2], 'Counted Enter crosses blocks relatively');
Vim.handleEx(getCM(current()), '4');
await waitFor(() => current()?.state.doc.toString() === parts[1], ':4 crosses blocks');
check(current().state.doc.lineAt(current().state.selection.main.head).text === 'target', ':4 reaches the indexed line');
keys('g', 'g');
await waitFor(() => current()?.state.doc.toString() === parts[0], 'Return before editing');
current().dispatch({ changes: { from: 0, insert: 'draft\n' } });
keys('7', 'G');
await waitFor(() => current()?.state.doc.toString() === parts[2], 'Global lines include draft insertions');
keys('g', 'g');
await waitFor(() => current()?.state.doc.toString().startsWith('draft'), 'Draft survives block navigation');
current().contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
check(!host.querySelector('.file-editor-paged-search').hidden, 'Ctrl+F opens whole-file Find in Vim mode');
const query = host.querySelector('[aria-label="Find in entire file"]');
query.value = 'ABCD'; query.dispatchEvent(new Event('input'));
query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await waitFor(() => host.querySelector('.file-editor-paged-search [role="status"]').textContent.includes('continues'), 'Find locates a boundary-spanning occurrence');
check(current().state.sliceDoc(current().state.selection.main.from, current().state.selection.main.to) === 'AB', 'Visible part of the occurrence is selected');
query.value = 'target'; query.dispatchEvent(new Event('input'));
query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await waitFor(() => current()?.state.doc.toString() === parts[1], 'Find loads another block');
query.value = 'draft'; query.dispatchEvent(new Event('input'));
query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await waitFor(() => current()?.state.doc.toString().startsWith('draft') && current()?.state.selection.main.to === 5, 'Find includes unsaved content and wraps');
query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
keys('<Esc>', '/');
check(!host.querySelector('.file-editor-paged-search').hidden, 'Vim / opens whole-file search');
query.value = 'target'; query.dispatchEvent(new Event('input'));
query.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await waitFor(() => current()?.state.doc.toString() === parts[1] && document.activeElement === current()?.contentDOM, 'Vim search restores editor focus');
keys('n');
await waitFor(() => current()?.state.doc.toString() === parts[2], 'Vim n advances to the next global occurrence');
keys('N');
await waitFor(() => current()?.state.doc.toString() === parts[1], 'Vim N returns to the previous global occurrence');
// The current draft adds six bytes before the physical block boundary.
header.querySelector('[aria-label="Hex editor"]').click();
const boundary = parts[0].length + 6;
await waitFor(() => host.querySelector(`input[data-offset="${boundary - 1}"]`), 'Hex renders the boundary');
const byte = host.querySelector(`input[data-offset="${boundary - 1}"]`);
const clipboardData = new DataTransfer(); clipboardData.setData('text', '31 32 33 34');
byte.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
await waitFor(() => host.querySelector(`input[data-offset="${boundary - 1}"]`)?.value === '31' && host.querySelector(`input[data-offset="${boundary + 2}"]`)?.value === '34', 'Hex paste crosses the hidden boundary');
[...host.querySelectorAll('.file-editor-hex button')].find(button => button.textContent === 'Undo').click();
await waitFor(() => host.querySelector(`input[data-offset="${boundary - 1}"]`)?.value === '42' && host.querySelector(`input[data-offset="${boundary}"]`)?.value === '43', 'One undo restores both sides of the boundary');
cleanup(); cleanHeader();
window.browserTestResult = 'passed';
