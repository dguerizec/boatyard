import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canShareScreen, sharedProjectKey } from "../src/main/shareScreenPolicy";
import { RemoteSettingsStore } from "../src/main/remoteSettingsStore";
import { RemoteAccessController } from "../src/main/remoteAccessController";
import { createRendererNavigationController } from "../src/renderer/rendererNavigationController";
import { RemoteAccessManager } from "../src/main/remoteAccessManager";

test("Share only reveals an explicitly allowed project's workspace in its own context", () => {
  const settings = { screenHidden: false, sharedProjectIds: [sharedProjectKey("profile", "allowed")] };
  assert.equal(canShareScreen(settings, "profile", { view: "project", projectId: "allowed" }), true);
  for (const view of ["global", "global-settings", "project-edit", "project-create"]) {
    assert.equal(canShareScreen(settings, "profile", { view, projectId: "allowed" }), false);
  }
  assert.equal(canShareScreen(settings, "profile", { view: "project", projectId: "private" }), false);
  assert.equal(canShareScreen(settings, "other-profile", { view: "project", projectId: "allowed" }), false);
  assert.equal(canShareScreen({ ...settings, screenHidden: true }, "profile", { view: "project", projectId: "allowed" }), false);
});

test("Share screen controls persist, serialize and keep both running servers and participants", async t => {
  const root = mkdtempSync(join(tmpdir(), "boatyard-share-screen-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shareStore = new RemoteSettingsStore(join(root, "share.json"), { readOnly: true, port: 47832 });
  const events: string[] = [];
  const make = (store: RemoteSettingsStore) => new RemoteAccessController(store, () => ({
    async start() { events.push("start"); return 47832; }, async stop() { events.push("stop"); },
    server: { getConnectionOrigins: () => [], getClients: () => [{ id: "viewer", state: "connected" }], createReadOnlyInvitation: () => ({ token: "fixture", expiresAt: 123 }) }
  }));
  const remote = make(new RemoteSettingsStore(join(root, "remote.json")));
  const manager = new RemoteAccessManager({ remote, share: make(shareStore) });
  await manager.configure("remote", { enabled: true, password: "fixture-password" });
  await manager.createReadOnlyLink();
  await Promise.all([manager.toggleShareScreen(), manager.toggleShareScreen()]);
  assert.equal(manager.getStatus("share").screenHidden, false);
  await manager.updateShareScreen({ screenHidden: true, sharedProjectIds: ["profile:allowed"] });
  assert.equal(manager.getStatus("remote").listening, true);
  assert.equal(manager.getStatus("share").listening, true);
  assert.equal(manager.getStatus("share").clients.length, 1);
  assert.deepEqual(events, ["start", "start"]);
  const restored = new RemoteSettingsStore(join(root, "share.json")).load();
  assert.equal(restored.screenHidden, true); assert.deepEqual(restored.sharedProjectIds, ["profile:allowed"]);
  const revision = shareStore.getRevision();
  await assert.rejects(manager.updateShareScreen({ sharedProjectIds: [123] }), /Invalid shared projects/);
  await assert.rejects(manager.updateShareScreen({ screenHidden: "false" }), /Invalid screen visibility/);
  assert.equal(shareStore.getRevision(), revision);
  await manager.stop();
  const legacy = join(root, "legacy.json");
  writeFileSync(legacy, JSON.stringify({ enabled: false, readOnly: true, port: 47832 }));
  assert.deepEqual(new RemoteSettingsStore(legacy).load().sharedProjectIds, [], "Existing settings migrate to private projects");
});

test("Navigation announces privacy before rendering persisted and transient views", () => {
  const events: string[] = [];
  const controller = createRendererNavigationController({
    closeProjectGroupMenu() {}, closeTerminalTabMenu() {}, getCollapsedProjectGroups: () => new Set(),
    getPinnedProjectIds: () => [], hasProject: () => true, isSidebarCollapsed: () => false,
    prepareNavigation: navigation => { events.push(`guard:${navigation.view}:${navigation.projectId}`); },
    render: () => { events.push("render"); }, updateNavigation: async () => { events.push("persist"); }
  });
  controller.selectProject("allowed");
  assert.deepEqual(events, ["guard:project:allowed", "persist", "render"]);
  events.length = 0; controller.selectCreateProject();
  assert.deepEqual(events, ["guard:project-create:null", "render"]);
  events.length = 0; controller.selectGlobalSettings();
  assert.deepEqual(events, ["guard:global-settings:null", "persist", "render"]);
  events.length = 0; controller.restoreNavigation({ view: "project", projectId: "synced" });
  assert.deepEqual(events, ["guard:project:synced"]);
});
