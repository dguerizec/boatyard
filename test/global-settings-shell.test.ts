"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  filterGlobalSettingsSectionIds
} = require(`${process.cwd()}/build/renderer/globalSettingsShell`);

const sections = [
  {
    id: "general",
    label: "General",
    description: "Core project defaults.",
    group: "boatyard",
    icon: "sliders",
    keywords: ["base path"],
    elements: []
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Installed extensions.",
    group: "extensions",
    icon: "plug",
    keywords: ["Twicc", "Pier"],
    elements: []
  },
  {
    id: "about",
    label: "About",
    description: "Version and updates.",
    group: "system",
    icon: "info",
    elements: []
  }
];

test("global settings section search returns all categories for an empty query", () => {
  assert.deepEqual(
    filterGlobalSettingsSectionIds(sections, ""),
    ["general", "plugins", "about"]
  );
});

test("global settings section search matches labels, descriptions, and keywords", () => {
  assert.deepEqual(filterGlobalSettingsSectionIds(sections, "plugin"), ["plugins"]);
  assert.deepEqual(filterGlobalSettingsSectionIds(sections, "project"), ["general"]);
  assert.deepEqual(filterGlobalSettingsSectionIds(sections, "twicc"), ["plugins"]);
  assert.deepEqual(filterGlobalSettingsSectionIds(sections, "UPDATE"), ["about"]);
});

export {};
