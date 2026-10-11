import { readFile } from "node:fs/promises";
import { remotePeerConfiguration, TURN_CREDENTIAL_TTL } from "../shared/remoteIce.js";

export function createRemoteIceProvider(file: string, override?: string, request: typeof fetch = fetch) {
  return async (): Promise<RTCIceServer[]> => {
    if (override) return remotePeerConfiguration(JSON.parse(override) as RTCIceServer[]).iceServers!;
    let configuration: unknown;
    try { configuration = JSON.parse(await readFile(file, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Could not read Cloudflare TURN configuration.");
    }
    const config = configuration as { keyId?: unknown; apiToken?: unknown } | null;
    if (!config || typeof config.keyId !== "string" || !/^[a-f0-9]{32}$/i.test(config.keyId) ||
      typeof config.apiToken !== "string" || !config.apiToken.trim()) {
      throw new Error("Cloudflare TURN requires a keyId and apiToken.");
    }
    return obtainCloudflareIceServers(config as { keyId: string; apiToken: string }, request);
  };
}

export async function obtainCloudflareIceServers(config: { keyId: string; apiToken: string }, request: typeof fetch = fetch): Promise<RTCIceServer[]> {
  try {
    const response = await request(`https://rtc.live.cloudflare.com/v1/turn/keys/${config.keyId}/credentials/generate-ice-servers`, {
      method: "POST", headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL }), signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error();
    const data = await response.json() as { iceServers?: RTCIceServer[] };
    if (!Array.isArray(data.iceServers)) throw new Error();
    const servers = data.iceServers.map(server => {
      const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
      if (!Array.isArray(urls) || urls.some(url => typeof url !== "string" || !/^(stun|turn|turns):/.test(url))) throw new Error();
      // Non-trickle negotiation must not wait for browser-blocked port 53.
      return { urls: urls.filter(url => !/:53(?:\?|$)/.test(url)),
        ...(typeof server.username === "string" ? { username: server.username } : {}),
        ...(typeof server.credential === "string" ? { credential: server.credential } : {}) };
    }).filter(server => server.urls.length);
    if (!servers.some(server => server.urls.some(url => /^turns?:/.test(url)) &&
      typeof server.username === "string" && typeof server.credential === "string")) throw new Error();
    return remotePeerConfiguration(servers).iceServers!;
  } catch {
    // Provider errors can contain credentials; never forward their raw body.
    throw new Error("Could not obtain Cloudflare TURN credentials. Check the TURN key and Internet connection.");
  }
}
