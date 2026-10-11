import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("global remote settings preserve drafts, start/stop and clean up credentials", t => {
  runBrowserTest(t, "test/fixtures/remote-settings.browser.js");
});
