import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("DOM pane links share tab navigation and stay in their source pane", (t) => {
  runBrowserTest(t, "test/fixtures/pane-navigation.browser.js");
});
