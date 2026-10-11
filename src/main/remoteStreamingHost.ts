import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type Handler = (action: string, payload: unknown) => unknown;

// One renderer owns all streaming peers.
class RemoteStreamingHost {
  private readonly channel = `boatyard-stream-${randomUUID()}`;
  private sender: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private readonly handlers = new Map<string, Handler>();
  private readonly partition = `remote-stream-${randomUUID()}`;
  constructor() {
    ipcMain.handle(this.channel, (event, id: string, action: string, payload: unknown) => {
      if (!this.sender || event.sender !== this.sender.webContents) throw new Error("Unauthorized streaming renderer");
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
        this.sender = null; this.loading = null;
        const handlers = [...this.handlers.values()]; this.handlers.clear();
        for (const callback of handlers) callback("closed", undefined);
      });
      this.loading = sender.loadFile(join(__dirname, "..", "renderer", "remote", "sender.html"));
    }
    await this.loading;
    if (!this.sender || this.sender.isDestroyed()) throw new Error("Streaming renderer unavailable");
    return this.sender;
  }
  send(id: string, action: string, payload?: unknown) {
    if (this.sender && !this.sender.isDestroyed()) this.sender.webContents.send(this.channel, { id, action, payload });
  }
  remove(id: string) {
    this.handlers.delete(id); this.send(id, "close");
  }
  close() { if (this.sender && !this.sender.isDestroyed()) this.sender.destroy(); }
}
let host: RemoteStreamingHost | undefined;
export function getRemoteStreamingHost() { return host ??= new RemoteStreamingHost(); }
