import assert from "node:assert/strict";
import test from "node:test";

const {
  canReusePaneElement,
  getMobileDevViewportKey
} = require(`${process.cwd()}/build/renderer/paneLayoutView`);

test("mobile viewport state is isolated by pane instance", () => {
  const firstPane = {
    id: "pier:preview",
    key: "project:pane:1:pier:preview",
    url: "https://preview.example.test"
  };
  const secondPane = {
    id: "pier:preview",
    key: "project:pane:2:pier:preview",
    url: "https://preview.example.test"
  };

  assert.notEqual(getMobileDevViewportKey(firstPane), getMobileDevViewportKey(secondPane));
});

test("mobile viewport state remains stable when a pane URL changes", () => {
  assert.equal(getMobileDevViewportKey({
    id: "pier:preview",
    key: "project:pane:1:pier:preview",
    url: "https://first.example.test"
  }), getMobileDevViewportKey({
    id: "pier:preview",
    key: "project:pane:1:pier:preview",
    url: "https://second.example.test"
  }));
});

test("mobile viewport updates rebuild only the targeted pane", () => {
  const state = {
    mobileDev: "true",
    navigation: "null",
    sidePanel: "null",
    webAppId: "pier:preview",
    webAppKind: "",
    webAppMenuSignature: "stable"
  };

  assert.equal(canReusePaneElement(state, state, { forcePaneIds: ["pane-1"] }, "pane-1"), false);
  assert.equal(canReusePaneElement(state, state, { forcePaneIds: ["pane-1"] }, "pane-2"), true);
});
