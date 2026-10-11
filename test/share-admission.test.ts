import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { RemoteServer } from "../src/main/remoteServer";
import { ShareAccessState } from "../src/main/shareAccessState";

test("admission modes are exclusive and switching modes closes pending requests without revoking participants", () => {
  const access = new ShareAccessState();
  const participant = access.create("Alice");
  access.configure({ groupEnabled: true });
  assert.equal(access.publicSettings.groupApprovalRequired, true, "Group entry requires host approval by default");
  const oldCode = access.hostSnapshot().groupCode;
  const groupRequest = access.request("Bob", "group");
  access.configure({ allowJoinRequests: true });
  assert.equal(access.publicSettings.groupEnabled, false);
  assert.equal(access.isGroup(oldCode), false);
  assert.equal(access.poll(groupRequest.token)?.state, "declined");
  const request = access.request("Carol", "request");
  access.configure({ groupEnabled: true });
  assert.equal(access.publicSettings.allowJoinRequests, false);
  assert.equal(access.publicSettings.groupApprovalRequired, true);
  assert.equal(access.poll(request.token)?.state, "declined");
  assert.equal(access.lookup(participant.token)?.id, participant.id);
  assert.notEqual(access.hostSnapshot().groupCode, oldCode);
  const before = access.hostSnapshot();
  assert.throws(() => access.configure({ groupEnabled: true, allowJoinRequests: true }), /Choose either/);
  assert.deepEqual(access.hostSnapshot(), before, "Conflicting configuration is rejected without changing state");
  access.configure({ groupEnabled: false });
  assert.equal(access.publicSettings.allowJoinRequests, false, "Both open admission modes can be off");
  access.configure({ groupApprovalRequired: false });
  assert.equal(access.publicSettings.groupApprovalRequired, false, "The host may opt out of approval");
  access.clear();
  assert.equal(access.publicSettings.groupApprovalRequired, true, "A new session restores approval by default");
});

test("Group admission gives every named participant a distinct personal code, with optional approval", async t => {
  const notifications: string[] = [];
  const server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [], connect: async () => ({ sessionId: "fixture", type: "answer", sdp: "v=0" }), disconnect() {}, joinRequested: label => notifications.push(label) });
  const origin = `http://127.0.0.1:${await server.start()}`; t.after(() => server.stop());
  const post = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  server.configureShareAccess({ groupEnabled: true, groupApprovalRequired: false });
  const groupCode = server.getShareAccess()!.groupCode;
  assert.match(groupCode, /^\d{6}$/);
  assert.ok(!JSON.stringify(await (await fetch(`${origin}/api/auth`)).json()).includes(groupCode));
  assert.equal((await post("/api/redeem", { token: groupCode })).status, 400);
  const members = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const response = await post("/api/redeem", { token: groupCode, label: index < 2 ? "Alice" : `Guest ${index}` });
    assert.equal(response.status, 200);
    return { body: await response.json(), cookie: response.headers.get("set-cookie")!.split(";")[0] };
  }));
  const codes = members.map(member => member.body.participant.code);
  assert.equal(new Set(codes).size, 20); assert.ok(!codes.includes(groupCode));
  assert.equal(server.getClients().length, 20, "Duplicate names do not take over another identity");
  for (const member of members) assert.equal((await fetch(`${origin}/api/windows`, { headers: { Cookie: member.cookie } })).status, 200);
  server.configureShareAccess({ groupApprovalRequired: true });
  const pending = await (await post("/api/redeem", { token: groupCode, label: "Needs approval" })).json();
  assert.equal(pending.pending, true); assert.deepEqual(notifications, ["Needs approval"]);
  assert.equal(server.getClients().length, 20, "Pending visitors have no participant or authentication yet");
  server.decideShareJoinRequest(server.getShareAccess()!.requests[0].id, true);
  const accepted = await post("/api/share/request-status", { requestToken: pending.requestToken });
  assert.equal(accepted.status, 200); assert.equal((await accepted.json()).participant.label, "Needs approval");
  assert.ok(accepted.headers.get("set-cookie"));
  assert.equal((await post("/api/share/request-status", { requestToken: pending.requestToken })).status, 410, "A request cannot issue a second authentication");
  server.configureShareAccess({ groupEnabled: false });
  assert.equal((await post("/api/redeem", { token: groupCode, label: "Late guest" })).status, 401);
  assert.equal((await post("/api/redeem", { token: codes[0], label: "Alice" })).status, 200, "Disabling group entry preserves personal codes");
});

test("Join requests are gated, secret, bounded and cancellable; acceptance, refusal, expiry and stop are terminal", async t => {
  const server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [], connect: async () => ({ sessionId: "fixture", type: "answer", sdp: "v=0" }), disconnect() {} });
  const origin = `http://127.0.0.1:${await server.start()}`; t.after(() => server.stop());
  const post = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("/api/share/request", { label: "Alice" })).status, 403);
  server.configureShareAccess({ allowJoinRequests: true });
  const request = async (label: string) => (await (await post("/api/share/request", { label })).json()).requestToken as string;
  const token = await request("Alice");
  assert.ok(!JSON.stringify(server.getShareAccess()).includes(token), "The host snapshot does not expose polling credentials");
  assert.equal((await post("/api/share/request-status", { requestToken: "wrong" })).status, 410);
  assert.deepEqual(await (await post("/api/share/request-status", { requestToken: token })).json(), { pending: true, declined: false });
  const id = server.getShareAccess()!.requests[0].id;
  server.decideShareJoinRequest(id, false);
  assert.equal((await (await post("/api/share/request-status", { requestToken: token })).json()).declined, true);
  assert.throws(() => server.decideShareJoinRequest(id, true), /no longer pending/);
  const cancelled = await request("Cancel me");
  await post("/api/share/request-cancel", { requestToken: cancelled });
  assert.equal(server.getShareAccess()!.requests.length, 0);
  const revoked = await request("Revoke me");
  server.decideShareJoinRequest(server.getShareAccess()!.requests[0].id, true);
  server.revokeClient(server.getClients()[0].id);
  const revokedReply = await post("/api/share/request-status", { requestToken: revoked });
  assert.equal((await revokedReply.json()).declined, true); assert.equal(revokedReply.headers.get("set-cookie"), null);
  const disabled = await request("Disable requests");
  server.configureShareAccess({ allowJoinRequests: false });
  assert.equal((await (await post("/api/share/request-status", { requestToken: disabled })).json()).declined, true);
  server.configureShareAccess({ allowJoinRequests: true });
  const expired = await request("Expire me");
  server.decideShareJoinRequest(server.getShareAccess()!.requests[0].id, true);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 11 * 60 * 1000;
    assert.equal((await post("/api/share/request-status", { requestToken: expired })).status, 410);
    assert.equal(server.getClients().length, 0, "Unclaimed approvals expire without leaving reserved participants");
  } finally { Date.now = originalNow; }
  const lateCancellation = await request("Cancel after approval");
  server.decideShareJoinRequest(server.getShareAccess()!.requests[0].id, true);
  const issued = await post("/api/share/request-status", { requestToken: lateCancellation });
  const cookie = issued.headers.get("set-cookie")!.split(";")[0];
  await post("/api/share/request-cancel", { requestToken: lateCancellation });
  assert.equal((await fetch(`${origin}/api/windows`, { headers: { Cookie: cookie } })).status, 401, "Cancellation also revokes authentication issued by a racing approval poll");
  const stopped = await request("Stop sharing");
  await server.stop();
  const nextOrigin = `http://127.0.0.1:${await server.start()}`;
  assert.equal((await fetch(`${nextOrigin}/api/share/request-status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestToken: stopped }) })).status, 410);
  assert.equal(server.getShareAccess()!.allowJoinRequests, false);
});

test("Six-digit code guesses are throttled without consuming valid codes", async t => {
  const server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [], connect: async () => ({ sessionId: "fixture", type: "answer", sdp: "v=0" }), disconnect() {} });
  const origin = `http://127.0.0.1:${await server.start()}`; t.after(() => server.stop());
  const invitation = server.createReadOnlyInvitation("Alice");
  const wrong = invitation.token === "000000" ? "000001" : "000000";
  const preview = (token: string) => fetch(`${origin}/api/share/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  for (let index = 0; index < 10; index++) assert.equal((await preview(wrong)).status, 401);
  assert.equal((await preview(invitation.token)).status, 429);
  const originalNow = Date.now;
  try { Date.now = () => originalNow() + 61000; assert.equal((await preview(invitation.token)).status, 200); }
  finally { Date.now = originalNow; }
});

test("A device takeover cancels pending setup without completing the cancelled setup", async t => {
  let entered!: () => void, finish!: (value: { sessionId: string; type: "answer"; sdp: string }) => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const disconnected: (string | undefined)[] = [];
  const server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [{ id: "window", title: "Fixture", width: 800, height: 600 }],
    connect: async (_offer, created) => {
      created?.("pending-session"); entered();
      return new Promise(resolve => { finish = resolve; });
    }, disconnect: id => disconnected.push(id) });
  const origin = `http://127.0.0.1:${await server.start()}`; t.after(() => server.stop());
  const invitation = server.createReadOnlyInvitation("Alice");
  const post = (path: string, body: unknown, cookie = "") => fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  const first = await post("/api/redeem", { token: invitation.token });
  const cookie = first.headers.get("set-cookie")!.split(";")[0];
  const pending = post("/api/connect", { windowId: "window", type: "offer", sdp: "v=0" }, cookie);
  await started;
  assert.equal((await post("/api/redeem", { token: invitation.token })).status, 200);
  assert.deepEqual(disconnected, ["pending-session"], "Setup is closed immediately, before it produces its answer");
  finish({ sessionId: "pending-session", type: "answer", sdp: "v=0" });
  assert.equal((await pending).status, 401); assert.equal(server.getConnectedClientCount(), 0);
});
