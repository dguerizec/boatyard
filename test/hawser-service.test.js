"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseHawserProjectName,
  parseHawserSessionName,
  summarizeMessages
} = require("../src/main/hawserService");

test("parseHawserProjectName derives the project from the configured main session", () => {
  assert.equal(parseHawserProjectName({
    slug: "fallback",
    hawserMainSession: "dashtop:main"
  }), "dashtop");
  assert.equal(parseHawserProjectName({
    slug: "fallback",
    hawserMainSession: ""
  }), "fallback");
});

test("parseHawserSessionName derives the session from the configured main session", () => {
  assert.equal(parseHawserSessionName({
    hawserMainSession: "dashtop:main"
  }), "main");
  assert.equal(parseHawserSessionName({
    hawserMainSession: "dashtop:feature:one"
  }), "feature:one");
  assert.equal(parseHawserSessionName({
    hawserMainSession: "dashtop"
  }), "");
});

test("summarizeMessages counts inbox and active Hawser tasks", () => {
  assert.deepEqual(summarizeMessages([
    {
      direction: "in",
      kind: "reply",
      status: "unread"
    },
    {
      direction: "in",
      kind: "task",
      status: "processing"
    },
    {
      direction: "out",
      kind: "task",
      status: "unread"
    },
    {
      direction: "out",
      kind: "reply",
      status: "done"
    }
  ]), {
    unread: 1,
    processing: 1,
    activeTasks: 2
  });
});
