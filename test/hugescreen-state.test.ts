import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HugescreenPreferences } from "../src/main/hugescreenPreferences.js";
import { ProjectStore } from "../src/main/store.js";
import { HugescreenOperationQueue, migrateHugescreenZones, normalizeHugescreenState } from "../src/main/hugescreenState.js";

const state = { widthMultiplier: 1.5, heightMultiplier: 2, panMode: "edge" as const, enabled: false };
const zones = { left: 20, right: 3, top: 40, bottom: 5 };

test("Hugescreen snapshots validate all fields and omit machine zones and native offsets", () => {
  assert.deepEqual(normalizeHugescreenState({ ...state, zones, x: -400 }), state);
  for (const invalid of [undefined, {}, { ...state, enabled: undefined }, { ...state, panMode: "unknown" },
    { ...state, widthMultiplier: Infinity }, { ...state, heightMultiplier: 0 }]) {
    assert.equal(normalizeHugescreenState(invalid), undefined);
  }
  assert.equal(normalizeHugescreenState({ ...state, widthMultiplier: 0.7 })?.widthMultiplier, 0.7);
});

test("edge zones migrate deterministically and explicit local preferences take precedence", () => {
  const legacy = { workspaceSession: { windows: {
    z: { window: { hugescreenEdgeZones: { ...zones, left: 90 } } },
    a: { window: { hugescreenEdgeZones: zones } }
  } } };
  assert.deepEqual(migrateHugescreenZones(legacy), zones);
  assert.deepEqual(migrateHugescreenZones({ ...legacy, hugescreenEdgeZones: { ...zones, top: 9 } }), { ...zones, top: 9 });
  assert.deepEqual(migrateHugescreenZones({ ...legacy, window: { hugescreenEdgeZones: { ...zones, top: 8 } } }), { ...zones, top: 8 });
});

test("project working states and both layout scopes persist independently across restarts", t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-hugescreen-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  writeFileSync(file, JSON.stringify({ projects: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    window: { hugescreenEdgeZones: zones } }));
  const store = new ProjectStore(file);
  store.load();
  assert.equal(store.getProjectHugescreen("a"), undefined, "legacy projects do not gain resizing data");
  assert.deepEqual(store.getLegacyHugescreenZones(), zones);
  store.updateProjectHugescreen("a", state);
  for (const projectId of [null, "a"]) {
    store.saveLayout({ id: projectId || "global", name: "Snapshot", projectId,
      paneLayout: { type: "pane", id: "pane", paneTypeId: null }, hugescreen: { ...state, edgeZones: zones } });
  }
  store.saveLayout({ id: "legacy", name: "Legacy", paneLayout: { type: "pane", id: "pane", paneTypeId: null } });
  store.updateProjectHugescreen("a", { ...state, widthMultiplier: 3, enabled: true });
  store.updateProjectHugescreen("b", { ...state, panMode: "continuous" });

  const reloaded = new ProjectStore(file);
  reloaded.load();
  assert.equal(reloaded.getProjectHugescreen("a")?.widthMultiplier, 3);
  assert.equal(reloaded.getProjectHugescreen("b")?.panMode, "continuous");
  for (const id of ["a", "global"]) assert.deepEqual(reloaded.listLayouts("a").find(layout => layout.id === id)?.hugescreen, state);
  assert.equal(reloaded.listLayouts().find(layout => layout.id === "legacy")?.hugescreen, undefined);
  reloaded.removeProject("b");
  assert.equal(reloaded.getProjectHugescreen("b"), undefined);

});

test("bulk Hugescreen apply persists independent copies without changing layouts or future projects", t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-hugescreen-bulk-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  writeFileSync(file, JSON.stringify({ projects: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }));
  const store = new ProjectStore(file);
  store.load();
  store.updateProjectHugescreen("a", { ...state, widthMultiplier: 3 });
  const layout = store.saveLayout({ name: "Saved", paneLayout: { type: "pane", id: "pane" }, hugescreen: state });
  const paneLayouts = store.getState().paneLayouts;
  const applied = { ...state, widthMultiplier: 2.5, enabled: true };
  store.applyHugescreenToAllProjects(applied);
  assert.throws(() => store.applyHugescreenToAllProjects({}), /Invalid Hugescreen/);
  const reloaded = new ProjectStore(file);
  reloaded.load();
  for (const id of ["a", "b", "__global__"]) assert.deepEqual(reloaded.getProjectHugescreen(id), applied);
  assert.deepEqual(reloaded.listLayouts().find(entry => entry.id === layout.id)?.hugescreen, state);
  assert.deepEqual(reloaded.getState().paneLayouts, paneLayouts);
  reloaded.updateProjectHugescreen("a", state);
  assert.deepEqual(reloaded.getProjectHugescreen("b"), applied);
  const added = reloaded.addProject({ name: "New", sourcePath: "/workspace/new" }).projects.at(-1)!;
  assert.equal(reloaded.getProjectHugescreen(added.id), undefined);
});

test("native operations stay ordered across asynchronous transitions and recover after errors", async () => {
  const queue = new HugescreenOperationQueue();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let owner = "a";
  const writes: string[] = [];
  const resize = queue.run(async () => { await blocked; writes.push(owner); });
  const navigation = queue.run(() => { owner = "b"; });
  await Promise.resolve();
  assert.equal(owner, "a");
  release();
  await Promise.all([resize, navigation]);
  assert.deepEqual(writes, ["a"]);
  await assert.rejects(queue.run(() => { throw new Error("transition failed"); }));
  assert.equal(await queue.run(() => owner), "b");
});

test("machine edge preferences migrate once and remain shared across profiles", t => {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-hugescreen-preferences-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "hugescreen.json");
  const preferences = new HugescreenPreferences(file);
  assert.deepEqual(preferences.getZones(zones), zones);
  assert.deepEqual(preferences.getZones({ ...zones, left: 99 }), zones, "another profile cannot remigrate the preference");
  preferences.setZones({ ...zones, left: 12 });
  assert.equal(new HugescreenPreferences(file).getZones(zones).left, 12);
});
