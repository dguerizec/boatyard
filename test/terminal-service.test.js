"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getTerminalClientSessionName,
  getProjectTmuxSessionName,
  parseTerminalEnv,
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

test("getTerminalClientSessionName derives per-terminal linked session names", () => {
  assert.equal(
    getTerminalClientSessionName("dashtop-project-name", "12345678-90ab-cdef"),
    "dashtop-project-name-client-12345678"
  );
});

test("parseTerminalEnv reads shell environment files", () => {
  assert.deepEqual(parseTerminalEnv(`
# comment
SSH_ASKPASS=
SSH_ASKPASS_REQUIRE=never
VALUE=hello world
  `), {
    SSH_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
    VALUE: "hello world"
  });

  assert.throws(
    () => parseTerminalEnv("BAD-NAME=value", "project terminal environment"),
    /Invalid project terminal environment line 1/
  );
});
