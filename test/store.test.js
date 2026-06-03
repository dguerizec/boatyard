"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ProjectStore, normalizeBounds, normalizeUrl } = require("../src/main/store");

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

test("ProjectStore persists configured projects", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const state = store.addProject({
    name: "Status",
    url: "status.example.com"
  });

  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].name, "Status");
  assert.equal(state.projects[0].url, "https://status.example.com/");

  const reloaded = new ProjectStore(filePath);
  const reloadedState = reloaded.load();
  assert.deepEqual(reloadedState, state);
});

test("ProjectStore persists project updates and removals", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  const store = new ProjectStore(filePath);

  store.load();
  const state = store.addProject({
    name: "Project",
    url: "project.example.test"
  });
  const id = state.projects[0].id;

  const moved = store.updateProject(id, {
    bounds: {
      x: 42,
      y: 24,
      width: 640,
      height: 420
    },
    isOpen: false
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load(), moved);

  const removed = reloaded.removeProject(id);
  const reloadedAgain = new ProjectStore(filePath);
  assert.deepEqual(reloadedAgain.load(), removed);
});

test("ProjectStore migrates legacy apps state to projects", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dashtop-store-"));
  const filePath = path.join(directory, "state.json");
  fs.writeFileSync(filePath, JSON.stringify({
    apps: [{
      id: "legacy-id",
      name: "Legacy",
      url: "legacy.example.test"
    }]
  }));

  const store = new ProjectStore(filePath);
  const state = store.load();

  assert.deepEqual(state.projects.map((project) => project.id), ["legacy-id"]);
  assert.equal(state.projects[0].url, "https://legacy.example.test/");
});
