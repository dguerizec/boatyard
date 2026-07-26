"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  serializeGlobalSettingsState
} = require(`${process.cwd()}/build/renderer/globalSettingsFormController`);

test("global settings state serialization detects meaningful form changes", () => {
  const initial = serializeGlobalSettingsState({
    projectsBasePath: "/workspace/example",
    enabled: true
  });
  const unchanged = serializeGlobalSettingsState({
    projectsBasePath: "/workspace/example",
    enabled: true
  });
  const changed = serializeGlobalSettingsState({
    projectsBasePath: "/workspace/projects",
    enabled: true
  });

  assert.equal(initial, unchanged);
  assert.notEqual(initial, changed);
});

test("global settings state serialization preserves ordered collection changes", () => {
  const initial = serializeGlobalSettingsState([
    { label: "Docs", url: "https://docs.example/" }
  ]);
  const changed = serializeGlobalSettingsState([
    { label: "Docs", url: "https://docs.example/" },
    { label: "Status", url: "https://status.example/" }
  ]);

  assert.notEqual(initial, changed);
});

export {};
