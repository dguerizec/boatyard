import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { RemoteAudioConference, RemoteHandQueue } from "./remoteVoiceState.js";

type Handler = (action: string, payload: unknown) => unknown;

// One renderer owns all peers so audio never crosses IPC as raw samples.
class RemoteStreamingHost {
  private readonly channel = `boatyard-stream-${randomUUID()}`;
  private sender: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private readonly handlers = new Map<string, Handler>();
  private readonly pending = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Set<() => void>();
  private muted = true;
  private microphoneDeviceId = "";
  private microphones: { deviceId: string; label: string }[] = [];
  private readonly partition = `remote-stream-${randomUUID()}`;
  readonly hands = new RemoteHandQueue();
  readonly conference = new RemoteAudioConference();
  private queue: Promise<unknown> = Promise.resolve();
  constructor() {
    ipcMain.handle(this.channel, (event, id: string, action: string, payload: unknown) => {
      if (!this.sender || event.sender !== this.sender.webContents) throw new Error("Unauthorized streaming renderer");
      if (action === "host-mic-state") { this.muted = payload !== false; this.changed(); return; }
      if (action === "host-mic-devices") {
        if (!Array.isArray(payload) || payload.some(device => !device || typeof device.deviceId !== "string" || typeof device.label !== "string")) throw new Error("Invalid microphone list.");
        this.microphones = payload.map(({ deviceId, label }) => ({ deviceId, label })); this.changed(); return;
      }
      if (action === "command-result") {
        const value = payload as { error?: string };
        const pending = this.pending.get(id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(id); if (value?.error) pending.reject(new Error(value.error)); else pending.resolve(); }
        return;
      }
      const handler = this.handlers.get(id);
      if (!handler) {
        const notification = action === "transport" ? (payload as { action?: string } | null)?.action : action;
        // Teardown may finish after the main process has removed the session.
        if (notification === "closed" || notification === "error") return;
        throw new Error("Remote connection unavailable");
      }
      return handler(action, payload);
    });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed() { for (const listener of this.listeners) listener(); }
  get hostMuted() { return this.muted; }
  get hostMicrophone() { return { deviceId: this.microphoneDeviceId, devices: this.microphones.map(device => ({ ...device })) }; }
  async register(id: string, handler: Handler) {
    this.handlers.set(id, handler);
    const sender = await this.ensureSender();
    if (!this.handlers.has(id)) throw new Error("Remote connection closed");
    return sender;
  }
  private async ensureSender() {
    if (!this.sender || this.sender.isDestroyed()) {
      const sender = new BrowserWindow({ show: false, width: 320, height: 240, webPreferences: {
        preload: join(__dirname, "remotePreload.js"), sandbox: true, contextIsolation: true,
        nodeIntegration: false, backgroundThrottling: false, partition: this.partition,
        autoplayPolicy: "no-user-gesture-required", additionalArguments: [`--remote-channel=${this.channel}`]
      } });
      this.sender = sender;
      sender.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      sender.webContents.on("will-navigate", event => event.preventDefault());
      sender.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === sender.webContents && permission === "media"));
      sender.webContents.session.setPermissionCheckHandler((contents, permission) => contents === sender.webContents && permission === "media");
      sender.webContents.once("render-process-gone", () => { if (!sender.isDestroyed()) sender.destroy(); });
      sender.once("closed", () => {
        if (this.sender !== sender) return;
        this.sender = null; this.loading = null; this.muted = true; this.microphones = [];
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Streaming renderer closed")); }
        this.pending.clear();
        const handlers = [...this.handlers.values()]; this.handlers.clear();
        for (const callback of handlers) callback("closed", undefined);
        this.changed();
      });
      this.loading = sender.loadFile(join(__dirname, "..", "renderer", "remote", "sender.html"));
    }
    await this.loading;
    if (!this.sender || this.sender.isDestroyed()) throw new Error("Audio renderer unavailable");
    return this.sender;
  }
  send(id: string, action: string, payload?: unknown) {
    if (this.sender && !this.sender.isDestroyed()) this.sender.webContents.send(this.channel, { id, action, payload });
  }
  remove(id: string) {
    this.handlers.delete(id); this.send(id, "close");
    if (!this.handlers.size) { this.muted = true; this.changed(); }
  }
  prepareMicrophones() { return this.microphoneCommand("host-mic-devices-request", () => null); }
  close() { if (this.sender && !this.sender.isDestroyed()) this.sender.destroy(); }
  setHostMuted(muted: boolean) {
    return this.microphoneCommand("host-mic", () => {
      if (!muted && !this.handlers.size) throw new Error("Connect a participant before enabling the microphone.");
      return { muted, deviceId: this.microphoneDeviceId };
    });
  }
  setHostMicrophoneDevice(deviceId: string) {
    return this.microphoneCommand("host-mic-device", () => deviceId, () => { this.microphoneDeviceId = deviceId; this.changed(); });
  }
  private microphoneCommand(action: string, payload: () => unknown, completed: () => void = () => {}) {
    const result = this.queue.then(async () => {
      const value = payload();
      await this.ensureSender();
      const id = randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Microphone request timed out.")); if (this.sender && !this.sender.isDestroyed()) this.sender.destroy(); }, 30000);
        this.pending.set(id, { resolve, reject, timer });
        this.send(id, action, value);
      });
      completed();
    });
    this.queue = result.catch(() => {}); return result;
  }
}
let host: RemoteStreamingHost | undefined;
export function getRemoteStreamingHost() { return host ??= new RemoteStreamingHost(); }
