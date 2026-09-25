import test from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("pane split dragging snaps adjacent crossings and persists the alignment", t => {
  runBrowserTest(t, "test/fixtures/pane-split-snap.browser.js");
});
