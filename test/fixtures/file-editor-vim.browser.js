import { EditorState, Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { getCM, Vim } from '@replit/codemirror-vim';
import { editorVim } from '../../src/plugins/file-editor/vim';

function check(condition, message) { if (!condition) throw new Error(message); }
const saved = [], errors = [], histories = [];
const compartment = new Compartment();
const owner = { save: () => saved.push('first'), error: (message) => errors.push(message) };
const first = new EditorView({ parent: document.body, state: EditorState.create({
  doc: 'alpha\nbeta', extensions: [compartment.of(editorVim(owner)), basicSetup]
}) });
const second = new EditorView({ parent: document.body, doc: 'second', extensions: [
  editorVim({ save: () => saved.push('second'), error: owner.error, history: (forward) => histories.push(forward) }), basicSetup
] });
const key = (view, value) => Vim.handleKey(getCM(view), value);
const ex = (view, value) => Vim.handleEx(getCM(view), value);
check(document.querySelector('.cm-vim-panel').textContent.includes('NORMAL'), 'Normal indicator');
first.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true, cancelable: true }));
check(first.state.selection.main.head === 6, 'Normal movement');
key(first, 'v');
check(document.querySelector('.cm-vim-panel').textContent.includes('VISUAL'), 'Visual indicator');
key(first, '<Esc>');
key(first, 'i');
check(document.querySelector('.cm-vim-panel').textContent.includes('INSERT'), 'Insert indicator');
first.dispatch({ changes: { from: first.state.selection.main.head, insert: 'draft ' } });
key(first, '<Esc>');
ex(first, 'w'); ex(second, 'write');
check(saved.join(',') === 'first,second', 'Save belongs to invoking pane');
ex(first, 'w elsewhere'); ex(first, 'w!'); ex(first, '1,2w');
check(errors.length === 3 && saved.length === 2, 'Unsupported writes must not save');
key(second, 'u'); key(second, '<C-r>'); ex(second, 'undo'); ex(second, 'redo');
check(histories.join(',') === 'false,true,false,true', 'Paged undo/redo uses shared history');
const draft = first.state.doc.toString();
const selection = first.state.selection.main.head;
first.dispatch({ effects: compartment.reconfigure([]) });
check(!getCM(first), 'Disabled adapter removed');
check(first.state.doc.toString() === draft && first.state.selection.main.head === selection, 'Toggle preserves draft and cursor');
first.dispatch({ effects: compartment.reconfigure(editorVim(owner)) });
key(first, 'u');
check(first.state.doc.toString() === 'alpha\nbeta', 'Toggle preserves undo history');
key(first, '<C-r>');
check(first.state.doc.toString() === draft, 'Standard Vim redo');
first.destroy(); second.destroy();

// Exercise the actual pane/header integration with an isolated file bridge.
let pane;
const paneSaves = [];
let diskText = "pane text";
window.BoatyardPluginRegistry = { register(_manifest, plugin) {
  plugin.activate({ status: { set() {} }, panes: { register(value) { pane = value; } } });
} };
window.boatyard = { invokePlugin: async (_plugin, action, payload) => {
  if (action === 'save') { paneSaves.push(payload); diskText = payload.text; return { path: payload.path, text: diskText, revision: 'two' }; }
  if (action === 'read' || action === 'readEditable') return {
    path: payload.path, text: diskText, revision: 'one', size: 9, mtimeMs: 1
  };
  if (action === 'gitStatus') return { available: false, entries: [] };
  if (action === 'gitBaseline') return { available: false };
  return null;
} };
await import('../../src/plugins/file-editor/renderer');
localStorage.clear();
const project = { id: 'vim-test', sourcePath: '/workspace/example' };
const paneKey = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:pane:test`;
localStorage.setItem(paneKey, 'example.txt');
const host = document.createElement('div'), header = document.createElement('div');
document.body.append(header, host);
const mount = () => {
  const cleanup = pane.render(host, { project, paneId: 'test' });
  const headerCleanup = pane.renderHeaderActions(header, { host });
  return () => { headerCleanup(); cleanup(); header.replaceChildren(); };
};
const settle = async () => { for (let i = 0; i < 100 && !host.querySelector('.cm-editor'); i++) await new Promise(r => setTimeout(r, 10)); };
let cleanup = mount();
await settle();
check(host.querySelector('.cm-editor'), 'Pane opens text fixture');
let toggle = header.querySelector('.file-editor-vim-button');
check(toggle.textContent === 'Vi' && toggle.getAttribute('aria-pressed') === 'false', 'Pane toolbar defaults to standard editing');
toggle.click();
check(toggle.getAttribute('aria-pressed') === 'true' && host.querySelector('.cm-vim-panel'), 'Pane toolbar enables Vim');
check(localStorage.getItem(`${paneKey}:vim`) === 'true', 'Preference stored');
const paneView = EditorView.findFromDOM(host.querySelector('.cm-content'));
paneView.dispatch({ changes: { from: 0, insert: 'draft ' } });
ex(paneView, 'w');
await new Promise(r => setTimeout(r, 0));
check(paneSaves.length === 1 && paneSaves[0].text === 'draft pane text' && paneSaves[0].revision === 'one', ':w uses revision-checked pane save');
paneView.dispatch({ changes: { from: 0, insert: 'more ' } });
paneView.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true }));
await new Promise(r => setTimeout(r, 0));
check(paneSaves.length === 2 && paneSaves[1].text === 'more draft pane text', 'Ctrl+S remains available in Vim mode');
cleanup(); cleanup = mount(); await settle();
toggle = header.querySelector('.file-editor-vim-button');
check(toggle.getAttribute('aria-pressed') === 'true' && host.querySelector('.cm-vim-panel'), 'Vim restored after remount');
toggle.click();
check(!host.querySelector('.cm-vim-panel'), 'Pane toolbar returns to standard editing');
cleanup();
window.vimTestResult = 'passed';
