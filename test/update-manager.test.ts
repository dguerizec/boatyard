"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compareVersions } = require(`${process.cwd()}/build/main/updateManager`);

test("compareVersions compares semantic version parts numerically", () => {
  assert.equal(compareVersions("1.10.0", "1.9.2"), 1);
  assert.equal(compareVersions("1.9.2", "1.10.0"), -1);
  assert.equal(compareVersions("v1.10.0", "1.10.0"), 0);
});

export {};
