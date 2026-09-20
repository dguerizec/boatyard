import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
  MCP_AGENT_TARGETS,
  isMcpAgentTargetId,
  type McpAgentTargetId
} from "./mcpAgentTargets.js";
import { CODEX_MCP_TOKEN_VARIABLE, readCodexMcpToken, updateCodexMcpEnv } from "./codexMcpEnv.js";

const execFileAsync = promisify(execFile);
type CodexCommandRunner = (args: string[], options: { env: NodeJS.ProcessEnv; cwd: string }) => Promise<string>;

export type McpAgentConnectionState =
  | "conflict"
  | "installed"
  | "modified"
  | "notInstalled"
  | "updateAvailable";

export type McpAgentConnectionStatus = {
  configPath: string;
  detail: string;
  id: McpAgentTargetId;
  label: string;
  managedToken: boolean;
  state: McpAgentConnectionState;
};

export type McpAgentConnectionMutationResult = {
  message: string;
  target: McpAgentConnectionStatus;
};

type McpAgentConnectionInstallerOptions = {
  environment?: Record<string, string | undefined>;
  runCodexCommand?: CodexCommandRunner;
  getEndpoint: () => string;
  getManagedToken: (targetId: McpAgentTargetId) => string | undefined;
  getOrCreateManagedToken: (targetId: McpAgentTargetId) => string;
  homeDirectory: string;
  revokeManagedToken: (targetId: McpAgentTargetId) => boolean;
};

type ConnectionTarget = {
  configPath: string;
  id: McpAgentTargetId;
  label: string;
  type: "claude-json" | "codex-toml" | "hermes-yaml";
};

type ParsedConfig = {
  entry: unknown;
  source: unknown;
};

function resolveConfiguredDirectory(value: string | undefined, fallback: string): string {
  const configured = String(value || "").trim();
  return configured && isAbsolute(configured) ? resolve(configured) : fallback;
}

function readConfigFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("The agent configuration path is not a regular file.");
  }
  return readFileSync(filePath, "utf8");
}

function writeSecretFileAtomically(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.boatyard-${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
  chmodSync(filePath, 0o600);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function inspectStructuredEntry(entry: unknown, token: string, endpoint: string, includeType: boolean) {
  if (!isRecord(entry)) {
    return { owned: false, current: false };
  }
  const headers = entry.headers;
  const expectedKeys = includeType ? ["headers", "type", "url"] : ["headers", "url"];
  const owned = hasOnlyKeys(entry, expectedKeys) &&
    (!includeType || entry.type === "http") &&
    typeof entry.url === "string" &&
    isRecord(headers) &&
    hasOnlyKeys(headers, ["Authorization"]) &&
    headers.Authorization === `Bearer ${token}`;
  return { owned, current: owned && entry.url === endpoint };
}

function createStructuredEntry(endpoint: string, token: string, includeType: boolean): Record<string, unknown> {
  return {
    ...(includeType ? { type: "http" } : {}),
    url: endpoint,
    headers: { Authorization: `Bearer ${token}` }
  };
}

function parseClaudeConfig(text: string | null): ParsedConfig {
  if (text === null || !text.trim()) {
    return { entry: undefined, source: {} };
  }
  const source: unknown = JSON.parse(text);
  if (!isRecord(source)) {
    throw new Error("Claude Code configuration must contain a JSON object.");
  }
  const servers = source.mcpServers;
  if (servers !== undefined && !isRecord(servers)) {
    throw new Error("Claude Code mcpServers configuration must be a JSON object.");
  }
  return {
    entry: isRecord(servers) ? servers.boatyard : undefined,
    source
  };
}

function parseHermesConfig(text: string | null): ParsedConfig {
  const document = parseDocument(text === null || !text.trim() ? "{}\n" : text);
  if (document.errors.length) {
    throw new Error(`Hermes configuration is invalid YAML: ${document.errors[0]?.message || "parse error"}`);
  }
  const source: unknown = document.toJS();
  if (!isRecord(source)) {
    throw new Error("Hermes configuration must contain a YAML mapping.");
  }
  const servers = source.mcp_servers;
  if (servers !== undefined && !isRecord(servers)) {
    throw new Error("Hermes mcp_servers configuration must be a YAML mapping.");
  }
  return {
    entry: isRecord(servers) ? servers.boatyard : undefined,
    source: document
  };
}

export class McpAgentConnectionInstaller {
  private readonly getEndpoint: () => string;
  private readonly getManagedToken: (targetId: McpAgentTargetId) => string | undefined;
  private readonly getOrCreateManagedToken: (targetId: McpAgentTargetId) => string;
  private readonly revokeManagedToken: (targetId: McpAgentTargetId) => boolean;
  private readonly targets: ConnectionTarget[];
  private readonly codexEnvironment: NodeJS.ProcessEnv;
  private readonly homeDirectory: string;
  private readonly runCodexCommand: CodexCommandRunner;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor({
    environment = process.env,
    runCodexCommand,
    getEndpoint,
    getManagedToken,
    getOrCreateManagedToken,
    homeDirectory,
    revokeManagedToken
  }: McpAgentConnectionInstallerOptions) {
    this.getEndpoint = getEndpoint;
    this.getManagedToken = getManagedToken;
    this.getOrCreateManagedToken = getOrCreateManagedToken;
    this.revokeManagedToken = revokeManagedToken;
    const codexRoot = resolveConfiguredDirectory(environment.CODEX_HOME, join(homeDirectory, ".codex"));
    this.homeDirectory = homeDirectory;
    this.codexEnvironment = { ...environment, CODEX_HOME: codexRoot };
    this.runCodexCommand = runCodexCommand || (async (args, options) => {
      const { stdout } = await execFileAsync("codex", args, {
        ...options, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true
      });
      return stdout;
    });
    const claudeRoot = resolveConfiguredDirectory(environment.CLAUDE_CONFIG_DIR, homeDirectory);
    const hermesRoot = resolveConfiguredDirectory(environment.HERMES_HOME, join(homeDirectory, ".hermes"));
    const configPaths: Record<McpAgentTargetId, { path: string; type: ConnectionTarget["type"] }> = {
      codex: { path: join(codexRoot, "config.toml"), type: "codex-toml" },
      "claude-code": { path: join(claudeRoot, ".claude.json"), type: "claude-json" },
      hermes: { path: join(hermesRoot, "config.yaml"), type: "hermes-yaml" }
    };
    this.targets = MCP_AGENT_TARGETS.map(({ id, label }) => ({
      configPath: configPaths[id].path,
      id,
      label,
      type: configPaths[id].type
    }));
  }

  async list(): Promise<McpAgentConnectionStatus[]> {
    return Promise.all(this.targets.map((target) => this.inspect(target)));
  }

  private enqueueMutation(operation: () => Promise<McpAgentConnectionMutationResult>) {
    const result = this.mutation.then(operation);
    this.mutation = result.catch(() => undefined);
    return result;
  }

  install(targetId: unknown): Promise<McpAgentConnectionMutationResult> {
    return this.enqueueMutation(() => this.installTarget(targetId));
  }

  uninstall(targetId: unknown, options: { force?: boolean } = {}): Promise<McpAgentConnectionMutationResult> {
    return this.enqueueMutation(() => this.uninstallTarget(targetId, options));
  }

  private async codexCommand(args: string[]): Promise<string> {
    try {
      return await this.runCodexCommand(["mcp", ...args], {
        env: this.codexEnvironment, cwd: this.homeDirectory
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Codex CLI was not found. Install Codex and make it available on PATH.");
      }
      // CLI diagnostics may contain configuration values, including credentials.
      throw new Error(`Codex MCP ${args[0]} failed. Check the Codex installation and configuration.`);
    }
  }

  private async installTarget(targetId: unknown): Promise<McpAgentConnectionMutationResult> {
    const target = this.getTarget(targetId);
    const initial = await this.inspect(target);
    if (initial.state === "conflict" || initial.state === "modified") {
      throw new Error(initial.detail);
    }
    if (initial.state === "installed") {
      return { message: `${target.label} already has the current Boatyard MCP connection.`, target: initial };
    }
    const previousToken = this.getManagedToken(target.id);
    const token = this.getOrCreateManagedToken(target.id);
    try {
      await this.writeConnection(target, this.getEndpoint(), token);
    } catch (error) {
      if (!previousToken) {
        this.revokeManagedToken(target.id);
      }
      throw error;
    }
    return {
      message: `${initial.state === "updateAvailable" ? "Updated" : "Installed"} the Boatyard MCP connection for ${target.label}. Restart the agent to load it.`,
      target: await this.inspect(target)
    };
  }

  private async uninstallTarget(targetId: unknown, options: { force?: boolean }): Promise<McpAgentConnectionMutationResult> {
    const target = this.getTarget(targetId);
    const status = await this.inspect(target);
    const token = this.getManagedToken(target.id);
    if (target.type === "codex-toml") {
      await this.removeConnection(target);
    } else {
      if (status.state === "conflict") {
        throw new Error("Boatyard will not remove an MCP connection it does not own.");
      }
      if (status.state === "modified" && options.force !== true) {
        throw new Error("This MCP connection contains local changes. Confirm their removal before uninstalling it.");
      }
      if (status.state !== "notInstalled") {
        if (!token) {
          throw new Error("Boatyard cannot verify ownership of this MCP connection.");
        }
        await this.removeConnection(target);
      }
    }
    this.revokeManagedToken(target.id);
    return {
      message: `Uninstalled the Boatyard MCP connection for ${target.label} and revoked its token.`,
      target: await this.inspect(target)
    };
  }

  private getTarget(targetId: unknown): ConnectionTarget {
    if (!isMcpAgentTargetId(targetId)) {
      throw new Error("Unknown MCP connection target.");
    }
    const target = this.targets.find(({ id }) => id === targetId);
    if (!target) {
      throw new Error("Unknown MCP connection target.");
    }
    return target;
  }

  private async inspect(target: ConnectionTarget): Promise<McpAgentConnectionStatus> {
    const token = this.getManagedToken(target.id);
    const base = {
      configPath: target.configPath,
      id: target.id,
      label: target.label,
      managedToken: Boolean(token)
    };
    const endpoint = this.getEndpoint();
    try {
      if (target.type === "codex-toml") {
        const output = await this.codexCommand(["list", "--json"]);
        let entries: unknown;
        try {
          entries = JSON.parse(output);
        } catch {
          throw new Error("Codex returned an invalid MCP server list.");
        }
        if (!Array.isArray(entries)) throw new Error("Codex returned an invalid MCP server list.");
        const server = entries.find((entry) => isRecord(entry) && entry.name === "boatyard");
        const entry = server?.transport;
        if (server === undefined) {
          return { ...base, detail: "The MCP connection is not installed.", state: "notInstalled" };
        }
        return isRecord(entry) && entry.url === endpoint && token &&
          server.enabled !== false && entry.bearer_token_env_var === CODEX_MCP_TOKEN_VARIABLE &&
          readCodexMcpToken(readConfigFile(join(dirname(target.configPath), ".env")) || "") === token
          ? { ...base, detail: "The Boatyard MCP connection is installed.", state: "installed" }
          : { ...base, detail: "The connection settings need to be updated.", state: "updateAvailable" };
      }

      const text = readConfigFile(target.configPath);
      const parsed = target.type === "claude-json" ? parseClaudeConfig(text) : parseHermesConfig(text);
      if (!token) {
        return parsed.entry === undefined
          ? { ...base, detail: "The MCP connection is not installed.", state: "notInstalled" }
          : { ...base, detail: "A Boatyard MCP entry already exists, but it is not managed by Boatyard.", state: "conflict" };
      }
      if (parsed.entry === undefined) {
        return { ...base, detail: "A managed token exists, but the agent connection is missing.", state: "notInstalled" };
      }
      const entry = inspectStructuredEntry(parsed.entry, token, endpoint, target.type === "claude-json");
      if (!entry.owned) {
        return { ...base, detail: "The Boatyard-managed MCP entry was changed locally.", state: "modified" };
      }
      return entry.current
        ? { ...base, detail: "The current Boatyard MCP connection is installed.", state: "installed" }
        : { ...base, detail: "The connection endpoint needs to be updated.", state: "updateAvailable" };
    } catch (error) {
      return {
        ...base,
        detail: `Boatyard cannot safely edit this configuration: ${error instanceof Error ? error.message : String(error)}`,
        state: token ? "modified" : "conflict"
      };
    }
  }

  private async writeConnection(target: ConnectionTarget, endpoint: string, token: string): Promise<void> {
    if (target.type === "codex-toml") {
      const envPath = join(dirname(target.configPath), ".env");
      const previous = readConfigFile(envPath);
      const next = updateCodexMcpEnv(previous || "", token);
      writeSecretFileAtomically(envPath, next);
      try {
        await this.codexCommand(["add", "boatyard", "--url", endpoint, "--bearer-token-env-var", CODEX_MCP_TOKEN_VARIABLE]);
      } catch (error) {
        if (readConfigFile(envPath) === next) {
          if (previous === null) unlinkSync(envPath);
          else writeSecretFileAtomically(envPath, previous);
        }
        throw error;
      }
      return;
    }
    const text = readConfigFile(target.configPath);
    if (target.type === "claude-json") {
      const parsed = parseClaudeConfig(text);
      const source = parsed.source as Record<string, unknown>;
      const servers = isRecord(source.mcpServers) ? source.mcpServers : {};
      servers.boatyard = createStructuredEntry(endpoint, token, true);
      source.mcpServers = servers;
      writeSecretFileAtomically(target.configPath, `${JSON.stringify(source, null, 2)}\n`);
      return;
    }
    const parsed = parseHermesConfig(text);
    const document = parsed.source as ReturnType<typeof parseDocument>;
    document.setIn(["mcp_servers", "boatyard"], createStructuredEntry(endpoint, token, false));
    writeSecretFileAtomically(target.configPath, document.toString());
  }

  private async removeConnection(target: ConnectionTarget): Promise<void> {
    if (target.type === "codex-toml") {
      const envPath = join(dirname(target.configPath), ".env");
      // Validate access before removing the MCP entry; re-read after the command
      // so unrelated edits made while Codex runs are retained.
      readConfigFile(envPath);
      await this.codexCommand(["remove", "boatyard"]);
      const source = readConfigFile(envPath);
      if (source !== null) {
        const next = updateCodexMcpEnv(source);
        if (next !== source) writeSecretFileAtomically(envPath, next);
      }
      return;
    }
    const text = readConfigFile(target.configPath);
    if (text === null) return;
    if (target.type === "claude-json") {
      const parsed = parseClaudeConfig(text);
      const source = parsed.source as Record<string, unknown>;
      const servers = source.mcpServers as Record<string, unknown>;
      delete servers.boatyard;
      if (!Object.keys(servers).length) {
        delete source.mcpServers;
      }
      writeSecretFileAtomically(target.configPath, `${JSON.stringify(source, null, 2)}\n`);
      return;
    }
    const parsed = parseHermesConfig(text);
    const document = parsed.source as ReturnType<typeof parseDocument>;
    document.deleteIn(["mcp_servers", "boatyard"]);
    const next = document.toJS() as Record<string, unknown>;
    if (isRecord(next.mcp_servers) && !Object.keys(next.mcp_servers).length) {
      document.deleteIn(["mcp_servers"]);
    }
    writeSecretFileAtomically(target.configPath, document.toString());
  }
}
