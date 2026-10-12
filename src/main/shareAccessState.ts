import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, randomInt, randomUUID } from "node:crypto";

export type ShareAccessSettings = { groupEnabled: boolean; groupApprovalRequired: boolean; allowJoinRequests: boolean };
export type ShareParticipant = { id: string; label: string; token: string; used?: boolean; voiceAllowed?: boolean };
type JoinRequest = { id: string; label: string; token: string; expiresAt: number; state: "pending" | "approved" | "declined" | "claimed"; participantId?: string; source: "group" | "request" };

export function normalizeShareCode(value: unknown) {
  const code = typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
  return /^\d{6}$/.test(code) ? code : "";
}

// Invitations and browser authentication persist; requests and microphone permissions are session-only.
export class ShareAccessState {
  readonly participants = new Map<string, ShareParticipant>();
  private browserSessions: { login: string; id: string }[] = [];
  private readonly requests = new Map<string, JoinRequest>();
  private readonly issuedCodes = new Set<string>();
  private groupCode = "";
  private settings: ShareAccessSettings = { groupEnabled: false, groupApprovalRequired: true, allowJoinRequests: false };
  constructor(private readonly expired: () => void = () => {}, private readonly filePath?: string) {
    if (!filePath || !existsSync(filePath)) return;
    try {
      const value = JSON.parse(readFileSync(filePath, "utf8"));
      const settings = value.settings;
      if (value.version !== 1 || !settings || [settings.groupEnabled, settings.groupApprovalRequired, settings.allowJoinRequests].some(flag => typeof flag !== "boolean") ||
        settings.groupEnabled && settings.allowJoinRequests || !Array.isArray(value.invitations) || value.invitations.length > 32) throw new Error("Invalid Share access data.");
      const codes = new Set<string>();
      const participants = new Map<string, ShareParticipant>();
      const groupCode = settings.groupEnabled ? normalizeShareCode(value.groupCode) : "";
      if (settings.groupEnabled && !groupCode) throw new Error("Invalid group code.");
      if (groupCode) codes.add(groupCode);
      for (const entry of value.invitations) {
        const token = normalizeShareCode(entry.token);
        if (typeof entry.id !== "string" || !entry.id || typeof entry.label !== "string" || entry.label.length > 80 || !token || codes.has(token) || participants.has(entry.id)) throw new Error("Invalid invitation.");
        if (entry.used !== undefined && typeof entry.used !== "boolean") throw new Error("Invalid invitation usage.");
        participants.set(entry.id, { id: entry.id, label: entry.label, token, ...(entry.used ? { used: true } : {}) }); codes.add(token);
      }
      const sessions = value.browserSessions ?? [];
      if (!Array.isArray(sessions) || sessions.length > 32 || sessions.some(entry => !entry || typeof entry.login !== "string" || !/^[a-f0-9]{64}$/.test(entry.login) || !participants.has(entry.id)) ||
        new Set(sessions.map(entry => entry.login)).size !== sessions.length || new Set(sessions.map(entry => entry.id)).size !== sessions.length) throw new Error("Invalid Share browser sessions.");
      this.browserSessions = sessions.map(({ login, id }) => ({ login, id }));
      for (const { id } of this.browserSessions) participants.get(id)!.used = true;
      chmodSync(filePath, 0o600);
      this.settings = { groupEnabled: settings.groupEnabled, groupApprovalRequired: settings.groupApprovalRequired, allowJoinRequests: settings.allowJoinRequests };
      this.groupCode = groupCode;
      for (const [id, participant] of participants) this.participants.set(id, participant);
      for (const code of codes) this.issuedCodes.add(code);
    } catch { this.browserSessions = []; console.warn("Could not load Share invitations and joining options."); }
  }
  private save() {
    if (!this.filePath) return;
    const provisional = new Set([...this.requests.values()].filter(request => request.state === "approved").map(request => request.participantId));
    const invitations = [...this.participants.values()].filter(participant => !provisional.has(participant.id)).map(({ id, label, token, used }) => ({ id, label, token, ...(used ? { used: true } : {}) }));
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, settings: this.settings, groupCode: this.groupCode, invitations, browserSessions: this.browserSessions }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, this.filePath); chmodSync(this.filePath, 0o600);
  }
  getBrowserSessions() { return this.browserSessions.map(entry => ({ ...entry })); }
  saveBrowserSessions(sessions: { login: string; id: string }[]) {
    this.browserSessions = sessions.filter(entry => this.participants.has(entry.id)); this.save();
  }
  private code() {
    let code: string;
    do { code = String(randomInt(1_000_000)).padStart(6, "0"); } while (this.issuedCodes.has(code));
    this.issuedCodes.add(code); return code;
  }
  create(label = "", provisional = false) {
    if (this.participants.size >= 32) throw new Error("Too many participants. Remove an existing participant first.");
    const participant = { id: randomUUID(), label: label.trim().slice(0, 80), token: this.code() };
    this.participants.set(participant.id, participant); if (!provisional) this.save(); return { ...participant };
  }
  lookup(value: unknown) {
    const code = normalizeShareCode(value);
    return code ? [...this.participants.values()].find(participant => participant.token === code) : undefined;
  }
  isGroup(value: unknown) { return this.settings.groupEnabled && normalizeShareCode(value) === this.groupCode; }
  configure(patch: Partial<ShareAccessSettings>) {
    for (const key of ["groupEnabled", "groupApprovalRequired", "allowJoinRequests"] as const) {
      if (patch[key] !== undefined && typeof patch[key] !== "boolean") throw new Error("Invalid Share access settings.");
    }
    if (patch.groupEnabled === true && patch.allowJoinRequests === true) throw new Error("Choose either group entry or Ask to join.");
    this.settings = { ...this.settings, ...patch,
      ...(patch.groupEnabled === true ? { allowJoinRequests: false } : patch.allowJoinRequests === true ? { groupEnabled: false } : {}) };
    if (this.settings.groupEnabled && !this.groupCode) this.groupCode = this.code();
    if (!this.settings.groupEnabled) this.groupCode = "";
    for (const request of this.requests.values()) if (request.state === "pending" &&
      (request.source === "group" ? !this.settings.groupEnabled : !this.settings.allowJoinRequests)) request.state = "declined";
    this.save();
  }
  get publicSettings() { return { ...this.settings }; }
  hostSnapshot() {
    this.prune();
    return { ...this.settings, groupCode: this.groupCode, invitations: [...this.participants.values()].map(({ id, token }) => ({ id, code: token })),
      requests: [...this.requests.values()].filter(request => request.state === "pending").map(({ id, label }) => ({ id, label })) };
  }
  request(label: string, source: "group" | "request") {
    this.prune();
    if (source === "request" && !this.settings.allowJoinRequests || source === "group" && !this.settings.groupEnabled) throw new Error("Join requests are unavailable.");
    if (this.requests.size >= 64) throw new Error("Too many join requests. Try again later.");
    const request: JoinRequest = { id: randomUUID(), label, token: randomBytes(32).toString("base64url"), expiresAt: Date.now() + 10 * 60 * 1000, state: "pending", source };
    this.requests.set(request.token, request); return { ...request };
  }
  decide(id: string, accepted: boolean) {
    this.prune();
    const request = [...this.requests.values()].find(request => request.id === id);
    if (!request || request.state !== "pending") throw new Error("This join request is no longer pending.");
    if (accepted) { request.participantId = this.create(request.label, true).id; request.state = "approved"; }
    else request.state = "declined";
  }
  poll(token: unknown) { this.prune(); return typeof token === "string" ? this.requests.get(token) : undefined; }
  finish(token: string) { this.requests.delete(token); }
  claimed(id: string) {
    const participant = this.participants.get(id); if (participant) participant.used = true;
    for (const request of this.requests.values()) if (request.participantId === id && request.state === "approved") request.state = "claimed";
    this.save();
  }
  revoke(id: string) {
    this.participants.delete(id);
    this.browserSessions = this.browserSessions.filter(entry => entry.id !== id);
    for (const request of this.requests.values()) if (request.participantId === id) request.state = "declined";
    this.save();
  }
  private prune() {
    let changed = false;
    for (const [token, request] of this.requests) if (request.expiresAt <= Date.now()) {
      if (request.state === "approved" && request.participantId) this.participants.delete(request.participantId);
      this.requests.delete(token); changed = true;
    }
    if (changed) this.expired();
  }
  endSession() {
    for (const request of this.requests.values()) if (request.state === "approved" && request.participantId) this.participants.delete(request.participantId);
    this.requests.clear();
    for (const participant of this.participants.values()) delete participant.voiceAllowed;
  }
  terminateSession() {
    this.endSession();
    for (const [id, participant] of this.participants) if (participant.used) this.participants.delete(id);
    this.browserSessions = [];
    this.groupCode = this.settings.groupEnabled ? this.code() : "";
    this.save();
  }
  clear() {
    this.participants.clear(); this.browserSessions = []; this.requests.clear(); this.issuedCodes.clear(); this.groupCode = "";
    this.settings = { groupEnabled: false, groupApprovalRequired: true, allowJoinRequests: false };
    this.save();
  }
}
