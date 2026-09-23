import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("isolated Electron persists Hugescreen through layouts, project switches and synchronized windows", t => {
  if (process.platform !== "linux" || spawnSync("which", ["xvfb-run"]).status !== 0) {
    t.skip("Native Hugescreen integration requires Linux with xvfb-run");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "boatyard-hugescreen-native-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "config");
  const profile = join(root, "profiles/default");
  mkdirSync(profile, { recursive: true });
  const json = (file: string, data: unknown) => writeFileSync(join(profile, file), JSON.stringify(data));
  json("projects.json", { projects: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "Unconfigured" }, { id: "d", name: "Unvisited" }] });
  json("settings.json", { app: { lastSeenVersion: "0.17.1", dismissedChangelogVersion: "0.17.1" },
    onboarding: { completedVersion: 1, completedAt: "2026-01-01T00:00:00Z" } });
  json("workspace-session.json", {
    navigation: { view: "project", projectId: "a" },
    window: { bounds: { x: 0, y: 0, width: 1000, height: 700 }, hugescreenEdgeZones: { top: 28 } },
    projectHugescreen: {
      a: { widthMultiplier: 1.5, heightMultiplier: 2, panMode: "continuous", enabled: false },
      b: { widthMultiplier: 1.25, heightMultiplier: 1.25, panMode: "continuous", enabled: false }
    }
  });
  const env: NodeJS.ProcessEnv = { ...process.env, BOATYARD_CONFIG_ROOT: root, BOATYARD_USER_DATA_PATH: join(directory, "chromium"),
    BOATYARD_STATE_PATH: join(directory, "unused-legacy.json"), BOATYARD_TERMINAL_SESSION_PREFIX: `hugescreen-test-${process.pid}` };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1200x800x24", require("electron"),
    resolve("test/fixtures/hugescreenPersistence.cjs"), "--no-sandbox", "--ozone-platform=x11"],
  { env, encoding: "utf8", timeout: 40000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /HUGESCREEN_PERSISTENCE_PASSED/);
  const restarted = spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1200x800x24", require("electron"),
    resolve("test/fixtures/hugescreenPersistence.cjs"), "--no-sandbox", "--ozone-platform=x11"],
  { env: { ...env, BOATYARD_TEST_RESTART: "1" }, encoding: "utf8", timeout: 40000 });
  assert.equal(restarted.status, 0, restarted.stdout + restarted.stderr);
  assert.match(restarted.stdout, /HUGESCREEN_RESTART_PASSED/);
});
