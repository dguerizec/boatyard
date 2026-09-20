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
let pane, settingsSection;
let globalPluginConfig = {};
const paneSaves = [];
let diskText = "pane text";
let diskRevision = "one";
let saveError = "";
let saveWait;
window.BoatyardPluginRegistry = { register(_manifest, plugin) {
  plugin.activate({ settings: { registerGlobalSection(section) { settingsSection = section; } }, status: { set() {} }, panes: { register(value) { pane = value; } } });
} };
window.boatyard = { invokePlugin: async (_plugin, action, payload) => {
  if (action === 'save') {
    paneSaves.push(payload);
    if (saveWait) await saveWait;
    if (saveError) throw new Error(saveError);
    diskText = payload.text; diskRevision = 'two';
    return { path: payload.path, text: diskText, revision: diskRevision };
  }
  if (action === 'read' || action === 'readEditable') return {
    path: payload.path, text: diskText, revision: diskRevision, size: 9, mtimeMs: 1
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
  const cleanup = pane.render(host, { project, paneId: 'test', globalPluginConfig });
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

check(settingsSection.id === 'boatyard.fileEditor.global', 'File Editor global settings registered');
check(settingsSection.fields.find(field => field.key === 'vimByDefault').defaultValue === 'disabled', 'Vim default is opt-in');
localStorage.removeItem(`${paneKey}:vim`);
globalPluginConfig = { vimByDefault: 'enabled' };
cleanup = mount(); await settle();
toggle = header.querySelector('.file-editor-vim-button');
check(toggle.getAttribute('aria-pressed') === 'true' && host.querySelector('.cm-vim-panel'), 'Plugin default enables Vim in a pane without override');
check(localStorage.getItem(`${paneKey}:vim`) === null, 'Using default does not create a pane override');
toggle.click(); cleanup();
cleanup = mount(); await settle();
check(!host.querySelector('.cm-vim-panel'), 'Explicit standard mode overrides enabled plugin default');
header.querySelector('.file-editor-vim-button').click(); cleanup();
globalPluginConfig = { vimByDefault: 'disabled' };
cleanup = mount(); await settle();
check(host.querySelector('.cm-vim-panel'), 'Explicit Vim mode overrides disabled plugin default');
cleanup();
localStorage.removeItem(`${paneKey}:vim`);
cleanup = mount(); await settle();
check(!host.querySelector('.cm-vim-panel'), 'Pane without override follows changed plugin default');
cleanup();

const tick = () => new Promise(r => setTimeout(r, 0));
const currentView = () => EditorView.findFromDOM(host.querySelector('.cm-content'));
const openScenario = async (path, paths = [path]) => {
  localStorage.setItem(paneKey, path);
  localStorage.setItem(`${paneKey}:tabs`, JSON.stringify(paths));
  localStorage.setItem(`${paneKey}:vim`, 'true');
  cleanup = mount(); await settle();
  check(host.querySelector('.cm-editor'), 'Scenario opens editor');
};
await openScenario('quit.txt');
let target = currentView();
target.dispatch({ changes: { from: 0, insert: 'unsaved ' } });
const savesBeforeQuit = paneSaves.length;
ex(target, 'q'); await tick();
check(host.querySelector('.cm-editor') && host.textContent.includes('Unsaved changes.'), ':q refuses dirty tabs');
check(!document.querySelector('dialog') && paneSaves.length === savesBeforeQuit, ':q neither prompts nor saves');
for (const command of ['q other.txt', 'wq!', '1,2q', '1,2wq']) { ex(target, command); await tick(); }
check(host.querySelector('.cm-editor') && paneSaves.length === savesBeforeQuit, 'Unsupported close arguments leave tab intact');
ex(target, 'q!'); await tick();
check(!host.querySelector('.cm-editor') && paneSaves.length === savesBeforeQuit, ':q! discards and closes without saving');
check(!Object.values(localStorage).some(value => value.includes('unsaved ')), ':q! removes the discarded draft');
cleanup();

await openScenario('write-quit.txt');
target = currentView();
target.dispatch({ changes: { from: 0, insert: 'save me ' } });
saveError = 'Simulated save failure';
ex(target, 'wq'); await tick();
check(host.querySelector('.cm-editor') && host.textContent.includes(saveError), ':wq keeps failed save open');
check(target.state.doc.toString().startsWith('save me '), ':wq keeps failed draft');
saveError = '';
let releaseSave;
saveWait = new Promise(resolve => { releaseSave = resolve; });
ex(target, 'wq'); await tick();
check(host.querySelector('.cm-editor'), ':wq waits for save completion');
target.dispatch({ changes: { from: 0, insert: 'newer ' } });
releaseSave(); await tick(); saveWait = undefined;
check(host.querySelector('.cm-editor') && target.state.doc.toString().startsWith('newer '), ':wq preserves edits made during save');
ex(target, 'wq'); await tick();
check(!host.querySelector('.cm-editor') && diskText.startsWith('newer save me '), ':wq closes after successful save');
cleanup();

await openScenario('conflict.txt');
target = currentView();
target.dispatch({ changes: { from: 0, insert: 'local conflict ' } });
diskText = 'external change'; diskRevision = 'external';
window.dispatchEvent(new Event('focus')); await tick();
const savesBeforeConflict = paneSaves.length;
ex(target, 'wq'); await tick();
check(host.querySelector('.cm-editor') && paneSaves.length === savesBeforeConflict, ':wq refuses disk conflicts without writing');
check(target.state.doc.toString().startsWith('local conflict '), 'Conflict retains draft');
ex(target, 'q!'); await tick(); cleanup();

await openScenario('first.txt', ['first.txt', 'next.txt']);
ex(currentView(), 'quit'); await tick();
check(host.querySelectorAll('[role=tab]').length === 1 && host.textContent.includes('next.txt'), ':quit closes only current tab and selects neighbor');
ex(currentView(), 'q'); await tick();
check(!host.querySelector('.cm-editor') && host.isConnected, 'Last :q leaves pane open and empty');
cleanup();
window.browserTestResult = 'passed';
