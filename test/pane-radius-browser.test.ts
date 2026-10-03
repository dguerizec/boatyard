import test from "node:test";
import { runBrowserTest } from "./helpers/browser.js";

test("pane frames and native surfaces share one radius without moving controls", t => {
  runBrowserTest(t, "test/fixtures/pane-radius.browser.js");
});
