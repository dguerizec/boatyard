import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("project switches dispose pane subscriptions and observers while reused panes stay alive", (t) => {
  runBrowserTest(t, "test/fixtures/pane-lifecycle.browser.js");
});
