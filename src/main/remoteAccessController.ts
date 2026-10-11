import { RemoteSettingsStore, type RemoteSettings } from "./remoteSettingsStore.js";

import type { ShareAccessSettings, ShareAccessState } from "./shareAccessState.js";

type RemoteService = {
  start(): Promise<number>;
  stop(): Promise<void>;
  server: {
    getConnectionOrigins(port: number): string[];
    createReadOnlyInvitation?(label?: string): { token: string; id?: string };
    getClients?(): unknown[];
    getShareAccess?(): ReturnType<ShareAccessState["hostSnapshot"]> | undefined;
    configureShareAccess?(patch: Partial<ShareAccessSettings>): void;
    decideShareJoinRequest?(id: string, accepted: boolean): void;
    getConnectedClientCount?(): number;
    revokeClient?(id: string): void;
  };
};
export class RemoteAccessController {
  private queue: Promise<unknown> = Promise.resolve();
  private service: RemoteService | null = null;
  private urls: string[] = [];
  private error: string | null = null;
  private stopped = false;
  constructor(private readonly settings: RemoteSettingsStore, private readonly createService: (settings: RemoteSettings) => RemoteService,
    private readonly changed: () => void = () => {}, private readonly shareAccess?: ShareAccessState) {}
  getStatus() {
    const { passwordHash, ...settings } = this.settings.get();
    const access = this.service?.server.getShareAccess?.() ?? this.shareAccess?.hostSnapshot();
    const clients = (this.service?.server.getClients?.() || (this.shareAccess ? [...this.shareAccess.participants.values()].map(({ id, label }) => ({ id, label, state: "invited" })) : [])).map(value => {
      const client = value as { id: string };
      const invitation = access?.invitations.find(invitation => invitation.id === client.id);
      return { ...client, ...(invitation ? { code: invitation.code, urls: this.urls.map(url => `${url}/#share=${invitation.code}`) } : {}) };
    });
    return { ...settings, shareAccess: access ? { groupEnabled: access.groupEnabled, groupApprovalRequired: access.groupApprovalRequired,
      allowJoinRequests: access.allowJoinRequests, groupCode: access.groupCode, groupUrls: access.groupCode ? this.urls.map(url => `${url}/#share=${access.groupCode}`) : [], requests: access.requests } : undefined, hasPassword: Boolean(passwordHash), listening: Boolean(this.service), urls: [...this.urls], error: this.error, clients, connectedClients: this.service?.server.getConnectedClientCount?.() || 0 };
  }
  configure(patch?: Record<string, unknown>, clearInvitations = false) {
    const result = this.queue.then(async () => {
      if (this.stopped) throw new Error("Boatyard is shutting down.");
      if (patch) await this.settings.update(patch);
      await this.stopService();
      if (clearInvitations) this.shareAccess?.clearInvitations();
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
  updateScreen(patch: Record<string, unknown>) {
    const result = this.queue.then(async () => {
      if (this.stopped) throw new Error("Boatyard is shutting down.");
      await this.settings.update(patch);
      this.changed(); return this.getStatus();
    });
    this.queue = result.catch(() => {}); return result;
  }
  createReadOnlyLink(label?: string) {
    const result = this.queue.then(() => {
      if (this.stopped) throw new Error("Boatyard is shutting down.");
      if (!this.service || !this.settings.get().readOnly || !this.service.server.createReadOnlyInvitation) {
        throw new Error("Start read-only sharing before creating a link.");
      }
      const invitation = this.service.server.createReadOnlyInvitation(label);
      return { id: invitation.id, urls: this.urls.map(url => `${url}/#share=${invitation.token}`), code: invitation.token };
    });
    this.queue = result.catch(() => {});
    return result;
  }
  configureShareAccess(patch: Partial<ShareAccessSettings>) {
    const result = this.queue.then(() => {
      if (this.stopped || !this.service?.server.configureShareAccess) throw new Error("Share is unavailable.");
      this.service.server.configureShareAccess(patch); this.changed(); return this.getStatus();
    });
    this.queue = result.catch(() => {}); return result;
  }
  decideShareJoinRequest(id: string, accepted: boolean) {
    const result = this.queue.then(() => {
      if (this.stopped || !this.service?.server.decideShareJoinRequest) throw new Error("Share is unavailable.");
      this.service.server.decideShareJoinRequest(id, accepted); this.changed(); return this.getStatus();
    });
    this.queue = result.catch(() => {}); return result;
  }
  revokeClient(id: string) {
    const result = this.queue.then(() => {
      if (this.stopped) throw new Error("Boatyard is shutting down.");
      if (this.service) this.service.server.revokeClient?.(id);
      else this.shareAccess?.revoke(id);
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
