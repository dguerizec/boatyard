import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";
test("Share chat works across the operator and real browser clients, including pasted images and archives", t => {
  runBrowserTest(t, "test/fixtures/share-chat.browser.js", { main: "test/fixtures/share-chat.main.cjs", preload: "test/fixtures/share-chat.preload.cjs", timeoutMs: 30000 });
});
