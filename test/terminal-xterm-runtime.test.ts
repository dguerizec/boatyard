import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  applyTerminalTheme,
  getTerminalTheme
} = require(`${process.cwd()}/build/renderer-esm/terminalXtermRuntime`);

test("terminal themes provide contrasting light and dark palettes", () => {
  const darkTheme = getTerminalTheme("dark");
  const lightTheme = getTerminalTheme("light");

  assert.equal(darkTheme.background, "#080c11");
  assert.equal(darkTheme.foreground, "#d7dde5");
  assert.equal(lightTheme.background, "#ffffff");
  assert.equal(lightTheme.foreground, "#18201c");
  assert.notEqual(lightTheme.black, lightTheme.background);
  assert.notEqual(lightTheme.white, lightTheme.background);
});

test("applying a terminal theme replaces the xterm theme object", () => {
  const originalTheme = { background: "#000000" };
  const term: { options: { theme: Record<string, string> } } = {
    options: {
      theme: originalTheme
    }
  };

  applyTerminalTheme(term, "light");

  assert.notEqual(term.options.theme, originalTheme);
  assert.equal(term.options.theme.background, "#ffffff");
  assert.equal(term.options.theme.cursor, "#147a52");
});

test("terminal viewport chrome follows the application theme", () => {
  const styles = readFileSync(`${process.cwd()}/src/renderer/styles.css`, "utf8");

  assert.match(
    styles,
    /\.terminal-viewport \.xterm \.xterm-viewport\s*\{[^}]*background-color: var\(--terminal-background\);/s
  );
});
