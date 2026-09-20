import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { McpAgentConnectionInstaller } from "../src/main/mcpAgentConnectionInstaller.js";
import { CODEX_MCP_TOKEN_VARIABLE, readCodexMcpToken, updateCodexMcpEnv } from "../src/main/codexMcpEnv.js";
import type { McpAgentTargetId } from "../src/main/mcpAgentTargets.js";
import { McpSettingsStore } from "../src/main/mcpSettingsStore.js";

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-mcp-connection-"));
  const homeDirectory = join(directory, "home");
  const codexRoot = join(directory, "codex-profile");
  const claudeRoot = join(directory, "claude-profile");
  const hermesRoot = join(directory, "hermes-profile");
  const store = new McpSettingsStore(join(directory, "boatyard", "mcp.json"));
  store.load();
  const commands: string[][] = [];
  let servers: { name: string; enabled?: boolean; transport: Record<string, unknown> }[] = [];
  let failure: { action: string; code?: string } | undefined;
  let endpoint = "http://127.0.0.1:4319/mcp";
  const envPath = join(codexRoot, ".env");
  const installer = new McpAgentConnectionInstaller({
    environment: { CLAUDE_CONFIG_DIR: claudeRoot, CODEX_HOME: codexRoot, HERMES_HOME: hermesRoot },
    runCodexCommand: async (args, options) => {
      commands.push(args);
      assert.equal(options.env.CODEX_HOME, codexRoot);
      assert.equal(options.cwd, homeDirectory);
      if (failure?.action === args[1]) {
        throw Object.assign(new Error("diagnostic containing a secret"), { code: failure.code });
      }
      if (args[1] === "list") return JSON.stringify(servers);
      if (args[1] === "add") {
        assert.equal(readCodexMcpToken(readFileSync(envPath, "utf8")), store.get().managedClientTokens.codex);
        servers = [{ name: "boatyard", enabled: true, transport: {
          type: "streamable_http", url: args[4], bearer_token_env_var: args[6]
        } }];
      } else if (args[1] === "remove") servers = [];
      else assert.fail("Unexpected Codex command");
      return "";
    },
    getEndpoint: () => endpoint,
    getManagedToken: (targetId) => store.get().managedClientTokens[targetId],
    getOrCreateManagedToken: (targetId) => store.getOrCreateManagedClientToken(targetId),
    homeDirectory,
    revokeManagedToken: (targetId) => store.revokeManagedClientToken(targetId)
  });
  return {
    claudePath: join(claudeRoot, ".claude.json"),
    codexPath: join(codexRoot, "config.toml"),
    envPath, directory, commands,
    hermesPath: join(hermesRoot, "config.yaml"), installer, store,
    setEndpoint(value: string) { endpoint = value; },
    setServers(value: typeof servers) { servers = value; },
    fail(action: string, code?: string) { failure = { action, code }; }
  };
}

function writeFixtureConfig(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

test("MCP connection targets use each agent's configured personal file", async () => {
  const fixture = createFixture();
  assert.deepEqual((await fixture.installer.list()).map(({ id, configPath, state }) => ({ id, configPath, state })), [
    { id: "codex", configPath: fixture.codexPath, state: "notInstalled" },
    { id: "claude-code", configPath: fixture.claudePath, state: "notInstalled" },
    { id: "hermes", configPath: fixture.hermesPath, state: "notInstalled" }
  ]);
});

test("MCP connections preserve unrelated config, update endpoints, and uninstall cleanly", async () => {
  const fixture = createFixture();
  const codexSource = '# CLI owns this file, including legacy markers\nmodel = "example"\n';
  writeFixtureConfig(fixture.codexPath, codexSource);
  const envSource = '# Other credentials\nOTHER_TOKEN="keep"\n';
  writeFixtureConfig(fixture.envPath, envSource);
  writeFixtureConfig(fixture.claudePath, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "example" } } }));
  writeFixtureConfig(fixture.hermesPath, "theme: dark\nmcp_servers:\n  other:\n    command: example\n");
  for (const targetId of ["codex", "claude-code", "hermes"] satisfies McpAgentTargetId[]) {
    assert.equal((await fixture.installer.install(targetId)).target.state, "installed");
  }
  const tokens = fixture.store.get().managedClientTokens;
  assert.equal(new Set(Object.values(tokens)).size, 3);
  assert.equal(readCodexMcpToken(readFileSync(fixture.envPath, "utf8")), tokens.codex);
  assert.equal(statSync(fixture.envPath).mode & 0o777, 0o600);
  assert.deepEqual(fixture.commands.find((args) => args[1] === "add"), [
    "mcp", "add", "boatyard", "--url", "http://127.0.0.1:4319/mcp", "--bearer-token-env-var", CODEX_MCP_TOKEN_VARIABLE
  ]);
  assert.equal(JSON.stringify(fixture.commands).includes(tokens.codex!), false);
  assert.deepEqual(JSON.parse(readFileSync(fixture.claudePath, "utf8")).mcpServers.boatyard, {
    type: "http", url: "http://127.0.0.1:4319/mcp", headers: { Authorization: `Bearer ${tokens["claude-code"]}` }
  });
  assert.deepEqual(parse(readFileSync(fixture.hermesPath, "utf8")).mcp_servers.boatyard, {
    url: "http://127.0.0.1:4319/mcp", headers: { Authorization: `Bearer ${tokens.hermes}` }
  });
  fixture.setEndpoint("http://127.0.0.1:5320/mcp");
  assert.deepEqual((await fixture.installer.list()).map(({ state }) => state), ["updateAvailable", "updateAvailable", "updateAvailable"]);
  for (const targetId of ["codex", "claude-code", "hermes"] satisfies McpAgentTargetId[]) {
    assert.equal((await fixture.installer.install(targetId)).target.state, "installed");
    assert.equal((await fixture.installer.uninstall(targetId)).target.state, "notInstalled");
  }
  assert.deepEqual(fixture.commands.find((args) => args[1] === "remove"), ["mcp", "remove", "boatyard"]);
  assert.equal(readFileSync(fixture.codexPath, "utf8"), codexSource);
  assert.equal(readFileSync(fixture.envPath, "utf8"), envSource);
  assert.deepEqual(JSON.parse(readFileSync(fixture.claudePath, "utf8")), { theme: "dark", mcpServers: { other: { command: "example" } } });
  assert.deepEqual(parse(readFileSync(fixture.hermesPath, "utf8")), { theme: "dark", mcp_servers: { other: { command: "example" } } });
  assert.deepEqual(fixture.store.get().managedClientTokens, {});
});

test("Codex migrates legacy header credentials through the CLI", async () => {
  const fixture = createFixture();
  fixture.setServers([{ name: "boatyard", transport: {
    url: "http://127.0.0.1:4319/mcp", http_headers: { Authorization: "Bearer legacy" }
  } }]);
  assert.equal((await fixture.installer.list())[0]?.state, "updateAvailable");
  assert.equal((await fixture.installer.install("codex")).target.state, "installed");
});

test("Codex removes an entry regardless of token ownership", async () => {
  const fixture = createFixture();
  fixture.setServers([{ name: "boatyard", transport: { url: "http://example.test/mcp" } }]);
  assert.equal((await fixture.installer.uninstall("codex")).target.state, "notInstalled");
  assert.equal(existsSync(fixture.envPath), false);
  assert.ok(fixture.commands.some((args) => args[1] === "remove"));
});

for (const original of [undefined, '# Keep\nOTHER=example\nBOATYARD_MCP_TOKEN=previous\n']) {
  test(`Codex add failure restores ${original ? "existing" : "absent"} dotenv and revokes a new token`, async () => {
    const fixture = createFixture();
    if (original) writeFixtureConfig(fixture.envPath, original);
    fixture.fail("add");
    await assert.rejects(fixture.installer.install("codex"), /^Error: Codex MCP add failed\./);
    assert.equal(existsSync(fixture.envPath), original !== undefined);
    if (original) assert.equal(readFileSync(fixture.envPath, "utf8"), original);
    assert.equal(fixture.store.get().managedClientTokens.codex, undefined);
  });
}

test("Codex remove failure preserves the token and dotenv", async () => {
  const fixture = createFixture();
  await fixture.installer.install("codex");
  const original = readFileSync(fixture.envPath, "utf8");
  const token = fixture.store.get().managedClientTokens.codex;
  fixture.fail("remove");
  await assert.rejects(fixture.installer.uninstall("codex"), /^Error: Codex MCP remove failed\./);
  assert.equal(readFileSync(fixture.envPath, "utf8"), original);
  assert.equal(fixture.store.get().managedClientTokens.codex, token);
});

test("Codex CLI absence reports an actionable error without leaking command output", async () => {
  const fixture = createFixture();
  fixture.fail("list", "ENOENT");
  const status = (await fixture.installer.list())[0]!;
  assert.match(status.detail, /Codex CLI was not found/);
  assert.equal(status.detail.includes("secret"), false);
  await assert.rejects(fixture.installer.install("codex"), /Codex CLI was not found/);
  assert.equal(existsSync(fixture.envPath), false);
});

test("Codex refuses a symlinked dotenv before issuing add or remove", async () => {
  const fixture = createFixture();
  const secretPath = join(fixture.directory, "other.env");
  writeFixtureConfig(secretPath, "OTHER=keep\n");
  mkdirSync(dirname(fixture.envPath), { recursive: true });
  symlinkSync(secretPath, fixture.envPath);
  await assert.rejects(fixture.installer.install("codex"), /not a regular file/);
  await assert.rejects(fixture.installer.uninstall("codex"), /not a regular file/);
  assert.equal(fixture.commands.some((args) => ["add", "remove"].includes(args[1]!)), false);
  assert.equal(readFileSync(secretPath, "utf8"), "OTHER=keep\n");
});

test("Codex serializes concurrent installations", async () => {
  const fixture = createFixture();
  await Promise.all([fixture.installer.install("codex"), fixture.installer.install("codex")]);
  assert.equal(fixture.commands.filter((args) => args[1] === "add").length, 1);
});

test("dotenv updates preserve multiline values, comments and CRLF while removing duplicate token assignments", () => {
  const preserved = '# Keep\r\nOTHER="first\r\nBOATYARD_MCP_TOKEN=inside-value\r\nlast"\r\nAFTER=keep # comment\r\n';
  const source = preserved + 'export BOATYARD_MCP_TOKEN="old" # comment\r\nBOATYARD_MCP_TOKEN=duplicate\r\n';
  const result = updateCodexMcpEnv(source, "new-token");
  assert.equal(result, preserved + 'BOATYARD_MCP_TOKEN=new-token\r\n');
  assert.equal(updateCodexMcpEnv(result), preserved);
  assert.equal(readCodexMcpToken(result), "new-token");
});

test("MCP connection removal requires confirmation before deleting Claude local changes", async () => {
  const fixture = createFixture();
  await fixture.installer.install("claude-code");
  const source = JSON.parse(readFileSync(fixture.claudePath, "utf8"));
  source.mcpServers.boatyard.headers["X-Local"] = "changed";
  writeFileSync(fixture.claudePath, `${JSON.stringify(source, null, 2)}\n`);
  assert.equal((await fixture.installer.list())[1]?.state, "modified");
  await assert.rejects(fixture.installer.install("claude-code"), /changed locally/);
  await assert.rejects(fixture.installer.uninstall("claude-code"), /Confirm their removal/);
  assert.equal((await fixture.installer.uninstall("claude-code", { force: true })).target.state, "notInstalled");
  assert.equal(fixture.store.get().managedClientTokens["claude-code"], undefined);
});

test("MCP connection uninstall revokes an orphaned managed token", async () => {
  const fixture = createFixture();
  fixture.store.getOrCreateManagedClientToken("hermes");
  assert.equal((await fixture.installer.uninstall("hermes")).target.managedToken, false);
});

test("MCP connection installer rejects unknown targets", async () => {
  const fixture = createFixture();
  await assert.rejects(fixture.installer.install("unknown-agent"), /Unknown MCP connection target/);
  await assert.rejects(fixture.installer.uninstall("unknown-agent"), /Unknown MCP connection target/);
});
