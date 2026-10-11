import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ShareChatStore } from "../src/main/shareChatStore";
import { RemoteServer } from "../src/main/remoteServer";
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=';
const input = (text: string, requestId = 'test-message-request-1234') => ({ text, requestId });

test("chat archives survive restart, isolate sessions, deduplicate sends and permanently remove images", () => {
  const directory = mkdtempSync(join(tmpdir(), 'boatyard-chat-'));
  try {
    const store = new ShareChatStore(directory); store.begin(); const first = store.activeId!;
    const message = store.send(first, 'alice', 'Alice', { ...input('See https://example.com'), image: png });
    assert.equal(store.send(first, 'alice', 'Alice', input('duplicate')).id, message.id);
    assert.equal(store.snapshot().messages.length, 1);
    assert.equal(store.image(first, message.id).mime, 'image/png');
    assert.throws(() => store.send(first, 'bob', 'Bob', input('')), /Write a message/);
    assert.throws(() => store.send(first, 'bob', 'Bob', { ...input('bad'), image: 'data:image/svg+xml;base64,PHN2Zz4=' }), /PNG/);
    assert.throws(() => store.send(first, 'bob', 'Bob', { ...input('bad'), image: 'data:image/png;base64,YWJj' }), /Invalid image/);
    assert.throws(() => store.send(first, 'bob', 'Bob', input('a'.repeat(8001))), /Invalid chat/);
    store.end(); store.begin(); const second = store.activeId!;
    assert.equal(store.snapshot().messages.length, 0);
    assert.throws(() => store.send(first, 'alice', 'Alice', input('late')), /ended/);
    const restored = new ShareChatStore(directory);
    assert.equal(restored.activeId, null);
    assert.ok(restored.snapshot(second).session!.endedAt);
    assert.equal(restored.snapshot(first).messages[0].author, 'Alice');
    restored.delete(first, message.id);
    assert.throws(() => restored.image(first, message.id), /not found/);
    assert.equal(new ShareChatStore(directory).snapshot(first).messages.length, 0);
    assert.ok(!readdirSync(directory).some(name => name.endsWith('.image')));
    if (process.platform !== 'win32') for (const file of readdirSync(directory)) assert.equal(statSync(join(directory, file)).mode & 0o777, 0o600);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Share chat authenticates history, sends, image reads and events; revocation closes subscriptions", async () => {
  const directory = mkdtempSync(join(tmpdir(), 'boatyard-chat-server-'));
  const store = new ShareChatStore(directory);
  const server = new RemoteServer({ chat: store, readOnly: true, assetsDirectory: resolve('src/renderer/remote'), passwordHash: '', host: '127.0.0.1', listWindows: () => [],
    connect: async () => { throw new Error('No stream needed'); }, disconnect() {} });
  const base = `http://127.0.0.1:${await server.start()}`;
  const request = (path: string, cookie = '', body?: unknown) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'Content-Type': 'application/json', Origin: base } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const joinParticipant = async (name: string) => {
    const invitation = server.createReadOnlyInvitation(name);
    const response = await request('/api/redeem', '', { token: invitation.token, label: name });
    assert.equal(response.status, 200); return { id: invitation.id, cookie: response.headers.get('set-cookie')!.split(';')[0] };
  };
  try {
    const sessionId = store.activeId!;
    assert.equal((await request('/api/chat')).status, 401);
    assert.equal((await request('/api/chat/events')).status, 401);
    const alice = await joinParticipant('Alice');
    const sent = await request('/api/chat/send', alice.cookie, { sessionId, ...input('Question'), image: png, author: 'Forged operator' });
    assert.equal(sent.status, 200); const message = (await sent.json()).message;
    assert.equal(message.author, 'Alice');
    const bob = await joinParticipant('Bob');
    assert.equal((await (await request('/api/chat', bob.cookie)).json()).messages.length, 1, 'Late join sees history');
    assert.equal((await request(`/api/chat/image/${message.id}`, bob.cookie)).headers.get('content-type'), 'image/png');
    assert.equal((await request(`/api/chat/image/${message.id}`)).status, 401);
    assert.equal((await request('/api/chat/delete', bob.cookie, { sessionId, messageId: message.id })).status, 404);
    assert.equal((await request('/api/chat/send', bob.cookie, { sessionId: 'another-session', ...input('bad') })).status, 400);
    assert.equal((await request('/api/chat/send', bob.cookie, input('bad'))).status, 400);
    const controller = new AbortController();
    const stream = await fetch(base + '/api/chat/events', { headers: { cookie: bob.cookie }, signal: controller.signal });
    assert.equal(stream.status, 200); const reader = stream.body!.getReader(); await reader.read();
    store.send(sessionId, 'operator', 'Operator', input('Answer'));
    assert.match(new TextDecoder().decode((await reader.read()).value), /data:/);
    server.revokeClient(bob.id);
    assert.equal((await reader.read()).done, true);
    assert.equal((await request('/api/chat', bob.cookie)).status, 401);
    store.delete(sessionId, message.id);
    assert.equal((await request(`/api/chat/image/${message.id}`, alice.cookie)).status, 400);
    assert.equal((await (await request('/api/chat', alice.cookie)).json()).messages.length, 1);
    const image = await request('/share-chat.css'); assert.equal(image.status, 200);
    controller.abort();
    await server.stop(); assert.ok(store.snapshot(sessionId).session!.endedAt);
  } finally { await server.stop(); rmSync(directory, { recursive: true, force: true }); }
});
