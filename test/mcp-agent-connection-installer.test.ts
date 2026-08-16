import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { McpAgentConnectionInstaller } from "../src/main/mcpAgentConnectionInstaller.js";
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
  let endpoint = "http://127.0.0.1:4319/mcp";
  const installer = new McpAgentConnectionInstaller({
    environment: {
      CLAUDE_CONFIG_DIR: claudeRoot,
      CODEX_HOME: codexRoot,
      HERMES_HOME: hermesRoot
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
    directory,
    hermesPath: join(hermesRoot, "config.yaml"),
    installer,
    setEndpoint(value: string) {
      endpoint = value;
    },
    store
  };
}

function writeFixtureConfig(filePath: string, contents: string): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, contents);
}

test("MCP connection targets use each agent's configured personal file", () => {
  const fixture = createFixture();

  assert.deepEqual(fixture.installer.list().map(({ id, configPath, state }) => ({ id, configPath, state })), [
    { id: "codex", configPath: fixture.codexPath, state: "notInstalled" },
    { id: "claude-code", configPath: fixture.claudePath, state: "notInstalled" },
    { id: "hermes", configPath: fixture.hermesPath, state: "notInstalled" }
  ]);
});

test("MCP connections preserve unrelated config, update endpoints, and uninstall cleanly", () => {
  const fixture = createFixture();
  writeFixtureConfig(fixture.codexPath, "model = \"gpt-test\"\n");
  writeFixtureConfig(fixture.claudePath, `${JSON.stringify({
    theme: "dark",
    mcpServers: { other: { command: "example" } }
  }, null, 2)}\n`);
  writeFixtureConfig(fixture.hermesPath, "theme: dark\nmcp_servers:\n  other:\n    command: example\n");

  for (const targetId of ["codex", "claude-code", "hermes"] satisfies McpAgentTargetId[]) {
    assert.equal(fixture.installer.install(targetId).target.state, "installed");
  }

  const tokens = fixture.store.get().managedClientTokens;
  assert.equal(new Set(Object.values(tokens)).size, 3);
  assert.equal(readFileSync(fixture.codexPath, "utf8").includes("model = \"gpt-test\""), true);
  assert.equal(readFileSync(fixture.codexPath, "utf8").includes("[mcp_servers.boatyard]"), true);
  const claude = JSON.parse(readFileSync(fixture.claudePath, "utf8"));
  assert.deepEqual(claude.mcpServers.boatyard, {
    type: "http",
    url: "http://127.0.0.1:4319/mcp",
    headers: { Authorization: `Bearer ${tokens["claude-code"]}` }
  });
  assert.deepEqual(claude.mcpServers.other, { command: "example" });
  const hermes = parse(readFileSync(fixture.hermesPath, "utf8"));
  assert.deepEqual(hermes.mcp_servers.boatyard, {
    url: "http://127.0.0.1:4319/mcp",
    headers: { Authorization: `Bearer ${tokens.hermes}` }
  });
  assert.deepEqual(hermes.mcp_servers.other, { command: "example" });
  for (const filePath of [fixture.codexPath, fixture.claudePath, fixture.hermesPath]) {
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
  }

  fixture.setEndpoint("http://127.0.0.1:5320/mcp");
  assert.deepEqual(fixture.installer.list().map(({ state }) => state), [
    "updateAvailable",
    "updateAvailable",
    "updateAvailable"
  ]);
  for (const targetId of ["codex", "claude-code", "hermes"] satisfies McpAgentTargetId[]) {
    assert.equal(fixture.installer.install(targetId).target.state, "installed");
    assert.equal(fixture.installer.uninstall(targetId).target.state, "notInstalled");
  }

  assert.equal(readFileSync(fixture.codexPath, "utf8"), "model = \"gpt-test\"\n");
  const claudeAfter = JSON.parse(readFileSync(fixture.claudePath, "utf8"));
  assert.equal(claudeAfter.theme, "dark");
  assert.deepEqual(claudeAfter.mcpServers, { other: { command: "example" } });
  const hermesAfter = parse(readFileSync(fixture.hermesPath, "utf8"));
  assert.equal(hermesAfter.theme, "dark");
  assert.deepEqual(hermesAfter.mcp_servers, { other: { command: "example" } });
  assert.deepEqual(fixture.store.get().managedClientTokens, {});
});

test("MCP connection installation preserves an unmanaged entry", () => {
  const fixture = createFixture();
  const contents = "[mcp_servers.boatyard]\nurl = \"http://example.test/mcp\"\n";
  writeFixtureConfig(fixture.codexPath, contents);

  assert.equal(fixture.installer.list()[0]?.state, "conflict");
  assert.throws(() => fixture.installer.install("codex"), /not managed by Boatyard/);
  assert.throws(() => fixture.installer.uninstall("codex"), /will not remove/);
  assert.equal(readFileSync(fixture.codexPath, "utf8"), contents);
  assert.deepEqual(fixture.store.get().managedClientTokens, {});
});

test("MCP connection installation detects an inline Codex entry", () => {
  const fixture = createFixture();
  const contents = "[mcp_servers]\nboatyard = { url = \"http://example.test/mcp\" }\n";
  writeFixtureConfig(fixture.codexPath, contents);

  assert.equal(fixture.installer.list()[0]?.state, "conflict");
  assert.throws(() => fixture.installer.install("codex"), /not managed by Boatyard/);
  assert.equal(readFileSync(fixture.codexPath, "utf8"), contents);
});

test("MCP connection removal requires confirmation before deleting local changes", () => {
  const fixture = createFixture();
  fixture.installer.install("claude-code");
  const source = JSON.parse(readFileSync(fixture.claudePath, "utf8"));
  source.mcpServers.boatyard.headers["X-Local"] = "changed";
  writeFileSync(fixture.claudePath, `${JSON.stringify(source, null, 2)}\n`);

  assert.equal(fixture.installer.list()[1]?.state, "modified");
  assert.throws(() => fixture.installer.install("claude-code"), /changed locally/);
  assert.throws(() => fixture.installer.uninstall("claude-code"), /Confirm their removal/);
  assert.equal(fixture.installer.uninstall("claude-code", { force: true }).target.state, "notInstalled");
  assert.equal(JSON.parse(readFileSync(fixture.claudePath, "utf8")).mcpServers, undefined);
  assert.equal(fixture.store.get().managedClientTokens["claude-code"], undefined);
});

test("MCP connection uninstall revokes an orphaned managed token", () => {
  const fixture = createFixture();
  fixture.store.getOrCreateManagedClientToken("hermes");

  const status = fixture.installer.list()[2];
  assert.equal(status?.state, "notInstalled");
  assert.equal(status?.managedToken, true);
  assert.equal(fixture.installer.uninstall("hermes").target.managedToken, false);
  assert.equal(fixture.store.get().managedClientTokens.hermes, undefined);
});

test("MCP connection installer rejects unknown targets", () => {
  const fixture = createFixture();

  assert.throws(() => fixture.installer.install("unknown-agent"), /Unknown MCP connection target/);
  assert.throws(() => fixture.installer.uninstall("unknown-agent"), /Unknown MCP connection target/);
});
