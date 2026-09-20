import assert from "node:assert/strict";
import test from "node:test";

const { startPaneContentDrag } = require(`${process.cwd()}/build/renderer/paneContentDrag`);

test("pane content drops highlight targets, commit once and release overlay resources", () => {
  const original = { document: globalThis.document, window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame };
  class Surface {
    listeners = new Map<string, (event: any) => void>();
    classes = new Set<string>();
    classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) };
    style = {};
    removed = false;
    addEventListener(name: string, callback: (event: any) => void) { this.listeners.set(name, callback); }
    removeEventListener(name: string) { this.listeners.delete(name); }
    remove() { this.removed = true; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; }
  }
  const doc = new Surface();
  const win = new Surface();
  const shields: Surface[] = [];
  let frame: () => void = () => {};
  let freezes = 0;
  let restores = 0;
  let drops = 0;
  const freeze = { freeze: () => freezes++, restore: () => restores++ };
  Object.assign(globalThis, {
    document: Object.assign(doc, { createElement: () => new Surface(), body: { append: (...nodes: Surface[]) => shields.push(...nodes) } }),
    window: win,
    requestAnimationFrame: (callback: () => void) => { frame = callback; return 1; }
  });
  try {
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData() {} };
    const event = { dataTransfer, preventDefault() {}, stopPropagation() {} };
    const cleanup = startPaneContentDrag(event, [{ element: new Surface(), drop: () => drops++ }], freeze);
    assert.equal(shields.length, 0);
    frame();
    assert.equal(freezes, 1);
    assert.equal(dataTransfer.effectAllowed, "copy");
    shields[0].listeners.get("dragover")!(event);
    assert.equal(shields[0].classes.has("active"), true);
    shields[0].listeners.get("dragleave")!(event);
    assert.equal(shields[0].classes.has("active"), false);
    shields[0].listeners.get("drop")!(event);
    cleanup();
    assert.equal(drops, 1);
    assert.equal(restores, 1);
    assert.equal(shields[0].removed, true);
    assert.equal(doc.listeners.size + win.listeners.size, 0);

    const cancel = startPaneContentDrag(event, [{ element: new Surface(), drop: () => drops++ }], freeze);
    cancel();
    frame();
    assert.equal(freezes, 1, "cancelled drags cannot create late overlays");
    assert.equal(drops, 1);
    assert.equal(doc.listeners.size + win.listeners.size, 0);
  } finally {
    Object.assign(globalThis, original);
  }
});
