import assert from "node:assert/strict";
import test from "node:test";
import type { ExecFileAsync } from "../src/shared/pluginTypes.js";

import {
  loadTwiccProcesses, loadTwiccProjects, loadTwiccSessions, loadTwiccSession,
  loadTwiccSessionFlow, resolveTwiccSession
} from "../src/plugins/twicc/service.js";

function cli(run: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>): ExecFileAsync {
  return run as unknown as ExecFileAsync;
}

const processMetadata = {
  id: "run-123", state: "awaiting_user_input", pid: 1234,
  started_at: "2026-09-24T10:00:00Z", last_state_change_at: "2026-09-24T10:05:00Z"
};
const session = {
  id: "session-123", project_id: "project", title: "Review", provider: "codex",
  process: processMetadata, last_started_at: "2026-09-24T10:00:00Z",
  last_updated_at: "2026-09-24T10:05:00Z"
};
function page(items: unknown[], offset = 0, hasMore = false) {
  return { items, pagination: { limit: 1, offset, total: hasMore ? offset + items.length + 1 : offset + items.length, has_more: hasMore } };
}
function rpc(result: unknown) {
  return { ok: true, json: async () => ({ exit_code: 0, result }) };
}

for (const enveloped of [false, true]) {
  for (const transport of ["cli", "rpc"] as const) {
    test(`${transport} reads ${enveloped ? "post-switch" : "transitional"} full session processes`, async () => {
      const rows = [session, { id: "subagent", process: null }, { id: "ended", process: { state: "dead" } }];
      const result = enveloped ? page(rows) : rows;
      const processes = await loadTwiccProcesses(transport === "cli" ? {
        execFileAsync: cli(async (_command, args) => {
          assert.equal(args[0], "sessions");
          for (const flag of ["--full", "--active", "--include-hidden", "--include-archived"]) {
            assert.ok(args.includes(flag));
          }
          return { stdout: JSON.stringify(result), stderr: "" };
        })
      } : {
        fetch: async (url, init) => {
          assert.ok(url.endsWith("/sessions"));
          const body = JSON.parse(String(init?.body));
          assert.equal(body.full, true);
          assert.equal(body.active, true);
          assert.equal(body.include_hidden, true);
          assert.equal(body.include_archived, true);
          return rpc(result);
        }
      });
      assert.deepEqual(processes, [{ ...processMetadata, session_id: session.id,
        session_title: session.title, project_id: session.project_id, provider: session.provider }]);
    });
  }
}

for (const transport of ["cli", "rpc"] as const) {
  test(`${transport} uses only the legacy command on explicit capability rejection`, async () => {
    const calls: string[] = [];
    const legacy = [{ session_id: "session-123", state: "starting", pid: 42 }];
    const result = await loadTwiccProcesses(transport === "cli" ? {
      execFileAsync: cli(async (_command, args) => {
        calls.push(args[0]);
        if (args[0] === "sessions") {
          throw Object.assign(new Error("Command failed"), { code: 2, stderr: "Error: No such option: --active" });
        }
        return { stdout: JSON.stringify(legacy), stderr: "" };
      })
    } : {
      fetch: async (url) => {
        calls.push(url.split("/rpc/")[1]);
        if (url.endsWith("/sessions")) {
          return { ok: false, status: 400, json: async () => ({ error: "Unknown field(s): active, full" }) };
        }
        return rpc(legacy);
      },
      execFileAsync: () => { throw new Error("Must never switch to the CLI"); }
    });
    assert.deepEqual(result, legacy);
    assert.deepEqual(calls, ["sessions", "processes"]);
  });

  test(`${transport} retries old session lists without the unsupported full option`, async () => {
    const fullAttempts: boolean[] = [];
    const options = transport === "cli" ? {
      execFileAsync: cli(async (_command, args) => {
        fullAttempts.push(args.includes("--full"));
        if (args.includes("--full")) {
          throw Object.assign(new Error("No such option: --full"), { code: 2 });
        }
        return { stdout: JSON.stringify([session]), stderr: "" };
      })
    } : {
      fetch: async (_url: string, init?: Record<string, unknown>) => {
        const full = JSON.parse(String(init?.body)).full === true;
        fullAttempts.push(full);
        return full ? { ok: false, status: 400, json: async () => ({ error: "Unknown field(s): full" }) } : rpc([session]);
      }
    };
    assert.deepEqual(await loadTwiccSessions("project", options), [session]);
    assert.deepEqual(fullAttempts, [true, false]);
  });
}

for (const command of ["projects", "sessions", "processes"] as const) {
  for (const transport of ["cli", "rpc"] as const) {
    test(`${transport} follows ${command} page metadata even when fewer than 1000 rows arrive`, async () => {
      const offsets: number[] = [];
      const read = (offset: number) => {
        offsets.push(offset);
        return page([{ ...session, id: `session-${offset}` }], offset, offset === 0);
      };
      const options = transport === "cli" ? {
        execFileAsync: cli(async (_command, args) => {
          const index = args.indexOf("--offset");
          return { stdout: JSON.stringify(read(index < 0 ? 0 : Number(args[index + 1]))), stderr: "" };
        })
      } : {
        fetch: async (_url: string, init?: Record<string, unknown>) => rpc(read(Number(JSON.parse(String(init?.body)).offset || 0)))
      };
      const result = command === "projects" ? await loadTwiccProjects(options)
        : command === "sessions" ? await loadTwiccSessions("project", options) : await loadTwiccProcesses(options);
      assert.equal(result.length, 2);
      assert.deepEqual(offsets, [0, 1]);
    });
  }
}

test("modern board reads preserve full lane/activity metadata without a separate process request", async () => {
  let calls = 0;
  const result = await loadTwiccSessionFlow("project", {
    fetch: async (url, init) => {
      calls++;
      assert.ok(url.endsWith("/sessions"));
      assert.equal(JSON.parse(String(init?.body)).full, true);
      return rpc(page([session, { ...session, id: "idle", process: { state: "user_turn" } }]));
    }
  });
  assert.equal(calls, 1);
  assert.equal(result[0].lane, "in_progress");
  assert.equal(result[0].lastActivityAt, "2026-09-24T10:05:00.000Z");
  assert.equal(result.find((row) => row.id === session.id)?.processStateChangedAt, processMetadata.last_state_change_at);
  assert.equal(result.find((row) => row.id === "idle")?.lane, "in_progress");
});

test("modern session resolution uses the embedded process, including dead and subagent states", async () => {
  for (const process of [processMetadata, { state: "dead" }, null]) {
    let calls = 0;
    const result = await resolveTwiccSession(session.id, {
      fetch: async (url) => { calls++; assert.ok(url.endsWith("/session")); return rpc({ ...session, process }); }
    });
    assert.equal(calls, 1);
    assert.equal(result.processState, process?.state ?? "stopped");
    assert.equal(result.warning, null);
  }
});

for (const status of [400, 401, 403, 404, 500, 503]) {
  test(`HTTP ${status} is not mistaken for an old TwiCC version or retried locally`, async () => {
    let calls = 0;
    await assert.rejects(loadTwiccProcesses({
      fetch: async () => { calls++; return { ok: false, status, json: async () => ({ error: "Unavailable" }) }; },
      execFileAsync: () => { throw new Error("Unexpected CLI fallback"); }
    }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  });
}

test("project and session lookup failures stay on the configured instance", async () => {
  for (const load of [loadTwiccProjects, (options: Parameters<typeof loadTwiccSession>[1]) => loadTwiccSession("session-123", options)]) {
    await assert.rejects(load({
      fetch: async () => { throw new Error("Network unavailable"); },
      execFileAsync: () => { throw new Error("Unexpected CLI fallback"); }
    }), /Network unavailable/);
  }
});

test("unknown unrelated RPC fields do not trigger legacy fallback", async () => {
  let calls = 0;
  await assert.rejects(loadTwiccProcesses({ fetch: async () => {
    calls++;
    return { ok: false, status: 400, json: async () => ({ error: "Unknown field(s): active, unrelated" }) };
  } }), /Unknown field/);
  assert.equal(calls, 1);
});

for (const result of [
  {}, { items: [] }, page([], 0, true), page([session], 99, true),
  page([{ id: "session-123" }]), page([{ id: "session-123", process: {} }])
]) {
  test(`malformed process response remains an error: ${JSON.stringify(result)}`, async () => {
    let calls = 0;
    await assert.rejects(loadTwiccProcesses({ fetch: async () => { calls++; return rpc(result); } }), /TwiCC returned/);
    assert.equal(calls, 1);
  });
}
