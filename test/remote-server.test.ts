import { hashRemotePassword } from "../src/main/remotePassword";
import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteServer } from "../src/main/remoteServer";
import { request } from "node:http";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { cpSync, mkdtempSync, appendFileSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Remote authentication survives time and restarts but not logout or password changes", async t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-remote-auth-")), sessionFilePath = join(directory, "sessions.json");
  const passwordHash = await hashRemotePassword("fixture-password");
  const create = (hash = passwordHash) => new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: hash, sessionFilePath,
    listWindows: () => [], connect: async () => ({ sessionId: "fixture", type: "answer", sdp: "v=0" }), disconnect() {} });
  let server = create(), endpoint = `http://127.0.0.1:${await server.start()}`;
  t.after(async () => { await server.stop(); rmSync(directory, { recursive: true, force: true }); });
  const signIn = async () => {
    const response = await fetch(`${endpoint}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie")!, /Max-Age=34560000/);
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  const windows = (cookie: string) => fetch(`${endpoint}/api/windows`, { headers: { Cookie: cookie } });
  const cookie = await signIn();
  assert.ok(!readFileSync(sessionFilePath, "utf8").includes(cookie.split("=")[1]), "Only token hashes are persisted");
  assert.equal(statSync(sessionFilePath).mode & 0o777, 0o600);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 30 * 24 * 60 * 60 * 1000;
    assert.equal((await windows(cookie)).status, 200, "Authentication has no server-side time limit");
  } finally { Date.now = originalNow; }
  await server.stop(); server = create(); endpoint = `http://127.0.0.1:${await server.start()}`;
  assert.equal((await windows(cookie)).status, 200, "A new server restores the existing browser session");
  await fetch(`${endpoint}/api/logout`, { method: "POST", headers: { Cookie: cookie } });
  await server.stop(); server = create(); endpoint = `http://127.0.0.1:${await server.start()}`;
  assert.equal((await windows(cookie)).status, 401, "Logout remains effective after restart");
  const second = await signIn();
  await server.stop(); server = create(await hashRemotePassword("replacement-password")); endpoint = `http://127.0.0.1:${await server.start()}`;
  assert.equal((await windows(second)).status, 401, "Changing the password invalidates prior sessions");
  await server.stop(); server = create(); endpoint = `http://127.0.0.1:${await server.start()}`;
  assert.equal((await windows(second)).status, 401, "Returning to the previous verifier does not revive invalidated sessions");
});

test("Share authentication has no time limit and is invalidated by stopping the server", async t => {
  const server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [], connect: async () => ({ sessionId: "fixture", type: "answer", sdp: "v=0" }), disconnect() {} });
  const endpoint = `http://127.0.0.1:${await server.start()}`; t.after(() => server.stop());
  const invitation = server.createReadOnlyInvitation();
  const response = await fetch(`${endpoint}/api/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: invitation.token }) });
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 30 * 24 * 60 * 60 * 1000;
    assert.equal((await fetch(`${endpoint}/api/windows`, { headers: { Cookie: cookie } })).status, 200);
  } finally { Date.now = originalNow; }
  await server.stop();
  const restarted = `http://127.0.0.1:${await server.start()}`;
  assert.equal((await fetch(`${restarted}/api/windows`, { headers: { Cookie: cookie } })).status, 401);
});

test("remote PWA assets are public, uncached and versioned by their content", async t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-client-version-"));
  cpSync(resolve("src/renderer/remote"), directory, { recursive: true });
  const server = new RemoteServer({ assetsDirectory: directory, passwordHash: "", readOnly: true,
    listWindows: () => [], connect: async () => ({ sessionId: "fixture", type: "answer", sdp: "v=0" }), disconnect() {} });
  const port = await server.start();
  t.after(async () => { await server.stop(); rmSync(directory, { recursive: true, force: true }); });
  const endpoint = `http://127.0.0.1:${port}`;
  const version = async () => {
    const response = await fetch(`${endpoint}/api/client-version`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return (await response.json()).version as string;
  };
  const first = await version();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(await version(), first, "Unchanged files do not trigger reloads");
  const html = await (await fetch(endpoint)).text();
  assert.ok(html.includes(`name="boatyard-client-version" content="${first}"`), "The page carries its own loaded version");
  assert.ok(html.includes('rel="manifest"'));
  const response = await fetch(`${endpoint}/manifest.json`);
  assert.equal(response.headers.get("content-type"), "application/manifest+json");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const manifest = await response.json();
  assert.equal(manifest.display, "standalone"); assert.equal(manifest.start_url, "/"); assert.equal(manifest.id, "/");
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((icon: { sizes: string }) => icon.sizes === `${size}x${size}`);
    const response = await fetch(`${endpoint}${icon.src}`);
    assert.equal(response.headers.get("content-type"), "image/png");
    const png = Buffer.from(await response.arrayBuffer());
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
  assert.equal((await fetch(`${endpoint}/apple-touch-icon.png`)).status, 200);
  appendFileSync(join(directory, "remote.css"), "\n/* Fixture update. */\n");
  const changed = await version();
  assert.notEqual(changed, first, "Changing client assets updates the version without restarting the service");
  assert.ok((await (await fetch(endpoint)).text()).includes(`content="${await version()}"`));
  assert.equal((await fetch(`${endpoint}/api/windows`)).status, 401, "PWA metadata does not grant access to shared windows");
});

test("remote server gates signaling, serializes sessions and rejects stale disconnects", async t => {
  let connects = 0;
  let iceRequests = 0;
  const disconnected: (string | undefined)[] = [];
  const server = new RemoteServer({
    assetsDirectory: resolve("src/renderer/remote"), passwordHash: await hashRemotePassword("fixture-password"),
    listWindows: () => [{ id: "window", title: "Fixture", width: 800, height: 600 }],
    getIceTransportPolicy: () => "relay",
    getIceServers: async () => { iceRequests++; return [{ urls: "turns:turn.example:443", username: "temporary-user", credential: "temporary-secret" }]; },
    connect: async () => { connects++; return { sessionId: "session", type: "answer", sdp: "v=0\r\n" }; },
    disconnect: id => { disconnected.push(id); }
  });
  const port = await server.start(); t.after(() => server.stop());
  assert.throws(() => server.createReadOnlyInvitation(), /Start read-only/);
  const endpoint = `http://127.0.0.1:${port}`;
  const wrongLogin = await fetch(`${endpoint}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong-password" }) });
  assert.equal(wrongLogin.status, 401);
  const login = await fetch(`${endpoint}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  assert.deepEqual(await login.json(), { authenticated: true });
  const headers = { Cookie: login.headers.get("set-cookie")!.split(";")[0], "Content-Type": "application/json" };
  assert.equal((await fetch(endpoint)).status, 200);
  assert.equal((await fetch(`${endpoint}/api/windows`)).status, 401);
  assert.equal(iceRequests, 0, "Unauthenticated requests cannot generate TURN credentials");
  const metadata = await fetch(`${endpoint}/api/windows`, { headers });
  assert.equal(metadata.headers.get("cache-control"), "no-store");
  const configuration = await metadata.json();
  assert.equal(configuration.iceTransportPolicy, "relay");
  assert.deepEqual(configuration.iceServers, [{ urls: "turns:turn.example:443", username: "temporary-user", credential: "temporary-secret" }]);
  assert.equal(iceRequests, 1);
  assert.equal((await fetch(`${endpoint}/api/windows`, { headers: { ...headers, Origin: "https://untrusted.example" } })).status, 403);
  const invalidHostStatus = await new Promise<number>(resolveStatus => {
    const req = request(`${endpoint}/api/windows`, { headers: { ...headers, Host: "untrusted.example" } }, response => {
      response.resume(); resolveStatus(response.statusCode!);
    }); req.end();
  });
  assert.equal(invalidHostStatus, 403);
  const post = (path: string, body: unknown) => fetch(`${endpoint}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal((await post("/api/connect", { windowId: "other", type: "offer", sdp: "v=0" })).status, 400);
  const offer = { windowId: "window", type: "offer", sdp: "v=0\r\n" };
  const responses = await Promise.all([post("/api/connect", offer), post("/api/connect", offer)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(connects, 1);
  await post("/api/disconnect", { sessionId: "stale" }); assert.equal(disconnected.length, 0);
  assert.equal((await post("/api/connect", offer)).status, 409);
  await post("/api/disconnect", { sessionId: "session" }); assert.deepEqual(disconnected, ["session"]);
  assert.equal((await post("/api/connect", offer)).status, 200);
  assert.equal(server.getConnectedClientCount(), 1);
  server.sessionClosed("session");
  assert.equal(server.getConnectedClientCount(), 0);
  assert.equal((await post("/api/connect", offer)).status, 200);
  assert.equal((await post("/api/disconnect", {})).status, 400);
  assert.equal((await post("/api/logout", {})).status, 200);
  assert.equal((await fetch(`${endpoint}/api/windows`, { headers })).status, 401);
});

test("remote server accepts its LAN address while retaining authentication and origin checks", async t => {
  const address = Object.values(networkInterfaces()).flatMap(entries => entries || [])
    .find(entry => entry.family === "IPv4" && !entry.internal)?.address;
  if (!address) { t.skip("No non-loopback IPv4 interface available"); return; }
  const server = new RemoteServer({
    assetsDirectory: resolve("src/renderer/remote"), passwordHash: await hashRemotePassword("fixture-password"), readOnly: true,
    listWindows: () => [{ id: "window", title: "Fixture", width: 800, height: 600 }],
    connect: async () => ({ sessionId: "session", type: "answer", sdp: "v=0\r\n" }),
    disconnect() {}
  });
  const port = await server.start(); t.after(() => server.stop());
  const origin = `http://${address}:${port}`;
  assert.ok(server.getConnectionOrigins(port).includes(origin));
  assert.equal((await fetch(origin)).status, 200);
  assert.equal((await fetch(`${origin}/api/windows`)).status, 401);
  assert.equal((await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password: "fixture-password" }) })).status, 401);
  const login = await fetch(`${origin}/api/redeem`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ token: server.createReadOnlyInvitation().token }) });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get("set-cookie")!.split(";")[0], Origin: origin };
  const windows = await fetch(`${origin}/api/windows`, { headers });
  assert.equal(windows.status, 200);
  assert.equal((await windows.json()).readOnly, true);
  assert.equal((await fetch(`${origin}/api/windows`, { headers: { ...headers, Origin: "http://untrusted.example" } })).status, 403);
});


test("read-only links are passwordless, consumed once, individually revoked and cleared on stop", async t => {
  const server = new RemoteServer({
    assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [{ id: "window", title: "Fixture", width: 800, height: 600 }],
    connect: async () => ({ sessionId: "session", type: "answer", sdp: "v=0\r\n" }), disconnect() {}
  });
  const port = await server.start(); t.after(() => server.stop());
  const origin = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.deepEqual(await (await fetch(`${origin}/api/auth`)).json(), { passwordLogin: false });
  assert.equal((await post("/api/login", { password: "anything" })).status, 401);
  const unnamed = server.createReadOnlyInvitation(" "), nextUnnamed = server.createReadOnlyInvitation();
  assert.deepEqual(server.getClients().map(client => client.label), ["Viewer 1", "Viewer 2"]);
  server.revokeClient(unnamed.id); server.revokeClient(nextUnnamed.id);
  const afterRemoval = server.createReadOnlyInvitation();
  assert.equal(server.getClients()[0].label, "Viewer 3", "Numbers are not reused after revocation");
  server.revokeClient(afterRemoval.id);
  const old = server.createReadOnlyInvitation("Old viewer"), invitation = server.createReadOnlyInvitation("New viewer");
  assert.equal(server.getClients().length, 2);
  assert.ok(!JSON.stringify(server.getClients()).includes(invitation.token));
  server.revokeClient(old.id);
  assert.ok(invitation.expiresAt > Date.now() && invitation.expiresAt <= Date.now() + 15 * 60 * 1000);
  assert.equal((await post("/api/redeem", { token: old.token })).status, 401);
  assert.equal((await post("/api/redeem", { token: "wrong" })).status, 401);
  // Loading the page does not consume the invitation (e.g. a link preview).
  assert.equal((await fetch(`${origin}/#share=${invitation.token}`)).status, 200);
  const results = await Promise.all([post("/api/redeem", invitation), post("/api/redeem", invitation)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  const login = results.find(result => result.status === 200)!;
  assert.deepEqual(await login.json(), { authenticated: true });
  const headers = { Cookie: login.headers.get("set-cookie")!.split(";")[0] };
  assert.equal((await (await fetch(`${origin}/api/windows`, { headers })).json()).readOnly, true);
  const expiring = server.createReadOnlyInvitation();
  const originalNow = Date.now;
  try {
    Date.now = () => expiring.expiresAt + 1;
    assert.equal((await post("/api/redeem", expiring)).status, 401);
  } finally { Date.now = originalNow; }
  const revoked = server.createReadOnlyInvitation();
  await server.stop();
  const newPort = await server.start();
  assert.equal((await fetch(`http://127.0.0.1:${newPort}/api/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(revoked) })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${newPort}/api/windows`, { headers })).status, 401);
});

test("Share isolates concurrent clients, accepts independent invites and revokes one without affecting others", async t => {
  let next = 0;
  const recovered: string[] = [];
  const disconnected: (string | undefined)[] = [];
  const server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [{ id: "window", title: "Fixture", width: 800, height: 600 }],
    connect: async () => ({ sessionId: `session-${++next}`, type: "answer", sdp: "v=0\r\n" }), disconnect: id => disconnected.push(id),
    recover: async id => { recovered.push(id); return { sessionId: id, type: "answer", sdp: "v=0\r\n" }; } });
  const port = await server.start(); t.after(() => server.stop());
  const origin = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown, cookie = "") => fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  const alice = server.createReadOnlyInvitation("Alice"), bob = server.createReadOnlyInvitation("Bob");
  const cookie = async (token: string) => { const result = await post("/api/redeem", { token }); assert.equal(result.status, 200); return result.headers.get("set-cookie")!.split(";")[0]; };
  const [a, b] = await Promise.all([cookie(alice.token), cookie(bob.token)]);
  assert.match(a, /^boatyard_share_session=/);
  const offer = { windowId: "window", type: "offer", sdp: "v=0\r\n" };
  const [first, second] = await Promise.all([post("/api/connect", offer, a), post("/api/connect", offer, b)]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const firstAnswer = await first.json(), secondAnswer = await second.json();
  assert.notEqual(firstAnswer.sessionId, secondAnswer.sessionId);
  assert.deepEqual(server.getClients().map(client => client.state), ["connected", "connected"]);
  assert.equal(server.getConnectedClientCount(), 2);
  await post("/api/disconnect", { sessionId: secondAnswer.sessionId }, a);
  assert.equal(disconnected.length, 0, "One client cannot disconnect another session");
  assert.equal((await post("/api/recover", { ...offer, sessionId: secondAnswer.sessionId }, a)).status, 403, "One client cannot replace another transport");
  assert.equal((await post("/api/recover", { ...offer, sessionId: firstAnswer.sessionId }, a)).status, 200);
  assert.deepEqual(recovered, [firstAnswer.sessionId]);
  assert.equal(server.getConnectedClientCount(), 2, "Recovery keeps participant identity and capacity");
  assert.equal((await post("/api/connect", offer, a)).status, 409);
  server.revokeClient(bob.id);
  assert.deepEqual(disconnected, [secondAnswer.sessionId]);
  assert.equal(server.getConnectedClientCount(), 1);
  assert.equal((await fetch(`${origin}/api/windows`, { headers: { Cookie: b } })).status, 401);
  assert.equal((await fetch(`${origin}/api/windows`, { headers: { Cookie: a } })).status, 200);
  assert.deepEqual(server.getClients().map(client => client.label), ["Alice"]);
  await post("/api/logout", {}, a);
  assert.equal(server.getClients().length, 0);
  assert.deepEqual(disconnected, [secondAnswer.sessionId, firstAnswer.sessionId]);
  assert.equal(server.getConnectedClientCount(), 0);
});

test("Share reserves viewer capacity during concurrent connection setup", async t => {
  let next = 0;
  const server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [{ id: "window", title: "Fixture", width: 800, height: 600 }],
    connect: async () => ({ sessionId: `session-${++next}`, type: "answer", sdp: "v=0\r\n" }), disconnect() {} });
  const port = await server.start(); t.after(() => server.stop());
  const origin = `http://127.0.0.1:${port}`;
  const cookies = await Promise.all(Array.from({ length: 9 }, async (_, index) => {
    const invitation = server.createReadOnlyInvitation(`Viewer ${index}`);
    const login = await fetch(`${origin}/api/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: invitation.token }) });
    return login.headers.get("set-cookie")!.split(";")[0];
  }));
  const connect = (cookie: string) => fetch(`${origin}/api/connect`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ windowId: "window", type: "offer", sdp: "v=0\r\n" }) });
  const results = await Promise.all(cookies.map(connect));
  assert.equal(results.filter(result => result.status === 200).length, 8);
  const refused = results.findIndex(result => result.status === 409); assert.ok(refused >= 0);
  const connected = results.findIndex(result => result.status === 200);
  server.sessionClosed((await results[connected].json()).sessionId);
  assert.equal((await connect(cookies[refused])).status, 200, "Capacity returns after one viewer disconnects");
});

test("revoking a Share client during setup discards its answer and closes only its stream", async t => {
  let finish!: (answer: { sessionId: string; sdp: string; type: "answer" }) => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; }), disconnected: (string | undefined)[] = [];
  const server = new RemoteServer({ assetsDirectory: resolve("src/renderer/remote"), passwordHash: "", readOnly: true,
    listWindows: () => [{ id: "window", title: "Fixture", width: 800, height: 600 }],
    connect: () => { started(); return new Promise(resolve => { finish = resolve; }); }, disconnect: id => disconnected.push(id) });
  const port = await server.start(); t.after(() => server.stop());
  const origin = `http://127.0.0.1:${port}`, invitation = server.createReadOnlyInvitation();
  const login = await fetch(`${origin}/api/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invitation) });
  const pending = fetch(`${origin}/api/connect`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: login.headers.get("set-cookie")!.split(";")[0] }, body: JSON.stringify({ windowId: "window", type: "offer", sdp: "v=0\r\n" }) });
  await entered; server.revokeClient(invitation.id);
  finish({ sessionId: "revoked-stream", type: "answer", sdp: "v=0\r\n" });
  assert.equal((await pending).status, 401); assert.deepEqual(disconnected, ["revoked-stream"]);
  assert.equal(server.getClients().length, 0);
});
