import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteAudioConference, RemoteHandQueue, RemoteVoiceState } from "../src/main/remoteVoiceState";

test("host permission and personal microphone intent remain independent", () => {
  const updates: unknown[] = [];
  const voice = new RemoteVoiceState((id, state) => updates.push({ id, ...state }));
  assert.deepEqual(voice.add("alice"), { allowed: true, selfMuted: true, handRaised: null });
  voice.guest("alice", { selfMuted: false });
  assert.equal(voice.get("alice")?.selfMuted, false);
  voice.allow("alice", false);
  assert.throws(() => voice.guest("alice", { selfMuted: false }), /Raise your hand/);
  voice.guest("alice", { raised: true });
  assert.equal(voice.get("alice")?.handRaised, 1);
  voice.allow("alice", true);
  assert.deepEqual(voice.get("alice"), { allowed: true, selfMuted: true, handRaised: 1 });
  voice.guest("alice", { selfMuted: false });
  voice.guest("alice", { selfMuted: true });
  assert.equal(voice.get("alice")?.allowed, true);
  assert.equal(updates.length, 6);
});

test("microphone permission preserves a prepared request until the host gives the floor", () => {
  const voice = new RemoteVoiceState(() => {});
  voice.add("alice", false);
  voice.guest("alice", { raised: true });
  voice.guest("alice", { selfMuted: false });
  assert.deepEqual(voice.get("alice"), { allowed: false, selfMuted: false, handRaised: 1 });
  voice.allow("alice", true);
  assert.deepEqual(voice.get("alice"), { allowed: true, selfMuted: false, handRaised: 1 });
  voice.conference.giveFloor("alice");
  assert.deepEqual(voice.get("alice"), { allowed: true, selfMuted: false, handRaised: null });
  voice.allow("alice", false);
  voice.allow("alice", true);
  assert.deepEqual(voice.get("alice"), { allowed: true, selfMuted: true, handRaised: null });
  voice.allow("alice", false);
  voice.guest("alice", { raised: true });
  voice.allow("alice", true);
  assert.deepEqual(voice.get("alice"), { allowed: true, selfMuted: true, handRaised: 1 });
  voice.conference.giveFloor("alice");
  assert.deepEqual(voice.get("alice"), { allowed: true, selfMuted: true, handRaised: null });
  voice.allow("alice", false);
  assert.throws(() => voice.guest("alice", { selfMuted: false }), /Raise your hand/);
});

test("withdrawing a blocked request cancels its prepared microphone", () => {
  const voice = new RemoteVoiceState(() => {});
  voice.add("alice", false);
  voice.guest("alice", { raised: true });
  voice.guest("alice", { selfMuted: false });
  voice.guest("alice", { raised: false });
  voice.allow("alice", true);
  assert.equal(voice.get("alice")?.selfMuted, true);
});

test("collective moderation resets microphones and covers newly connected guests", () => {
  const voice = new RemoteVoiceState(() => {});
  voice.add("alice"); voice.guest("alice", { selfMuted: false });
  voice.allowAll(false);
  assert.equal(voice.get("alice")?.allowed, false);
  assert.deepEqual(voice.add("bob"), { allowed: false, selfMuted: true, handRaised: null });
  voice.allowAll(true);
  assert.equal(voice.get("alice")?.selfMuted, true); assert.equal(voice.get("bob")?.selfMuted, true);
  assert.equal(voice.add("carol").allowed, true);
});

test("raised hands show current queue positions through duplicates, lowering and disconnect", () => {
  const updates: { id: string; rank: number | null }[] = [];
  const voice = new RemoteVoiceState((id, state) => updates.push({ id, rank: state.handRaised }));
  voice.add("alice"); voice.add("bob");
  voice.guest("bob", { raised: true }); voice.guest("alice", { raised: true });
  voice.guest("bob", { raised: true });
  assert.equal(voice.get("bob")?.handRaised, 1); assert.equal(voice.get("alice")?.handRaised, 2);
  voice.guest("bob", { raised: false });
  assert.equal(voice.get("alice")?.handRaised, 1);
  assert.ok(updates.some(update => update.id === "alice" && update.rank === 1), "Remaining guest receives the new position");
  voice.guest("bob", { raised: true });
  assert.equal(voice.get("bob")?.handRaised, 2);
  voice.remove("alice"); assert.equal(voice.get("alice"), undefined);
  assert.equal(voice.get("bob")?.handRaised, 1);
  assert.throws(() => voice.guest("alice", { raised: true }), /Invalid/);
  assert.equal(voice.add("alice").handRaised, null);
});

test("individual and collective permission preserve the shared queue while giving the floor consumes a request", () => {
  const hands = new RemoteHandQueue();
  const conference = new RemoteAudioConference();
  const updates: (number | null)[] = [];
  const share = new RemoteVoiceState(() => {}, hands, conference);
  const remote = new RemoteVoiceState((_, state) => updates.push(state.handRaised), hands, conference);
  share.add("alice"); remote.add("remote"); share.add("bob");
  share.guest("alice", { raised: true }); remote.guest("remote", { raised: true }); share.guest("bob", { raised: true });
  assert.equal(remote.get("remote")?.handRaised, 2);
  share.allow("alice", true);
  assert.equal(share.get("alice")?.handRaised, 1);
  assert.equal(remote.get("remote")?.handRaised, 2);
  share.allowAll(true); remote.allowAll(true);
  assert.equal(share.get("bob")?.handRaised, 3);
  assert.equal(remote.get("remote")?.handRaised, 2);
  conference.giveFloor("alice");
  assert.equal(remote.get("remote")?.handRaised, 1);
  assert.equal(updates.at(-1), 1);
  assert.equal(share.get("bob")?.handRaised, 2);
  remote.remove("remote");
  assert.equal(share.get("bob")?.handRaised, 1);
  share.allowAll(true);
  remote.add("new"); remote.guest("new", { raised: true });
  assert.equal(remote.get("new")?.handRaised, 2, "Collective permission keeps existing requests in place");
  conference.giveFloor("bob");
  assert.equal(remote.get("new")?.handRaised, 1, "Giving the floor renumbers the remaining requests across services");
});


test("conference transitions preserve hands and reset permission and microphone intent", () => {
  const conference = new RemoteAudioConference(), hands = new RemoteHandQueue();
  const share = new RemoteVoiceState(() => {}, hands, conference);
  const remote = new RemoteVoiceState(() => {}, hands, conference);
  share.add("alice"); remote.add("bob");
  share.guest("alice", { selfMuted: false });
  remote.guest("bob", { raised: true }); share.guest("alice", { raised: true });
  conference.setMode("speaker-only");
  assert.deepEqual(share.get("alice"), { allowed: false, selfMuted: true, handRaised: 2 });
  assert.equal(remote.get("bob")?.handRaised, 1);
  assert.equal(share.add("late").allowed, false);
  conference.giveFloor("bob");
  assert.equal(conference.floor, "bob");
  assert.deepEqual(remote.get("bob"), { allowed: true, selfMuted: true, handRaised: null });
  assert.equal(share.get("alice")?.handRaised, 1);
  conference.setMode("qa");
  assert.equal(conference.floor, null);
  assert.equal(remote.get("bob")?.allowed, false);
  assert.equal(share.get("alice")?.handRaised, 1);
  conference.setMode("open-discussion");
  assert.equal(share.get("alice")?.allowed, true);
  assert.equal(share.get("alice")?.selfMuted, true);
  assert.equal(share.get("alice")?.handRaised, 1);
  assert.equal(remote.add("late-remote").allowed, true);
});

test("moderated turns span services, while manual overrides remain available", () => {
  const conference = new RemoteAudioConference(), hands = new RemoteHandQueue();
  const share = new RemoteVoiceState(() => {}, hands, conference);
  const remote = new RemoteVoiceState(() => {}, hands, conference);
  share.add("alice"); share.add("carol"); remote.add("bob");
  conference.setMode("qa");
  share.guest("alice", { raised: true }); remote.guest("bob", { raised: true });
  remote.guest("bob", { selfMuted: false });
  conference.giveFloor("alice");
  assert.equal(remote.get("bob")?.selfMuted, false, "Waiting microphone preparation is retained");
  share.allowAll(true); remote.allowAll(true);
  assert.equal(conference.mode, "qa");
  assert.equal(share.get("carol")?.allowed, true);
  conference.giveFloor("bob");
  assert.equal(share.get("alice")?.allowed, false);
  assert.equal(share.get("carol")?.allowed, false);
  assert.equal(remote.get("bob")?.allowed, true);
  assert.equal(conference.floor, "bob");
  assert.equal(share.add("late").allowed, false, "New guests follow the restored moderated policy");
  assert.equal(remote.get("bob")?.selfMuted, false, "Permission honors existing guest intent");
  remote.allow("bob", false);
  assert.equal(conference.floor, null);
  conference.giveFloor("alice"); conference.endTurn();
  assert.equal(share.get("alice")?.allowed, false);
  assert.equal(conference.floor, null);
  conference.giveFloor("carol"); share.remove("carol");
  assert.equal(conference.floor, null);
  assert.throws(() => conference.giveFloor("missing"), /not connected/);
  share.dispose();
  assert.equal(conference.mode, "qa", "Stopping one service retains the conference");
  remote.dispose();
  assert.equal(conference.mode, "open-discussion", "Stopping both services resets the conference");
});

test("speaker-only hand requests support an interruption without switching mode", () => {
  const voice = new RemoteVoiceState(() => {});
  voice.add("alice"); voice.add("bob");
  voice.conference.setMode("speaker-only");
  voice.guest("alice", { raised: true }); voice.guest("bob", { raised: true });
  voice.conference.giveFloor("alice");
  voice.allow("bob", true);
  assert.equal(voice.get("alice")?.allowed, true);
  assert.equal(voice.get("bob")?.allowed, true);
  assert.equal(voice.conference.mode, "speaker-only");
  voice.conference.giveFloor("bob");
  assert.equal(voice.get("alice")?.allowed, false);
  voice.conference.setMode("speaker-only");
  assert.equal(voice.get("bob")?.allowed, true, "Reselecting the same mode retains operator decisions");
});
