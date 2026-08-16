import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { McpServerService } from "../src/main/mcpServer.js";
import type { McpSettings } from "../src/main/mcpSettingsStore.js";

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function parseMcpResponse(text: string): Record<string, unknown> {
  if (!text.startsWith("event:")) {
    return JSON.parse(text) as Record<string, unknown>;
  }
  const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) || "{}";
  return JSON.parse(data) as Record<string, unknown>;
}

test("MCP server requires a bearer token and accepts Streamable HTTP initialization", async () => {
  const settings: McpSettings = {
    enabled: true,
    managedClientTokens: { codex: "codex-managed-token-with-sufficient-entropy" },
    port: await reservePort(),
    token: "test-token-with-sufficient-entropy"
  };
  const service = new McpServerService({
    api: {
      listWindows: () => ({ windows: [] }),
      requestPane: async () => ({})
    },
    getSettings: () => ({ ...settings }),
    version: "test"
  });

  try {
    const status = await service.configure();
    assert.equal(status.listening, true);
    assert.equal("managedClientTokens" in status, false);

    const unauthorized = await fetch(status.endpoint);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const initialized = await fetch(status.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "boatyard-test", version: "1" }
        }
      })
    });
    assert.equal(initialized.status, 200);
    const response = parseMcpResponse(await initialized.text());
    assert.equal((response.result as Record<string, unknown>).protocolVersion, "2025-06-18");

    const toolsResponse = await fetch(status.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    assert.equal(toolsResponse.status, 200);
    const toolsPayload = parseMcpResponse(await toolsResponse.text());
    const tools = ((toolsPayload.result as Record<string, unknown>).tools as Array<Record<string, unknown>>);
    assert.deepEqual(tools.map((tool) => tool.name), [
      "list_windows",
      "get_pane_layout",
      "list_pane_types",
      "update_pane",
      "navigate_pane"
    ]);

    const managedClientResponse = await fetch(status.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${settings.managedClientTokens.codex}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "boatyard-managed-test", version: "1" }
        }
      })
    });
    assert.equal(managedClientResponse.status, 200);

    settings.managedClientTokens = {};
    const revokedClientResponse = await fetch(status.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer codex-managed-token-with-sufficient-entropy",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} })
    });
    assert.equal(revokedClientResponse.status, 401);
  } finally {
    await service.stop();
  }
});
