import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("paged editors integrate whole-file Find, Vim jumps, draft-aware search, and hex paste in Electron", (t) => {
  runBrowserTest(t, "test/fixtures/paged-file.browser.js");
});
