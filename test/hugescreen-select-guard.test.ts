import assert from "node:assert/strict";
import test from "node:test";
import { installHugescreenSelectGuard } from "../src/main/hugescreenSelectGuard.js";

function fixture() {
  const view = new EventTarget();
  let open = false;
  const select = { localName: "select", multiple: false, size: 0, disabled: false, isConnected: true,
    matches: () => open };
  const document = Object.assign(new EventTarget(), { activeElement: select as unknown, defaultView: view });
  const changes: boolean[] = [];
  const dispose = installHugescreenSelectGuard(document as unknown as Document, value => changes.push(value));
  const dispatch = (type: string, extra = {}) => {
    const event = Object.assign(new Event(type), { button: 0, ...extra });
    event.composedPath = () => [select as unknown as EventTarget, document];
    document.dispatchEvent(event);
  };
  return { document, select, changes, dispose, dispatch, setOpen(value: boolean) { open = value; } };
}

test("pointer opening pauses immediately; closing resumes even while select keeps focus", context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const fixtureState = fixture();
  const { changes, dispatch, setOpen, dispose } = fixtureState;
  try {
    dispatch("pointerdown");
    assert.deepEqual(changes, [true]);
    setOpen(true);
    context.mock.timers.tick(100);
    assert.deepEqual(changes, [true]);
    setOpen(false);
    context.mock.timers.tick(16);
    assert.deepEqual(changes, [true, false]);
    dispatch("pointerdown");
    setOpen(true);
    context.mock.timers.tick(16);
    assert.deepEqual(changes, [true, false, true], "the same select can reopen");
  } finally { dispose(); }
});

test("keyboard opening and programmatic opening of a focused select are observed", context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const { changes, dispatch, setOpen, dispose } = fixture();
  try {
    dispatch("focusin");
    context.mock.timers.tick(16);
    assert.deepEqual(changes, [], "focus alone does not stop tracking");
    dispatch("keydown", { key: " " });
    assert.deepEqual(changes, [true]);
    setOpen(true); context.mock.timers.tick(16);
    setOpen(false); context.mock.timers.tick(16);
    setOpen(true); context.mock.timers.tick(16);
    assert.deepEqual(changes, [true, false, true]);
  } finally { dispose(); }
});

test("cancelled opening expires and removed controls release the pause", context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const { changes, dispatch, select, setOpen, dispose } = fixture();
  try {
    dispatch("pointerdown");
    now = 151; context.mock.timers.tick(16);
    assert.deepEqual(changes, [true, false]);
    dispatch("pointerdown"); setOpen(true); context.mock.timers.tick(16);
    select.isConnected = false; context.mock.timers.tick(16);
    assert.deepEqual(changes, [true, false, true, false]);
  } finally { dispose(); }
});

test("listboxes are excluded and page teardown releases an open popup", context => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const { changes, dispatch, select, document, dispose } = fixture();
  select.multiple = true; dispatch("pointerdown");
  assert.deepEqual(changes, []);
  select.multiple = false; select.size = 4; dispatch("pointerdown");
  assert.deepEqual(changes, []);
  select.size = 0; dispatch("pointerdown");
  document.defaultView.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(changes, [true, false]);
  dispose(); dispatch("pointerdown");
  assert.deepEqual(changes, [true, false]);
});
