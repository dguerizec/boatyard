import type { RemoteAudioMode } from "../shared/remoteAudio.js";
import type { ShareAccessSettings } from "./shareAccessState.js";
import { join } from "node:path";
import { RemoteAccessController } from "./remoteAccessController.js";
import { DEFAULT_REMOTE_PORT, RemoteSettingsStore } from "./remoteSettingsStore.js";

export type RemoteAccessMode = "remote" | "share";
type HostMicrophone = {
  readonly hostMicrophone: { deviceId: string; devices: { deviceId: string; label: string }[] };
  prepareMicrophones(): Promise<void>;
  setHostMicrophoneDevice(deviceId: string): Promise<void>;
  subscribe(listener: () => void): () => void;
  close(): void;
};

export async function loadRemoteAccessSettings(root: string) {
  const remote = new RemoteSettingsStore(join(root, "remote.json"));
  const settings = remote.load();
  const share = new RemoteSettingsStore(join(root, "remote-share.json"), { readOnly: true, port: settings.port < 65535 ? settings.port + 1 : DEFAULT_REMOTE_PORT });
  share.load();
  return { remote, share };
}

export class RemoteAccessManager {
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private shareHadClients = false;
  private readonly errors = new Map<RemoteAccessMode, string>();
  private readonly unsubscribeMicrophone: (() => void) | undefined;
  constructor(private readonly controllers: Record<RemoteAccessMode, RemoteAccessController>, private readonly changed: () => void = () => {}, private readonly microphone?: HostMicrophone) {
    this.unsubscribeMicrophone = microphone?.subscribe(changed);
  }
  getStatus(mode: RemoteAccessMode) {
    const status = this.controllers[mode].getStatus();
    return { ...status, ...(this.microphone ? { hostMicrophone: this.microphone.hostMicrophone } : {}), error: this.errors.get(mode) || status.error };
  }
  getStatuses() { return { remote: this.getStatus("remote"), share: this.getStatus("share") }; }
  configure(mode: RemoteAccessMode, patch?: Record<string, unknown>) {
    return this.run(() => this.applyConfiguration(mode, patch, false, mode === "share" && patch?.enabled === false));
  }
  private async applyConfiguration(mode: RemoteAccessMode, patch?: Record<string, unknown>, addingClient = false, clearInvitations = false) {
    if (mode === "share" && !addingClient && patch?.enabled !== true) {
      patch = { ...patch, enabled: false };
    }
    this.errors.delete(mode);
    const next = { ...this.getStatus(mode), ...patch };
    const other = this.getStatus(mode === "remote" ? "share" : "remote");
    if (next.enabled && other.enabled) {
      if (Number(next.port) === Number(other.port)) throw new Error("Remote and Share must use different ports.");
      if (next.publicOrigin && other.publicOrigin && new URL(String(next.publicOrigin)).origin === new URL(String(other.publicOrigin)).origin) {
        throw new Error("Remote and Share must use different external URLs.");
      }
    }
    return this.controllers[mode].configure(patch ? { ...patch, readOnly: mode === "share" } : { readOnly: mode === "share" }, clearInvitations);
  }
  clientsChanged(mode: RemoteAccessMode) {
    if (mode !== "share" || this.stopped) return;
    const status = this.getStatus("share");
    if (!status.listening) { this.shareHadClients = false; return; }
    const clients = status.clients as { state?: string }[];
    const access = status.shareAccess;
    const ended = this.shareHadClients && !clients.length && !access?.groupEnabled && !access?.allowJoinRequests;
    this.shareHadClients = clients.length > 0;
    if (ended) void this.run(async () => {
      const latest = this.getStatus("share");
      if (latest.listening && !latest.clients.length && !latest.shareAccess?.groupEnabled && !latest.shareAccess?.allowJoinRequests) {
        await this.applyConfiguration("share", { enabled: false });
      }
    }).catch(() => {});
  }
  private run<T>(action: () => Promise<T>) {
    const result = this.queue.then(() => { if (this.stopped) throw new Error("Boatyard is shutting down."); return action(); });
    this.queue = result.catch(() => {}); return result;
  }
  createReadOnlyLink(label?: string) {
    return this.run(async () => {
      const starting = !this.getStatus("share").listening;
      if (starting) {
        const status = await this.applyConfiguration("share", { enabled: true }, true);
        if (!status.listening) throw new Error(status.error || "Could not start Share.");
      }
      try { return await this.controllers.share.createReadOnlyLink(label); }
      catch (error) { if (starting) await this.applyConfiguration("share", { enabled: false }); throw error; }
    });
  }
  configureShareAccess(patch: Partial<ShareAccessSettings>) {
    return this.run(async () => {
      const starting = !this.getStatus("share").listening;
      if (starting) {
        const status = await this.applyConfiguration("share", { enabled: true }, true);
        if (!status.listening) throw new Error(status.error || "Could not start Share.");
      }
      try { return await this.controllers.share.configureShareAccess(patch); }
      catch (error) { if (starting) await this.applyConfiguration("share", { enabled: false }); throw error; }
    });
  }
  decideShareJoinRequest(id: string, accepted: boolean) { return this.run(() => this.controllers.share.decideShareJoinRequest(id, accepted)); }
  updateShareScreen(patch: Record<string, unknown> | (() => Record<string, unknown>)) { return this.run(() => this.controllers.share.updateScreen(typeof patch === "function" ? patch() : patch)); }
  toggleShareScreen() { return this.run(() => this.controllers.share.updateScreen({ screenHidden: !this.getStatus("share").screenHidden })); }
  revokeClient(id: string) { return this.run(() => this.controllers.share.revokeClient(id)); }
  disconnectClient(mode: RemoteAccessMode, id: string) { return this.run(() => this.controllers[mode].disconnectClient(id)); }
  voiceControl(mode: RemoteAccessMode, id: string | null, allowed: boolean) { return this.run(() => this.controllers[mode].voiceControl(id, allowed)); }
  conferenceControl(mode: RemoteAccessMode, action: { audioMode: RemoteAudioMode } | { floor: string | null }) { return this.run(() => this.controllers[mode].conferenceControl(action)); }
  prepareHostMicrophones(mode: RemoteAccessMode) { return this.run(async () => {
    if (!this.microphone) throw new Error("Microphone selection is unavailable.");
    await this.microphone.prepareMicrophones(); return this.getStatus(mode);
  }); }
  selectHostMicrophone(mode: RemoteAccessMode, deviceId: string) { return this.run(async () => {
    if (!this.microphone) throw new Error("Microphone selection is unavailable.");
    await this.microphone.setHostMicrophoneDevice(deviceId); return this.getStatus(mode);
  }); }
  hostMicrophone(mode: RemoteAccessMode, muted: boolean) { return this.run(() => this.controllers[mode].hostMicrophone(muted)); }
  async initialize() {
    for (const mode of ["remote", "share"] as const) {
      try { await this.run(() => this.applyConfiguration(mode, undefined, true)); }
      catch (error) { this.errors.set(mode, error instanceof Error ? error.message : "Could not start server."); this.changed(); }
    }
  }
  stop() {
    this.stopped = true;
    return this.queue.then(async () => {
      await this.controllers.remote.stop(); await this.controllers.share.stop();
      this.unsubscribeMicrophone?.(); this.microphone?.close();
    });
  }
}
