import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("WebRTC mixes host and guest audio without self-return and enforces moderation", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-voice.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 60000
  });
});
