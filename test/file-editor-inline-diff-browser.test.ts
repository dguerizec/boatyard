import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("expanded inline deletions preserve blank line height in Electron", (t) => {
  runBrowserTest(t, "test/fixtures/file-editor-inline-diff.browser.js");
});
