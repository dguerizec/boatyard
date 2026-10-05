import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("large image confirmation, direct disk loading, zoom and navigation work in Electron", (t) => {
  runBrowserTest(t, "test/fixtures/file-editor-image.browser.js", {
    main: "test/fixtures/file-editor-image.main.cjs",
    preload: "test/fixtures/file-editor-image.preload.cjs",
    timeoutMs: process.env.BOATYARD_IMAGE_TEST_FILE ? 45000 : undefined
  });
});
