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

window.browserTestResult = 'passed';
