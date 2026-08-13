"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createTerminalAttachmentCoordinator
} = require(`${process.cwd()}/build/renderer/terminalAttachmentCoordinator`);

test("terminal attachment coordinator discards a response invalidated by navigation", async () => {
  const discardedTerminalIds: string[] = [];
  const coordinator = createTerminalAttachmentCoordinator({
    discardAttachment: async ({ terminalId }: { terminalId: string }) => {
      discardedTerminalIds.push(terminalId);
    }
  });
  const attempt = coordinator.begin("surface-1", "project-1");

  coordinator.invalidateInactiveProjects(null);

  assert.equal(coordinator.isCurrent(attempt), false);
  await coordinator.discard(attempt, { terminalId: "terminal-1" });
  assert.deepEqual(discardedTerminalIds, ["terminal-1"]);
});

test("terminal attachment coordinator keeps only the latest overlapping attempt", async () => {
  const discardedTerminalIds: string[] = [];
  const coordinator = createTerminalAttachmentCoordinator({
    discardAttachment: async ({ terminalId }: { terminalId: string }) => {
      discardedTerminalIds.push(terminalId);
    }
  });
  const firstAttempt = coordinator.begin("surface-1", "project-1");
  const secondAttempt = coordinator.begin("surface-1", "project-1");

  assert.equal(coordinator.isCurrent(firstAttempt), false);
  assert.equal(coordinator.isCurrent(secondAttempt), true);
  await coordinator.discard(firstAttempt, { terminalId: "terminal-old" });
  assert.equal(coordinator.complete(secondAttempt), true);
  assert.equal(coordinator.isCurrent(secondAttempt), false);
  assert.deepEqual(discardedTerminalIds, ["terminal-old"]);
});

test("terminal attachment coordinator invalidates pending attempts when leaving a project", () => {
  const coordinator = createTerminalAttachmentCoordinator({
    discardAttachment: async () => {}
  });
  const boatyardAttempt = coordinator.begin("surface-boatyard", "boatyard");
  const pickatubeAttempt = coordinator.begin("surface-pickatube", "pickatube");

  coordinator.invalidateInactiveProjects("pickatube");

  assert.equal(coordinator.isCurrent(boatyardAttempt), false);
  assert.equal(coordinator.isCurrent(pickatubeAttempt), true);

  coordinator.invalidateProject("pickatube");

  assert.equal(coordinator.isCurrent(pickatubeAttempt), false);
});

export {};
