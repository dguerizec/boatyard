import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("remote video metadata preserves camera revisions without altering image pixels", t => {
  runBrowserTest(t, "test/fixtures/remote-frame-metadata.browser.js");
});
