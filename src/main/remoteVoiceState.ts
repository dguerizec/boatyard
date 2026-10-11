import type { RemoteAudioMode } from "../shared/remoteAudio.js";

export type RemoteVoice = { allowed: boolean; selfMuted: boolean; handRaised: number | null };

// Conference policy spans both services, just like the hand queue and audio mixer.
export class RemoteAudioConference {
  private readonly voices = new Set<RemoteVoiceState>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  get policyRevision() { return this.revision; }
  mode: RemoteAudioMode = "open-discussion";
  floor: string | null = null;
  attach(voice: RemoteVoiceState) { this.voices.add(voice); }
  detach(voice: RemoteVoiceState) {
    this.voices.delete(voice);
    if (!this.voices.size) { this.mode = "open-discussion"; this.floor = null; }
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  setMode(mode: RemoteAudioMode) {
    if (mode === this.mode) return;
    this.mode = mode; this.floor = null; this.revision++;
    for (const voice of this.voices) voice.resetForMode(mode);
    this.changed();
  }
  giveFloor(id: string) {
    const owner = [...this.voices].find(voice => voice.get(id));
    if (!owner) throw new Error("Participant is not connected.");
    this.floor = id; this.revision++;
    if (this.mode !== "open-discussion") {
      for (const voice of this.voices) voice.blockExcept(id);
    }
    owner.allow(id, true, { consumeHand: true });
    this.changed();
  }
  endTurn() {
    const id = this.floor;
    if (id === null) return;
    for (const voice of this.voices) if (voice.get(id)) voice.allow(id, false);
  }
  release(id: string) { if (this.floor === id) { this.floor = null; this.changed(); } }
}

export class RemoteHandQueue {
  private readonly waiting = new Map<string, { rank: number; changed(rank: number): void }>();
  raise(id: string, changed: (rank: number) => void) {
    const existing = this.waiting.get(id);
    if (existing) return existing.rank;
    const rank = this.waiting.size + 1;
    this.waiting.set(id, { rank, changed });
    return rank;
  }
  remove(id: string) {
    if (!this.waiting.delete(id)) return;
    let rank = 0;
    for (const entry of this.waiting.values()) {
      rank++;
      if (entry.rank !== rank) { entry.rank = rank; entry.changed(rank); }
    }
  }
}

export class RemoteVoiceState {
  private readonly participants = new Map<string, RemoteVoice>();
  allMuted = false;
  constructor(private readonly changed: (id: string, state: RemoteVoice) => void, private readonly hands = new RemoteHandQueue(), readonly conference = new RemoteAudioConference()) {
    conference.attach(this);
    this.allMuted = conference.mode !== "open-discussion";
  }
  add(id: string, allowed = !this.allMuted) {
    const state = { allowed, selfMuted: true, handRaised: null };
    this.participants.set(id, state); return { ...state };
  }
  get(id: string) { const state = this.participants.get(id); return state ? { ...state } : undefined; }
  remove(id: string) { this.participants.delete(id); this.hands.remove(id); this.conference.release(id); }
  dispose() { for (const id of this.participants.keys()) this.remove(id); this.conference.detach(this); }
  resetForMode(mode: RemoteAudioMode) {
    this.allMuted = mode !== "open-discussion";
    for (const [id, state] of this.participants) {
      state.allowed = !this.allMuted; state.selfMuted = true;
      this.changed(id, { ...state });
    }
  }
  blockExcept(selected: string) {
    this.allMuted = true;
    for (const [id, state] of this.participants) if (id !== selected && state.allowed) this.allow(id, false);
  }
  private setHand(id: string, state: RemoteVoice, raised: boolean) {
    if (raised) state.handRaised = this.hands.raise(id, rank => {
      state.handRaised = rank;
      this.changed(id, { ...state });
    });
    else { state.handRaised = null; this.hands.remove(id); }
  }
  guest(id: string, value: unknown) {
    const state = this.participants.get(id), message = value as { selfMuted?: unknown; raised?: unknown };
    if (!state || !message || typeof message !== "object") throw new Error("Invalid voice state.");
    if (typeof message.selfMuted === "boolean") {
      if (!message.selfMuted && !state.allowed && state.handRaised === null) throw new Error("Raise your hand before preparing your microphone.");
      state.selfMuted = message.selfMuted;
    }
    if (typeof message.raised === "boolean") this.setHand(id, state, message.raised);
    if (!state.allowed && state.handRaised === null) state.selfMuted = true;
    this.changed(id, { ...state });
  }
  allow(id: string, allowed: boolean, options: { consumeHand?: boolean } = {}) {
    const state = this.participants.get(id);
    if (!state) throw new Error("Participant is not connected.");
    state.allowed = allowed;
    // A host block cancels microphone intent; a fresh request may prepare it again.
    if (!allowed) state.selfMuted = true;
    else if (options.consumeHand) this.setHand(id, state, false);
    this.changed(id, { ...state });
    if (!allowed) this.conference.release(id);
  }
  allowAll(allowed: boolean) {
    this.allMuted = !allowed;
    for (const id of this.participants.keys()) this.allow(id, allowed);
  }
}
