import { Compartment, EditorState, Text } from '@codemirror/state';
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
const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
for (const longLine of ['long value '.repeat(60), 'x'.repeat(600)]) {
  const wrapping = new Compartment();
  const original = Text.of(['before ' + longLine]);
  const current = 'after ' + longLine;
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: current,
    extensions: [inlineDiffState, wrapping.of([]), EditorView.theme({ '.cm-content': { lineHeight: '20px', fontFamily: 'monospace' } })]
  }) });
  view.dispatch({ effects: setInlineDiff.of({ original, inline: true }) });
  const key = removedLinesKey(original, view.state.field(inlineDiffState).chunks[0]);
  view.dispatch({ effects: toggleRemovedLines.of(key) });
  for (const enabled of [true, false, true]) {
    view.dispatch({ effects: wrapping.reconfigure(enabled ? EditorView.lineWrapping : []) });
    await tick();
    for (const selector of ['.file-editor-removed-lines', '.file-editor-added-line']) {
      const line = host.querySelector(selector);
      const height = line.getBoundingClientRect().height;
      check(enabled ? height > 20 : height === 20, `${selector} respects wrap=${enabled}: height=${height}`);
    }
    if (enabled) check(view.scrollDOM.scrollWidth <= view.scrollDOM.clientWidth + 1, 'Expanded changes do not force horizontal overflow when wrapped');
    check(view.state.doc.toString() === current, 'Wrapping does not modify the document');
  }
  view.destroy();
}
for (const [before, after, removed, added] of [
  ['Keep the old value here.', 'Keep the new value here.', 'old', 'new'],
  ['Keep the value here.', 'Keep the TEST value here.', '', 'TEST '],
  ['Keep the TEST value here.', 'Keep the value here.', 'TEST ', ''],
  ['unchanged\nKeep <old> here.', 'unchanged\nKeep <new> here.', 'old', 'new']
]) {
  const original = Text.of(before.split('\n'));
  const view = new EditorView({ parent: host, doc: after, extensions: [inlineDiffState, EditorView.lineWrapping] });
  view.dispatch({ effects: setInlineDiff.of({ original, inline: true }) });
  const key = removedLinesKey(original, view.state.field(inlineDiffState).chunks[0]);
  view.dispatch({ effects: toggleRemovedLines.of(key) });
  const highlighted = selector => [...host.querySelectorAll(selector)].map(node => node.textContent).join('');
  check(highlighted('.file-editor-removed-text') === removed, 'Only removed characters are emphasized');
  check(highlighted('.file-editor-added-text') === added, 'Only added characters are emphasized');
  check(view.state.doc.toString() === after, 'Highlights preserve editable text');
  if (removed === 'old' && !before.includes('\n')) {
    const from = after.indexOf('new');
    view.dispatch({ changes: { from, to: from + 3, insert: 'old value' } });
    check(highlighted('.file-editor-removed-text') === '', 'Original highlights refresh when the same expanded block becomes insertion-only');
  }
  view.destroy();
}
window.browserTestResult = 'passed';
