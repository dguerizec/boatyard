import { existsSync, chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hashRemotePassword, isRemotePasswordHash, verifyRemotePassword } from "./remotePassword.js";

export const DEFAULT_REMOTE_PORT = 47831;
export type RemoteSettings = { enabled: boolean; port: number; publicOrigin: string; passwordHash: string; readOnly: boolean };

function readPort(value: unknown): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Port must be between 1024 and 65535.");
  return port;
}
function readOrigin(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("External URL must be an HTTP or HTTPS address without a path.");
  }
  return url.origin;
}

export class RemoteSettingsStore {
  private settings: RemoteSettings = { enabled: false, port: DEFAULT_REMOTE_PORT, publicOrigin: "", passwordHash: "", readOnly: false };
  constructor(private readonly filePath: string, defaults: Partial<RemoteSettings> = {}) { this.settings = { ...this.settings, ...defaults }; }
  load(): RemoteSettings {
    if (existsSync(this.filePath)) {
      try {
        const value = JSON.parse(readFileSync(this.filePath, "utf8"));
        const passwordHash = isRemotePasswordHash(value.passwordHash) ? value.passwordHash : "";
        this.settings = { enabled: value.enabled === true && (value.readOnly === true || Boolean(passwordHash)), port: readPort(value.port), publicOrigin: readOrigin(value.publicOrigin), passwordHash, readOnly: value.readOnly === true };
        chmodSync(this.filePath, 0o600);
      } catch { console.warn("Could not load remote access settings. Remote access remains disabled."); }
    }
    return this.get();
  }
  get(): RemoteSettings { return { ...this.settings }; }
  async update(patch: Record<string, unknown>): Promise<RemoteSettings> {
    const next = { ...this.settings };
    if (patch.port !== undefined) next.port = readPort(patch.port);
    if (patch.publicOrigin !== undefined) next.publicOrigin = readOrigin(patch.publicOrigin);
    if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
    if (patch.readOnly !== undefined) next.readOnly = patch.readOnly === true;
    if (patch.password !== undefined && (typeof patch.password !== "string" || patch.password.length > 1024)) throw new Error("Invalid password.");
    if (typeof patch.password === "string" && patch.password && !(await verifyRemotePassword(patch.password, next.passwordHash))) next.passwordHash = await hashRemotePassword(patch.password);
    if (next.enabled && !next.readOnly && !next.passwordHash) throw new Error("Set a password before starting remote access.");
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, this.filePath); chmodSync(this.filePath, 0o600);
    this.settings = next;
    return this.get();
  }
}
