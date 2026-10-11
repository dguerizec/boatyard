import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("conference modes and turns reach a WebRTC guest and survive reconnection", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-conference.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});
