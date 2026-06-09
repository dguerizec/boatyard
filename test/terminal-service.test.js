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
  assert.equal(slugifyTmuxName("Boatyard Main"), "boatyard-main");
  assert.equal(slugifyTmuxName("feature/foo:bar"), "feature-foo-bar");
  assert.equal(slugifyTmuxName("", "fallback"), "fallback");
});

test("getProjectTmuxSessionName derives project session names", () => {
  assert.equal(getProjectTmuxSessionName({
    slug: "boatyard"
  }), "boatyard-boatyard");
  assert.equal(getProjectTmuxSessionName({
    name: "Project Name"
  }), "boatyard-project-name");
});

test("getTerminalClientSessionName derives per-terminal linked session names", () => {
  assert.equal(
    getTerminalClientSessionName("boatyard-project-name", "12345678-90ab-cdef"),
    "boatyard-project-name-client-12345678"
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
