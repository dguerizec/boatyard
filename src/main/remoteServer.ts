import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyRemotePassword, isRemotePasswordHash } from "./remotePassword.js";
import { networkInterfaces } from "node:os";
import { ShareAccessState, type ShareAccessSettings, type ShareParticipant } from "./shareAccessState.js";
import { ShareChatStore, MAX_CHAT_IMAGE_BYTES } from "./shareChatStore.js";
import type { RemoteConnectionRoute } from "../shared/remoteIce.js";

export const DEFAULT_REMOTE_HOST = "0.0.0.0";
export const MAX_SHARE_CLIENTS = 8;
const BROWSER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const clientAssets: Record<string, [string, string]> = {
  "/": ["client.html", "text/html"],
  "/client.js": ["client.js", "text/javascript"],
  "/microphoneWorklet.js": ["microphoneWorklet.js", "text/javascript"],
  "/share-chat.css": ["../shareChat.css", "text/css"],
  "/remote.css": ["remote.css", "text/css"],
  "/waiting-screen.png": ["../assets/boatyard-mark-night-preview.png", "image/png"],
  "/manifest.json": ["manifest.json", "application/manifest+json"]
};

function localInterfaceAddresses() {
  return Object.values(networkInterfaces()).flatMap(entries => entries || []);
}

export type RemoteWindowInfo = { id: string; title: string; width: number; height: number };
export type RemoteOffer = { windowId: string; sdp: string; type: "offer" };
export type RemoteAnswer = { sessionId: string; sdp: string; type: "answer" };
export type RemoteServerOptions = {
  assetsDirectory: string;
  passwordHash: string;
  sessionFilePath?: string;
  readOnly?: boolean;
  shareAccess?: ShareAccessState;
  chat?: ShareChatStore;
  host?: string;
  port?: number;
  publicOrigin?: string;
  iceServers?: RTCIceServer[];
  getIceServers?(): Promise<RTCIceServer[]>;
  getIceTransportPolicy?(): RTCIceTransportPolicy;
  getVoiceState?(sessionId: string): { allowed: boolean; selfMuted: boolean; handRaised: number | null } | undefined;
  getConnectionRoute?(sessionId: string): RemoteConnectionRoute | null;
  listWindows(): RemoteWindowInfo[];
  connect(offer: RemoteOffer, voiceAllowed?: boolean, created?: (id: string) => void): Promise<RemoteAnswer>;
  recover?(sessionId: string, offer: RemoteOffer): Promise<RemoteAnswer>;
  disconnect(sessionId?: string): void;
  clientsChanged?(): void;
  joinRequested?(label: string): void;
};

export class RemoteServer {
  private readonly logins = new Set<string>();
  private readonly attempts = new Map<string, { since: number; count: number }>();
  private pendingLogins = 0;
  private readonly shareAccess: ShareAccessState;
  private readonly shareAttempts = new Map<string, { since: number; count: number }>();
  private globalShareAttempts = { since: 0, count: 0 };
  private readonly loginClients = new Map<string, { id: string; label: string }>();
  private readonly sessions = new Map<string, { login: string }>();
  private server: Server | null = null;
  private chatId: string | null = null;
  private readonly chatStreams = new Map<ServerResponse, string>();
  private readonly chatLastSent = new Map<string, number>();
  private readonly connecting = new Set<string>();
  private readonly pendingSessions = new Map<string, string>();
  private readonly assets = { ...clientAssets };
  private readonly mode: "remote" | "share";
  constructor(private readonly options: RemoteServerOptions) {
    this.shareAccess = options.shareAccess ?? new ShareAccessState(() => this.options.clientsChanged?.());
    if (!options.readOnly && !isRemotePasswordHash(options.passwordHash)) throw new Error("Set a password before starting remote access.");
    if (options.publicOrigin && new URL(options.publicOrigin).origin !== options.publicOrigin) throw new Error("Remote public origin must be an origin without a path");
    this.mode = options.readOnly ? "share" : "remote";
    for (const file of ["icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.png"]) {
      const asset: [string, string] = [`icons/${this.mode}/${file}`, "image/png"];
      this.assets[`/icons/${this.mode}/${file}`] = asset;
      this.assets[`/${file}`] = asset;
    }
  }
  private passwordFingerprint() { return createHash("sha256").update(this.options.passwordHash).digest("hex"); }
  private loginDigest(token: string) { return createHash("sha256").update(token).digest("hex"); }
  private loadLogins() {
    const file = this.options.sessionFilePath;
    if (!file || this.options.readOnly) return;
    if (existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8"));
        if (saved.passwordFingerprint === this.passwordFingerprint() && Array.isArray(saved.logins) && saved.logins.length <= 32 && saved.logins.every((value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))) {
          for (const login of saved.logins) this.logins.add(login);
        }
      } catch { console.warn("Could not restore remote browser sessions. Sign in again."); }
    }
    this.saveLogins();
  }
  private saveLogins() {
    const file = this.options.sessionFilePath;
    if (!file || this.options.readOnly) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ passwordFingerprint: this.passwordFingerprint(), logins: [...this.logins] }) + "\n", { mode: 0o600 });
    renameSync(temporary, file); chmodSync(file, 0o600);
  }
  getConnectionOrigins(port: number): string[] {
    if (this.options.publicOrigin) return [this.options.publicOrigin];
    const host = this.options.host || DEFAULT_REMOTE_HOST;
    const addresses = host === "0.0.0.0"
      ? ["127.0.0.1", ...localInterfaceAddresses().filter(address => !address.internal && address.family === "IPv4").map(address => address.address)]
      : [host];
    return [...new Set(addresses)].map(address => `http://${address.includes(":") ? `[${address}]` : address}:${port}`);
  }
  getClientSession(id: string) {
    const login = [...this.loginClients].find(([, client]) => client.id === id)?.[0];
    return [...this.sessions].find(([, session]) => session.login === login)?.[0];
  }
  getConnectedClientCount() { return this.sessions.size; }
  getClients() {
    const clients = this.options.readOnly ? [...this.shareAccess.participants.values()].map(({ id, label }) => ({ id, label })) : [...this.loginClients.values()];
    return clients.map(value => {
      const login = [...this.loginClients].find(([, client]) => client.id === value.id)?.[0];
      const session = [...this.sessions].find(([, session]) => session.login === login);
      return { ...value, voice: session ? this.options.getVoiceState?.(session[0]) : undefined,
        state: session ? "connected" : login ? "signed-in" : "invited",
        route: session ? this.options.getConnectionRoute?.(session[0]) ?? null : null };
    });
  }
  getShareAccess() { return this.options.readOnly ? this.shareAccess.hostSnapshot() : undefined; }
  configureShareAccess(patch: Partial<ShareAccessSettings>) {
    if (!this.server || !this.options.readOnly) throw new Error("Share is unavailable.");
    this.shareAccess.configure(patch); this.options.clientsChanged?.();
  }
  decideShareJoinRequest(id: string, accepted: boolean) {
    this.shareAccess.decide(id, accepted); this.options.clientsChanged?.();
  }
  setClientVoiceAllowed(id: string | null, allowed: boolean) {
    for (const participant of this.shareAccess.participants.values()) if (id === null || participant.id === id) participant.voiceAllowed = allowed;
  }
  setSessionVoiceAllowed(sessionId: string, allowed: boolean) {
    const login = this.sessions.get(sessionId)?.login;
    const client = login ? this.loginClients.get(login) : undefined;
    if (client) this.setClientVoiceAllowed(client.id, allowed);
  }
  createReadOnlyInvitation(label = "") {
    if (!this.server || !this.options.readOnly) throw new Error("Start read-only sharing before creating a link.");
    const invitation = this.shareAccess.create(String(label));
    this.options.clientsChanged?.(); return invitation;
  }
  private invalidateLogin(login: string) {
    // Revoke authentication before closing transports or notifying observers.
    this.logins.delete(login); this.loginClients.delete(login); this.connecting.delete(login);
    this.chatLastSent.delete(login);
    for (const [stream, owner] of this.chatStreams) if (owner === login) stream.end();
    const pending = this.pendingSessions.get(login);
    if (pending) { this.pendingSessions.delete(login); this.options.disconnect(pending); }
    for (const [sessionId, session] of [...this.sessions]) if (session.login === login) {
      this.options.disconnect(sessionId); this.sessionClosed(sessionId);
    }
  }
  private signInParticipant(participant: ShareParticipant) {
    for (const [login, client] of [...this.loginClients]) if (client.id === participant.id) this.invalidateLogin(login);
    const token = randomBytes(32).toString("base64url"), login = this.loginDigest(token);
    this.shareAccess.claimed(participant.id);
    this.logins.add(login); this.loginClients.set(login, { id: participant.id, label: participant.label });
    this.options.clientsChanged?.(); return token;
  }
  private allowShareAttempt(request: IncomingMessage, validCode: boolean) {
    const now = Date.now(), address = request.socket.remoteAddress || "unknown";
    for (const [key, attempt] of this.shareAttempts) if (now - attempt.since >= 60000) this.shareAttempts.delete(key);
    if (now - this.globalShareAttempts.since >= 60000) this.globalShareAttempts = { since: now, count: 0 };
    const attempt = this.shareAttempts.get(address) || { since: now, count: 0 };
    if (attempt.count >= 10 || this.globalShareAttempts.count >= 120 || this.shareAttempts.size >= 256 && !this.shareAttempts.has(address)) return false;
    if (!validCode) attempt.count++; this.globalShareAttempts.count++; this.shareAttempts.set(address, attempt); return true;
  }
  revokeClient(id: string) {
    this.shareAccess.revoke(id);
    for (const [login, client] of [...this.loginClients]) if (client.id === id) this.invalidateLogin(login);
    this.options.clientsChanged?.();
  }
  async start(): Promise<number> {
    this.loadLogins();
    const server = createServer((request, response) => { void this.handle(request, response); });
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port ?? 0, this.options.host || DEFAULT_REMOTE_HOST, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Remote server did not obtain a port");
    if (this.options.readOnly && this.options.chat) { this.options.chat.begin(); this.chatId = this.options.chat.activeId; }
    return address.port;
  }
  async stop() {
    if (this.chatId && this.options.chat?.activeId === this.chatId) this.options.chat.end();
    this.chatId = null;
    for (const stream of this.chatStreams.keys()) stream.end();
    this.chatLastSent.clear();
    this.options.disconnect();
    this.logins.clear(); this.attempts.clear(); if (this.options.shareAccess) this.shareAccess.endSession(); else this.shareAccess.clear(); this.shareAttempts.clear(); this.globalShareAttempts = { since: 0, count: 0 }; this.loginClients.clear();
    this.sessions.clear(); this.connecting.clear(); this.pendingSessions.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
  private async clientVersion() {
    const hash = createHash("sha256").update(this.mode);
    for (const file of new Set(Object.values(this.assets).map(([file]) => file))) {
      hash.update(file); hash.update(await readFile(join(this.options.assetsDirectory, file)));
    }
    // Include the sender protocol and the unbundled source helper as well.
    for (const file of ["sender.js", "clientUpdates.js"]) {
      hash.update(file); hash.update(await readFile(join(this.options.assetsDirectory, file)));
    }
    return hash.digest("hex");
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
    const json = (status: number, value: unknown) => {
      if (response.destroyed) return;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    try {
      const host = request.headers.host || "";
      const localHosts = ["localhost", "127.0.0.1", "[::1]"];
      const hostname = new URL(`http://${host}`).hostname;
      const publicHost = this.options.publicOrigin ? new URL(this.options.publicOrigin).host : null;
      const address = hostname.replace(/^\[|\]$/g, "");
      const localInterface = localInterfaceAddresses().some(entry => entry.address === address);
      if (!localHosts.includes(hostname) && !localInterface && host !== publicHost) { json(403, { error: "Host not allowed" }); return; }
      const origin = request.headers.origin;
      if (origin && origin !== `http://${host}` && origin !== this.options.publicOrigin) { json(403, { error: "Origin not allowed" }); return; }
      const url = new URL(request.url || "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/api/client-version") {
        json(200, { version: await this.clientVersion() }); return;
      }
      const asset = this.assets[url.pathname];
      if (request.method === "GET" && asset) {
        let bytes = await readFile(join(this.options.assetsDirectory, asset[0]));
        if (url.pathname === "/") bytes = Buffer.from(bytes.toString("utf8")
          .replaceAll("__BOATYARD_APP_NAME__", this.options.readOnly ? "Boatyard Share" : "Boatyard Remote")
          .replaceAll("__BOATYARD_SHORT_NAME__", this.options.readOnly ? "Share" : "Remote")
          .replaceAll("__BOATYARD_ICON_PATH__", `/icons/${this.mode}`)
          .replace("__BOATYARD_CLIENT_VERSION__", await this.clientVersion()));
        if (url.pathname === "/manifest.json") {
          const manifest = JSON.parse(bytes.toString("utf8"));
          manifest.name = this.options.readOnly ? "Boatyard Share" : "Boatyard Remote";
          manifest.short_name = this.options.readOnly ? "Share" : "Remote";
          manifest.description = this.options.readOnly ? "View a shared Boatyard window." : "View and control a shared Boatyard window.";
          for (const icon of manifest.icons) icon.src = `/icons/${this.mode}${icon.src}`;
          bytes = Buffer.from(JSON.stringify(manifest));
        }
        response.writeHead(200, { "Content-Type": asset[1] }); response.end(bytes); return;
      }
      const secureCookie = origin?.startsWith("https://") || (host === publicHost && this.options.publicOrigin?.startsWith("https://"));
      const cookieName = this.options.readOnly ? "boatyard_share_session" : "boatyard_remote_session";
      const setCookie = (value: string, age: number) => response.setHeader("Set-Cookie", `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookie ? "; Secure" : ""}`);
      const readBody = async (limit = 65536) => {
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > limit) throw new Error("Request too large");
          chunks.push(chunk);
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
        return body as Record<string, unknown>;
      };
      if (request.method === "GET" && url.pathname === "/api/auth") {
        json(200, { passwordLogin: !this.options.readOnly, ...(this.options.readOnly ? this.shareAccess.publicSettings : {}) }); return;
      }
      if (request.method === "POST" && ["/api/share/preview", "/api/redeem", "/api/share/request"].includes(url.pathname)) {
        if (!this.options.readOnly) { json(404, { error: "Share is unavailable." }); return; }
        const body = await readBody(4096);
        if (!this.server) return;
        const participant = this.shareAccess.lookup(body.token), group = this.shareAccess.isGroup(body.token);
        if (!this.allowShareAttempt(request, Boolean(participant || group))) { json(429, { error: "Too many access attempts. Try again in a minute." }); return; }
        if (url.pathname === "/api/share/preview") {
          if (!participant && !group) { json(401, { error: "Invalid access code." }); return; }
          json(200, { label: participant?.label || "", group, approvalRequired: group && this.shareAccess.publicSettings.groupApprovalRequired }); return;
        }
        const label = typeof body.label === "string" ? body.label.trim() : participant?.label || "";
        if (!label || label.length > 80) { json(400, { error: "Enter your name (up to 80 characters)." }); return; }
        if (url.pathname === "/api/share/request" || group && this.shareAccess.publicSettings.groupApprovalRequired) {
          const source = url.pathname === "/api/share/request" ? "request" : "group";
          if (source === "request" && !this.shareAccess.publicSettings.allowJoinRequests) { json(403, { error: "Join requests are unavailable." }); return; }
          const pending = this.shareAccess.request(label, source);
          this.options.clientsChanged?.(); this.options.joinRequested?.(label);
          json(200, { pending: true, requestToken: pending.token }); return;
        }
        if (!participant && !group) { json(401, { error: "Invalid access code." }); return; }
        const identity = participant || this.shareAccess.participants.get(this.shareAccess.create(label).id)!;
        identity.label = label;
        setCookie(this.signInParticipant(identity), BROWSER_COOKIE_MAX_AGE);
        json(200, { authenticated: true, participant: { label: identity.label, code: identity.token } }); return;
      }
      if (request.method === "POST" && ["/api/share/request-status", "/api/share/request-cancel"].includes(url.pathname)) {
        const body = await readBody(4096), pending = this.options.readOnly ? this.shareAccess.poll(body.requestToken) : undefined;
        if (!pending) { json(410, { error: "This join request has expired. Ask to join again." }); return; }
        if (url.pathname === "/api/share/request-cancel") {
          if (pending.participantId) this.revokeClient(pending.participantId);
          this.shareAccess.finish(pending.token); this.options.clientsChanged?.(); json(200, { cancelled: true }); return;
        }
        if (pending.state === "approved") {
          const participant = this.shareAccess.participants.get(pending.participantId!);
          if (!participant) { json(410, { error: "This access has been revoked." }); return; }
          setCookie(this.signInParticipant(participant), BROWSER_COOKIE_MAX_AGE);
          json(200, { authenticated: true, participant: { label: participant.label, code: participant.token } }); return;
        }
        if (pending.state === "claimed") { json(410, { error: "This request has already joined. Use your personal access code." }); return; }
        json(200, { pending: pending.state === "pending", declined: pending.state === "declined" }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/login") {
        if (this.options.readOnly) { json(401, { error: "Enter your Share access code." }); return; }
        const address = request.socket.remoteAddress || "unknown";
        const now = Date.now();
        for (const [key, attempt] of this.attempts) if (now - attempt.since > 60000) this.attempts.delete(key);
        const attempt = this.attempts.get(address) || { since: now, count: 0 };
        if (attempt.count >= 10 || this.pendingLogins >= 4 || this.attempts.size >= 256 && !this.attempts.has(address)) {
          json(429, { error: "Too many login attempts. Try again in a minute." }); return;
        }
        attempt.count++; this.attempts.set(address, attempt);
        const body = await readBody(4096);
        if (this.pendingLogins >= 4) { json(429, { error: "Too many login attempts. Try again shortly." }); return; }
        this.pendingLogins++;
        let valid = false;
        try { valid = typeof body.password === "string" && await verifyRemotePassword(body.password, this.options.passwordHash); }
        finally { this.pendingLogins--; }
        if (!valid) { json(401, { error: "Incorrect password." }); return; }
        if (!this.server) return;
        if (this.logins.size >= 32) { json(429, { error: "Too many active browser sessions." }); return; }
        const login = randomBytes(32).toString("base64url");
        this.logins.add(this.loginDigest(login)); this.saveLogins();
        setCookie(login, BROWSER_COOKIE_MAX_AGE);
        json(200, { authenticated: true }); return;
      }
      const token = request.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || "";
      const login = this.loginDigest(token);
      if (!this.logins.has(login)) { this.logins.delete(login); this.loginClients.delete(login); json(401, { error: this.options.readOnly ? "Your access is no longer active. It may have been opened on another device. Join again to use this device." : "Please sign in." }); return; }
      if (request.method === "POST" && url.pathname === "/api/logout") {
        this.invalidateLogin(login); this.options.clientsChanged?.(); this.saveLogins(); setCookie("", 0); json(200, { authenticated: false }); return;
      }
      setCookie(token, BROWSER_COOKIE_MAX_AGE);
      if (url.pathname.startsWith("/api/chat")) {
        const chat = this.options.readOnly ? this.options.chat : undefined, chatId = this.chatId;
        if (!chat || !chatId) { json(404, { error: "Chat is unavailable." }); return; }
        if (request.method === "GET" && url.pathname === "/api/chat") { json(200, chat.snapshot(chatId)); return; }
        if (request.method === "GET" && url.pathname === "/api/chat/events") {
          if ([...this.chatStreams.values()].filter(owner => owner === login).length >= 2 || this.chatStreams.size >= 32) { json(429, { error: "Too many chat connections." }); return; }
          response.writeHead(200, { "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
          this.chatStreams.set(response, login);
          const notify = () => {
            if (!this.logins.has(login) || this.chatId !== chatId) { response.end(); return; }
            if (response.writableLength > 65536) { response.destroy(); return; }
            response.write('data: {}\n\n');
          };
          const unsubscribe = chat.subscribe(notify);
          const heartbeat = setInterval(() => {
            if (!this.logins.has(login)) response.end(); else response.write(': heartbeat\n\n');
          }, 15000);
          response.on("close", () => { clearInterval(heartbeat); unsubscribe(); this.chatStreams.delete(response); });
          notify(); return;
        }
        if (request.method === "GET" && url.pathname.startsWith("/api/chat/image/")) {
          const image = chat.image(chatId, url.pathname.slice("/api/chat/image/".length));
          response.writeHead(200, { "Content-Type": image.mime }); response.end(image.bytes); return;
        }
        if (request.method === "POST" && url.pathname === "/api/chat/send") {
          const body = await readBody(Math.ceil(MAX_CHAT_IMAGE_BYTES * 1.4) + 65536);
          if (!this.logins.has(login)) { json(401, { error: "Your access is no longer active." }); return; }
          if (body.sessionId !== chatId || this.chatId !== chatId) throw new Error("This conversation has ended.");
          const identity = this.loginClients.get(login);
          if (!identity) throw new Error("Please join the sharing session.");
          if (Date.now() - (this.chatLastSent.get(login) || 0) < 500) { json(429, { error: "Please wait a moment before sending another message." }); return; }
          const message = chat.send(chatId, identity.id, identity.label, body);
          this.chatLastSent.set(login, Date.now()); json(200, { message }); return;
        }
        json(404, { error: "Not found" }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/windows") {
        const iceServers = this.options.getIceServers ? await this.options.getIceServers() : this.options.iceServers || [];
        if (!this.logins.has(login)) { json(401, { error: "Please sign in." }); return; }
        const identity = this.shareAccess.participants.get(this.loginClients.get(login)?.id || "");
        json(200, { windows: this.options.listWindows(), iceServers, iceTransportPolicy: this.options.getIceTransportPolicy?.() ?? "all", readOnly: this.options.readOnly === true, ...(this.options.readOnly ? { participant: identity ? { label: identity.label, code: identity.token } : undefined } : {}) }); return;
      }
      if (request.method !== "POST" || !["/api/connect", "/api/disconnect", "/api/recover"].includes(url.pathname)) { json(404, { error: "Not found" }); return; }
      const body = await readBody();
      if (!this.logins.has(login)) { json(401, { error: "Your access is no longer active. Join again." }); return; }
      if (url.pathname === "/api/disconnect") {
        if (typeof body.sessionId !== "string") { json(400, { error: "Invalid session" }); return; }
        if (this.sessions.get(body.sessionId)?.login === login) { this.options.disconnect(body.sessionId); this.sessionClosed(body.sessionId); }
        json(200, { disconnected: true }); return;
      }
      if (typeof body.windowId !== "string" || body.type !== "offer" || typeof body.sdp !== "string" || !body.sdp.startsWith("v=0") ||
          !this.options.listWindows().some(window => window.id === body.windowId)) { json(400, { error: "Invalid window or offer" }); return; }
      if (url.pathname === "/api/recover") {
        if (typeof body.sessionId !== "string" || this.sessions.get(body.sessionId)?.login !== login) { json(403, { error: "Remote session unavailable" }); return; }
        if (!this.options.recover) { json(400, { error: "Streaming recovery unavailable" }); return; }
        if (this.connecting.has(login)) { json(409, { error: "Streaming recovery already in progress" }); return; }
        this.connecting.add(login);
        try {
          const answer = await this.options.recover(body.sessionId, body as RemoteOffer);
          if (!this.server || response.destroyed) { this.options.disconnect(answer.sessionId); return; }
          if (!this.logins.has(login) || this.sessions.get(answer.sessionId)?.login !== login) { this.options.disconnect(answer.sessionId); json(401, { error: "Remote session closed" }); return; }
          json(200, answer);
        } finally { this.connecting.delete(login); }
        return;
      }
      if (this.connecting.has(login) || [...this.sessions.values()].some(session => session.login === login) || this.connecting.size + this.sessions.size >= (this.options.readOnly ? MAX_SHARE_CLIENTS : 1)) {
        json(409, { error: this.options.readOnly ? "The viewer limit has been reached or this browser is already connected." : "A client is already connected. Disconnect it first." }); return;
      }
      this.connecting.add(login);
      try {
        const participant = this.shareAccess.participants.get(this.loginClients.get(login)?.id || "");
        const answer = await this.options.connect(body as RemoteOffer, participant?.voiceAllowed, id => { this.pendingSessions.set(login, id); });
        if (!this.server || response.destroyed) { this.options.disconnect(answer.sessionId); return; }
        if (!this.logins.has(login)) { this.options.disconnect(answer.sessionId); json(401, { error: "Please sign in." }); return; }
        if (!this.loginClients.has(login)) this.loginClients.set(login, { id: randomUUID(), label: "Remote client" });
        this.sessions.set(answer.sessionId, { login });
        this.options.clientsChanged?.();
        json(200, answer);
      } finally { this.connecting.delete(login); this.pendingSessions.delete(login); }
    } catch (error) {
      json(400, { error: error instanceof Error ? error.message : "Remote request failed" });
    }
  }
  sessionClosed(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.options.clientsChanged?.();
  }
}
