import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { obtainCloudflareIceServers } from "./cloudflareTurn.js";
import { activeRemoteTurnUrls, remotePeerConfiguration, TURN_CREDENTIAL_TTL } from "../shared/remoteIce.js";

type Settings = {
  provider: "direct" | "cloudflare" | "custom";
  forceRelay: boolean;
  keyId: string; apiToken: string;
  urls: string[]; authentication: "fixed" | "temporary";
  username: string; password: string; sharedSecret: string;
};
const defaults: Settings = { provider: "direct", forceRelay: false, keyId: "", apiToken: "", urls: [], authentication: "fixed", username: "", password: "", sharedSecret: "" };
export { TURN_CREDENTIAL_TTL } from "../shared/remoteIce.js";

function isTurnUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  const match = /^(turns?):([^\s/@?#]+)(?:\?transport=(udp|tcp))?$/.exec(value);
  if (!match) return false;
  try {
    const address = new URL(`http://${match[2]}`);
    return Boolean(address.hostname) && address.pathname === "/" && (!address.port || Number(address.port) > 0);
  } catch { return false; }
}

function validate(value: Settings): Settings {
  if (typeof value.forceRelay !== "boolean") throw new Error("Invalid relay policy.");
  if (value.forceRelay && value.provider === "direct") throw new Error("Configure TURN before forcing relay connections.");
  if (!["direct", "cloudflare", "custom"].includes(value.provider) || !["fixed", "temporary"].includes(value.authentication)) throw new Error("Invalid WebRTC provider or authentication mode.");
  for (const key of ["keyId", "apiToken", "username", "password", "sharedSecret"] as const) {
    if (typeof value[key] !== "string" || value[key].length > 4096) throw new Error("Invalid WebRTC settings.");
  }
  if (!Array.isArray(value.urls) || value.urls.length > 256 || value.urls.some(line => typeof line !== "string" || line.length > 4096)) throw new Error("Invalid TURN address list.");
  const activeUrls = activeRemoteTurnUrls(value.urls);
  if (activeUrls.length > 16 || activeUrls.some(url => !isTurnUrl(url))) throw new Error("Enter valid TURN or TURNS addresses (one per line).");
  if (value.provider === "cloudflare" && (!/^[a-f0-9]{32}$/i.test(value.keyId) || !value.apiToken.trim())) throw new Error("Cloudflare TURN requires a key ID and key secret.");
  if (value.provider === "custom" && (!activeUrls.length || (value.authentication === "fixed" ? !value.username.trim() || !value.password : !value.sharedSecret))) throw new Error("Custom TURN requires addresses and authentication credentials.");
  return value;
}

/** Installation-wide settings; permanent provider secrets never enter status responses. */
export class WebrtcSettingsStore {
  private settings: Settings = { ...defaults, urls: [] };
  private loadError = "";
  readonly filePath: string;
  constructor(private readonly root: string, private readonly override?: string, private readonly request: typeof fetch = fetch) {
    this.filePath = join(root, "webrtc.json");
  }
  load() {
    try {
      if (existsSync(this.filePath)) {
        this.settings = validate({ ...defaults, ...JSON.parse(readFileSync(this.filePath, "utf8")) });
        chmodSync(this.filePath, 0o600);
      } else {
        const legacy = join(this.root, "cloudflare-turn.json");
        if (existsSync(legacy)) {
          const config = JSON.parse(readFileSync(legacy, "utf8"));
          this.persist(validate({ ...defaults, provider: "cloudflare", keyId: config.keyId, apiToken: config.apiToken }));
          chmodSync(legacy, 0o600);
        }
      }
    } catch {
      this.loadError = "Could not load WebRTC settings. Check the private configuration file.";
      throw new Error(this.loadError);
    }
    this.loadError = "";
    return this.status();
  }
  status() {
    const { provider, forceRelay, keyId, urls, authentication, username } = this.settings;
    return { error: this.loadError, provider, forceRelay, keyId, urls: [...urls], authentication, username, hasApiToken: Boolean(this.settings.apiToken), hasPassword: Boolean(this.settings.password), hasSharedSecret: Boolean(this.settings.sharedSecret), overridden: Boolean(this.override) };
  }
  update(patch: unknown) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid WebRTC settings.");
    const next = { ...this.settings, urls: [...this.settings.urls] };
    const source = patch as Record<string, unknown>;
    for (const key of Object.keys(defaults) as (keyof Settings)[]) {
      if (source[key] === undefined) continue;
      // Empty secret fields keep the saved secret; switching providers does not erase it.
      if (["apiToken", "password", "sharedSecret"].includes(key) && source[key] === "") continue;
      Object.assign(next, { [key]: source[key] });
    }
    this.persist(validate(next));
    return this.status();
  }
  private persist(next: Settings) {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.filePath);
    chmodSync(this.filePath, 0o600);
    this.settings = next;
    this.loadError = "";
  }
  getIceTransportPolicy(): RTCIceTransportPolicy { return this.settings.forceRelay ? "relay" : "all"; }
  async getIceServers(): Promise<RTCIceServer[]> {
    if (this.override) {
      try { return remotePeerConfiguration(JSON.parse(this.override)).iceServers!; }
      catch { throw new Error("Invalid BOATYARD_REMOTE_ICE_SERVERS override."); }
    }
    if (this.loadError) throw new Error(this.loadError);
    const config = this.settings;
    if (config.provider === "direct") return [];
    if (config.provider === "cloudflare") return obtainCloudflareIceServers(config, this.request);
    const username = config.authentication === "temporary" ? `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL}:${randomUUID()}` : config.username;
    const credential = config.authentication === "temporary" ? createHmac("sha1", config.sharedSecret).update(username).digest("base64") : config.password;
    return [{ urls: activeRemoteTurnUrls(config.urls), username, credential }];
  }
}
