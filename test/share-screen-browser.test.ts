import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("Share privacy sends black pixels and resumes without losing its peer or voice state", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-privacy.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});
