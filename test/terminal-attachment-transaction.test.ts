"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  runTerminalAttachmentTransaction
} = require(`${process.cwd()}/build/main/terminalAttachmentTransaction`);

test("terminal attachment transaction rolls back a session when initialization fails", async () => {
  const events: string[] = [];

  await assert.rejects(
    runTerminalAttachmentTransaction({
      createSession: async () => {
        events.push("create");
      },
      destroySession: async () => {
        events.push("destroy");
      },
      initializeAttachment: async () => {
        events.push("initialize");
        throw new Error("PTY failed");
      }
    }),
    /PTY failed/
  );

  assert.deepEqual(events, ["create", "initialize", "destroy"]);
});

test("terminal attachment transaction does not roll back before session creation", async () => {
  const events: string[] = [];

  await assert.rejects(
    runTerminalAttachmentTransaction({
      createSession: async () => {
        events.push("create");
        throw new Error("tmux failed");
      },
      destroySession: async () => {
        events.push("destroy");
      },
      initializeAttachment: async () => {
        events.push("initialize");
      }
    }),
    /tmux failed/
  );

  assert.deepEqual(events, ["create"]);
});

export {};
