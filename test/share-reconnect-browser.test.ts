import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("Share resumes after reload, renderer crash and host restart, but not after Stop or forced disconnect", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/share-reconnect.main.cjs",
    preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 100000
  });
});
