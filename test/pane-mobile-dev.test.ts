import assert from "node:assert/strict";
import test from "node:test";

const { getMobileDevViewportKey } = require(`${process.cwd()}/build/renderer/paneLayoutView`);

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
