import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("Vim editing, pane toolbar, persistence, and save/history ownership in Electron", (t) => {
  runBrowserTest(t, "test/fixtures/file-editor-vim.browser.js");
});
