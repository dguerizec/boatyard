import assert from "node:assert/strict";
import test from "node:test";
import { resolveTwiccSession } from "../src/plugins/twicc/service.js";

function fixture(state = "awaiting_user_input") {
  const calls: string[] = [];
  return {
    calls,
    options: {
      globalConfig: { twiccBaseUrl: "https://twicc.example" },
      async fetch(url: string) {
        calls.push(url);
        return { ok: true, json: async () => ({ result: url.endsWith("/session")
          ? { id: "session-123", project_id: "another-project", title: "Review", archived: true, hidden: true }
          : [{ session_id: "session-123", state }] }) };
      }
    }
  };
}

test("session resolution uses the recorded project and reports pending input without writes", async () => {
  const f = fixture();
  const result = await resolveTwiccSession("session-123", f.options);
  assert.equal(result.url, "https://twicc.example/project/another-project/session/session-123");
  assert.equal(result.title, "Review");
  assert.equal(result.requiresUserAction, true);
  assert.deepEqual(f.calls.map((url) => url.split("/rpc/")[1]), ["session", "processes"]);
});

test("invalid session IDs never contact TwiCC", async () => {
  const f = fixture();
  for (const id of ["", "../session", "https://example.test", "--help"]) {
    await assert.rejects(resolveTwiccSession(id, f.options), { code: "INVALID_SESSION_ID" });
  }
  assert.equal(f.calls.length, 0);
});

for (const [status, code] of [[401, "TWICC_PERMISSION_DENIED"], [403, "TWICC_PERMISSION_DENIED"],
  [404, "TWICC_SESSION_NOT_FOUND"], [503, "TWICC_UNAVAILABLE"]] as const) {
  test(`session lookup reports HTTP ${status} and never falls back to a different instance`, async () => {
    let cliCalls = 0;
    await assert.rejects(resolveTwiccSession("session-123", {
      fetch: async () => ({ ok: false, status, json: async () => ({}) }),
      execFileAsync: (() => { cliCalls++; throw new Error("Unexpected CLI fallback"); })
    }), { code });
    assert.equal(cliCalls, 0);
  });
}

test("missing backend and invalid metadata have clear errors", async () => {
  await assert.rejects(resolveTwiccSession("session-123"), { code: "TWICC_UNAVAILABLE" });
  for (const [result, code] of [[null, "TWICC_SESSION_NOT_FOUND"], [{ id: "other" }, "TWICC_INVALID_RESPONSE"]] as const) {
    await assert.rejects(resolveTwiccSession("session-123", {
      fetch: async () => ({ ok: true, json: async () => ({ result }) })
    }), { code });
  }
});

test("unavailable process state does not prevent opening a known conversation", async () => {
  const f = fixture();
  const fetch = f.options.fetch;
  f.options.fetch = async (url) => {
    if (url.endsWith("/processes")) { throw new Error("offline"); }
    return fetch(url);
  };
  const result = await resolveTwiccSession("session-123", f.options);
  assert.equal(result.processState, "unknown");
  assert.ok(result.warning);
});
