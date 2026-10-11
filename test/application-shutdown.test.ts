import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("closing the last workspace quits Electron with an idle hidden streaming window", t => {
  if (process.platform !== "linux" || spawnSync("which", ["xvfb-run"]).status !== 0) {
    t.skip("Application shutdown integration requires Linux with xvfb-run");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "boatyard-shutdown-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = { ...process.env,
    BOATYARD_CONFIG_ROOT: join(directory, "config"),
    BOATYARD_USER_DATA_PATH: join(directory, "chromium"),
    BOATYARD_STATE_PATH: join(directory, "unused-legacy.json"),
    BOATYARD_TERMINAL_SESSION_PREFIX: `shutdown-test-${process.pid}`
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync("xvfb-run", ["-a", require("electron"),
    resolve("test/fixtures/applicationShutdown.cjs"), "--no-sandbox", "--ozone-platform=x11"],
  { env, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /APPLICATION_SHUTDOWN_PASSED/);
});
