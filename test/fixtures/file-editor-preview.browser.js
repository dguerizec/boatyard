import katex from 'katex';
import { createPreviewDocument } from '../../src/plugins/file-editor/preview';
import { renderDiagram } from '../../src/plugins/file-editor/mermaid';

function check(condition, message) { if (!condition) throw new Error(message); }

const colors = { background: '#fff', text: '#111', muted: '#666', accent: '#06c', line: '#ddd', dark: false };
const html = await createPreviewDocument('<h1>Preview</h1><script>alert(1)</script><img src="x" onerror="alert(1)">', 'example.html', colors);
const preview = new DOMParser().parseFromString(html, 'text/html');
check(preview.querySelector('h1')?.textContent === 'Preview', 'Sanitization preserves document content');
check(!preview.querySelector('script, [onerror]'), 'Sanitization removes executable markup');
check(preview.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content.includes("script-src 'none'"), 'Preview retains its script-blocking policy');

const svg = await renderDiagram('flowchart LR\n A["$$x^2 + \\frac{1}{2}$$"] --> B[Result]', false);
const diagram = new DOMParser().parseFromString(svg, 'image/svg+xml');
check(!diagram.querySelector('parsererror'), 'Mermaid produces valid SVG');
check(diagram.querySelector('math'), 'Mermaid renders mathematical labels with the overridden KaTeX version');
check(!svg.includes('$$'), 'Mathematical expressions are rendered rather than displayed literally');

// An inherited trust option must not enable unsafe links in mathematical input.
Object.prototype.trust = true;
try {
  const math = katex.renderToString('\\href{javascript:alert(1)}{click}', { output: 'mathml' });
  check(!math.includes('href="javascript:'), 'KaTeX ignores trust inherited from Object.prototype');
} finally {
  delete Object.prototype.trust;
}

// Exercise link interception in the mounted editor's sandboxed preview.
let pane;
const requests = [], reads = [], external = [];
window.BoatyardPluginRegistry = { register(_manifest, plugin) {
  plugin.activate({ settings: { registerGlobalSection() {} }, status: { set() {} }, panes: { register(value) { pane = value; } } });
} };
window.boatyard = {
  openExternal: url => external.push(url),
  invokePlugin: async (_plugin, action, payload) => {
    if (action === 'read' || action === 'readEditable') {
      reads.push(payload.path);
      return { path: payload.path, text: '<a href="https://example.com/detail"><span>Web</span></a><a href="#section">Anchor</a><h2 id="section">Section</h2><a href="next%20file.html">Local</a>', revision: 'one', size: 200, mtimeMs: 1 };
    }
    if (action === 'gitStatus') return { available: false, entries: [] };
    if (action === 'gitBaseline') return { available: false };
    return null;
  }
};
await import('../../src/plugins/file-editor/renderer');
localStorage.clear();
const project = { id: 'preview-test', sourcePath: '/workspace/example' };
const paneKey = `boatyard:file-editor:${JSON.stringify([project.id, project.sourcePath])}:pane:test`;
localStorage.setItem(paneKey, 'docs/example.html');
localStorage.setItem(`${paneKey}:preview`, 'true');
const host = document.createElement('div');
document.body.append(host);
const cleanup = pane.render(host, { project, paneId: 'test', openUrl: url => requests.push(url) });
const frame = host.querySelector('.file-editor-preview');
// Link interception is installed on load, after the srcdoc DOM becomes visible.
await new Promise(resolve => {
  frame.addEventListener('load', function loaded() {
    if (!frame.contentDocument?.querySelector('a')) return;
    frame.removeEventListener('load', loaded);
    resolve();
  });
});
check(frame.contentDocument?.querySelector('a'), 'Editor loads its preview document');
const content = frame.contentDocument;
content.querySelector('a span').click();
await new Promise(resolve => setTimeout(resolve, 0));
check(requests.join() === 'https://example.com/detail' && external.length === 0, 'Preview web link uses the destination dialog instead of opening externally');
const anchorEvent = new content.defaultView.MouseEvent('click', { bubbles: true, cancelable: true });
let anchorIntercepted;
content.addEventListener('click', event => {
  anchorIntercepted = event.defaultPrevented;
  // Avoid navigating the srcdoc fixture against the harness's file URL.
  event.preventDefault();
}, { once: true });
content.querySelector('a[href="#section"]').dispatchEvent(anchorEvent);
check(!anchorIntercepted && requests.length === 1, 'Local anchors retain native preview navigation');
content.querySelector('a[href="next%20file.html"]').click();
await new Promise(resolve => setTimeout(resolve, 0));
check(reads.includes('docs/next file.html') && requests.length === 1, 'Relative file links remain in the editor');
cleanup();
window.browserTestResult = 'passed';
