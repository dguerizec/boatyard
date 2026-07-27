"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  serializeSettingsState
} = require(`${process.cwd()}/build/renderer/settingsFormController`);

test("settings state serialization detects meaningful form changes", () => {
  const initial = serializeSettingsState({
    projectsBasePath: "/workspace/example",
    enabled: true
  });
  const unchanged = serializeSettingsState({
    projectsBasePath: "/workspace/example",
    enabled: true
  });
  const changed = serializeSettingsState({
    projectsBasePath: "/workspace/projects",
    enabled: true
  });

  assert.equal(initial, unchanged);
  assert.notEqual(initial, changed);
});

test("settings state serialization preserves ordered collection changes", () => {
  const initial = serializeSettingsState([
    { label: "Docs", url: "https://docs.example/" }
  ]);
  const changed = serializeSettingsState([
    { label: "Docs", url: "https://docs.example/" },
    { label: "Status", url: "https://status.example/" }
  ]);

  assert.notEqual(initial, changed);
});

export {};
