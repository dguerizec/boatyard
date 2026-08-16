import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
  MCP_AGENT_TARGETS,
  isMcpAgentTargetId,
  type McpAgentTargetId
} from "./mcpAgentTargets.js";

const CODEX_BLOCK_START = "# >>> Boatyard managed MCP connection: boatyard";
const CODEX_BLOCK_END = "# <<< Boatyard managed MCP connection: boatyard";

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

type CodexBlock = {
  end: number;
  endpoint: string | null;
  owned: boolean;
  start: number;
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

function createCodexBlock(endpoint: string, token: string): string {
  return [
    CODEX_BLOCK_START,
    "[mcp_servers.boatyard]",
    `url = ${JSON.stringify(endpoint)}`,
    `http_headers = { Authorization = ${JSON.stringify(`Bearer ${token}`)} }`,
    CODEX_BLOCK_END
  ].join("\n");
}

function findCodexBlock(text: string, token: string): CodexBlock | null {
  const start = text.indexOf(CODEX_BLOCK_START);
  const endMarker = text.indexOf(CODEX_BLOCK_END);
  if (start < 0 && endMarker < 0) {
    return null;
  }
  if (
    start < 0 ||
    endMarker < start ||
    text.indexOf(CODEX_BLOCK_START, start + CODEX_BLOCK_START.length) >= 0 ||
    text.indexOf(CODEX_BLOCK_END, endMarker + CODEX_BLOCK_END.length) >= 0
  ) {
    throw new Error("The Boatyard-managed Codex MCP block is malformed.");
  }
  const end = endMarker + CODEX_BLOCK_END.length;
  const block = text.slice(start, end);
  const lines = block.split("\n");
  let endpoint: string | null = null;
  if (lines.length === 5 && lines[0] === CODEX_BLOCK_START && lines[1] === "[mcp_servers.boatyard]") {
    const urlValue = lines[2]?.slice("url = ".length);
    try {
      const parsed = JSON.parse(urlValue || "null");
      endpoint = typeof parsed === "string" ? parsed : null;
    } catch {
      endpoint = null;
    }
  }
  return {
    end,
    endpoint,
    owned: endpoint !== null && block === createCodexBlock(endpoint, token),
    start
  };
}

function hasUnmanagedCodexEntry(text: string, managedBlock: CodexBlock | null): boolean {
  const outside = managedBlock
    ? `${text.slice(0, managedBlock.start)}${text.slice(managedBlock.end)}`
    : text;
  const boatyardKey = "(?:boatyard|\\\"boatyard\\\"|'boatyard')";
  if (new RegExp(
    `^\\s*\\[{1,2}\\s*mcp_servers\\s*\\.\\s*${boatyardKey}\\s*]{1,2}\\s*(?:#.*)?$`,
    "m"
  ).test(outside)) {
    return true;
  }
  if (new RegExp(`^\\s*mcp_servers\\s*\\.\\s*${boatyardKey}(?:\\s*\\.|\\s*=)`, "m").test(outside)) {
    return true;
  }
  const parentHeader = /^\s*\[\s*mcp_servers\s*]\s*(?:#.*)?$/gm;
  let parentMatch: RegExpExecArray | null;
  while ((parentMatch = parentHeader.exec(outside))) {
    const bodyStart = parentMatch.index + parentMatch[0].length;
    const nextHeader = /^\s*\[/gm;
    nextHeader.lastIndex = bodyStart;
    const bodyEnd = nextHeader.exec(outside)?.index ?? outside.length;
    const body = outside.slice(bodyStart, bodyEnd);
    if (new RegExp(`^\\s*${boatyardKey}(?:\\s*\\.|\\s*=)`, "m").test(body)) {
      return true;
    }
  }
  return false;
}

function appendCodexBlock(text: string, block: string): string {
  if (!text) {
    return `${block}\n`;
  }
  const separator = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${separator}${block}\n`;
}

function removeCodexBlock(text: string, block: CodexBlock): string {
  let before = text.slice(0, block.start);
  let after = text.slice(block.end);
  if (before.endsWith("\n") && after.startsWith("\n")) {
    after = after.slice(1);
  }
  if (!before && after.startsWith("\n")) {
    after = after.slice(1);
  }
  if (!after && before.endsWith("\n\n")) {
    before = before.slice(0, -1);
  }
  return `${before}${after}`;
}

export class McpAgentConnectionInstaller {
  private readonly getEndpoint: () => string;
  private readonly getManagedToken: (targetId: McpAgentTargetId) => string | undefined;
  private readonly getOrCreateManagedToken: (targetId: McpAgentTargetId) => string;
  private readonly revokeManagedToken: (targetId: McpAgentTargetId) => boolean;
  private readonly targets: ConnectionTarget[];

  constructor({
    environment = process.env,
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

  list(): McpAgentConnectionStatus[] {
    return this.targets.map((target) => this.inspect(target));
  }

  install(targetId: unknown): McpAgentConnectionMutationResult {
    const target = this.getTarget(targetId);
    const initial = this.inspect(target);
    if (initial.state === "conflict" || initial.state === "modified") {
      throw new Error(initial.detail);
    }
    if (initial.state === "installed") {
      return { message: `${target.label} already has the current Boatyard MCP connection.`, target: initial };
    }
    const previousToken = this.getManagedToken(target.id);
    const token = this.getOrCreateManagedToken(target.id);
    try {
      this.writeConnection(target, this.getEndpoint(), token);
    } catch (error) {
      if (!previousToken) {
        this.revokeManagedToken(target.id);
      }
      throw error;
    }
    return {
      message: `${initial.state === "updateAvailable" ? "Updated" : "Installed"} the Boatyard MCP connection for ${target.label}. Restart the agent to load it.`,
      target: this.inspect(target)
    };
  }

  uninstall(targetId: unknown, options: { force?: boolean } = {}): McpAgentConnectionMutationResult {
    const target = this.getTarget(targetId);
    const status = this.inspect(target);
    const token = this.getManagedToken(target.id);
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
      this.removeConnection(target, token);
    }
    this.revokeManagedToken(target.id);
    return {
      message: `Uninstalled the Boatyard MCP connection for ${target.label} and revoked its token.`,
      target: this.inspect(target)
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

  private inspect(target: ConnectionTarget): McpAgentConnectionStatus {
    const token = this.getManagedToken(target.id);
    const base = {
      configPath: target.configPath,
      id: target.id,
      label: target.label,
      managedToken: Boolean(token)
    };
    const endpoint = this.getEndpoint();
    try {
      const text = readConfigFile(target.configPath);
      if (target.type === "codex-toml") {
        const source = text || "";
        const block = findCodexBlock(source, token || "");
        const unmanagedEntry = hasUnmanagedCodexEntry(source, block);
        if (!token) {
          return block || unmanagedEntry
            ? { ...base, detail: "A Boatyard MCP entry already exists, but it is not managed by Boatyard.", state: "conflict" }
            : { ...base, detail: "The MCP connection is not installed.", state: "notInstalled" };
        }
        if (!block && !unmanagedEntry) {
          return { ...base, detail: "A managed token exists, but the Codex connection is missing.", state: "notInstalled" };
        }
        if (!block || unmanagedEntry || !block.owned) {
          return { ...base, detail: "The Boatyard-managed Codex MCP entry was changed locally.", state: "modified" };
        }
        return block.endpoint === endpoint
          ? { ...base, detail: "The current Boatyard MCP connection is installed.", state: "installed" }
          : { ...base, detail: "The connection endpoint needs to be updated.", state: "updateAvailable" };
      }

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

  private writeConnection(target: ConnectionTarget, endpoint: string, token: string): void {
    const text = readConfigFile(target.configPath);
    if (target.type === "codex-toml") {
      const source = text || "";
      const block = findCodexBlock(source, token);
      const next = block
        ? `${source.slice(0, block.start)}${createCodexBlock(endpoint, token)}${source.slice(block.end)}`
        : appendCodexBlock(source, createCodexBlock(endpoint, token));
      writeSecretFileAtomically(target.configPath, next);
      return;
    }
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

  private removeConnection(target: ConnectionTarget, token: string): void {
    const text = readConfigFile(target.configPath);
    if (text === null) {
      return;
    }
    if (target.type === "codex-toml") {
      const block = findCodexBlock(text, token);
      if (!block) {
        return;
      }
      writeSecretFileAtomically(target.configPath, removeCodexBlock(text, block));
      return;
    }
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
