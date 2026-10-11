import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRemoteIceProvider } from "../src/main/cloudflareTurn.js";
import { remoteConnectionRoute, remotePeerConfiguration, waitForRemoteIce } from "../src/shared/remoteIce.js";

test("connection route follows the selected pair and detects relay on either peer", () => {
  const reports = new Map<string, Record<string, unknown>>([
    ["transport", { type: "transport", selectedCandidatePairId: "selected" }],
    ["selected", { type: "candidate-pair", localCandidateId: "local", remoteCandidateId: "remote" }],
    ["unused-relay", { type: "local-candidate", candidateType: "relay" }],
    ["local", { type: "local-candidate", candidateType: "host" }],
    ["remote", { type: "remote-candidate", candidateType: "srflx" }]
  ]);
  const stats = reports as unknown as RTCStatsReport;
  assert.equal(remoteConnectionRoute(stats), "direct");
  reports.get("remote")!.candidateType = "relay";
  assert.equal(remoteConnectionRoute(stats), "relay");
  reports.get("remote")!.candidateType = "host";
  reports.get("local")!.candidateType = "relay";
  assert.equal(remoteConnectionRoute(stats), "relay");
  reports.delete("selected");
  assert.equal(remoteConnectionRoute(stats), null);
});

test("Cloudflare TURN issues temporary credentials, filters blocked ports and keeps the key private", async t => {
  const root = await mkdtemp(join(tmpdir(), "boatyard-turn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "cloudflare-turn.json"), keyId = "a".repeat(32);
  const unused = createRemoteIceProvider(file);
  assert.deepEqual(await unused(), []);
  await writeFile(file, JSON.stringify({ keyId, apiToken: "private-key" }));
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`);
    assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer private-key");
    assert.equal(JSON.parse(String(init!.body)).ttl, 43200);
    assert.equal(init!.method, "POST"); assert.ok(init!.signal);
    return Response.json({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" },
      { urls: ["turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "temporary-user", credential: `temporary-${calls}` }] });
  };
  const provider = createRemoteIceProvider(file, undefined, request);
  const first = await provider();
  assert.deepEqual(first[0].urls, ["turns:turn.cloudflare.com:443?transport=tcp"]);
  assert.ok(!JSON.stringify(first).includes("private-key"));
  assert.notEqual((await provider())[0].credential, first[0].credential);
  await writeFile(file, "invalid");
  await assert.rejects(provider(), /Could not read Cloudflare TURN configuration/);
  assert.deepEqual(await createRemoteIceProvider(file, '[{"urls":"stun:override.example:3478"}]', request)(), []);
});

test("both peers allow direct connections with TURN fallback while excluding dedicated STUN servers", () => {
  const config = remotePeerConfiguration([{ urls: "stun:example:3478" },
    { urls: ["stun:example:3478", "turns:example:443"], username: "viewer", credential: "temporary" }]);
  assert.equal(config.iceTransportPolicy, "all");
  assert.equal(remotePeerConfiguration(config.iceServers, "relay").iceTransportPolicy, "relay");
  assert.deepEqual(config.iceServers, [{ urls: ["turns:example:443"], username: "viewer", credential: "temporary" }]);
  assert.deepEqual(remotePeerConfiguration(), { iceServers: [], iceTransportPolicy: "all" });
});

test("ICE respects an explicit relay-only policy when another transport stalls", async () => {
  const events = new EventTarget();
  const fake = Object.assign(events, { iceGatheringState: "gathering", localDescription: { sdp: "a=candidate:1 1 udp 1 192.0.2.1 1234 typ relay\r\n" },
    getConfiguration: () => ({ iceTransportPolicy: "relay" }) });
  const peer = fake as unknown as RTCPeerConnection;
  await waitForRemoteIce(peer, 1);
  fake.localDescription.sdp = "a=candidate:1 1 udp 1 192.0.2.1 1234 typ host\r\n";
  await assert.rejects(waitForRemoteIce(peer, 1), /without a usable connection candidate/);
});

test("Cloudflare TURN failures do not leak provider secrets or retry credential creation", async t => {
  const root = await mkdtemp(join(tmpdir(), "boatyard-turn-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "cloudflare-turn.json");
  await writeFile(file, JSON.stringify({ keyId: "b".repeat(32), apiToken: "private-key" }));
  let calls = 0;
  const provider = createRemoteIceProvider(file, undefined, async () => { calls++; throw new Error("private-key"); });
  await assert.rejects(provider(), error => error instanceof Error && !error.message.includes("private-key") && /Could not obtain/.test(error.message));
  assert.equal(calls, 1);
  const malformed = createRemoteIceProvider(file, undefined, async () => Response.json({ iceServers: [] }));
  await assert.rejects(malformed(), /Could not obtain/);
});
