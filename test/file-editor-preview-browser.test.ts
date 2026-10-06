import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("preview dependencies sanitize HTML and render Mermaid mathematics in Electron", (t) => {
  runBrowserTest(t, "test/fixtures/file-editor-preview.browser.js");
});
