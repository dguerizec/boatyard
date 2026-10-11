import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("WebRTC settings preserve drafts, mask saved secrets and clean up connectivity tests", async t => {
  runBrowserTest(t, "test/fixtures/webrtc-settings.browser.js");
});
