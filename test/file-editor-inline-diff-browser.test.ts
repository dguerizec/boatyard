import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("inline changes preserve blank lines and respect line wrapping in Electron", (t) => {
  runBrowserTest(t, "test/fixtures/file-editor-inline-diff.browser.js");
});
