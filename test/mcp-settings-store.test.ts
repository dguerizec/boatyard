import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_MCP_PORT, McpSettingsStore } from "../src/main/mcpSettingsStore.js";

test("MCP settings are disabled by default and persisted with a private token", () => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-mcp-settings-"));
  const filePath = join(directory, "mcp.json");
  const store = new McpSettingsStore(filePath);
  const initial = store.load();

  assert.equal(initial.enabled, false);
  assert.equal(initial.port, DEFAULT_MCP_PORT);
  assert.match(initial.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(statSync(filePath).mode & 0o777, 0o600);

  const updated = store.update({ enabled: true, port: 54321 });
  assert.equal(updated.enabled, true);
  assert.equal(updated.port, 54321);
  assert.equal(updated.token, initial.token);
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).token, initial.token);

  const rotated = store.rotateToken();
  assert.notEqual(rotated.token, initial.token);
});
