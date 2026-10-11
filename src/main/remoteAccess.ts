import { BrowserWindow, screen, type WebContents } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_SHARE_CLIENTS, RemoteServer, type RemoteOffer, type RemoteServerOptions } from "./remoteServer.js";
import { parseRemoteInput, parseRemoteViewport, remotePoint, type RemoteModifier, type RemoteViewport } from "./remoteProtocol.js";
import { getRemoteStreamingHost } from "./remoteStreamingHost.js";
import type { RemoteConnectionRoute } from "../shared/remoteIce.js";

export type RemoteInputTarget = { contents: WebContents; x: number; y: number };
export type RemoteAccessOptions = {
  windows(): { id: string; window: BrowserWindow }[];
  target(windowId: string, x: number, y: number): RemoteInputTarget;
  canInput(windowId: string, contents: WebContents): boolean;
  host?: string;
  port?: number;
  passwordHash: string;
  sessionFilePath?: string;
  readOnly?: boolean;
  publicOrigin?: string;
  iceServers?: RTCIceServer[];
  getIceServers?(): Promise<RTCIceServer[]>;
  getIceTransportPolicy?(): RTCIceTransportPolicy;
  clientsChanged?(): void;
};

type Connection = {
  id: string;
  windowId: string;
  window: BrowserWindow;
  sender?: BrowserWindow;
  viewport: RemoteViewport;
  viewports: Map<number, RemoteViewport>;
  keyboard: WebContents;
  drag: RemoteInputTarget | null;
  buttons: Set<"left" | "middle" | "right">;
  keys: Map<string, { contents: WebContents; modifiers: RemoteModifier[] }>;
  closeTarget(): void;
  resolve(answer: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  heartbeat: number;
  epoch: number;
  recovering: boolean;
  recoveredAt: number;
  watchdog?: ReturnType<typeof setInterval>;
  route: RemoteConnectionRoute | null;
  iceTransportPolicy: RTCIceTransportPolicy;
};

export class RemoteAccessService {
  readonly server: RemoteServer;
  private readonly connections = new Map<string, Connection>();
  private readonly host = getRemoteStreamingHost();
  constructor(private readonly options: RemoteAccessOptions) {
    const serverOptions: RemoteServerOptions = {
      ...options,
      assetsDirectory: join(__dirname, "..", "renderer", "remote"),
      listWindows: () => options.windows().filter(w => !w.window.isDestroyed()).map(w => {
        const [width, height] = w.window.getContentSize();
        return { id: w.id, title: w.window.getTitle(), width, height };
      }),
      connect: offer => this.connect(offer),
      recover: (id, offer) => this.recover(id, offer),
      getConnectionRoute: id => this.connections.get(id)?.route ?? null,
      disconnect: id => this.disconnect(id)
    };
    this.server = new RemoteServer(serverOptions);
  }
  private handle(c: Connection, action: string, payload: unknown): unknown {
    if (this.connections.get(c.id) !== c) throw new Error("Remote connection unavailable");
    if (action === "transport") {
      const message = payload as { epoch: number; action: string; payload: unknown };
      if (!message || message.epoch !== c.epoch || message.action === "transport") throw new Error("Stale streaming transport");
      return this.handle(c, message.action, message.payload);
    }
    if (action === "setup") return this.setup(c);
    if (action === "ice-servers") return this.options.getIceServers ? this.options.getIceServers() : this.options.iceServers || [];
    if (action === "answer") { c.resolve(payload); return; }
    if (action === "closed") { this.disconnect(c.id); return; }
    if (action === "error") { c.reject(new Error(String(payload).slice(0, 200))); this.disconnect(c.id); return; }
    if (action === "cursor") {
      if (c.window.isDestroyed() || !c.window.isVisible() || c.window.isMinimized()) return null;
      const point = screen.getCursorScreenPoint(), bounds = c.window.getContentBounds();
      const x = point.x - bounds.x, y = point.y - bounds.y;
      // Never expose pointer coordinates outside the selected window's content.
      return x >= 0 && y >= 0 && x < bounds.width && y < bounds.height ? { x, y } : null;
    }
    if (action === "heartbeat") { c.heartbeat = Date.now(); return; }
    if (action === "route") {
      if (payload !== null && payload !== "direct" && payload !== "relay") throw new Error("Invalid connection route");
      if (c.route !== payload) { c.route = payload; this.options.clientsChanged?.(); }
      return;
    }
    if (action === "viewport") {
      const [width, height] = c.window.getContentSize();
      const viewport = parseRemoteViewport(payload, width, height);
      if (viewport.revision < c.viewport.revision) throw new Error("Stale viewport");
      c.viewport = viewport;
      c.viewports.set(viewport.revision, viewport);
      if (c.viewports.size > 128) c.viewports.delete(c.viewports.keys().next().value!);
      return viewport;
    }
    if (action === "input") { this.input(c, payload); return; }
    throw new Error("Unknown streaming action");
  }
  start() { return this.server.start(); }
  async stop() { await this.server.stop(); }
  private async setup(c: Connection) {
    // Request native window capture so sibling WebContentsViews are included
    // in the composed source, rather than selecting an individual page.
    const bounds = c.window.getBounds(), content = c.window.getContentBounds();
    return {
      sourceId: c.window.getMediaSourceId().replace(/:1$/, ":0"),
      captureBounds: { width: bounds.width, height: bounds.height },
      contentOffset: { x: content.x - bounds.x, y: content.y - bounds.y },
      iceTransportPolicy: c.iceTransportPolicy,
      iceServers: this.options.getIceServers ? await this.options.getIceServers() : this.options.iceServers || [], readOnly: this.options.readOnly === true, viewport: c.viewport
    };
  }
  private async connect(offer: RemoteOffer) {
    const target = this.options.windows().find(w => w.id === offer.windowId && !w.window.isDestroyed());
    if (!target || this.connections.size >= (this.options.readOnly ? MAX_SHARE_CLIENTS : 1)) throw new Error("Window unavailable or already shared");
    const id = randomUUID();
    const [width, height] = target.window.getContentSize();
    let resolve!: (answer: unknown) => void, reject!: (error: Error) => void;
    const answer = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
    // A window can close while loadFile is still pending, before answer is awaited.
    void answer.catch(() => {});
    const closeTarget = () => this.disconnect(id);
    const c: Connection = { id, window: target.window, windowId: target.id,
      viewport: { x: 0, y: 0, width, height, revision: 0 }, keyboard: target.window.webContents,
      viewports: new Map([[0, { x: 0, y: 0, width, height, revision: 0 }]]),
      drag: null, buttons: new Set(), keys: new Map(), closeTarget, resolve, reject, route: null, iceTransportPolicy: this.options.getIceTransportPolicy?.() ?? "all",
      timeout: setTimeout(() => { reject(new Error("Streaming setup timed out")); this.disconnect(id); }, 25000), heartbeat: Date.now(), epoch: 0, recovering: false, recoveredAt: -Infinity };
    this.connections.set(id, c);
    target.window.once("closed", closeTarget);
    target.window.on("resize", closeTarget);
    target.window.on("minimize", closeTarget);
    c.watchdog = setInterval(() => {
      if (Date.now() - c.heartbeat > 30000 || c.window.isDestroyed()) this.disconnect(id);
    }, 5000);
    try {
      c.sender = await this.host.register(id, (action, payload) => this.handle(c, action, payload));
      this.host.send(id, "offer", { ...offer, epoch: c.epoch });
      const description = await answer as { type: string; sdp: string };
      if (description?.type !== "answer" || typeof description.sdp !== "string") throw new Error("Invalid WebRTC answer");
      if (this.connections.get(id) !== c) throw new Error("Remote session closed during setup");
      clearTimeout(c.timeout);
      return { sessionId: id, type: "answer" as const, sdp: description.sdp };
    } catch (error) { this.disconnect(id); throw error; }
  }
  private async recover(id: string, offer: RemoteOffer) {
    const c = this.connections.get(id);
    if (!c || c.windowId !== offer.windowId || c.window.isDestroyed()) throw new Error("Remote session unavailable");
    if (c.recovering || Date.now() - c.recoveredAt < 30000) throw new Error("Streaming recovery is already in progress or too recent");
    c.recovering = true; c.recoveredAt = Date.now(); c.epoch++; c.heartbeat = Date.now();
    this.release(c);
    const answer = new Promise<unknown>((resolve, reject) => { c.resolve = resolve; c.reject = reject; });
    c.timeout = setTimeout(() => { c.reject(new Error("Streaming recovery timed out")); this.disconnect(id); }, 25000);
    try {
      this.host.send(id, "offer", { ...offer, epoch: c.epoch });
      const description = await answer as { type: string; sdp: string };
      if (this.connections.get(id) !== c || description?.type !== "answer" || typeof description.sdp !== "string") throw new Error("Remote session closed during recovery");
      clearTimeout(c.timeout);
      return { sessionId: id, type: "answer" as const, sdp: description.sdp };
    } catch (error) { this.disconnect(id); throw error; }
    finally { c.recovering = false; }
  }
  private input(c: Connection, value: unknown) {
    if (c.window.isDestroyed()) throw new Error("Shared window closed");
    const input = parseRemoteInput(value);
    if (input.kind === "release") { this.release(c); return; }
    if (this.options.readOnly) throw new Error("Remote access is read-only.");
    if (!this.options.canInput(c.windowId, c.keyboard)) { this.release(c); c.keyboard = c.window.webContents; }
    if (input.kind === "text") {
      if (!c.keyboard.isDestroyed()) { c.window.focus(); c.keyboard.focus(); c.keyboard.insertText(input.text); }
      return;
    }
    if (input.kind === "key") {
      const held = c.keys.get(input.key);
      const contents = held?.contents || c.keyboard;
      if (contents.isDestroyed()) return;
      if (input.action === "down" && c.keys.size >= 32 && !held) throw new Error("Too many held keys");
      c.window.focus(); contents.focus();
      contents.sendInputEvent({ type: input.action === "down" ? "keyDown" : "keyUp", keyCode: input.key, modifiers: input.modifiers });
      // Enter needs its character event for form submission and newlines.
      if (input.action === "down" && ["Enter", "Return"].includes(input.key) && input.modifiers.every(modifier => modifier === "shift")) {
        contents.sendInputEvent({ type: "char", keyCode: "\r", modifiers: input.modifiers });
      }
      if (input.action === "down") c.keys.set(input.key, { contents, modifiers: input.modifiers });
      else c.keys.delete(input.key);
      return;
    }
    // Video and control arrive independently. An input belongs to the crop of
    // the frame the client displayed, which may precede the encoder's crop.
    const inputViewport = c.viewports.get(input.revision);
    if (!inputViewport) throw new Error("Viewport expired");
    const point = remotePoint(inputViewport, input);
    const hit = this.options.target(c.windowId, point.x, point.y);
    const target = c.drag ? { ...c.drag, x: c.drag.x + point.x, y: c.drag.y + point.y } : hit;
    if (!this.options.canInput(c.windowId, target.contents)) { this.release(c); return; }
    if (input.action === "down") {
      c.window.focus(); target.contents.focus(); c.keyboard = target.contents;
      c.drag = { contents: target.contents, x: target.x - point.x, y: target.y - point.y };
      c.buttons.add(input.button);
    }
    if (input.action === "up") c.buttons.delete(input.button);
    const buttonModifiers = { left: "leftbuttondown", middle: "middlebuttondown", right: "rightbuttondown" } as const;
    const modifiers = [...c.buttons].map(button => buttonModifiers[button]);
    // Electron's native wheel deltas use the opposite sign to DOM WheelEvent.
    if (input.action === "wheel") target.contents.sendInputEvent({ type: "mouseWheel", x: target.x, y: target.y, deltaX: -input.deltaX, deltaY: -input.deltaY, canScroll: true });
    else target.contents.sendInputEvent({ type: input.action === "down" ? "mouseDown" : input.action === "up" ? "mouseUp" : "mouseMove", x: target.x, y: target.y, button: input.button, clickCount: 1, modifiers });
    if (input.action === "up" && !c.buttons.size) c.drag = null;
  }
  private release(c: Connection) {
    for (const [key, held] of c.keys) {
      if (!held.contents.isDestroyed()) held.contents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers: held.modifiers });
    }
    c.keys.clear();
    for (const button of c.buttons) {
      const contents = c.drag?.contents || c.keyboard;
      if (!contents.isDestroyed()) contents.sendInputEvent({ type: "mouseUp", x: -1, y: -1, button, clickCount: 1 });
    }
    c.buttons.clear(); c.drag = null;
  }
  private disconnect(id?: string) {
    if (!id) { for (const key of [...this.connections.keys()]) this.disconnect(key); return; }
    const c = this.connections.get(id);
    if (!c) return;
    this.connections.delete(id);
    clearTimeout(c.timeout); clearInterval(c.watchdog);
    this.release(c);
    c.window.removeListener("closed", c.closeTarget);
    c.window.removeListener("resize", c.closeTarget);
    c.window.removeListener("minimize", c.closeTarget);
    c.reject(new Error("Remote session closed"));
    this.server.sessionClosed(c.id);
    this.host.remove(id);
  }
}
