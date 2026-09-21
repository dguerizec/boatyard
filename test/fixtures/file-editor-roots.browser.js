import { EditorView } from '@codemirror/view';
import '../../src/renderer/styles.css';
import '../../src/plugins/file-editor/style.css';

function check(condition, message) { if (!condition) throw new Error(message); }
const waitFor = async (condition, message) => {
  for (let i = 0; i < 150; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error(message);
};
let pane;
window.BoatyardPluginRegistry = { register(_manifest, plugin) {
  plugin.activate({ settings: { registerGlobalSection() {} }, status: { set() {} }, panes: { register(value) { pane = value; } } });
} };
const project = { id: 'roots-test', sourcePath: '/workspace/project' };
const feature = '/workspace/feature';
let available = true;
const saved = [], calls = [];
const disk = new Map([[project.sourcePath, 'main text'], [feature, 'feature text']]);
window.boatyard = { invokePlugin: async (_plugin, action, payload) => {
  calls.push({ action, ...payload });
  if (action === 'roots') return [
    { path: project.sourcePath, label: 'main', usable: true, project: true },
    { path: feature, label: 'feature', usable: available, project: false }
  ];
  if (action === 'resolveRoot') {
    if (payload.root === feature && !available) throw new Error('This worktree is no longer available.');
    return payload.root;
  }
  if (action === 'read') return { path: payload.path, text: disk.get(payload.root), revision: disk.get(payload.root) };
  if (action === 'save') { saved.push(payload); disk.set(payload.root, payload.text); return { path: payload.path, text: payload.text, revision: payload.text }; }
  if (action === 'list') return { entries: [{ name: 'shared.txt', path: 'shared.txt', kind: 'file' }], total: 1, nextOffset: null };
  if (action === 'gitStatus') return { available: true, changes: [] };
  if (action === 'gitBaseline') return { available: true, text: disk.get(payload.root), label: 'HEAD', revision: 'head', deleted: false };
  return null;
} };
await import('../../src/plugins/file-editor/renderer');
localStorage.clear();
const key = 'boatyard:file-editor:' + JSON.stringify([project.id, project.sourcePath]) + ':pane:test';
localStorage.setItem(key + ':browser', JSON.stringify({ open: true, width: 260 }));
localStorage.setItem(key, 'shared.txt');
const host = document.createElement('div'), header = document.createElement('div');
host.style.cssText = 'position:fixed;left:0;top:40px;width:780px;height:480px';
document.body.append(header, host);
const mount = () => {
  const dispose = pane.render(host, { project, paneId: 'test' });
  const disposeHeader = pane.renderHeaderActions(header, { host });
  return () => { disposeHeader(); dispose(); header.replaceChildren(); };
};
const view = () => host.querySelector('.cm-content') && EditorView.findFromDOM(host.querySelector('.cm-content'));
const selector = () => host.querySelector('.file-browser-root');
const choose = async path => {
  await waitFor(() => [...(selector()?.options || [])].some(option => option.value === path), 'Root listed');
  selector().value = path;
  selector().dispatchEvent(new Event('change'));
};
let cleanup = mount();
await waitFor(() => view() && selector()?.options.length === 2, 'Initial editor and worktrees load');
check(host.querySelector('.file-browser-root-label').textContent === 'main', 'Toolbar shows only the root name');
check(selector().title === 'main — ' + project.sourcePath, 'Tooltip includes root name and path');
check(selector().options[1].text === 'feature — ' + feature, 'Dropdown retains root name and path');
view().dispatch({ changes: { from: 0, insert: 'draft ' }, userEvent: 'input' });
await choose(feature);
await waitFor(() => selector()?.value === feature && !view(), 'New root starts with separate tabs');
await waitFor(() => host.querySelector('.file-browser-entry'), 'Feature directory loads');
host.querySelector('.file-browser-entry').click();
await waitFor(() => view()?.state.doc.toString() === 'feature text', 'Same filename opens from selected root');
view().dispatch({ changes: { from: 0, insert: 'other ' }, userEvent: 'input' });
await choose(project.sourcePath);
await waitFor(() => view()?.state.doc.toString() === 'draft main text', 'Returning restores main draft');
host.querySelector('[aria-label="Save"]').click();
await waitFor(() => saved.length === 1, 'Main draft saves');
check(saved[0].root === project.sourcePath && saved[0].text === 'draft main text', 'Main save stays in main worktree');
await choose(feature);
await waitFor(() => view()?.state.doc.toString() === 'other feature text', 'Returning restores feature draft');
host.querySelector('[aria-label="Save"]').click();
await waitFor(() => saved.length === 2, 'Feature draft saves');
check(saved[1].root === feature && saved[1].text === 'other feature text', 'Feature save stays in feature worktree');
cleanup(); cleanup = mount();
await waitFor(() => selector()?.value === feature && view()?.state.doc.toString() === 'other feature text', 'Remount restores selected root and tabs');
await waitFor(() => selector().title === 'feature — ' + feature, 'Selected worktree tooltip updates');
check(host.querySelector('.file-browser-root-label').textContent === 'feature', 'Selected worktree has a compact label');
check(header.querySelector('.file-editor-browse-button').getAttribute('aria-pressed') === 'true', 'Header controls survive root restoration');
check(calls.some(call => call.action === 'gitBaseline' && call.root === feature), 'Git baseline follows root');
available = false;
cleanup(); cleanup = mount();
await waitFor(() => selector()?.value === project.sourcePath && view()?.state.doc.toString() === 'draft main text', 'Missing worktree falls back to project safely');
check(host.textContent.includes('no longer available'), 'Missing saved root is explained');
cleanup();
window.browserTestResult = 'passed';
