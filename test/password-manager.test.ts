"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getCredentialOrigin } = require(`${process.cwd()}/build/main/passwordManager`);

test("getCredentialOrigin keeps only http and https origins", () => {
  assert.equal(getCredentialOrigin("https://example.com/login?next=/app"), "https://example.com");
  assert.equal(getCredentialOrigin("http://localhost:5173/path"), "http://localhost:5173");
  assert.equal(getCredentialOrigin("file:///tmp/page.html"), "");
  assert.equal(getCredentialOrigin("not a url"), "");
});

export {};
