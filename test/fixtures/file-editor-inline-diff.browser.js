import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { inlineDiffState, setInlineDiff, toggleRemovedLines, removedLinesKey } from '../../src/plugins/file-editor/inlineDiff';
import '../../src/plugins/file-editor/style.css';

function check(condition, message) { if (!condition) throw new Error(message); }
const host = document.createElement('div');
host.className = 'file-editor';
host.style.cssText = 'width: 500px; height: 400px';
document.body.append(host);
for (const [before, after, content, lines] of [
  ['a\n\nb', 'a\nb', '', 1],
  ['a\n\n\nb', 'a\nb', '\n', 2],
  ['a\nold\n\nb', 'a\nb', 'old\n', 2],
  ['a\n\n', 'a\n', '', 1],
  ['a\nold\nb', 'a\nb', 'old', 1]
]) {
  const original = Text.of(before.split('\n'));
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: after,
    extensions: [inlineDiffState, EditorView.theme({ '.cm-content': { lineHeight: '20px', fontFamily: 'monospace' } })]
  }) });
  view.dispatch({ effects: setInlineDiff.of({ original, inline: true }) });
  check(!host.querySelector('.file-editor-removed-lines'), 'Deleted lines start collapsed');
  const key = removedLinesKey(original, view.state.field(inlineDiffState).chunks[0]);
  view.dispatch({ effects: toggleRemovedLines.of(key) });
  const widget = host.querySelector('.file-editor-removed-lines');
  check(widget && widget.textContent === content, 'Original text remains exact');
  const lineHeight = parseFloat(getComputedStyle(widget).lineHeight);
  const height = widget.getBoundingClientRect().height;
  check(Math.abs(height - lines * lineHeight) < 1, `Expected ${lines} deleted rows for ${JSON.stringify(content)}, got height ${height} at line height ${lineHeight}`);
  check(widget.contentEditable === 'false', 'Deleted lines are read-only');
  check(view.state.doc.toString() === after, 'Deleted lines never enter editable document');
  view.dispatch({ effects: toggleRemovedLines.of(key) });
  check(!host.querySelector('.file-editor-removed-lines'), 'Deleted lines collapse again');
  view.destroy();
}
window.browserTestResult = 'passed';
