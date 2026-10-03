import test from "node:test";
import { runBrowserTest } from "./helpers/browser.js";

test("pane clicks reach real WCV controls with trusted input and reject unsafe targets", t => {
  runBrowserTest(t, "test/fixtures/webapp-click.browser.js", {
    main: "test/fixtures/webapp-click.main.cjs",
    preload: "test/fixtures/webapp-click.preload.cjs"
  });
});
