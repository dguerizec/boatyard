import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { listEditorRoots, resolveEditorRoot } from "../src/plugins/file-editor/roots";
import { activate } from "../src/plugins/file-editor/main";
import type { PluginContext } from "../src/shared/pluginTypes";
import { runBrowserTest } from "./helpers/browser";

const exec = promisify(execFile);

test("editor actions resolve registered worktrees and isolate reads, saves, lists, and Git baselines", async () => {
  const directory = await mkdtemp(join(tmpdir(), "boatyard-editor-roots-"));
  const root = join(directory, "project"), other = join(directory, "feature tree"), plain = join(directory, "plain");
  await mkdir(root); await mkdir(plain);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init"); git("config", "user.name", "Editor Test"); git("config", "user.email", "editor@example.test");
    await writeFile(join(root, "shared.txt"), "main");
    git("add", "shared.txt"); git("commit", "-m", "test: create root fixture", "-m", "Provide a baseline for worktree isolation.");
    git("worktree", "add", "-b", "feature", other);
    await writeFile(join(other, "shared.txt"), "feature");
    await writeFile(join(other, "feature.txt"), "only here");
    const roots = await listEditorRoots(root, exec);
    assert.equal(roots[0].project, true);
    assert.ok(roots.some(entry => entry.path === other && entry.label.includes("feature") && entry.usable));
    assert.equal(await resolveEditorRoot(root, other, exec), other);
    await assert.rejects(resolveEditorRoot(root, plain, exec), /no longer available/);
    assert.deepEqual(await listEditorRoots(plain, exec), [{ path: plain, label: "Project files", usable: true, project: true }]);
    const handlers = new Map<string, (input: Record<string, unknown>) => Promise<any>>();
    activate({
      paths: { pluginData: join(directory, "data") },
      getState: () => ({ projects: [{ id: "project", sourcePath: root }] }),
      execFileAsync: exec,
      actions: { handle: (name: string, handler: (input: Record<string, unknown>) => Promise<any>) => handlers.set(name, handler) }
    } as unknown as PluginContext<{ projects: { id: string; sourcePath: string }[] }>);
    const call = (name: string, input: Record<string, unknown> = {}) => handlers.get(name)!({ projectId: "project", root: other, ...input });
    const snapshot = await call("read", { path: "shared.txt" });
    assert.equal(snapshot.text, "feature");
    await call("save", { path: "shared.txt", text: "saved feature", revision: snapshot.revision });
    assert.equal(await readFile(join(root, "shared.txt"), "utf8"), "main");
    assert.equal(await readFile(join(other, "shared.txt"), "utf8"), "saved feature");
    assert.ok((await call("list")).entries.some((entry: { name: string }) => entry.name === "feature.txt"));
    assert.equal((await call("gitBaseline", { path: "shared.txt" })).text, "main");
    assert.ok((await call("gitStatus")).changes.some((entry: { path: string }) => entry.path === "feature.txt"));
    await assert.rejects(call("save", { root: plain, path: "shared.txt", text: "invalid", revision: snapshot.revision }), /no longer available/);
    await rm(other, { recursive: true });
    assert.equal((await listEditorRoots(root, exec)).find(entry => entry.path === other)?.usable, false);
    await assert.rejects(call("read", { path: "shared.txt" }), /no longer available/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("root selection preserves separate drafts, tabs, and save targets in Electron", t => {
  runBrowserTest(t, "test/fixtures/file-editor-roots.browser.js");
});
