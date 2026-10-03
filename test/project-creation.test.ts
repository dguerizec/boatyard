import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createRendererNavigationController } from "../src/renderer/rendererNavigationController";

test("project selection exposes navigation completion before project-scoped work", async () => {
  let complete!: () => void;
  const persisted = new Promise<void>(resolve => { complete = resolve; });
  let renders = 0;
  const navigation = createRendererNavigationController({
    closeProjectGroupMenu() {},
    closeTerminalTabMenu() {},
    getCollapsedProjectGroups: () => new Set<string>(),
    getPinnedProjectIds: () => [],
    hasProject: () => true,
    isSidebarCollapsed: () => false,
    render: () => { renders++; },
    updateNavigation: () => persisted
  });
  let selected = false;
  const selection = navigation.selectProject("new-project").then(() => { selected = true; });
  await Promise.resolve();
  assert.equal(navigation.getCurrentProjectId(), "new-project");
  assert.equal(renders, 1, "normal selection still renders immediately");
  assert.equal(selected, false, "selection waits for main-process navigation");
  complete();
  await selection;
  assert.equal(selected, true);
});

test("isolated Electron creates a project with its TwiCC pane after activating it", t => {
  if (process.platform !== "linux" || spawnSync("which", ["xvfb-run"]).status !== 0) {
    t.skip("Native project creation integration requires Linux with xvfb-run");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "boatyard-project-creation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "config");
  const profile = join(root, "profiles/default");
  mkdirSync(profile, { recursive: true });
  const json = (file: string, data: unknown) => writeFileSync(join(profile, file), JSON.stringify(data));
  json("projects.json", { projects: [
    { id: "existing", name: "Existing" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `grouped-${index}`, name: `Grouped ${index}`, group: "Team" })),
    { id: "ungrouped", name: "Ungrouped" }
  ] });
  json("settings.json", {
    app: { lastSeenVersion: "0.18.1", dismissedChangelogVersion: "0.18.1" },
    onboarding: { completedVersion: 1, completedAt: "2026-01-01T00:00:00Z" }
  });
  json("workspace-session.json", { navigation: { view: "project", projectId: "existing" } });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BOATYARD_CONFIG_ROOT: root,
    BOATYARD_USER_DATA_PATH: join(directory, "chromium"),
    BOATYARD_STATE_PATH: join(directory, "unused-legacy.json"),
    BOATYARD_TERMINAL_SESSION_PREFIX: `project-creation-test-${process.pid}`
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1200x800x24", require("electron"),
    resolve("test/fixtures/project-creation.cjs"), "--no-sandbox", "--ozone-platform=x11"],
  { env, encoding: "utf8", timeout: 55000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PROJECT_CREATION_PASSED/);
});
