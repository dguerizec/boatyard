import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRemoteAccessSettings, RemoteAccessManager } from "../src/main/remoteAccessManager";
import { RemoteAccessController } from "../src/main/remoteAccessController";
import { RemoteServer } from "../src/main/remoteServer";
import { resolve } from "node:path";

test("Remote and Share start independently, fix their permissions and reject conflicting endpoints", async t => {
  const root = mkdtempSync(join(tmpdir(), "boatyard-remote-modes-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const stores = await loadRemoteAccessSettings(root), events: string[] = [];
  const make = (mode: "remote" | "share") => new RemoteAccessController(stores[mode], settings => ({
    async start() { events.push(`start:${mode}:${settings.readOnly}`); return settings.port; },
    async stop() { events.push(`stop:${mode}`); },
    server: { getConnectionOrigins: port => [`http://127.0.0.1:${port}`], createReadOnlyInvitation: () => ({ id: "viewer", token: "fixture-secret", expiresAt: 123 }), revokeClient: id => events.push(`revoke:${id}`) }
  }));
  const manager = new RemoteAccessManager({ remote: make("remote"), share: make("share") });
  await manager.configure("remote", { enabled: true, password: "fixture-password", publicOrigin: "https://remote.example.com", readOnly: true });
  await assert.rejects(manager.configure("share", { enabled: true }), /Add a client/);
  await manager.configure("share", { publicOrigin: "https://share.example.com", readOnly: false });
  assert.equal(manager.getStatus("share").listening, false);
  assert.equal((await manager.createReadOnlyLink("Viewer")).id, "viewer");
  assert.deepEqual(events, ["start:remote:false", "start:share:true"]);
  assert.equal(manager.getStatus("share").port, 47832);
  assert.equal(manager.getStatus("remote").listening, true); assert.equal(manager.getStatus("share").listening, true);
  assert.equal((await manager.createReadOnlyLink("Viewer")).id, "viewer");
  assert.ok(!JSON.stringify(manager.getStatuses()).includes("fixture-secret"));
  await manager.configure("share", { port: 47831 });
  await assert.rejects(manager.createReadOnlyLink(), /different ports/);
  assert.equal(manager.getStatus("share").listening, false);
  await manager.configure("share", { port: 47832, publicOrigin: "https://remote.example.com/" });
  await assert.rejects(manager.createReadOnlyLink(), /different external URLs/);
  await manager.configure("share", { publicOrigin: "https://share.example.com" });
  await manager.createReadOnlyLink();
  await manager.revokeClient("viewer");
  await manager.configure("share", { enabled: false });
  assert.equal(manager.getStatus("remote").listening, true); assert.equal(manager.getStatus("share").listening, false);
  await manager.createReadOnlyLink();
  await manager.initialize();
  assert.equal(manager.getStatus("share").listening, false, "Share never starts without clients on initialization");
  await manager.stop(); await assert.rejects(manager.configure("remote", { enabled: true }), /shutting down/);
});

test("Share survives viewer disconnections and explicit Stop closes the sharing session", async t => {
  const root = mkdtempSync(join(tmpdir(), "boatyard-share-lifecycle-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const stores = await loadRemoteAccessSettings(root);
  let manager!: RemoteAccessManager, server!: RemoteServer, next = 0;
  const remote = new RemoteAccessController(stores.remote, settings => ({ async start() { return settings.port; }, async stop() {}, server: { getConnectionOrigins: () => [] } }));
  const share = new RemoteAccessController(stores.share, settings => {
    server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: settings.readOnly,
      listWindows: () => [{ id: "window", title: "Fixture", width: 800, height: 600 }],
      connect: async () => ({ sessionId: `session-${++next}`, type: "answer", sdp: "v=0\r\n" }),
      disconnect: id => { if (id) server.sessionClosed(id); }, clientsChanged: () => manager.clientsChanged("share") });
    return { server, start: () => server.start(), stop: () => server.stop() };
  });
  manager = new RemoteAccessManager({ remote, share }); t.after(() => manager.stop());
  await manager.configure("remote", { enabled: true, password: "fixture-password" });
  await manager.initialize();
  assert.equal(manager.getStatus("share").listening, false);
  const first = await manager.createReadOnlyLink(), second = await manager.createReadOnlyLink();
  const post = (url: string, body: unknown, cookie = "") => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  async function connect(link: string) {
    const url = new URL(link), token = url.hash.slice("#share=".length);
    const login = await post(`${url.origin}/api/redeem`, { token });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const answer = await post(`${url.origin}/api/connect`, { windowId: "window", type: "offer", sdp: "v=0\r\n" }, cookie);
    return { origin: url.origin, cookie, sessionId: (await answer.json()).sessionId };
  }
  const a = await connect(first.urls[0]), b = await connect(second.urls[0]);
  await manager.createReadOnlyLink("Pending viewer");
  await post(`${a.origin}/api/disconnect`, { sessionId: a.sessionId }, a.cookie);
  assert.equal(manager.getStatus("share").listening, true, "Another viewer keeps Share running");
  await post(`${b.origin}/api/disconnect`, { sessionId: b.sessionId }, b.cookie);
  await manager.revokeClient("queue-barrier");
  assert.equal(manager.getStatus("share").listening, true, "Final disconnect keeps Share running for reconnection");
  assert.equal(server.getClients().length, 3);
  const reconnect = await post(`${b.origin}/api/connect`, { windowId: "window", type: "offer", sdp: "v=0\r\n" }, b.cookie);
  assert.equal(reconnect.status, 200, "The same browser reconnects after a network interruption");
  assert.equal(manager.getStatus("remote").listening, true);
  const pending = await manager.createReadOnlyLink();
  assert.equal(manager.getStatus("share").listening, true);
  await manager.configure("share", { enabled: false });
  assert.equal(server.getClients().length, 0, "Explicit Stop clears invitations");
  assert.equal(manager.getStatus("share").listening, false);
  await manager.createReadOnlyLink();
  const client = server.getClients()[0];
  await manager.revokeClient(client.id); await manager.revokeClient("queue-barrier");
  assert.equal(manager.getStatus("share").listening, false, "Revoking the final invited client stops Share");
  assert.ok(pending.urls.length);
});
