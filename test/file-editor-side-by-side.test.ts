import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("side-by-side diff preserves editing, history, navigation, and pane preferences in Electron", (t) => {
  runBrowserTest(t, "test/fixtures/file-editor-side-by-side.browser.js");
});
