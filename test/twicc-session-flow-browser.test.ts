import test from "node:test";
import { spawnSync } from "node:child_process";
import { runBrowserTest } from "./helpers/browser";

test("TwiCC Kanban preserves interactions, serializes moves and rejects obsolete reads", (t) => {
  runBrowserTest(t, "test/fixtures/twicc-session-flow.browser.js");
});

test("TwiCC Kanban accepts native mouse releases on the visible insertion preview", (t) => {
  if (process.platform !== "linux" || ["xdotool", "xvfb-run"].some((command) => spawnSync("which", [command]).status !== 0)) {
    t.skip("Native Kanban dragging requires Linux, xdotool and an isolated Xvfb display");
    return;
  }
  runBrowserTest(t, "test/fixtures/twicc-native-drop.browser.js", {
    main: "test/fixtures/twicc-native-drop.main.cjs",
    preload: "test/fixtures/twicc-native-drop.preload.cjs"
  });
});
