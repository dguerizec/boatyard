import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";
test("project sharing controls synchronize sidebar, shortcuts and context menus", t => {
  runBrowserTest(t, "test/fixtures/project-sharing.browser.js");
});
