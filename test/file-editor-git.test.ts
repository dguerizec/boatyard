import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { editorGitBaseline, editorGitStatus } from "../src/plugins/file-editor/git";
import { cachedGit } from "../src/plugins/file-editor/gitCache";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "boatyard-git-diff-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }, stdio: "pipe" });
  git("init"); git("config", "user.name", "Editor Test"); git("config", "user.email", "editor@example.test");
  return { root, git, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("Git baselines use HEAD, support staged renames, deletions, and literal unusual paths", async () => {
  const f = await fixture();
  try {
    const name = "file [literal]\nname.txt";
    await writeFile(join(f.root, name), "committed\n");
    await writeFile(join(f.root, "deleted.txt"), "removed\n");
    f.git("add", "--", name, "deleted.txt"); f.git("commit", "-m", "test: create fixture", "-m", "Create Git diff fixtures.");
    await writeFile(join(f.root, name), "staged\n"); f.git("add", "--", name);
    await writeFile(join(f.root, name), "working\n");
    assert.equal((await editorGitBaseline(f.root, name)).text, "committed\n");
    await rm(join(f.root, "deleted.txt"));
    const deleted = await editorGitBaseline(f.root, "deleted.txt");
    assert.equal(deleted.deleted, true); assert.equal(deleted.text, "removed\n");
    await rename(join(f.root, name), join(f.root, "renamed.txt"));
    // Restore the original content so Git recognizes the rename deterministically.
    await writeFile(join(f.root, "renamed.txt"), "committed\n");
    f.git("add", "--", name, "renamed.txt");
    const baseline = await editorGitBaseline(f.root, "renamed.txt");
    assert.equal(baseline.text, "committed\n"); assert.ok(baseline.label.includes(name));
    const status = await editorGitStatus(f.root);
    assert.equal(status.available, true);
    assert.ok(status.changes.some((entry) => entry.path === "deleted.txt" && entry.workingTreeStatus === "D"));
    assert.ok(status.changes.some((entry) => entry.path === "renamed.txt" && entry.indexStatus === "R"));
  } finally { await f.cleanup(); }
});

test("Git handles unborn repositories, subdirectory projects, external files, and unavailable text baselines", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "nested"));
    await writeFile(join(f.root, "nested", "new.txt"), "new\n");
    assert.equal((await editorGitBaseline(f.root, "nested/new.txt")).text, "");
    assert.deepEqual((await editorGitStatus(join(f.root, "nested"))).changes.map((entry) => entry.path), ["new.txt"]);
    await writeFile(join(f.root, "binary"), Buffer.from([0, 255]));
    await writeFile(join(f.root, "large"), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
    f.git("add", "nested/new.txt", "binary", "large"); f.git("commit", "-m", "test: create fixture", "-m", "Create baseline limits.");
    assert.equal((await editorGitBaseline(join(f.root, "nested"), join(f.root, "binary"))).available, false);
    assert.match((await editorGitBaseline(f.root, "large")).reason!, /larger than/);
    assert.equal((await editorGitBaseline(join(f.root, "nested"), "new.txt")).text, "new\n");
    await assert.rejects(editorGitBaseline(join(f.root, "nested"), "../binary"), /inside this project/);
    await rm(join(f.root, "nested"), { recursive: true });
    assert.equal((await editorGitBaseline(f.root, "nested/new.txt")).text, "new\n");
  } finally { await f.cleanup(); }
});

test("non-Git files have an explicit unavailable state", async () => {
  const root = await mkdtemp(join(tmpdir(), "boatyard-no-git-"));
  try {
    await writeFile(join(root, "file.txt"), "plain text");
    assert.equal((await editorGitStatus(root)).available, false);
    assert.equal((await editorGitBaseline(root, "file.txt")).available, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Git requests share pending work and failed reads can retry", async () => {
  let calls = 0;
  const read = async () => { calls++; return "baseline"; };
  assert.deepEqual(await Promise.all([cachedGit("shared-test", read), cachedGit("shared-test", read)]), ["baseline", "baseline"]);
  assert.equal(calls, 1);
  await assert.rejects(cachedGit("retry-test", async () => { throw new Error("temporary"); }));
  assert.equal(await cachedGit("retry-test", read), "baseline");
});
