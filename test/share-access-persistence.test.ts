import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ShareAccessState } from "../src/main/shareAccessState";
import { RemoteServer } from "../src/main/remoteServer";
import { RemoteAccessController } from "../src/main/remoteAccessController";
import { loadRemoteAccessSettings, RemoteAccessManager } from "../src/main/remoteAccessManager";

test("Share restores options and codes, excludes pending admission and microphone state, and persists revocations", t => {
  const root = mkdtempSync(join(tmpdir(), "boatyard-share-access-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "share-access.json");
  const access = new ShareAccessState(undefined, file);
  access.configure({ groupEnabled: true, groupApprovalRequired: false });
  const groupCode = access.hostSnapshot().groupCode;
  const invitation = access.create("Alice");
  access.participants.get(invitation.id)!.voiceAllowed = true;
  const pending = access.request("Waiting", "group");
  const approved = access.request("Approved but absent", "group");
  access.decide(approved.id, true);
  access.configure({ groupApprovalRequired: false });
  const restored = new ShareAccessState(undefined, file);
  assert.deepEqual(restored.publicSettings, access.publicSettings);
  assert.equal(restored.isGroup(groupCode), true);
  assert.deepEqual(restored.lookup(invitation.token), invitation);
  assert.equal(restored.participants.size, 1);
  assert.equal(restored.poll(pending.token), undefined);
  assert.equal(restored.poll(approved.token), undefined);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(file, "utf8").includes(pending.token));
  restored.revoke(invitation.id);
  assert.equal(new ShareAccessState(undefined, file).lookup(invitation.token), undefined);
  restored.configure({ allowJoinRequests: true });
  assert.deepEqual(new ShareAccessState(undefined, file).publicSettings, { groupEnabled: false, groupApprovalRequired: false, allowJoinRequests: true });
  const request = restored.request("Accepted", "request");
  restored.decide(request.id, true);
  const id = restored.poll(request.token)!.participantId!;
  restored.claimed(id);
  assert.equal(new ShareAccessState(undefined, file).participants.get(id)?.label, "Accepted");
});

test("Malformed saved admission fails closed without partially restoring invitations", t => {
  const root = mkdtempSync(join(tmpdir(), "boatyard-share-access-invalid-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "share-access.json");
  writeFileSync(file, JSON.stringify({ version: 1, settings: { groupEnabled: true, groupApprovalRequired: false, allowJoinRequests: false }, groupCode: "123456",
    invitations: [{ id: "first", label: "Alice", token: "234567" }, { id: "second", label: "Bob", token: "123456" }] }));
  const restored = new ShareAccessState(undefined, file);
  assert.equal(restored.participants.size, 0);
  assert.deepEqual(restored.publicSettings, { groupEnabled: false, groupApprovalRequired: true, allowJoinRequests: false });
});

test("Share browser authentication persists device takeover and forced disconnection without reviving old cookies", async t => {
  const root = mkdtempSync(join(tmpdir(), "boatyard-share-browser-auth-")), file = join(root, "share-access.json");
  let server: RemoteServer;
  t.after(async () => { await server?.stop(); rmSync(root, { recursive: true, force: true }); });
  const boot = async () => {
    const access = new ShareAccessState(undefined, file);
    server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true, shareAccess: access,
      listWindows: () => [], connect: async () => ({ sessionId: "unused", type: "answer", sdp: "v=0" }), disconnect() {} });
    return `http://127.0.0.1:${await server.start()}`;
  };
  let origin = await boot();
  const invitation = server!.createReadOnlyInvitation("Alice");
  const signIn = async () => {
    const response = await fetch(`${origin}/api/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: invitation.token }) });
    assert.equal(response.status, 200); return response.headers.get("set-cookie")!.split(";")[0];
  };
  const windows = (cookie: string) => fetch(`${origin}/api/windows`, { headers: { Cookie: cookie } });
  const oldCookie = await signIn(), cookie = await signIn();
  await server!.stop(); origin = await boot();
  assert.equal((await windows(oldCookie)).status, 401, "Device takeover is durable");
  assert.equal((await windows(cookie)).status, 200);
  server!.disconnectClient(invitation.id);
  await server!.stop(); origin = await boot();
  assert.equal((await windows(cookie)).status, 401, "Forced disconnection is durable");
  assert.equal((await windows(await signIn())).status, 200, "The reusable invitation still permits a deliberate join");
});

test("Restart resumes enabled Share with saved codes, and explicit Stop remains stopped while keeping options", async t => {
  const root = mkdtempSync(join(tmpdir(), "boatyard-share-restart-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  async function boot() {
    const stores = await loadRemoteAccessSettings(root);
    const access = new ShareAccessState(undefined, join(root, "share-access.json"));
    const remote = new RemoteAccessController(stores.remote, () => { throw new Error("Remote should remain disabled."); });
    let server!: RemoteServer;
    const share = new RemoteAccessController(stores.share, () => {
      server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), host: "127.0.0.1", port: 0, passwordHash: "", readOnly: true, shareAccess: access,
        listWindows: () => [], connect: async () => ({ sessionId: "fixture", type: "answer", sdp: "v=0" }), disconnect() {} });
      return { server, start: () => server.start(), stop: () => server.stop() };
    }, undefined, access);
    const manager = new RemoteAccessManager({ remote, share });
    t.after(() => manager.stop());
    await manager.initialize();
    return { manager, server: () => server };
  }
  const first = await boot();
  await first.manager.configureShareAccess({ groupEnabled: true, groupApprovalRequired: false });
  const invitation = await first.manager.createReadOnlyLink("Alice");
  const revoked = await first.manager.createReadOnlyLink("Revoke while stopped");
  const groupCode = first.manager.getStatus("share").shareAccess!.groupCode;
  const redeem = (origin: string, code: string) => fetch(`${origin}/api/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: code, label: "Alice" }) });
  const login = await redeem(first.manager.getStatus("share").urls[0], invitation.code);
  assert.equal(login.status, 200);
  assert.ok(!readFileSync(join(root, "share-access.json"), "utf8").includes(login.headers.get("set-cookie")!.split(";")[0].split("=")[1]), "Only hashed browser tokens are persisted");
  const oldCookie = login.headers.get("set-cookie")!.split(";")[0];
  await first.manager.stop();
  const second = await boot();
  const status = second.manager.getStatus("share");
  assert.equal(status.listening, true, "Enabled Share resumes automatically");
  assert.equal(status.shareAccess!.groupCode, groupCode);
  assert.equal(status.shareAccess!.groupApprovalRequired, false);
  assert.equal(status.clients.length, 2);
  assert.equal(status.clients[0].code, invitation.code);
  assert.equal((status.clients[0] as { state?: string }).state, "signed-in");
  const resumedOrigin = status.urls[0];
  assert.equal((await fetch(`${resumedOrigin}/api/windows`, { headers: { Cookie: oldCookie } })).status, 200);
  assert.equal((await redeem(resumedOrigin, invitation.code)).status, 200);
  await second.manager.configure("share", {});
  await assert.rejects(second.manager.configureShareAccess({ groupEnabled: true, allowJoinRequests: true }), /Choose either/);
  assert.equal(second.manager.getStatus("share").listening, false);
  assert.equal(second.manager.getStatus("share").clients.length, 2, "Failed setup must preserve restored invitations");
  assert.equal(second.manager.getStatus("share").shareAccess!.groupCode, groupCode);
  await second.manager.revokeClient(revoked.id!);
  const unused = await second.manager.createReadOnlyLink("Unused invitation");
  await second.manager.configure("share", { enabled: true });
  const origin = second.manager.getStatus("share").urls[0];
  const resumedLogin = await redeem(origin, invitation.code);
  assert.equal(resumedLogin.status, 200);
  const resumedCookie = resumedLogin.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await redeem(origin, revoked.code)).status, 401);
  await second.manager.configure("share", { enabled: false });
  assert.equal(second.manager.getStatus("share").clients.length, 1, "Stop preserves invitations that have never been used");
  assert.equal(second.manager.getStatus("share").shareAccess!.groupApprovalRequired, false);
  const third = await boot();
  assert.equal(third.manager.getStatus("share").listening, false, "Explicit Stop survives restart");
  assert.equal(third.manager.getStatus("share").clients.length, 1);
  assert.notEqual(third.manager.getStatus("share").shareAccess!.groupCode, groupCode);
  await third.manager.configure("share", { enabled: true });
  assert.equal((await redeem(third.manager.getStatus("share").urls[0], invitation.code)).status, 401);
  assert.equal((await fetch(`${third.manager.getStatus("share").urls[0]}/api/windows`, { headers: { Cookie: resumedCookie } })).status, 401);
  assert.equal((await redeem(third.manager.getStatus("share").urls[0], unused.code)).status, 200);
});
