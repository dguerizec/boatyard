"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createTerminalShutdownCoordinator
} = require(`${process.cwd()}/build/main/terminalShutdown`);

test("application quit waits for terminal cleanup exactly once", async () => {
  let finishCleanup: () => void = () => {
    throw new Error("Terminal cleanup did not start.");
  };
  let detachCalls = 0;
  let preventedQuits = 0;
  let quitCalls = 0;
  const service = {
    detachAll() {
      detachCalls += 1;
      return new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
    }
  };
  const coordinator = createTerminalShutdownCoordinator({
    getServices: () => [service, service],
    quit: () => {
      quitCalls += 1;
    }
  });
  const event = {
    preventDefault() {
      preventedQuits += 1;
    }
  };

  coordinator.handleBeforeQuit(event);
  coordinator.handleBeforeQuit(event);
  await Promise.resolve();

  assert.equal(detachCalls, 1);
  assert.equal(preventedQuits, 2);
  assert.equal(quitCalls, 0);
  finishCleanup();
  await coordinator.beginCleanup();

  assert.equal(coordinator.isCleanupComplete(), true);
  assert.equal(quitCalls, 1);

  coordinator.handleBeforeQuit(event);
  assert.equal(preventedQuits, 2);
  assert.equal(detachCalls, 1);
});

test("application quit continues after a terminal cleanup failure", async () => {
  const errors: unknown[] = [];
  let quitCalls = 0;
  const coordinator = createTerminalShutdownCoordinator({
    getServices: () => [{
      detachAll() {
        throw new Error("cleanup failed");
      }
    }],
    onError: (error: unknown) => errors.push(error),
    quit: () => {
      quitCalls += 1;
    }
  });

  await coordinator.beginCleanup();

  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /cleanup failed/);
  assert.equal(quitCalls, 1);
});

export {};
