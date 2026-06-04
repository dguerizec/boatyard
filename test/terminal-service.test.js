"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getProjectTmuxSessionName,
  slugifyTmuxName
} = require("../src/main/terminalService");

test("slugifyTmuxName keeps tmux target names stable", () => {
  assert.equal(slugifyTmuxName("DashTop Main"), "dashtop-main");
  assert.equal(slugifyTmuxName("feature/foo:bar"), "feature-foo-bar");
  assert.equal(slugifyTmuxName("", "fallback"), "fallback");
});

test("getProjectTmuxSessionName derives project session names", () => {
  assert.equal(getProjectTmuxSessionName({
    slug: "dashtop"
  }), "dashtop-dashtop");
  assert.equal(getProjectTmuxSessionName({
    name: "Project Name"
  }), "dashtop-project-name");
});
