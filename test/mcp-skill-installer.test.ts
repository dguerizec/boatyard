import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpSkillInstaller } from "../src/main/mcpSkillInstaller.js";

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-mcp-skill-"));
  const homeDirectory = join(directory, "home");
  const sourceDirectory = join(directory, "source");
  mkdirSync(join(sourceDirectory, "agents"), { recursive: true });
  writeFileSync(join(sourceDirectory, "SKILL.md"), "---\nname: boatyard-mcp\ndescription: Test skill.\n---\n\nInitial.\n");
  writeFileSync(join(sourceDirectory, "agents", "openai.yaml"), "interface:\n  display_name: \"Boatyard MCP\"\n");
  return { directory, homeDirectory, sourceDirectory };
}

test("MCP skill targets use each agent's personal skill directory", () => {
  const fixture = createFixture();
  const installer = new McpSkillInstaller({
    environment: {
      CLAUDE_CONFIG_DIR: join(fixture.directory, "claude-profile"),
      HERMES_HOME: join(fixture.directory, "hermes-profile")
    },
    homeDirectory: fixture.homeDirectory,
    sourceDirectory: fixture.sourceDirectory
  });

  assert.deepEqual(installer.list().map(({ id, installPath, state }) => ({ id, installPath, state })), [
    {
      id: "codex",
      installPath: join(fixture.homeDirectory, ".agents", "skills", "boatyard-mcp"),
      state: "notInstalled"
    },
    {
      id: "claude-code",
      installPath: join(fixture.directory, "claude-profile", "skills", "boatyard-mcp"),
      state: "notInstalled"
    },
    {
      id: "hermes",
      installPath: join(fixture.directory, "hermes-profile", "skills", "boatyard-mcp"),
      state: "notInstalled"
    }
  ]);
});

test("MCP skill installation is owned, updateable, and cleanly removable", () => {
  const fixture = createFixture();
  const installer = new McpSkillInstaller({
    environment: {},
    homeDirectory: fixture.homeDirectory,
    sourceDirectory: fixture.sourceDirectory
  });
  const installPath = join(fixture.homeDirectory, ".agents", "skills", "boatyard-mcp");

  const installed = installer.install("codex");
  assert.equal(installed.target.state, "installed");
  assert.equal(readFileSync(join(installPath, "SKILL.md"), "utf8").includes("Initial."), true);
  assert.equal(statSync(join(installPath, ".boatyard-managed.json")).mode & 0o777, 0o600);

  writeFileSync(join(fixture.sourceDirectory, "SKILL.md"), "---\nname: boatyard-mcp\ndescription: Test skill.\n---\n\nUpdated.\n");
  assert.equal(installer.list()[0]?.state, "updateAvailable");

  const updated = installer.install("codex");
  assert.equal(updated.target.state, "installed");
  assert.equal(readFileSync(join(installPath, "SKILL.md"), "utf8").includes("Updated."), true);

  const removed = installer.uninstall("codex");
  assert.equal(removed.target.state, "notInstalled");
  assert.equal(existsSync(installPath), false);
  assert.equal(existsSync(join(fixture.homeDirectory, ".agents", "skills")), true);
});

test("MCP skill installation preserves unmanaged directories", () => {
  const fixture = createFixture();
  const installPath = join(fixture.homeDirectory, ".claude", "skills", "boatyard-mcp");
  mkdirSync(installPath, { recursive: true });
  writeFileSync(join(installPath, "SKILL.md"), "User-owned skill.\n");
  const installer = new McpSkillInstaller({
    environment: {},
    homeDirectory: fixture.homeDirectory,
    sourceDirectory: fixture.sourceDirectory
  });

  const status = installer.list().find(({ id }) => id === "claude-code");
  assert.equal(status?.state, "conflict");
  assert.throws(() => installer.install("claude-code"), /not installed by Boatyard/);
  assert.throws(() => installer.uninstall("claude-code"), /will not remove/);
  assert.equal(readFileSync(join(installPath, "SKILL.md"), "utf8"), "User-owned skill.\n");
});

test("MCP skill installation requires explicit force before removing local changes", () => {
  const fixture = createFixture();
  const installer = new McpSkillInstaller({
    environment: {},
    homeDirectory: fixture.homeDirectory,
    sourceDirectory: fixture.sourceDirectory
  });
  const installPath = join(fixture.homeDirectory, ".hermes", "skills", "boatyard-mcp");
  installer.install("hermes");
  writeFileSync(join(installPath, "SKILL.md"), "Locally edited.\n");
  writeFileSync(join(installPath, "notes.md"), "Local notes.\n");

  const status = installer.list().find(({ id }) => id === "hermes");
  assert.equal(status?.state, "modified");
  assert.deepEqual(status?.modifiedFiles, ["SKILL.md", "notes.md"]);
  assert.throws(() => installer.install("hermes"), /Local changes detected/);
  assert.throws(() => installer.uninstall("hermes"), /Confirm their removal/);
  assert.equal(existsSync(installPath), true);

  const removed = installer.uninstall("hermes", { force: true });
  assert.equal(removed.target.state, "notInstalled");
  assert.equal(existsSync(installPath), false);
});

test("MCP skill installer rejects unknown targets", () => {
  const fixture = createFixture();
  const installer = new McpSkillInstaller({
    environment: {},
    homeDirectory: fixture.homeDirectory,
    sourceDirectory: fixture.sourceDirectory
  });

  assert.throws(() => installer.install("unknown-agent"), /Unknown MCP skill installation target/);
  assert.throws(() => installer.uninstall("unknown-agent"), /Unknown MCP skill installation target/);
});
