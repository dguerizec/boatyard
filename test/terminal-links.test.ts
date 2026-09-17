import assert from "node:assert/strict";
import test from "node:test";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import type { WebLinksAddon } from "@xterm/addon-web-links";

const { createTerminalLinksAddon } = require(`${process.cwd()}/build/renderer-esm/terminalLinks`);

function fixture() {
  const events = new EventTarget();
  const opened: string[] = [];
  let provider: ILinkProvider;
  let disposed = false;
  let handler: (event: MouseEvent, url: string) => void;
  const link: ILink = {
    text: "https://example.com/login",
    range: { start: { x: 1, y: 1 }, end: { x: 25, y: 1 } },
    activate(event, url) { handler(event, url); }
  };
  class Detector {
    constructor(callback: typeof handler) { handler = callback; }
    activate(term: Terminal) {
      term.registerLinkProvider({ provideLinks: (_line, callback) => callback([link]) });
    }
    dispose() { disposed = true; }
  }
  const addon = createTerminalLinksAddon(
    Detector as unknown as typeof WebLinksAddon,
    events as unknown as Window,
    (url: string) => opened.push(url)
  );
  addon.activate({ registerLinkProvider(value: ILinkProvider) { provider = value; } });
  provider!.provideLinks(1, () => {});
  const modifier = (type: string, ctrlKey: boolean) => {
    const event = Object.assign(new Event(type), { ctrlKey });
    events.dispatchEvent(event);
  };
  return { addon, events, opened, link, modifier, isDisposed: () => disposed };
}

const mouse = (ctrlKey: boolean, button = 0) => ({ ctrlKey, button, preventDefault() {} }) as MouseEvent;

test("terminal links follow Ctrl changes without moving the pointer and reset on blur", () => {
  const f = fixture();
  f.link.hover!(mouse(false), f.link.text);
  assert.deepEqual(f.link.decorations, { underline: false, pointerCursor: false });
  f.modifier("keydown", true);
  assert.deepEqual(f.link.decorations, { underline: true, pointerCursor: true });
  f.modifier("keyup", false);
  assert.equal(f.link.decorations!.underline, false);
  f.link.hover!(mouse(true), f.link.text);
  assert.equal(f.link.decorations!.underline, true);
  f.events.dispatchEvent(new Event("blur"));
  assert.equal(f.link.decorations!.underline, false);
  f.addon.dispose();
});

test("terminal links open only HTTP(S) URLs with Ctrl and the primary button", async () => {
  const f = fixture();
  f.link.activate(mouse(false), f.link.text);
  f.link.activate(mouse(true, 1), f.link.text);
  f.link.activate(mouse(true), "file:///workspace/example");
  await Promise.resolve();
  assert.deepEqual(f.opened, []);
  f.link.activate(mouse(true), f.link.text);
  await Promise.resolve();
  assert.deepEqual(f.opened, [f.link.text]);
  f.addon.dispose();
});

test("leaving, releasing and disposing terminal links removes active modifier behavior", () => {
  const f = fixture();
  f.link.hover!(mouse(false), f.link.text);
  f.link.leave!(mouse(false), f.link.text);
  f.modifier("keydown", true);
  assert.equal(f.link.decorations!.underline, false);
  f.link.hover!(mouse(false), f.link.text);
  f.link.dispose!();
  f.modifier("keydown", true);
  assert.equal(f.link.decorations!.underline, false);
  f.link.hover!(mouse(false), f.link.text);
  f.addon.dispose();
  f.modifier("keydown", true);
  assert.equal(f.link.decorations!.underline, false);
  assert.equal(f.isDisposed(), true);
});


test("Ctrl held before hover updates the decoration setters installed by xterm", async () => {
  const f = fixture();
  f.link.hover!(mouse(true), f.link.text);
  f.link.decorations = { underline: false, pointerCursor: false };
  await Promise.resolve();
  assert.deepEqual(f.link.decorations, { underline: true, pointerCursor: true });
  f.addon.dispose();
});
