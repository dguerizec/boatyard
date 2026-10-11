import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { RemoteCommandQueue } from "../src/shared/remoteCommandQueue.js";

test("slow IPC retains the latest camera and mouse motion while preserving click boundaries", async () => {
  type Command = { kind: string; action?: string; revision: number };
  const processed: Command[] = [];
  let unblock!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const errors: unknown[] = [];
  const queue = new RemoteCommandQueue<Command>(async command => {
    processed.push(command);
    if (processed.length === 1) await blocked;
  }, error => errors.push(error));
  queue.push({ kind: "viewport", revision: 0 });
  for (let revision = 1; revision <= 1000; revision++) {
    queue.push({ kind: "viewport", revision });
    queue.push({ kind: "pointer", action: "move", revision });
  }
  queue.push({ kind: "pointer", action: "down", revision: 1000 });
  queue.push({ kind: "pointer", action: "up", revision: 1000 });
  queue.push({ kind: "viewport", revision: 1001 });
  queue.push({ kind: "viewport", revision: 1002 });
  unblock(); await setImmediate();
  assert.deepEqual(processed, [
    { kind: "viewport", revision: 0 }, { kind: "viewport", revision: 1000 },
    { kind: "pointer", action: "move", revision: 1000 },
    { kind: "pointer", action: "down", revision: 1000 },
    { kind: "pointer", action: "up", revision: 1000 }, { kind: "viewport", revision: 1002 }
  ]);
  assert.deepEqual(errors, []);
});

test("closing discards pending commands and a failed command does not stall the queue", async () => {
  let unblock!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const processed: string[] = [], errors: unknown[] = [];
  const queue = new RemoteCommandQueue(async command => {
    processed.push(command.kind);
    if (command.kind === "key") { await blocked; throw new Error("Failed input"); }
  }, error => errors.push(error));
  queue.push({ kind: "key" }); queue.push({ kind: "release" }); queue.clear();
  unblock(); await setImmediate();
  queue.push({ kind: "release" }); await setImmediate();
  assert.deepEqual(processed, ["key", "release"]);
  assert.equal(errors.length, 1);
});
