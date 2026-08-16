import assert from "node:assert/strict";
import test from "node:test";
import { McpRendererBroker, McpRendererError } from "../src/main/mcpRendererBroker.js";

test("MCP renderer broker accepts only the targeted renderer response", async () => {
  const broker = new McpRendererBroker(1_000);
  let sent: Record<string, unknown> = {};
  const resultPromise = broker.request({
    id: 12,
    isDestroyed: () => false,
    send: (_channel, payload) => { sent = payload as Record<string, unknown>; }
  }, "get_pane_layout", { projectId: "project-1" });

  assert.equal(broker.acceptResponse(99, { requestId: sent.requestId, result: "wrong" }), false);
  assert.equal(broker.acceptResponse(12, { requestId: sent.requestId, result: { ok: true } }), true);
  assert.deepEqual(await resultPromise, { ok: true });
});

test("MCP renderer broker preserves renderer error codes", async () => {
  const broker = new McpRendererBroker(1_000);
  let sent: Record<string, unknown> = {};
  const resultPromise = broker.request({
    id: 7,
    isDestroyed: () => false,
    send: (_channel, payload) => { sent = payload as Record<string, unknown>; }
  }, "assign_pane_type", {});
  broker.acceptResponse(7, {
    requestId: sent.requestId,
    error: { code: "LAYOUT_CHANGED", message: "Layout changed." }
  });

  await assert.rejects(resultPromise, (error) => (
    error instanceof McpRendererError && error.code === "LAYOUT_CHANGED"
  ));
});
