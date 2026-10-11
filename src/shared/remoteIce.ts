export const TURN_CREDENTIAL_TTL = 12 * 60 * 60;
export const TURN_CREDENTIAL_RENEWAL_MS = 10 * 60 * 60 * 1000;

export type RemoteConnectionRoute = "direct" | "relay";

export function remoteConnectionRoute(stats: RTCStatsReport): RemoteConnectionRoute | null {
  let route: RemoteConnectionRoute | null = null;
  stats.forEach(report => {
    if (report.type !== "transport" || !report.selectedCandidatePairId) return;
    const pair = stats.get(report.selectedCandidatePairId);
    const local = stats.get(pair?.localCandidateId)?.candidateType;
    const remote = stats.get(pair?.remoteCandidateId)?.candidateType;
    if (local === "relay" || remote === "relay") route = "relay";
    else if (local && remote && route !== "relay") route = "direct";
  });
  return route;
}

/** Keep editable comments in settings, but pass only active addresses to WebRTC. */
export function activeRemoteTurnUrls(lines: string[]): string[] {
  return lines.map(line => line.split("#", 1)[0]!.trim()).filter(Boolean);
}

export function remotePeerConfiguration(servers: RTCIceServer[] = [], iceTransportPolicy: RTCIceTransportPolicy = "all"): RTCConfiguration {
  const iceServers = servers.map(server => ({ ...server,
    urls: (typeof server.urls === "string" ? [server.urls] : server.urls).filter(url => /^turns?:/.test(url))
  })).filter(server => server.urls.length > 0);
  return { iceServers, iceTransportPolicy };
}

export function waitForRemoteIce(peer: RTCPeerConnection, timeoutMs = 10000): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", changed);
      if (error) reject(error); else resolve();
    };
    const changed = () => { if (peer.iceGatheringState === "complete") finish(); };
    const timer = setTimeout(() => {
      // Some interfaces or TURN transports can stall while others already work.
      // The non-trickle offer/answer can use the candidates gathered so far.
      const candidates = peer.localDescription?.sdp || "";
      const usable = peer.getConfiguration().iceTransportPolicy === "relay"
        ? /^a=candidate:.* typ relay(?:\s|$)/m.test(candidates) : /^a=candidate:/m.test(candidates);
      finish(usable ? undefined : new Error("ICE gathering timed out without a usable connection candidate"));
    }, timeoutMs);
    peer.addEventListener("icegatheringstatechange", changed);
  });
}
