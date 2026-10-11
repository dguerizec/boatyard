import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("Share sidebar persists its presentation and keeps live alerts while collapsed", t => {
  runBrowserTest(t, "test/fixtures/share-sidebar.browser.js");
});
