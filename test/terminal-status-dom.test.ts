import assert from "node:assert/strict";
import test from "node:test";
const { formatTerminalMemory, updateTerminalFooter, clearTerminalFooterMemory } = require(`${process.cwd()}/build/renderer-esm/terminalStatusDom`);

test("terminal footer RAM formats binary units and unavailable samples", () => {
  for (const value of [undefined, null, NaN, -1]) assert.equal(formatTerminalMemory(value), "RAM —");
  assert.equal(formatTerminalMemory(0), "RAM 0 MiB");
  assert.equal(formatTerminalMemory(42 * 1024 ** 2), "RAM 42 MiB");
  assert.equal(formatTerminalMemory(1.5 * 1024 ** 3), "RAM 1.5 GiB");
});

test("RAM updates only the active terminal footer and preserves error messages", () => {
  const name = { textContent: "backend" };
  const memory = { textContent: "RAM —" };
  const status = {
    dataset: { windowId: "@1" as string | undefined },
    querySelector: (selector: string) => selector === ".terminal-status-name" ? name : memory
  };
  const card = { querySelector: (selector: string) => selector === ".terminal-status" ? status : memory };
  updateTerminalFooter(card, { id: "@1", name: "backend", memoryBytes: 42 * 1024 ** 2 });
  assert.equal(memory.textContent, "RAM 42 MiB");
  updateTerminalFooter(card, { id: "@2", name: "other", memoryBytes: 0 });
  assert.equal(name.textContent, "backend");
  assert.equal(memory.textContent, "RAM 42 MiB");
  delete status.dataset.windowId;
  updateTerminalFooter(card, { id: "@1", name: "ignored", memoryBytes: 0 });
  assert.equal(name.textContent, "backend");
  clearTerminalFooterMemory(card);
  assert.equal(memory.textContent, "RAM —");
  updateTerminalFooter(card, { id: "@2", name: "frontend", memoryBytes: 1024 ** 3 }, { attached: true });
  assert.equal(name.textContent, "frontend");
  assert.equal(memory.textContent, "RAM 1.0 GiB");
  assert.equal(status.dataset.windowId, "@2");
});
