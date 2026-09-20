import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat, link, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOCK_BYTES, ProjectFileIndex } from "../src/plugins/file-editor/blockIndex";
import { contentBytes } from "../src/plugins/file-editor/bytes";
import { EditorDocument } from "../src/plugins/file-editor/document";
import { blockRows, locateBlock } from "../src/plugins/file-editor/blockNavigation";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "boatyard-index-"));
  const root = join(directory, "project"), cache = join(directory, "cache");
  await mkdir(root);
  return { root, cache, directory, index: new ProjectFileIndex(cache), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("file index preserves UTF-8 boundaries and counts Unicode, UTF-16 and CRLF independently", async () => {
  const f = await fixture();
  try {
    const text = "\uFEFF" + "a".repeat(BLOCK_BYTES - 4) + "😀\r\né\n" + "b".repeat(BLOCK_BYTES) + "\rfin";
    await writeFile(join(f.root, "large.txt"), text);
    const first = await f.index.read(f.root, "large.txt");
    assert.equal(first.encoding, undefined);
    assert.equal(first.block!.count, 3);
    let combined = "", chars = 0, units = 0, breaks = 0, bytes = 0;
    for (let i = 0; i < first.block!.count; i++) {
      const part = await f.index.read(f.root, "large.txt", i);
      const block = part.block!;
      assert.equal(part.encoding, undefined);
      assert.equal(block.offset, bytes);
      assert.equal(block.characterOffset, chars);
      assert.equal(block.utf16Offset, units);
      assert.equal(block.line, breaks + 1);
      assert.equal(block.characters, Array.from(part.text).length);
      assert.equal(block.utf16Units, part.text.length);
      assert.equal(block.lineBreaks, (part.text.match(/\r\n|\r|\n/g) || []).length);
      assert.equal(Buffer.byteLength(part.text), block.length);
      assert.ok(block.length <= BLOCK_BYTES);
      chars += block.characters; units += block.utf16Units; breaks += block.lineBreaks; bytes += block.length;
      combined += part.text;
    }
    assert.equal(combined, text);
    assert.equal(first.block!.totalCharacters, chars);
    assert.equal(first.block!.totalUtf16Units, units);
    assert.equal(first.block!.totalLines, 4);
    assert.equal(units - chars, 1);
    assert.equal(locateBlock(blockRows(first.block!), 1).index, 2);
  } finally { await f.cleanup(); }
});

test("file index never splits CRLF and handles UTF-8 code points at every possible edge", async () => {
  const f = await fixture();
  try {
    for (const character of ["é", "€", "😀", "\r\n"]) for (let overlap = 1; overlap < Buffer.byteLength(character); overlap++) {
      const text = "x".repeat(BLOCK_BYTES - overlap) + character + "end";
      await writeFile(join(f.root, "edge.txt"), text);
      const a = await f.index.read(f.root, "edge.txt");
      const b = await f.index.read(f.root, "edge.txt", 1);
      assert.equal(a.text + b.text, text);
      assert.equal(a.text.endsWith("\r"), false);
      assert.equal(a.encoding, undefined); assert.equal(b.encoding, undefined);
      assert.equal(a.block!.characters + b.block!.characters, Array.from(text).length);
    }
  } finally { await f.cleanup(); }
});

test("metadata cache survives instances, invalidates on changes, and rebuilds malformed entries", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "file.txt"), "one\ntwo");
    const initial = await f.index.read(f.root, "file.txt", 0, true);
    const [name] = await readdir(f.cache), cachedPath = join(f.cache, name);
    const before = await stat(cachedPath, { bigint: true });
    assert.deepEqual(await new ProjectFileIndex(f.cache).read(f.root, "file.txt", 0, true), initial);
    assert.equal((await stat(cachedPath, { bigint: true })).mtimeNs, before.mtimeNs);
    await writeFile(join(f.root, "file.txt"), "three\nfour\nfive");
    const updated = await f.index.read(f.root, "file.txt", 0, true);
    assert.notEqual(updated.revision, initial.revision);
    assert.equal(updated.block!.totalLines, 3);
    const metadata = JSON.parse(await readFile(cachedPath, "utf8"));
    metadata.blocks[0].characters = -1;
    await writeFile(cachedPath, JSON.stringify(metadata));
    assert.deepEqual(await new ProjectFileIndex(f.cache).read(f.root, "file.txt", 0, true), updated);
    assert.equal((await readdir(f.cache)).length, 1);
  } finally { await f.cleanup(); }
});

test("binary indexing covers exact bytes and does not expose partial text metrics", async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.alloc(BLOCK_BYTES * 2 + 57, 65);
    bytes[BLOCK_BYTES + 10] = 255;
    await writeFile(join(f.root, "bytes.bin"), bytes);
    const snapshots = await Promise.all([0, 1, 2].map((block) => f.index.read(f.root, "bytes.bin", block)));
    assert.deepEqual(Buffer.concat(snapshots.map((snapshot) => Buffer.from(contentBytes(snapshot)))), bytes);
    for (const snapshot of snapshots) {
      assert.equal(snapshot.encoding, "hex");
      assert.equal(snapshot.block!.totalCharacters, 0);
      assert.equal(snapshot.block!.totalUtf16Units, 0);
    }
  } finally { await f.cleanup(); }
});

test("block saves stream unchanged ranges, preserve permissions, and reindex size changes", async () => {
  const f = await fixture();
  try {
    const path = join(f.root, "large.txt");
    const text = "a".repeat(BLOCK_BYTES) + "b".repeat(BLOCK_BYTES) + "tail";
    await writeFile(path, text); await chmod(path, 0o740);
    const middle = await f.index.read(f.root, "large.txt", 1);
    const saved = await f.index.save(f.root, "large.txt", 1, middle.revision, "😀\r\n");
    assert.equal(await readFile(path, "utf8"), "a".repeat(BLOCK_BYTES) + "😀\r\ntail");
    assert.equal(saved.text, "😀\r\ntail");
    assert.equal(saved.block!.totalLines, 2);
    assert.equal((await stat(path)).mode & 0o777, 0o740);
    await assert.rejects(f.index.save(f.root, "large.txt", 1, middle.revision, "stale"), /changed on disk/);
    assert.deepEqual(await readdir(f.root), ["large.txt"]);
    const empty = await f.index.save(f.root, "large.txt", 1, saved.revision, "");
    assert.equal(empty.block!.index, 0);
    assert.equal(empty.block!.count, 1);
  } finally { await f.cleanup(); }
});

test("block access rejects escapes, hard links, invalid blocks, and stale revisions", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "file.txt"), "inside");
    await writeFile(join(f.directory, "outside.txt"), "outside");
    await symlink(join(f.directory, "outside.txt"), join(f.root, "escape"));
    await assert.rejects(f.index.read(f.root, "escape"), /inside this project/);
    const snapshot = await f.index.read(f.root, "file.txt", 0, true);
    await assert.rejects(f.index.read(f.root, "file.txt", -1), /Invalid/);
    await assert.rejects(f.index.read(f.root, "file.txt", 1), /no longer exists/);
    await link(join(f.root, "file.txt"), join(f.root, "hard"));
    await assert.rejects(f.index.save(f.root, "file.txt", 0, snapshot.revision, "edited"), /hard links/);
    await writeFile(join(f.root, "file.txt"), "changed");
    await assert.rejects(f.index.save(f.root, "file.txt", 0, snapshot.revision, "stale"), /changed on disk/);
  } finally { await f.cleanup(); }
});

test("empty files and a symlinked project root retain normal file semantics", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "empty.txt"), "");
    await symlink(f.root, join(f.directory, "alias"));
    const snapshot = await f.index.read(join(f.directory, "alias"), "empty.txt", 0, true);
    assert.equal(snapshot.path, "empty.txt");
    assert.equal(snapshot.text, "");
    assert.equal(snapshot.block!.totalLines, 1);
    assert.equal(snapshot.block!.totalCharacters, 0);
    assert.equal(snapshot.block!.count, 1);
  } finally { await f.cleanup(); }
});

test("block documents keep metadata in drafts and adopt reindexed content after save", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "large.txt"), "a".repeat(BLOCK_BYTES) + "tail");
    const first = await f.index.read(f.root, "large.txt");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const document = new EditorDocument(first, {
      read: (path) => f.index.read(f.root, path),
      save: async (path, text, revision, encoding) => { await gate; return f.index.save(f.root, path, 0, revision, text, encoding); }
    });
    document.edit("edited");
    assert.deepEqual(document.draft()!.block, first.block);
    const saving = document.save();
    document.edit("should be blocked");
    assert.equal(document.text, "edited");
    release(); await saving;
    assert.equal(document.text, "editedtail");
    assert.equal(document.dirty, false);
    assert.equal(document.saving, false);
  } finally { await f.cleanup(); }
});
