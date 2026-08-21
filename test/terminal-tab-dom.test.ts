"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getTerminalTabEditName,
  getTerminalTabTitle,
  TERMINAL_TAB_RENAME_TOOLTIP
} = require(`${process.cwd()}/build/renderer-esm/terminalTabDom`);

test("terminal tab titles reveal truncated names and otherwise keep the rename hint", () => {
  assert.equal(getTerminalTabTitle("workflow-dependency-closure", 180, 120), "workflow-dependency-closure");
  assert.equal(getTerminalTabTitle("main", 48, 120), TERMINAL_TAB_RENAME_TOOLTIP);
  assert.equal(getTerminalTabTitle("shell", 120, 120), TERMINAL_TAB_RENAME_TOOLTIP);
});

test("terminal tab rename uses the latest rendered name", () => {
  const initiallyRenderedTab = {
    id: "@1",
    index: 0,
    name: "shell"
  };

  assert.equal(getTerminalTabEditName(initiallyRenderedTab), "shell");
  assert.equal(getTerminalTabEditName(initiallyRenderedTab, "backend"), "backend");
});

export {};
