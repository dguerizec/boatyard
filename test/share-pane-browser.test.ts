import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";
test("Share pane manages participants while preserving drafts, focus and subscriptions", t => {
  runBrowserTest(t, "test/fixtures/share-pane.browser.js");
});
