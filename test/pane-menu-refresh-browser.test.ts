import test from "node:test";
import { runBrowserTest } from "./helpers/browser.js";

test("pane menu discovers external Pier workloads without blocking or losing focus", (t) => {
  runBrowserTest(t, "test/fixtures/pane-menu-refresh.browser.js");
});
