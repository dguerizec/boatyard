import { RemoteSettingsStore, type RemoteSettings } from "./remoteSettingsStore.js";

type RemoteService = { start(): Promise<number>; stop(): Promise<void>; server: { getConnectionOrigins(port: number): string[]; createReadOnlyInvitation?(label?: string): { token: string; expiresAt: number; id?: string }; getClients?(): unknown[]; getConnectedClientCount?(): number; revokeClient?(id: string): void } };
export class RemoteAccessController {
  private queue: Promise<unknown> = Promise.resolve();
  private service: RemoteService | null = null;
  private urls: string[] = [];
  private error: string | null = null;
  private stopped = false;
  constructor(private readonly settings: RemoteSettingsStore, private readonly createService: (settings: RemoteSettings) => RemoteService,
    private readonly changed: () => void = () => {}) {}
  getStatus() {
    const { passwordHash, ...settings } = this.settings.get();
    return { ...settings, hasPassword: Boolean(passwordHash), listening: Boolean(this.service), urls: [...this.urls], error: this.error, clients: this.service?.server.getClients?.() || [], connectedClients: this.service?.server.getConnectedClientCount?.() || 0 };
  }
  configure(patch?: Record<string, unknown>) {
    const result = this.queue.then(async () => {
      if (this.stopped) throw new Error("Boatyard is shutting down.");
      if (patch) await this.settings.update(patch);
      await this.stopService();
      this.error = null;
      const settings = this.settings.get();
      if (settings.enabled) {
        let service: RemoteService | undefined;
        try {
          service = this.createService(settings);
          const port = await service.start();
          this.service = service; this.urls = service.server.getConnectionOrigins(port);
        } catch (error) {
          await service?.stop();
          this.error = error instanceof Error ? error.message : "Could not start remote access.";
        }
      }
      this.changed();
      return this.getStatus();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  createReadOnlyLink(label?: string) {
    const result = this.queue.then(() => {
      if (this.stopped) throw new Error("Boatyard is shutting down.");
      if (!this.service || !this.settings.get().readOnly || !this.service.server.createReadOnlyInvitation) {
        throw new Error("Start read-only sharing before creating a link.");
      }
      const invitation = this.service.server.createReadOnlyInvitation(label);
      return { id: invitation.id, urls: this.urls.map(url => `${url}/#share=${invitation.token}`), expiresAt: invitation.expiresAt };
    });
    this.queue = result.catch(() => {});
    return result;
  }
  revokeClient(id: string) {
    const result = this.queue.then(() => {
      if (this.stopped) throw new Error("Boatyard is shutting down.");
      this.service?.server.revokeClient?.(id);
      this.changed(); return this.getStatus();
    });
    this.queue = result.catch(() => {}); return result;
  }
  stop() {
    this.stopped = true;
    const result = this.queue.then(() => this.stopService());
    this.queue = result.catch(() => {});
    return result;
  }
  private async stopService() {
    const service = this.service; this.service = null; this.urls = [];
    if (service) await service.stop();
  }
}
