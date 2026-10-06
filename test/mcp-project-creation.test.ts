import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMcpProject, rejectProjectCreation, type ProjectCreationContext, type ProjectCreationReceipt } from "../src/main/mcpProjectCreation.js";
import { ProjectStore } from "../src/main/store.js";

const contextId = "0123456789abcdef";
const input = { contextId, name: "Example", directory: "example" };
const twiccReply = { id: "example-project", url: "https://twicc.example/project/example-project", matchType: "exact" };
function isolatedContext(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-mcp-project-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "state.json");
  const root = path.join(directory, "projects");
  fs.mkdirSync(root);
  const store = new ProjectStore(filePath);
  store.load();
  store.updateSettings({ projectsBasePath: root });
  const context: ProjectCreationContext = {
    store, twiccEnabled: false, createTwiccProject: async () => assert.fail("Unexpected TwiCC mutation")
  };
  return { store, filePath, root, context };
}
function code(result: ProjectCreationReceipt) { return "code" in result ? result.code : undefined; }

test("MCP project creation creates bounded directories, persists domain defaults and returns safe identity", async (t) => {
  const { context, store, filePath, root } = isolatedContext(t);
  const before = store.getState();
  const result = await createMcpProject({ ...input, name: " Éxample ", group: " Team ", directory: "team/example" }, () => context);
  assert.equal(result.status, "created");
  if (result.status !== "created") return;
  assert.deepEqual(result, {
    status: "created", contextId,
    project: { id: result.project.id, name: "Éxample", slug: "example", group: "Team", isOpen: true },
    attemptedCount: 1, confirmedCount: 1, directory: { status: "created", createdCount: 2 },
    twicc: { status: "skipped", attemptedCount: 0, confirmedCount: 0 }
  });
  const state = new ProjectStore(filePath).load();
  assert.equal(state.projects[0].sourcePath, path.join(root, "team/example"));
  assert.equal(fs.statSync(state.projects[0].sourcePath).isDirectory(), true);
  assert.deepEqual(state.projectHugescreen[result.project.id], { widthMultiplier: 1, heightMultiplier: 1, panMode: "continuous", enabled: false });
  for (const key of ["navigation", "paneLayouts", "plugins", "webApps", "pluginConfig"] as const) {
    assert.deepEqual(state[key], before[key], `${key} is not activated by project creation`);
  }
});

test("schema refuses missing fields, traversal, overlong values and privileged fields before resolution", async () => {
  let resolutions = 0;
  const invalid = [
    {}, { contextId, name: "Example" }, { ...input, name: " " }, { ...input, name: "!" },
    { ...input, name: "a".repeat(161) }, { ...input, name: "a".repeat(81) }, { ...input, name: "line\nbreak" },
    { ...input, contextId: "/workspace/config" }, { ...input, slug: "Not canonical" },
    { ...input, slug: "a".repeat(81) }, { ...input, group: "g".repeat(161) },
    ...["/absolute", "../escape", ".", "child/..", "a//b", "a/./b", "a\\b", "a/", "", "a\nb", "a:"].map((directory) => ({ ...input, directory })),
    { ...input, directory: "p".repeat(2049) }, { ...input, directory: Array(17).fill("child").join("/") },
    { ...input, pluginConfig: { gmail: {} } }, { ...input, id: "chosen-id" }, { ...input, isOpen: false },
    { ...input, sourcePath: "/workspace/example" }, { ...input, terminalEnv: "SECRET=value" },
    { ...input, createTwiccProject: "yes" }, { ...input, reuse: "true" }
  ];
  for (const values of invalid) {
    assert.deepEqual(await createMcpProject(values, () => { resolutions += 1; return undefined; }), rejectProjectCreation("INVALID_PROJECT_INPUT"));
  }
  assert.equal(resolutions, 0);
});

test("exact context isolation and an available configured projects root are mandatory", async (t) => {
  const first = isolatedContext(t);
  const second = isolatedContext(t);
  const resolve = (id: string) => id === contextId ? first.context : id === "fedcba9876543210" ? second.context : undefined;
  assert.deepEqual(await createMcpProject({ ...input, contextId: "aaaaaaaaaaaaaaaa" }, resolve), rejectProjectCreation("CONTEXT_NOT_AVAILABLE"));
  assert.equal((await createMcpProject(input, resolve)).status, "created");
  assert.equal((await createMcpProject({ ...input, contextId: "fedcba9876543210" }, resolve)).status, "created");
  assert.equal(first.store.getState().projects.length, 1);
  assert.equal(second.store.getState().projects.length, 1);
  for (const root of ["", "/", "relative", path.join(first.root, "missing")]) {
    first.store.updateSettings({ projectsBasePath: root });
    assert.equal(code(await createMcpProject({ ...input, name: "Other" }, resolve)), "PROJECTS_ROOT_NOT_AVAILABLE");
  }
});

test("existing directories need explicit reuse and cannot bypass existing-project duplicate guards", async (t) => {
  const { root, context, store } = isolatedContext(t);
  const target = path.join(root, "example");
  fs.mkdirSync(target);
  assert.deepEqual(await createMcpProject(input, () => context), rejectProjectCreation("DIRECTORY_ALREADY_EXISTS"));
  assert.equal(store.getState().projects.length, 0);
  const result = await createMcpProject({ ...input, reuse: true }, () => context);
  assert.equal(result.status, "created");
  assert.deepEqual(result.directory, { status: "existing", createdCount: 0 });
  assert.equal(code(await createMcpProject({ ...input, name: "Different", reuse: true }, () => context)), "DUPLICATE_SOURCE_PATH");
  assert.equal(code(await createMcpProject({ ...input, directory: "fresh", slug: "other", reuse: true, name: " EXAMPLE " }, () => context)), "DUPLICATE_PROJECT_NAME");
  assert.equal(code(await createMcpProject({ ...input, directory: "fresh", name: "Different", slug: "example" }, () => context)), "DUPLICATE_PROJECT_SLUG");
  assert.equal(fs.existsSync(path.join(root, "fresh")), false, "duplicate refusal creates no directory");
  assert.equal(store.getState().projects.length, 1);
});

test("symlink escapes, root aliases and files are refused before any directory or project creation", async (t) => {
  const { root, context, store } = isolatedContext(t);
  const outside = path.dirname(root);
  fs.symlinkSync(outside, path.join(root, "escape"));
  fs.symlinkSync(root, path.join(root, "self"));
  fs.writeFileSync(path.join(root, "file"), "contents");
  for (const [directory, expected] of [
    ["escape/new", "DIRECTORY_OUTSIDE_PROJECTS_ROOT"], ["self", "DIRECTORY_OUTSIDE_PROJECTS_ROOT"],
    ["file", "DIRECTORY_NOT_AVAILABLE"]
  ]) {
    assert.equal(code(await createMcpProject({ ...input, directory, reuse: true }, () => context)), expected);
  }
  assert.equal(fs.existsSync(path.join(outside, "new")), false);
  assert.equal(store.getState().projects.length, 0);
});

test("in-tree aliases resolve canonically and duplicate detection sees the same source directory", async (t) => {
  const { root, context } = isolatedContext(t);
  fs.mkdirSync(path.join(root, "real"));
  fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"));
  assert.equal((await createMcpProject({ ...input, directory: "alias", reuse: true }, () => context)).status, "created");
  assert.equal(code(await createMcpProject({ ...input, name: "Other", directory: "real", reuse: true }, () => context)), "DUPLICATE_SOURCE_PATH");
});

test("preflight read errors are sanitized with zero effects", async () => {
  assert.deepEqual(await createMcpProject(input, () => { throw new Error("SECRET private config"); }), rejectProjectCreation("PROJECT_READ_FAILED"));
});

test("directory creation errors report remaining partial effects without attempting the domain mutation", async (t) => {
  const { context, root, store } = isolatedContext(t);
  const original = fs.mkdirSync;
  let attempts = 0;
  t.mock.method(fs, "mkdirSync", (...args: Parameters<typeof fs.mkdirSync>) => {
    attempts += 1;
    if (attempts === 2) throw new Error("SECRET private path");
    return original(...args);
  });
  const result = await createMcpProject({ ...input, directory: "parent/child" }, () => context);
  assert.equal(code(result), "DIRECTORY_CREATION_UNCERTAIN");
  assert.equal(result.status, "partial");
  assert.equal(result.attemptedCount, 0);
  assert.deepEqual(result.directory, { status: "unknown", createdCount: 1 });
  assert.equal(fs.existsSync(path.join(root, "parent")), true);
  assert.equal(store.getState().projects.length, 0);
  assert.equal(attempts, 2, "no replay or cleanup rollback");
});

test("persistence failures after domain mutation are unknown without retry or rollback", async (t) => {
  const { context, store } = isolatedContext(t);
  let attempts = 0;
  store.save = () => { attempts += 1; throw new Error("SECRET private path"); };
  const result = await createMcpProject(input, () => context);
  assert.equal(code(result), "PROJECT_CREATION_UNCERTAIN");
  assert.equal(result.status, "unknown");
  assert.equal(result.attemptedCount, 1);
  assert.equal(result.confirmedCount, 0);
  assert.deepEqual(result.directory, { status: "created", createdCount: 1 });
  assert.equal(attempts, 1);
  assert.equal(store.getState().projects.length, 1);
});

test("a directory appearing after preflight cannot silently bypass reuse", async (t) => {
  const { context, root, store } = isolatedContext(t);
  const target = path.join(root, "parent/child");
  const original = fs.mkdirSync;
  t.mock.method(fs, "mkdirSync", (...args: Parameters<typeof fs.mkdirSync>) => {
    const result = original(...args);
    if (args[0] === path.dirname(target)) original(target);
    return result;
  });
  const result = await createMcpProject({ ...input, directory: "parent/child" }, () => context);
  assert.equal(code(result), "DIRECTORY_CREATION_UNCERTAIN");
  assert.equal(result.attemptedCount, 0);
  assert.equal(store.getState().projects.length, 0);
});

test("an unexpected domain receipt stops without TwiCC creation or replay", async (t) => {
  const { context, store } = isolatedContext(t);
  context.twiccEnabled = true;
  let attempts = 0;
  store.addProject = () => { attempts += 1; return store.getState(); };
  const result = await createMcpProject(input, () => context);
  assert.equal(code(result), "PROJECT_CREATION_UNCERTAIN");
  assert.equal(result.twicc.status, "not_attempted");
  assert.equal(attempts, 1);
});

test("TwiCC auto follows enabled state, explicit false skips it, and explicit true cannot enable it", async (t) => {
  for (const setting of [undefined, "auto", false, true] as const) {
    const { context, store, root } = isolatedContext(t);
    let calls = 0;
    context.createTwiccProject = async () => { calls += 1; return twiccReply; };
    const values = { ...input, createTwiccProject: setting };
    if (setting === true) {
      assert.equal(code(await createMcpProject(values, () => context)), "TWICC_NOT_AVAILABLE");
      assert.equal(fs.existsSync(path.join(root, "example")), false);
      continue;
    }
    assert.equal((await createMcpProject(values, () => context)).twicc.status, "skipped");
    assert.equal(calls, 0);
    assert.equal(store.getState().projects.length, 1);
  }
  for (const setting of [undefined, "auto", true, false] as const) {
    const { context, store, root } = isolatedContext(t);
    context.twiccEnabled = true;
    let calls = 0;
    context.createTwiccProject = async (values) => {
      calls += 1;
      assert.deepEqual(values, {
        name: input.name, sourcePath: path.join(root, input.directory),
        trust: true, propagateTrust: true, allowCliFallback: false
      });
      return twiccReply;
    };
    const result = await createMcpProject({ ...input, createTwiccProject: setting }, () => context);
    assert.equal(result.status, "created");
    assert.equal(calls, setting === false ? 0 : 1);
    if (result.status === "created" && setting !== false) {
      assert.deepEqual(result.twicc, { status: "created", projectId: "example-project", attemptedCount: 1, confirmedCount: 1 });
      assert.equal(store.getState().pluginConfig.projects[result.project.id]["boatyard.twicc"].twiccProjectUrl, twiccReply.url);
    }
  }
});

test("TwiCC failures and unsafe replies preserve the Boatyard project and return partial uncertainty", async (t) => {
  for (const reply of [null, { ...twiccReply, matchType: "parent" }, { ...twiccReply, url: "https://user:SECRET@twicc.example/project/p" }, { ...twiccReply, url: "https://twicc.example/project/p?token=SECRET" }]) {
    const { context, store } = isolatedContext(t);
    context.twiccEnabled = true;
    let calls = 0;
    context.createTwiccProject = async () => { calls += 1; if (reply === null) throw new Error("SECRET"); return reply; };
    const result = await createMcpProject(input, () => context);
    assert.equal(code(result), "TWICC_CREATION_UNCERTAIN");
    assert.equal(result.confirmedCount, 1);
    assert.deepEqual(result.twicc, { status: "unknown", attemptedCount: 1, confirmedCount: 0 });
    assert.equal(store.getState().projects.length, 1);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes("SECRET"), false);
  }
});

test("known TwiCC name limits are checked before local writes without restricting Boatyard-only creation", async (t) => {
  const { context, root, store } = isolatedContext(t);
  context.twiccEnabled = true;
  const values = { ...input, name: "a".repeat(26) };
  assert.equal(code(await createMcpProject(values, () => context)), "TWICC_NAME_TOO_LONG");
  assert.equal(fs.existsSync(path.join(root, input.directory)), false);
  assert.equal(store.getState().projects.length, 0);
  assert.equal((await createMcpProject({ ...values, createTwiccProject: false }, () => context)).status, "created");
});

test("UI changes during TwiCC creation are preserved and duplicate concurrent requests are refused", async (t) => {
  const { context, store } = isolatedContext(t);
  context.twiccEnabled = true;
  let finish!: (reply: unknown) => void;
  let calls = 0;
  context.createTwiccProject = () => { calls += 1; return new Promise((resolve) => { finish = resolve; }); };
  const pending = createMcpProject(input, () => context);
  const project = store.getState().projects[0];
  assert.equal(code(await createMcpProject(input, () => context)), "DUPLICATE_PROJECT_SLUG");
  store.updateProjectPluginConfig(project.id, "boatyard.twicc", { twiccProjectUrl: "https://twicc.example/project/user-choice" });
  finish(twiccReply);
  const result = await pending;
  assert.equal(code(result), "TWICC_LINK_CHANGED");
  assert.equal(result.twicc.confirmedCount, 1);
  assert.equal(store.getState().pluginConfig.projects[project.id]["boatyard.twicc"].twiccProjectUrl, "https://twicc.example/project/user-choice");
  assert.equal(calls, 1);
});

test("TwiCC link persistence failure acknowledges backend creation independently", async (t) => {
  const { context, store } = isolatedContext(t);
  context.twiccEnabled = true;
  context.createTwiccProject = async () => twiccReply;
  store.updateProjectPluginConfig = () => { throw new Error("SECRET write failure"); };
  const result = await createMcpProject(input, () => context);
  assert.equal(code(result), "TWICC_LINK_UNCERTAIN");
  assert.equal(result.confirmedCount, 1);
  assert.equal(result.twicc.confirmedCount, 1);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});
