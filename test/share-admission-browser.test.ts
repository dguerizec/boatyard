import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("Share guest forms handle named codes, group entry, approvals and device changes on mobile", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/share-admission.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});
