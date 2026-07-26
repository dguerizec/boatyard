"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getGlobalPluginStatusGroup,
  matchesGlobalPluginFilter
} = require(`${process.cwd()}/build/renderer/globalPluginSettingsFilters`);

test("global plugin statuses collapse into useful filter groups", () => {
  assert.equal(getGlobalPluginStatusGroup("ready"), "ready");
  assert.equal(getGlobalPluginStatusGroup("notConfigured"), "attention");
  assert.equal(getGlobalPluginStatusGroup("degraded"), "attention");
  assert.equal(getGlobalPluginStatusGroup("unavailable"), "error");
  assert.equal(getGlobalPluginStatusGroup("disabled"), "disabled");
});

test("global plugin filtering matches identity, status, and summary", () => {
  const plugin = {
    id: "boatyard.twicc",
    name: "Twicc",
    description: "Twicc integration",
    statusState: "ready",
    statusSummary: "Connected to local service"
  };

  assert.equal(matchesGlobalPluginFilter(plugin, "twicc", "all"), true);
  assert.equal(matchesGlobalPluginFilter(plugin, "local", "ready"), true);
  assert.equal(matchesGlobalPluginFilter(plugin, "", "attention"), false);
  assert.equal(matchesGlobalPluginFilter(plugin, "hawser", "all"), false);
});

export {};
