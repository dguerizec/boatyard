"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  addSessionRefsToMessages,
  getMessageSessionTarget,
  getTwiccSessionIdFromRefs,
  isActiveTask,
  normalizeMessage,
  parseHawserProjectName,
  parseHawserSessionName,
  shouldShowWidgetMessage,
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

test("isActiveTask excludes read tasks that remain visible for Twicc links", () => {
  assert.equal(isActiveTask({
    kind: "task",
    status: "processing",
    twiccSessionId: "019e8578-4195-7553-9d18-1e01bf765656"
  }), true);
  assert.equal(isActiveTask({
    kind: "task",
    status: "done",
    twiccSessionId: "019e8578-4195-7553-9d18-1e01bf765656"
  }), false);
});

test("normalizeMessage extracts the Twicc session id from Hawser envelopes", () => {
  assert.equal(normalizeMessage({
    id: "message-1",
    body: JSON.stringify({
      twicc_session_id: "019e9d00-6985-7ce0-b903-ba343e968483",
      codex_session_id: "019e8578-4195-7553-9d18-1e01bf765656",
      runtime_session_id: "7e521d86-db79-4112-b498-8e99ce969c5c",
      content: "Done."
    }),
    from_project: "hawser",
    to_project: "dashtop"
  }, "dashtop").twiccSessionId, "019e9d00-6985-7ce0-b903-ba343e968483");
});

test("getMessageSessionTarget resolves sent and received Hawser session endpoints", () => {
  assert.deepEqual(getMessageSessionTarget({
    direction: "out",
    fromProject: "dashtop",
    fromSession: "",
    toProject: "twicc",
    toSession: "main"
  }), {
    project: "twicc",
    session: "main"
  });
  assert.deepEqual(getMessageSessionTarget({
    direction: "in",
    fromProject: "hawser",
    fromSession: "test",
    toProject: "dashtop",
    toSession: ""
  }), {
    project: "hawser",
    session: "test"
  });
});

test("getTwiccSessionIdFromRefs finds typed Hawser external refs", () => {
  assert.equal(getTwiccSessionIdFromRefs([
    {
      kind: "log-file",
      id: "/tmp/session.log"
    },
    {
      kind: "twicc-session",
      id: "019e9d00-6985-7ce0-b903-ba343e968483"
    }
  ]), "019e9d00-6985-7ce0-b903-ba343e968483");
});

test("addSessionRefsToMessages enriches sent tasks before replies arrive", async () => {
  const messages = await addSessionRefsToMessages([
    {
      direction: "out",
      status: "processing",
      toProject: "twicc",
      toSession: "main",
      twiccSessionId: ""
    }
  ], {}, async (project, session) => {
    assert.equal(project, "twicc");
    assert.equal(session, "main");
    return [
      {
        kind: "twicc-session",
        id: "019e9d00-6985-7ce0-b903-ba343e968483"
      }
    ];
  });

  assert.equal(messages[0].twiccSessionId, "019e9d00-6985-7ce0-b903-ba343e968483");
});

test("shouldShowWidgetMessage keeps read messages with Twicc sessions", () => {
  assert.equal(shouldShowWidgetMessage({
    kind: "reply",
    status: "done",
    twiccSessionId: "019e8578-4195-7553-9d18-1e01bf765656"
  }), true);
  assert.equal(shouldShowWidgetMessage({
    kind: "reply",
    status: "done",
    twiccSessionId: ""
  }), false);
});
