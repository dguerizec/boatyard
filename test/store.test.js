"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppStore, normalizeBounds, normalizeUrl } = require("../src/main/store");

test("normalizeUrl adds https and rejects unsupported schemes", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com/");
  assert.equal(normalizeUrl("http://example.com/path"), "http://example.com/path");
  assert.throws(() => normalizeUrl("file:///tmp/test.html"), /Only http and https/);
});

test("normalizeBounds clamps dimensions", () => {
  assert.deepEqual(normalizeBounds({ x: -10, y: -4, width: 8, height: 9 }), {
    x: 0,
    y: 0,
    width: 260,
    height: 200
  });
});

test("AppStore persists configured apps", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new AppStore(filePath);

  store.load();
  const state = store.addApp({
    name: "Status",
    url: "status.example.com"
  });

  assert.equal(state.apps.length, 1);
  assert.equal(state.apps[0].name, "Status");
  assert.equal(state.apps[0].url, "https://status.example.com/");

  const reloaded = new AppStore(filePath);
  const reloadedState = reloaded.load();
  assert.deepEqual(reloadedState, state);
});
