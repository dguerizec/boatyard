"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  filterSettingsSectionIds
} = require(`${process.cwd()}/build/renderer/settingsShell`);

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

test("settings section search returns all categories for an empty query", () => {
  assert.deepEqual(
    filterSettingsSectionIds(sections, ""),
    ["general", "plugins", "about"]
  );
});

test("settings section search matches labels, descriptions, and keywords", () => {
  assert.deepEqual(filterSettingsSectionIds(sections, "plugin"), ["plugins"]);
  assert.deepEqual(filterSettingsSectionIds(sections, "project"), ["general"]);
  assert.deepEqual(filterSettingsSectionIds(sections, "twicc"), ["plugins"]);
  assert.deepEqual(filterSettingsSectionIds(sections, "UPDATE"), ["about"]);
});

export {};
