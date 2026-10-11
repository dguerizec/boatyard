import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { WebrtcSettingsStore, TURN_CREDENTIAL_TTL } from "../src/main/webrtcSettings.js";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "boatyard-webrtc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("fresh installations are direct only and migrate private Cloudflare settings once", async t => {
  const root = fixture(t), legacy = join(root, "cloudflare-turn.json");
  const store = new WebrtcSettingsStore(root);
  assert.equal(store.load().provider, "direct");
  assert.deepEqual(await store.getIceServers(), []);
  writeFileSync(legacy, JSON.stringify({ keyId: "a".repeat(32), apiToken: "fixture-private-secret" }));
  const migrated = store.load();
  assert.equal(migrated.provider, "cloudflare");
  assert.equal(migrated.hasApiToken, true);
  assert.ok(!JSON.stringify(migrated).includes("fixture-private-secret"));
  assert.equal(statSync(store.filePath).mode & 0o777, 0o600);
  assert.equal(statSync(legacy).mode & 0o777, 0o600);
  store.update({ provider: "direct" });
  assert.equal(new WebrtcSettingsStore(root).load().provider, "direct", "Legacy settings cannot re-enable a disabled provider");
});

test("Cloudflare configuration preserves blank secrets and exposes only temporary ICE credentials", async t => {
  const root = fixture(t);
  let calls = 0;
  const store = new WebrtcSettingsStore(root, undefined, async (_url, options) => {
    calls++;
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer fixture-private-secret");
    return Response.json({ iceServers: [{ urls: "turns:relay.example:443", username: "temporary", credential: "temporary-password" }] });
  });
  store.load();
  store.update({ provider: "cloudflare", keyId: "b".repeat(32), apiToken: "fixture-private-secret" });
  store.update({ apiToken: "" });
  assert.ok(!JSON.stringify(await store.getIceServers()).includes("fixture-private-secret"));
  assert.equal(calls, 1);
  assert.throws(() => store.update({ keyId: "invalid" }), /Cloudflare TURN/);
  assert.equal(store.status().keyId, "b".repeat(32));
});

test("custom TURN validates authentication and generates coturn-compatible expiring credentials", async t => {
  const root = fixture(t), store = new WebrtcSettingsStore(root);
  store.load();
  assert.throws(() => store.update({ provider: "custom", urls: ["stun:example:3478"] }), /valid TURN/);
  assert.throws(() => store.update({ provider: "custom", urls: ["turn:example:3478"] }), /authentication/);
  for (const url of ["turn:example:0", "turn:example:65536", "turn:user@host:3478", "turn:example/path"]) {
    assert.throws(() => store.update({ urls: [url] }), /valid TURN/);
  }
  store.update({ provider: "custom", urls: ["turn:example:3478?transport=udp", "turns:[::1]:5349"], username: "user", password: "fixture-password" });
  const servers = await store.getIceServers();
  assert.equal(servers[0].credential, "fixture-password");
  assert.ok(!JSON.stringify(store.status()).includes("fixture-password"));
  store.update({ authentication: "temporary", sharedSecret: "fixture-shared-secret" });
  const temporary = (await store.getIceServers())[0];
  assert.equal(temporary.credential, createHmac("sha1", "fixture-shared-secret").update(temporary.username!).digest("base64"));
  assert.ok(Math.abs(Number(temporary.username!.split(":")[0]) - Date.now() / 1000 - TURN_CREDENTIAL_TTL) < 2);
  assert.notEqual((await store.getIceServers())[0].username, temporary.username);
  assert.ok(!JSON.stringify(store.status()).includes("fixture-shared-secret"));
  assert.ok(readFileSync(store.filePath, "utf8").includes("fixture-shared-secret"));
});

test("malformed persisted settings fail explicitly and environment overrides retain precedence", async t => {
  const root = fixture(t), store = new WebrtcSettingsStore(root, '[{"urls":"turn:override.example:3478","username":"override","credential":"fixture"}]');
  store.load();
  assert.equal(store.status().overridden, true);
  assert.equal((await store.getIceServers())[0].username, "override");
  writeFileSync(store.filePath, "{invalid");
  assert.throws(() => store.load(), /Could not load WebRTC/);
  const invalid = new WebrtcSettingsStore(root);
  assert.throws(() => invalid.load(), /Could not load WebRTC/);
  await assert.rejects(invalid.getIceServers(), /Could not load WebRTC/, "Invalid settings cannot silently fall back to direct");
  invalid.update({ provider: "direct" });
  assert.equal(invalid.status().error, "");
  assert.deepEqual(await invalid.getIceServers(), []);
});

test("forced relay persists without exposing the coturn shared secret and requires TURN", async t => {
  const root = fixture(t), store = new WebrtcSettingsStore(root);
  store.load();
  assert.equal(store.getIceTransportPolicy(), "all");
  assert.throws(() => store.update({ forceRelay: true }), /Configure TURN/);
  assert.throws(() => store.update({ forceRelay: "true" }), /relay policy/);
  store.update({ provider: "custom", urls: ["turns:turn.example:5349?transport=tcp"],
    authentication: "temporary", sharedSecret: "fixture-relay-secret", forceRelay: true });
  const reloaded = new WebrtcSettingsStore(root);
  assert.equal(reloaded.load().forceRelay, true);
  assert.equal(reloaded.getIceTransportPolicy(), "relay");
  const servers = await reloaded.getIceServers();
  assert.ok(!JSON.stringify(servers).includes("fixture-relay-secret"));
  assert.ok(!JSON.stringify(reloaded.status()).includes("fixture-relay-secret"));
  assert.equal(servers[0].credential, createHmac("sha1", "fixture-relay-secret").update(servers[0].username!).digest("base64"));
  reloaded.update({ provider: "direct", forceRelay: false });
  assert.equal(reloaded.getIceTransportPolicy(), "all");
});


test("TURN address comments survive saving and are excluded from client credentials", async t => {
  const root = fixture(t), store = new WebrtcSettingsStore(root);
  const urls = ["# UDP relay", "  turn:turn.example:3478?transport=udp # Preferred transport", "",
    "# turns:disabled.example:5349?transport=tcp", "turns:turn.example:5349?transport=tcp#TLS fallback"];
  store.load();
  store.update({ provider: "custom", urls, authentication: "temporary", sharedSecret: "fixture-shared-secret" });
  const reloaded = new WebrtcSettingsStore(root);
  assert.deepEqual(reloaded.load().urls, urls);
  assert.deepEqual((await reloaded.getIceServers())[0].urls,
    ["turn:turn.example:3478?transport=udp", "turns:turn.example:5349?transport=tcp"]);
  assert.throws(() => reloaded.update({ urls: ["# Only disabled addresses", "# turn:turn.example:3478"] }), /addresses and authentication/);
  assert.throws(() => reloaded.update({ urls: ["stun:example:3478 # Unsupported address"] }), /valid TURN/);
  assert.throws(() => reloaded.update({ urls: Array(17).fill("turn:example:3478 # Active") }), /valid TURN/);
});
