import test from "node:test";
import { runBrowserTest } from "./helpers/browser.js";

test("pane filling updates real WCV forms and controlled fields without submission or cross-pane changes", t => {
  runBrowserTest(t, "test/fixtures/webapp-fill.browser.js", {
    main: "test/fixtures/webapp-fill.main.cjs", preload: "test/fixtures/webapp-fill.preload.cjs"
  });
});
