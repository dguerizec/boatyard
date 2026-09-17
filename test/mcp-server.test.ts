import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { z } from "zod";
import { PluginHost } from "../src/main/pluginHost.js";
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
      capturePane: async () => ({
        data: Buffer.from("png").toString("base64"),
        metadata: {
          paneId: "pane-1",
          rect: { x: 12, y: 18, width: 320, height: 240 }
        },
        mimeType: "image/png"
      }),
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
      "switch_project",
      "get_pane_layout",
      "list_pane_types",
      "capture_pane",
      "update_pane",
      "navigate_pane",
      "open_twicc_session"
    ]);

    const captureResponse = await fetch(status.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "capture_pane",
          arguments: {
            contextId: "context-1",
            windowId: "window-1",
            projectId: "project-1",
            paneId: "pane-1",
            rect: { x: 12, y: 18, width: 320, height: 240 }
          }
        }
      })
    });
    assert.equal(captureResponse.status, 200);
    const capturePayload = parseMcpResponse(await captureResponse.text());
    const captureResult = capturePayload.result as Record<string, unknown>;
    assert.deepEqual(captureResult.content, [
      {
        type: "text",
        text: JSON.stringify({
          paneId: "pane-1",
          rect: { x: 12, y: 18, width: 320, height: 240 }
        }, null, 2)
      },
      { type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" }
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
        id: 4,
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
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list", params: {} })
    });
    assert.equal(revokedClientResponse.status, 401);
  } finally {
    await service.stop();
  }
});


test("MCP publishes plugin tools, validates schemas and routes to the selected configuration", async () => {
  let enabled = true;
  const host = new PluginHost({ store: { getState: () => ({ plugins: { enabled: { "example.plugin": enabled } } }) } });
  let invocations = 0;
  const definition = {
    id: "example.plugin.echo",
    title: "Echo",
    description: "Test scoped plugin tool",
    inputSchema: z.object({ value: z.number().int() }).strict().refine((input) => input.value > 0),
    readOnly: true,
    invoke: (input: Record<string, unknown>) => { invocations += 1; return { value: input.value }; }
  };
  host.registerTool("example.plugin", definition);
  assert.throws(() => host.registerTool("other.plugin", definition), /prefixed/);
  assert.throws(() => host.registerTool("example.plugin", definition), /already registered/);
  assert.throws(() => host.registerTool("example.plugin", {
    ...definition, id: "example.plugin.reserved", inputSchema: z.object({ contextId: z.string() })
  }), /reserved/);
  const settings: McpSettings = {
    enabled: true, managedClientTokens: {}, port: await reservePort(), token: "test-plugin-tools-token"
  };
  const service = new McpServerService({
    getSettings: () => settings,
    version: "test",
    api: {
      capturePane: async () => ({ data: "", metadata: {}, mimeType: "image/png" }),
      listWindows: () => ({ windows: [] }),
      requestPane: async () => ({}),
      listPluginTools: () => host.listTools(),
      invokePluginTool: async (contextId, id, input) => {
        if (contextId !== "selected-context") { throw new Error("Unknown configuration context"); }
        return host.invokeTool(id, input);
      }
    }
  });
  try {
    const status = await service.configure();
    let id = 0;
    async function request(method: string, params: Record<string, unknown>) {
      const response = await fetch(status.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream", Authorization: `Bearer ${settings.token}`,
          "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })
      });
      return parseMcpResponse(await response.text()) as {
        result?: { tools?: Array<{ name: string; annotations?: { readOnlyHint: boolean } }>; isError?: boolean; structuredContent?: unknown };
        error?: unknown;
      };
    }
    const listed = await request("tools/list", {});
    const tool = listed.result?.tools?.find((entry) => entry.name === definition.id);
    assert.equal(tool?.annotations?.readOnlyHint, true);
    const call = (args: Record<string, unknown>) => request("tools/call", { name: definition.id, arguments: args });
    const valid = await call({ contextId: "selected-context", value: 42 });
    assert.deepEqual(valid.result?.structuredContent, { value: 42 });
    const invalid = await call({ contextId: "selected-context", value: "bad" });
    assert.ok(invalid.error || invalid.result?.isError);
    const refined = await call({ contextId: "selected-context", value: -1 });
    assert.ok(refined.error || refined.result?.isError);
    const wrongContext = await call({ contextId: "other-context", value: 1 });
    assert.equal(wrongContext.result?.isError, true);
    assert.equal(invocations, 1);
    enabled = false;
    assert.equal(host.listTools().length, 0);
    await assert.rejects(host.invokeTool(definition.id, { value: 2 }), /unavailable/);
    const refreshed = await request("tools/list", {});
    assert.equal(refreshed.result?.tools?.some((entry) => entry.name === definition.id), false);
  } finally { await service.stop(); }
});

test("switch_project validates its target and routes navigation through the selected window", async () => {
  const settings: McpSettings = {
    enabled: true, managedClientTokens: {}, port: await reservePort(), token: "test-navigation-token"
  };
  const requests: unknown[] = [];
  const service = new McpServerService({
    api: {
      capturePane: async () => ({ data: "", metadata: {}, mimeType: "image/png" }),
      listWindows: () => ({ windows: [] }),
      requestPane: async (contextId, windowId, operation, input) => {
        requests.push({ contextId, windowId, operation, input });
        if (input.projectId === "missing") {
          throw Object.assign(new Error("Project is unavailable."), { code: "PROJECT_NOT_FOUND" });
        }
        return { projectId: input.projectId, view: "project" };
      }
    },
    getSettings: () => settings,
    version: "test"
  });
  try {
    const status = await service.configure();
    const call = async (input: Record<string, unknown>) => {
      const response = await fetch(status.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${settings.token}`,
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-06-18"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name: "switch_project", arguments: input } })
      });
      return parseMcpResponse(await response.text());
    };
    const input = { contextId: "context-2", windowId: "window-3", projectId: "project-1" };
    const payload = await call(input);
    assert.deepEqual((payload.result as Record<string, unknown>).structuredContent, {
      projectId: "project-1", view: "project"
    });
    assert.deepEqual(requests, [{
      contextId: "context-2", windowId: "window-3", operation: "switch_project", input
    }]);
    for (const key of ["contextId", "windowId", "projectId"]) {
      const invalid = { ...input } as Record<string, unknown>;
      delete invalid[key];
      const rejected = await call(invalid);
      assert.ok(rejected.error || (rejected.result as Record<string, unknown>)?.isError);
    }
    assert.equal(requests.length, 1);
    const missing = await call({ ...input, projectId: "missing" });
    const result = missing.result as { isError: boolean; content: Array<{ text: string }> };
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).code, "PROJECT_NOT_FOUND");
  } finally {
    await service.stop();
  }
});

test("MCP opens a resolved TwiCC session and reports optional plugin/backend failures", async () => {
  let enabled = true;
  let failure = false;
  const calls: unknown[] = [];
  const settings: McpSettings = {
    enabled: true, managedClientTokens: {}, port: await reservePort(), token: "test-session-open-token"
  };
  const service = new McpServerService({
    api: {
      listWindows: () => ({}),
      capturePane: async () => ({ data: "", metadata: {}, mimeType: "image/png" }),
      listPluginTools: () => enabled ? [{
        id: "boatyard.twicc.resolve_session", title: "Resolve", description: "Resolve",
        inputSchema: z.object({ sessionId: z.string() }), readOnly: true, invoke: async () => ({})
      }] : [],
      invokePluginTool: async (contextId, id, input) => {
        calls.push({ contextId, id, input });
        if (failure) { throw Object.assign(new Error("TwiCC unavailable"), { code: "TWICC_UNAVAILABLE" }); }
        return { sessionId: input.sessionId, title: "Example", url: "https://twicc.example/project/p/session/s", requiresUserAction: true };
      },
      requestPane: async (contextId, windowId, operation, input) => {
        calls.push({ contextId, windowId, operation, input });
        return { navigated: true };
      }
    },
    getSettings: () => settings, version: "test"
  });
  try {
    const { endpoint } = await service.configure();
    async function open() {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json, text/event-stream", Authorization: `Bearer ${settings.token}`,
          "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
          name: "open_twicc_session", arguments: {
            contextId: "context", windowId: "window", projectId: "project", paneId: "pane",
            expectedRevision: "revision", sessionId: "s"
          }
        } })
      });
      return parseMcpResponse(await response.text()).result as Record<string, unknown>;
    }
    const result = await open();
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, [
      { contextId: "context", id: "boatyard.twicc.resolve_session", input: { sessionId: "s" } },
      { contextId: "context", windowId: "window", operation: "open_twicc_session", input: {
        contextId: "context", windowId: "window", projectId: "project", paneId: "pane",
        expectedRevision: "revision", sessionId: "s", url: "https://twicc.example/project/p/session/s"
      } }
    ]);
    calls.length = 0;
    failure = true;
    assert.match(JSON.stringify(await open()), /TWICC_UNAVAILABLE/);
    assert.equal(calls.length, 1);
    calls.length = 0;
    enabled = false;
    assert.match(JSON.stringify(await open()), /TWICC_PLUGIN_UNAVAILABLE/);
    assert.equal(calls.length, 0);
  } finally { await service.stop(); }
});
