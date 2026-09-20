import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileChanges, readChangesDraft } from "../src/plugins/file-editor/changes";
import { BLOCK_BYTES, ProjectFileIndex } from "../src/plugins/file-editor/blockIndex";
import { EditorDocument } from "../src/plugins/file-editor/document";
import { contentBytes } from "../src/plugins/file-editor/bytes";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "boatyard-changes-"));
  const text = "a".repeat(BLOCK_BYTES) + "b".repeat(BLOCK_BYTES) + "tail";
  await writeFile(join(root, "file.txt"), text);
  const index = new ProjectFileIndex();
  const snapshots = await Promise.all([0, 1, 2].map((block) => index.read(root, "file.txt", block)));
  const changes = new FileChanges(snapshots[0]);
  const docs = snapshots.map((snapshot, block) => {
    const doc = new EditorDocument(snapshot, {
      read: () => index.read(root, "file.txt", block),
      save: () => { throw new Error("Changes must use a single file-wide save."); },
      rebaseChanges: (path, revision, patches, size) => index.rebaseChanges(root, path, revision, patches, size),
      saveChanges: (path, revision, patches) => index.saveChanges(root, path, revision, patches, block)
    }, undefined, changes);
    doc.connectChanges(); return doc;
  });
  return { root, text, index, changes, docs, snapshots, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("file changesets keep sparse edits across blocks, shift later offsets, and undo globally", async () => {
  const f = await fixture();
  try {
    f.docs[0].edit("😀\n" + f.docs[0].text);
    f.docs[2].edit("TAIL!");
    assert.equal(f.changes.edits.length, 2);
    assert.ok(JSON.stringify(f.changes.draft("file.txt")).length < 500);
    assert.equal(f.changes.blockStart(f.snapshots[1]), BLOCK_BYTES + 5);
    assert.equal(f.changes.length, Buffer.byteLength(f.text) + 6);
    assert.equal(f.changes.viewBlock(f.snapshots[1].block!).line, 2);
    assert.equal(f.changes.viewBlock(f.snapshots[1].block!).totalLines, 2);
    assert.equal(f.changes.history(false), 2);
    assert.equal(f.docs[2].text, "tail");
    assert.equal(f.changes.history(false), 0);
    assert.equal(f.changes.dirty, false);
    assert.equal(f.changes.history(true), 0);
    assert.equal(f.docs[0].text, "😀\n" + f.snapshots[0].text);
    assert.equal(f.changes.history(true), 2);
    const restored = new FileChanges(f.snapshots[0], readChangesDraft(JSON.parse(JSON.stringify(f.changes.draft("file.txt")))));
    assert.deepEqual(restored.apply(f.snapshots[2]), contentBytes({ text: "TAIL!" }));
    await f.docs[2].save();
    assert.equal(await readFile(join(f.root, "file.txt"), "utf8"), "😀\n" + f.text.slice(0, -4) + "TAIL!");
    assert.equal(f.changes.dirty, false);
    assert.equal(f.changes.canUndo, false);
  } finally { await f.cleanup(); }
});

test("file changesets preserve all edits after stale or invalid atomic saves", async () => {
  const f = await fixture();
  try {
    f.docs[0].edit("x" + f.docs[0].text.slice(1));
    f.docs[2].edit("new tail");
    const draft = f.changes.draft("file.txt");
    const invalid = f.changes.edits.map((patch) => ({ ...patch }));
    invalid[1].before = "00";
    await assert.rejects(f.index.saveChanges(f.root, "file.txt", f.changes.revision, invalid), /does not match/);
    assert.equal(await readFile(join(f.root, "file.txt"), "utf8"), f.text);
    assert.deepEqual(await readdir(f.root), ["file.txt"]);
    await writeFile(join(f.root, "file.txt"), "external");
    await f.docs[0].refresh();
    assert.equal(f.changes.conflict, true);
    await f.docs[0].save();
    assert.deepEqual(f.changes.draft("file.txt"), draft);
    assert.equal(await readFile(join(f.root, "file.txt"), "utf8"), "external");
  } finally { await f.cleanup(); }
});

test("changeset validation rejects overlapping ranges and invalid bytes", () => {
  const base = { path: "file.bin", revision: "revision", size: 10 };
  assert.equal(readChangesDraft({ ...base, patches: [{ block: 0, offset: 0, before: "00", after: "zz" }] }), undefined);
  assert.equal(readChangesDraft({ ...base, patches: [
    { block: 0, offset: 0, before: "0000", after: "01" },
    { block: 1, offset: 1, before: "00", after: "02" }
  ] }), undefined);
});


test("keeping a compared changeset rebases touched ranges and preserves unrelated disk edits", async () => {
  const f = await fixture();
  try {
    f.docs[0].edit("x" + f.docs[0].text.slice(1));
    f.docs[2].edit("MINE");
    const external = f.text.slice(0, 100) + "q" + f.text.slice(101, -4) + "DISK";
    await writeFile(join(f.root, "file.txt"), external);
    await f.docs[2].refresh();
    assert.equal(f.docs[2].conflict, true);
    await f.docs[2].keepDraft();
    assert.equal(f.docs[2].conflict, false);
    await f.docs[2].save();
    assert.equal(await readFile(join(f.root, "file.txt"), "utf8"), "x" + external.slice(1, -4) + "MINE");
  } finally { await f.cleanup(); }
});

test("an old block refresh cannot roll back a changeset revision after another pane saves", async () => {
  const f = await fixture();
  try {
    let release!: (value: typeof f.snapshots[0]) => void;
    let first = true;
    const delayed = new EditorDocument(f.snapshots[0], {
      read: () => first ? (first = false, new Promise((resolve) => { release = resolve; })) : f.index.read(f.root, "file.txt", 0),
      save: async () => f.snapshots[0]
    }, undefined, f.changes);
    delayed.connectChanges();
    const refreshing = delayed.refresh();
    f.docs[2].edit("edited tail");
    await f.docs[2].save();
    const revision = f.changes.revision;
    release(f.snapshots[0]);
    await refreshing;
    assert.equal(f.changes.revision, revision);
    assert.equal(f.changes.dirty, false);
    delayed.disconnectChanges();
  } finally { await f.cleanup(); }
});
