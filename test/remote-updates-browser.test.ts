import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("remote client installs on demand and checks updates between streaming sessions", t => {
  runBrowserTest(t, "test/fixtures/remote-updates.browser.js");
});

test("served PWA reloads updated assets while retaining its redeemed Share session", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-pwa.main.cjs", preload: "test/fixtures/remote-access.preload.cjs"
  });
});
