import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSettingsStore } from "../src/main/remoteSettingsStore";
import { RemoteAccessController } from "../src/main/remoteAccessController";
import { verifyRemotePassword } from "../src/main/remotePassword";

test("remote settings persist only a salted password verifier and validate before writing", async t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-remote-settings-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "remote.json"), store = new RemoteSettingsStore(file);
  assert.equal(store.load().enabled, false);
  await assert.rejects(store.update({ enabled: true }), /password/);
  const saved = await store.update({ password: "fixture-password", enabled: true, readOnly: true, port: 47832, publicOrigin: "https://remote.example.com/" });
  assert.equal(saved.publicOrigin, "https://remote.example.com");
  assert.ok(await verifyRemotePassword("fixture-password", saved.passwordHash));
  assert.equal(await verifyRemotePassword("wrong", saved.passwordHash), false);
  assert.ok(!readFileSync(file, "utf8").includes("fixture-password"));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(new RemoteSettingsStore(file).load(), saved);
  const before = readFileSync(file, "utf8");
  await assert.rejects(store.update({ port: 0, password: "replacement" }));
  await assert.rejects(store.update({ publicOrigin: "https://remote.example.com/nested" }));
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal((await store.update({ password: "" })).passwordHash, saved.passwordHash);
  assert.equal((await store.update({ password: "fixture-password" })).passwordHash, saved.passwordHash, "Saving the same password preserves browser authentication");
});

test("remote lifecycle serializes configuration, stops old sessions and hides credential hashes", async t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-remote-lifecycle-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new RemoteSettingsStore(join(directory, "remote.json"));
  const events: string[] = []; let active = 0;
  const controller = new RemoteAccessController(store, settings => ({
    server: { getConnectionOrigins: port => [`http://127.0.0.1:${port}`], getConnectedClientCount: () => 1 },
    async start() { events.push(`start:${settings.port}`); assert.equal(++active, 1); return settings.port; },
    async stop() { events.push(`stop:${settings.port}`); active--; }
  }));
  const results = await Promise.all([
    controller.configure({ enabled: true, port: 47831, password: "fixture-password" }),
    controller.configure({ port: 47832, readOnly: true }),
    controller.configure({ enabled: false })
  ]);
  assert.deepEqual(events, ["start:47831", "stop:47831", "start:47832", "stop:47832"]);
  assert.equal(results[1].readOnly, true); assert.equal(results[2].listening, false);
  assert.equal(results[0].connectedClients, 1); assert.equal(results[2].connectedClients, 0);
  assert.ok(!JSON.stringify(results).includes("passwordHash"));
  await controller.stop();
  await assert.rejects(controller.configure({ enabled: true }), /shutting down/);
});


test("passwordless read-only settings reload and share links stay outside status", async t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-remote-readonly-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "remote.json"), store = new RemoteSettingsStore(file);
  await store.update({ enabled: true, readOnly: true });
  assert.equal(new RemoteSettingsStore(file).load().enabled, true);
  await assert.rejects(store.update({ readOnly: false }), /password/);
  const controller = new RemoteAccessController(store, () => ({
    server: { getConnectionOrigins: port => [`http://127.0.0.1:${port}`], createReadOnlyInvitation: () => ({ token: "fixture-secret", expiresAt: 123 }) },
    async start() { return 47831; }, async stop() {}
  }));
  await assert.rejects(controller.createReadOnlyLink(), /Start read-only/);
  await controller.configure();
  assert.deepEqual(await controller.createReadOnlyLink(), { id: undefined, urls: ["http://127.0.0.1:47831/#share=fixture-secret"], expiresAt: 123 });
  assert.ok(!JSON.stringify(controller.getStatus()).includes("fixture-secret"));
  await controller.configure({ enabled: false });
  await assert.rejects(controller.createReadOnlyLink(), /Start read-only/);
  await controller.stop();
  await assert.rejects(controller.createReadOnlyLink(), /shutting down/);
});
