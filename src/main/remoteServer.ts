import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyRemotePassword, isRemotePasswordHash } from "./remotePassword.js";
import { networkInterfaces } from "node:os";
import type { RemoteConnectionRoute } from "../shared/remoteIce.js";

export const DEFAULT_REMOTE_HOST = "0.0.0.0";
export const MAX_SHARE_CLIENTS = 8;
const BROWSER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const clientAssets: Record<string, [string, string]> = {
  "/": ["client.html", "text/html"],
  "/client.js": ["client.js", "text/javascript"],
  "/remote.css": ["remote.css", "text/css"],
  "/waiting-screen.png": ["../assets/boatyard-mark-night-preview.png", "image/png"],
  "/manifest.json": ["manifest.json", "application/manifest+json"],
  "/icon-192.png": ["icon-192.png", "image/png"],
  "/icon-512.png": ["icon-512.png", "image/png"],
  "/apple-touch-icon.png": ["apple-touch-icon.png", "image/png"]
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
  host?: string;
  port?: number;
  publicOrigin?: string;
  iceServers?: RTCIceServer[];
  getIceServers?(): Promise<RTCIceServer[]>;
  getIceTransportPolicy?(): RTCIceTransportPolicy;
  getConnectionRoute?(sessionId: string): RemoteConnectionRoute | null;
  listWindows(): RemoteWindowInfo[];
  connect(offer: RemoteOffer): Promise<RemoteAnswer>;
  recover?(sessionId: string, offer: RemoteOffer): Promise<RemoteAnswer>;
  disconnect(sessionId?: string): void;
  clientsChanged?(): void;
};

export class RemoteServer {
  private readonly logins = new Set<string>();
  private readonly attempts = new Map<string, { since: number; count: number }>();
  private pendingLogins = 0;
  private nextViewerNumber = 1;
  private readonly invitations = new Map<string, { id: string; label: string; expiresAt: number }>();
  private readonly loginClients = new Map<string, { id: string; label: string }>();
  private readonly sessions = new Map<string, { login: string }>();
  private server: Server | null = null;
  private readonly connecting = new Set<string>();
  constructor(private readonly options: RemoteServerOptions) {
    if (!options.readOnly && !isRemotePasswordHash(options.passwordHash)) throw new Error("Set a password before starting remote access.");
    if (options.publicOrigin && new URL(options.publicOrigin).origin !== options.publicOrigin) throw new Error("Remote public origin must be an origin without a path");
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
    this.prune();
    return [
      ...[...this.invitations.values()].map(value => ({ ...value, state: "invited" })),
      ...[...this.loginClients].map(([login, value]) => {
        const session = [...this.sessions].find(([, session]) => session.login === login);
        return { ...value, state: session ? "connected" : "signed-in",
          route: session ? this.options.getConnectionRoute?.(session[0]) ?? null : null };
      })
    ];
  }
  private prune() {
    for (const [token, value] of this.invitations) if (value.expiresAt <= Date.now()) this.invitations.delete(token);
    for (const login of this.loginClients.keys()) if (!this.logins.has(login)) this.loginClients.delete(login);
  }
  createReadOnlyInvitation(label = "") {
    if (!this.server || !this.options.readOnly) throw new Error("Start read-only sharing before creating a link.");
    this.prune();
    if (this.invitations.size + this.logins.size >= 32) throw new Error("Too many invited clients. Remove an existing client first.");
    const token = randomBytes(32).toString("base64url");
    const suppliedName = String(label).trim().slice(0, 80);
    const names = new Set(this.getClients().map(client => client.label));
    let name = suppliedName;
    if (!name) { do { name = `Viewer ${this.nextViewerNumber++}`; } while (names.has(name)); }
    const invitation = { id: randomUUID(), label: name, expiresAt: Date.now() + 15 * 60 * 1000 };
    this.invitations.set(token, invitation);
    this.options.clientsChanged?.();
    return { token, ...invitation };
  }
  revokeClient(id: string) {
    for (const [token, client] of this.invitations) if (client.id === id) this.invitations.delete(token);
    for (const [login, client] of this.loginClients) if (client.id === id) {
      this.logins.delete(login); this.loginClients.delete(login);
      for (const [sessionId, session] of [...this.sessions]) if (session.login === login) { this.options.disconnect(sessionId); this.sessionClosed(sessionId); }
    }
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
    return address.port;
  }
  async stop() {
    this.options.disconnect();
    this.logins.clear(); this.attempts.clear(); this.invitations.clear(); this.loginClients.clear();
    this.sessions.clear(); this.connecting.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
  private async clientVersion() {
    const hash = createHash("sha256");
    for (const [file] of Object.values(clientAssets)) {
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
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
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
      const asset = clientAssets[url.pathname];
      if (request.method === "GET" && asset) {
        let bytes = await readFile(join(this.options.assetsDirectory, asset[0]));
        if (url.pathname === "/") bytes = Buffer.from(bytes.toString("utf8").replace("__BOATYARD_CLIENT_VERSION__", await this.clientVersion()));
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
        json(200, { passwordLogin: !this.options.readOnly }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/redeem") {
        const body = await readBody(4096);
        const invitation = typeof body.token === "string" ? this.invitations.get(body.token) : undefined;
        if (!this.options.readOnly || !invitation || invitation.expiresAt <= Date.now()) {
          json(401, { error: "This share link has expired or has already been used. Ask for a new link." }); return;
        }
        if (this.logins.size >= 32) { json(429, { error: "Too many active browser sessions." }); return; }
        // Consume synchronously before issuing the browser session; concurrent redemption cannot reuse it.
        this.invitations.delete(String(body.token));
        const login = randomBytes(32).toString("base64url");
        this.logins.add(this.loginDigest(login));
        this.loginClients.set(this.loginDigest(login), { id: invitation.id, label: invitation.label });
        this.options.clientsChanged?.();
        setCookie(login, BROWSER_COOKIE_MAX_AGE);
        json(200, { authenticated: true }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/login") {
        if (this.options.readOnly) { json(401, { error: "Open your one-use read-only share link." }); return; }
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
      if (!this.logins.has(login)) { this.logins.delete(login); this.loginClients.delete(login); json(401, { error: "Please sign in." }); return; }
      if (request.method === "POST" && url.pathname === "/api/logout") {
        for (const [id, session] of [...this.sessions]) if (session.login === login) { this.options.disconnect(id); this.sessionClosed(id); }
        this.logins.delete(login); this.loginClients.delete(login); this.options.clientsChanged?.(); this.saveLogins(); setCookie("", 0); json(200, { authenticated: false }); return;
      }
      setCookie(token, BROWSER_COOKIE_MAX_AGE);
      if (request.method === "GET" && url.pathname === "/api/windows") {
        const iceServers = this.options.getIceServers ? await this.options.getIceServers() : this.options.iceServers || [];
        if (!this.logins.has(login)) { json(401, { error: "Please sign in." }); return; }
        json(200, { windows: this.options.listWindows(), iceServers, iceTransportPolicy: this.options.getIceTransportPolicy?.() ?? "all", readOnly: this.options.readOnly === true }); return;
      }
      if (request.method !== "POST" || !["/api/connect", "/api/disconnect", "/api/recover"].includes(url.pathname)) { json(404, { error: "Not found" }); return; }
      const body = await readBody();
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
        const answer = await this.options.connect(body as RemoteOffer);
        if (!this.server || response.destroyed) { this.options.disconnect(answer.sessionId); return; }
        if (!this.logins.has(login)) { this.options.disconnect(answer.sessionId); json(401, { error: "Please sign in." }); return; }
        if (!this.loginClients.has(login)) this.loginClients.set(login, { id: randomUUID(), label: "Remote client" });
        this.sessions.set(answer.sessionId, { login });
        this.options.clientsChanged?.();
        json(200, answer);
      } finally { this.connecting.delete(login); }
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
