import { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { getSearchQuery, openSearchPanel, SearchQuery, searchPanelOpen, setSearchQuery } from '@codemirror/search';
import { getCM, Vim } from '@replit/codemirror-vim';
import '../../src/renderer/styles.css';
import '../../src/plugins/file-editor/style.css';

window.addEventListener('error', event => console.log(event.error?.stack));
window.addEventListener('unhandledrejection', event => console.log(event.reason?.stack));
function check(condition, message) { if (!condition) throw new Error(message); }
const waitFor = async (condition, message) => {
  for (let i = 0; i < 150; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error(message);
};
let pane;
window.BoatyardPluginRegistry = { register(_manifest, plugin) {
  plugin.activate({ settings: { registerGlobalSection() {} }, status: { set() {} }, panes: { register(value) { pane = value; } } });
} };
const originalLines = Array.from({ length: 120 }, (_, i) => `key${i} = ${i}`);
const currentLines = [...originalLines]; currentLines.splice(5, 2); currentLines[60] = 'key62 = 900';
let diskText = '\uFEFF' + currentLines.join('\r\n');
let revision = 'one';
let baselineText = '\uFEFF' + originalLines.join('\r\n');
const saves = [];
window.boatyard = { invokePlugin: async (_plugin, action, payload) => {
  if (action === 'read') return { path: payload.path, text: payload.path === 'plain.txt' ? 'plain' : diskText, revision };
  if (action === 'save') { saves.push(payload); diskText = payload.text; revision = 'two'; return { path: payload.path, text: diskText, revision }; }
  if (action === 'gitBaseline') return payload.path === 'plain.txt'
    ? { available: false, reason: 'No Git working tree' }
    : { available: true, text: baselineText, label: 'HEAD', revision: 'head', deleted: false };
  if (action === 'gitStatus') return { available: true, changes: [] };
  return null;
} };
await import('../../src/plugins/file-editor/renderer');
localStorage.clear();
const project = { id: 'split-test', sourcePath: '/workspace/example' };
const key = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:pane:test`;
localStorage.setItem(key, 'config.toml'); localStorage.setItem(`${key}:diff`, 'true'); localStorage.setItem(`${key}:vim`, 'true');
localStorage.setItem(`${key}:tabs`, JSON.stringify(['config.toml', 'plain.txt']));
const host = document.createElement('div'), header = document.createElement('div');
host.style.cssText = 'position:fixed;left:0;top:40px;width:780px;height:480px';
document.body.append(header, host);
const mount = () => {
  const cleanup = pane.render(host, { project, paneId: 'test' });
  const cleanHeader = pane.renderHeaderActions(header, { host });
  return () => { cleanHeader(); cleanup(); header.replaceChildren(); };
};
const current = () => EditorView.findFromDOM(host.querySelector('.cm-merge-b .cm-content') || host.querySelector('.cm-content'));
const original = () => EditorView.findFromDOM(host.querySelector('.cm-merge-a .cm-content'));
const layout = () => host.querySelector('.file-editor-diff-layout');
let cleanup = mount();
await waitFor(() => layout() && !layout().disabled, 'Git baseline loads');
check(!host.querySelector('.cm-mergeView'), 'Inline remains default');
check(layout().parentElement.lastElementChild === layout() && layout().closest('.file-editor-file-actions'), 'Layout button is last in file toolbar');
const initial = current().state.doc.toString();
current().dispatch({ changes: { from: 0, insert: Text.of(['# draft', '']) }, selection: { anchor: 8 }, userEvent: 'input' });
const draft = current().state.doc.toString();
openSearchPanel(current()); current().dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'key62' })) });
layout().click();
await waitFor(() => host.querySelector('.cm-merge-b') && current().scrollDOM.clientHeight > 0, 'Side-by-side editor appears');
check(current().state.doc.toString() === draft, 'Layout switch retains draft');
check(current().state.selection.main.head === 8, 'Layout switch retains selection');
check(searchPanelOpen(current().state) && getSearchQuery(current().state).search === 'key62', 'Layout switch retains search');
check(original().state.readOnly && !original().state.facet(EditorView.editable), 'HEAD is read-only');
check(original().state.doc.toString() === originalLines.join('\n'), 'HEAD shows original normalized content');
check(original().dom.getBoundingClientRect().right <= current().dom.getBoundingClientRect().left + 1, 'HEAD and Current are beside each other');
check(current().scrollDOM.scrollHeight > current().scrollDOM.clientHeight, 'Current editor is vertically scrollable');
check(original().contentDOM.querySelector('span'), 'Original has syntax highlighting');
await waitFor(() => {
  const a = original(), b = current();
  const posA = a.state.doc.toString().indexOf('key10 ='), posB = b.state.doc.toString().indexOf('key10 =');
  return Math.abs(a.documentTop + a.lineBlockAt(posA).top - b.documentTop - b.lineBlockAt(posB).top) < 2;
}, 'Unchanged lines align across deleted and inserted rows');
check(getCM(current()), 'Vim remains available in Current');
undo(current()); check(current().state.doc.toString() === initial, 'Undo crosses switch to side-by-side');
redo(current()); check(current().state.doc.toString() === draft, 'Redo crosses switch to side-by-side');
current().scrollDOM.scrollTop = 300;
await waitFor(() => Math.abs(original().scrollDOM.scrollTop - current().scrollDOM.scrollTop) < 2 && current().scrollDOM.scrollTop > 0, 'Vertical scrolling is synchronized');
current().scrollDOM.scrollTop = current().scrollDOM.scrollHeight;
await new Promise(r => setTimeout(r, 100));
check(Math.abs(current().scrollDOM.scrollTop - (current().scrollDOM.scrollHeight - current().scrollDOM.clientHeight)) < 2, 'Different panel heights do not prevent scrolling to the bottom');
host.querySelector('[aria-label="Next change"]').click();
check(document.activeElement === current().contentDOM, 'Change navigation focuses Current');
current().dispatch({ changes: { from: 0, insert: Text.of(['# split edit', '']) }, userEvent: 'input' });
const splitDraft = current().state.doc.toString();
layout().click();
check(!host.querySelector('.cm-mergeView') && current().state.doc.toString() === splitDraft, 'Returning inline keeps side-by-side edits');
undo(current()); check(current().state.doc.toString() === draft, 'Undo crosses switch back to inline');
redo(current()); check(current().state.doc.toString() === splitDraft, 'Redo crosses switch back to inline');
layout().click();
Vim.handleEx(getCM(current()), 'w');
await waitFor(() => saves.length === 1, 'Vim write saves from Current');
check(saves[0].text === '\uFEFF' + splitDraft.replace(/\n/g, '\r\n'), 'Saving preserves BOM and CRLF');
check(original().state.doc.toString() === originalLines.join('\n'), 'Saving does not overwrite HEAD baseline');
check(localStorage.getItem(`${key}:diff-layout`) === 'side-by-side', 'Layout preference saved');
header.querySelector('.file-editor-diff-button').click();
check(!host.querySelector('.cm-mergeView'), 'Closing diff restores single editor');
header.querySelector('.file-editor-diff-button').click();
check(host.querySelector('.cm-mergeView'), 'Reopening diff restores chosen layout');
cleanup(); cleanup = mount();
await waitFor(() => host.querySelector('.cm-mergeView'), 'Remount restores layout');
const selectTab = name => [...host.querySelectorAll('[role=tab]')].find(tab => tab.textContent.includes(name)).click();
selectTab('plain.txt');
await waitFor(() => layout().disabled && host.querySelector('.file-editor-diff-status').textContent.includes('No Git'), 'Unavailable baseline is explained');
check(!host.querySelector('.cm-mergeView') && current().state.doc.toString() === 'plain', 'Unsupported file has no stale HEAD pane');
selectTab('config.toml');
await waitFor(() => host.querySelector('.cm-mergeView'), 'Returning to supported file restores split');
const rightBeforeRefresh = current();
const textBeforeRefresh = rightBeforeRefresh.state.doc.toString();
baselineText = '# new HEAD\n' + baselineText.replace(/^\uFEFF/, '');
await new Promise(r => setTimeout(r, 2100));
window.dispatchEvent(new Event('focus'));
await waitFor(() => original().state.doc.toString().startsWith('# new HEAD'), 'HEAD refresh updates left column');
check(current() === rightBeforeRefresh && current().state.doc.toString() === textBeforeRefresh, 'HEAD refresh preserves current editor');
cleanup();
window.browserTestResult = 'passed';
