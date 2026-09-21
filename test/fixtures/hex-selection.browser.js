import { createHexView } from '../../src/plugins/file-editor/hexView';
import '../../src/plugins/file-editor/style.css';

function check(condition, message) { if (!condition) throw new Error(message); }
const host = document.createElement('div');
host.className = 'file-editor';
host.style.cssText = 'width: 1100px; height: 400px; --accent-rgb: 80, 140, 220; --accent: blue; --text: white';
document.body.append(host);
const bytes = Uint8Array.from({ length: 1027 }, (_, i) => i % 128);
const view = createHexView(host, () => {}, () => {});
const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const cell = (index, ascii = false) => host.querySelector(ascii ? `[data-ascii="${index}"]` : `input[data-offset="${index}"]`);
function selected(expected) {
  for (const selector of ['input[data-offset]', '[data-ascii]']) {
    const actual = [...host.querySelectorAll(`${selector}.selected`)].map(node => Number(node.dataset.offset ?? node.dataset.ascii));
    check(JSON.stringify(actual) === JSON.stringify(expected), `${selector}: expected ${expected}, got ${actual}`);
  }
}
function pointer(index, ascii, type = 'pointerdown', extra = {}) {
  cell(index, ascii).dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, ...extra }));
}
function release() { window.dispatchEvent(new PointerEvent('pointerup')); }
view.update(bytes, 'fixture');
await tick();
selected([0]);
check(cell(0, true).textContent === '.', 'Nonprintable bytes have selectable placeholders');
check(cell(65, true).textContent === 'A', 'Printable bytes retain their text');
pointer(14, false); release();
selected([14]);
cell(14).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight', shiftKey: true }));
selected([14, 15]);
pointer(17, true, 'pointerdown', { shiftKey: true }); release();
selected([14, 15, 16, 17]);
pointer(18, true);
pointer(15, true, 'pointerenter'); release();
selected([15, 16, 17, 18]);
check(document.activeElement === cell(15), 'ASCII selection focuses the corresponding editable byte');
check(getComputedStyle(cell(15, true)).backgroundColor === getComputedStyle(cell(15)).backgroundColor, 'Both columns share the selection highlight');
view.setSelection({ anchor: 1027, head: 1025 });
await tick();
selected([1025, 1026]);
check(!cell(1027, true), 'Partial final row has no extra characters');
view.setSelection({ anchor: 65, head: 65 });
await tick();
selected([65]);
cell(65).value = '42';
cell(65).dispatchEvent(new Event('input', { bubbles: true }));
check(cell(65, true).textContent === 'B', 'Editing refreshes text without losing selection');
selected([65]);
view.cleanup();
window.browserTestResult = 'passed';
