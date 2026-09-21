import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("hex and ASCII selections stay synchronized in Electron", (t) => {
  runBrowserTest(t, "test/fixtures/hex-selection.browser.js");
});
