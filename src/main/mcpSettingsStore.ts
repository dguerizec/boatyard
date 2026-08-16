import { randomBytes } from "node:crypto";
import { existsSync, chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isMcpAgentTargetId, type McpAgentTargetId } from "./mcpAgentTargets.js";

export const DEFAULT_MCP_PORT = 4319;

export type McpSettings = {
  enabled: boolean;
  managedClientTokens: Partial<Record<McpAgentTargetId, string>>;
  port: number;
  token: string;
};

function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function normalizePort(value: unknown): number {
  const port = typeof value === "number" ? value : Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_MCP_PORT;
}

export class McpSettingsStore {
  private readonly filePath: string;
  private settings: McpSettings = {
    enabled: false,
    managedClientTokens: {},
    port: DEFAULT_MCP_PORT,
    token: createToken()
  };

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): McpSettings {
    let shouldSave = !existsSync(this.filePath);
    if (!shouldSave) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
        const source = parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
        const token = typeof source.token === "string" ? source.token.trim() : "";
        const managedClientTokens: Partial<Record<McpAgentTargetId, string>> = {};
        const managedSource = source.managedClientTokens;
        if (managedSource && typeof managedSource === "object" && !Array.isArray(managedSource)) {
          for (const [targetId, value] of Object.entries(managedSource as Record<string, unknown>)) {
            const managedToken = typeof value === "string" ? value.trim() : "";
            if (isMcpAgentTargetId(targetId) && managedToken) {
              managedClientTokens[targetId] = managedToken;
            }
          }
        }
        this.settings = {
          enabled: source.enabled === true,
          managedClientTokens,
          port: normalizePort(source.port),
          token: token || createToken()
        };
        shouldSave = !token || source.port !== this.settings.port;
      } catch (error) {
        console.warn(`Could not load Boatyard MCP settings: ${(error as Error).message}`);
        shouldSave = true;
      }
    }
    if (shouldSave) {
      this.save();
    } else {
      chmodSync(this.filePath, 0o600);
    }
    return this.get();
  }

  get(): McpSettings {
    return {
      ...this.settings,
      managedClientTokens: { ...this.settings.managedClientTokens }
    };
  }

  update(patch: Record<string, unknown>): McpSettings {
    const nextPort = patch.port === undefined ? this.settings.port : Number(patch.port);
    if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
      throw new Error("MCP port must be an integer between 1024 and 65535.");
    }
    this.settings = {
      ...this.settings,
      enabled: patch.enabled === undefined ? this.settings.enabled : patch.enabled === true,
      port: nextPort
    };
    this.save();
    return this.get();
  }

  rotateToken(): McpSettings {
    this.settings = { ...this.settings, token: createToken() };
    this.save();
    return this.get();
  }

  getOrCreateManagedClientToken(targetId: McpAgentTargetId): string {
    const existing = this.settings.managedClientTokens[targetId];
    if (existing) {
      return existing;
    }
    const token = createToken();
    this.settings = {
      ...this.settings,
      managedClientTokens: {
        ...this.settings.managedClientTokens,
        [targetId]: token
      }
    };
    this.save();
    return token;
  }

  revokeManagedClientToken(targetId: McpAgentTargetId): boolean {
    if (!this.settings.managedClientTokens[targetId]) {
      return false;
    }
    const managedClientTokens = { ...this.settings.managedClientTokens };
    delete managedClientTokens[targetId];
    this.settings = { ...this.settings, managedClientTokens };
    this.save();
    return true;
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    renameSync(temporaryPath, this.filePath);
    chmodSync(this.filePath, 0o600);
  }
}
