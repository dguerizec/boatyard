import { randomBytes, randomInt, randomUUID } from "node:crypto";

export type ShareAccessSettings = { groupEnabled: boolean; groupApprovalRequired: boolean; allowJoinRequests: boolean };
export type ShareParticipant = { id: string; label: string; token: string };
type JoinRequest = { id: string; label: string; token: string; expiresAt: number; state: "pending" | "approved" | "declined" | "claimed"; participantId?: string; source: "group" | "request" };

export function normalizeShareCode(value: unknown) {
  const code = typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
  return /^\d{6}$/.test(code) ? code : "";
}

// Session-only admission state. Only the host snapshot includes access codes.
export class ShareAccessState {
  readonly participants = new Map<string, ShareParticipant>();
  private readonly requests = new Map<string, JoinRequest>();
  private readonly issuedCodes = new Set<string>();
  private groupCode = "";
  private settings: ShareAccessSettings = { groupEnabled: false, groupApprovalRequired: true, allowJoinRequests: false };
  constructor(private readonly expired: () => void = () => {}) {}
  private code() {
    let code: string;
    do { code = String(randomInt(1_000_000)).padStart(6, "0"); } while (this.issuedCodes.has(code));
    this.issuedCodes.add(code); return code;
  }
  create(label = "") {
    if (this.participants.size >= 32) throw new Error("Too many participants. Remove an existing participant first.");
    const participant = { id: randomUUID(), label: label.trim().slice(0, 80), token: this.code() };
    this.participants.set(participant.id, participant); return { ...participant };
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
    if (accepted) { request.participantId = this.create(request.label).id; request.state = "approved"; }
    else request.state = "declined";
  }
  poll(token: unknown) { this.prune(); return typeof token === "string" ? this.requests.get(token) : undefined; }
  finish(token: string) { this.requests.delete(token); }
  claimed(id: string) {
    for (const request of this.requests.values()) if (request.participantId === id && request.state === "approved") request.state = "claimed";
  }
  revoke(id: string) {
    this.participants.delete(id);
    for (const request of this.requests.values()) if (request.participantId === id) request.state = "declined";
  }
  private prune() {
    let changed = false;
    for (const [token, request] of this.requests) if (request.expiresAt <= Date.now()) {
      if (request.state === "approved" && request.participantId) this.participants.delete(request.participantId);
      this.requests.delete(token); changed = true;
    }
    if (changed) this.expired();
  }
  clear() {
    this.participants.clear(); this.requests.clear(); this.issuedCodes.clear(); this.groupCode = "";
    this.settings = { groupEnabled: false, groupApprovalRequired: true, allowJoinRequests: false };
  }
}
