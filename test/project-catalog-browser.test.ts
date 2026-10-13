import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { runBrowserTest } from "./helpers/browser";

test("project catalog IPC refreshes sidebars while preserving drafts and rejecting a stale initial snapshot", t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-catalog-preload-"));
  try {
    const preload = join(directory, "preload.cjs");
    // Bundle the real bridge for the harness's sandboxed window.
    buildSync({ entryPoints: ["src/main/preload.ts"], outfile: preload,
      bundle: true, format: "cjs", platform: "node", external: ["electron"] });
    runBrowserTest(t, "test/fixtures/project-catalog.browser.js", {
      main: "test/fixtures/project-catalog.main.cjs", preload
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
