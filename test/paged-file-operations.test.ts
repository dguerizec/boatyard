import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFileIndex } from "../src/plugins/file-editor/blockIndex";
import { DEFAULT_BLOCK_BYTES } from "../src/plugins/file-editor/config";
import { EditorDocument } from "../src/plugins/file-editor/document";
import { FileChanges } from "../src/plugins/file-editor/changes";
import { pasteFileBytes } from "../src/plugins/file-editor/hexPaste";
import { byteContent, contentBytes } from "../src/plugins/file-editor/bytes";
import { editorText, findInFile, lineInFile, type PagedTextSource } from "../src/plugins/file-editor/pagedText";

const source = (parts: string[]): PagedTextSource => ({ count: parts.length, read: async (i) => parts[i], valid: () => true });
test("full-file literal search crosses multiple fragments, wraps, and searches backward", async () => {
  const text = source(["hello ab", "C", "d hello ABCD end"]);
  assert.deepEqual(await findInFile(text, "abcd", { block: 0, offset: 0 }), { from: { block: 0, offset: 6 }, to: { block: 2, offset: 1 } });
  assert.deepEqual(await findInFile(text, "ABCD", { block: 1, offset: 0 }, false, true), { from: { block: 2, offset: 8 }, to: { block: 2, offset: 12 } });
  assert.deepEqual((await findInFile(text, "abcd", { block: 0, offset: 0 }, true))?.from, { block: 2, offset: 8 });
  assert.deepEqual((await findInFile(text, "abcd", { block: 2, offset: 8 }, true))?.from, { block: 0, offset: 6 });
  assert.deepEqual((await findInFile(text, "abcd", { block: 2, offset: 13 }))?.from, { block: 0, offset: 6 });
  assert.equal(await findInFile(text, ".*", { block: 0, offset: 0 }), undefined);
  assert.deepEqual((await findInFile(source(["é😀", "café"]), "😀ca", { block: 0, offset: 0 }))?.from, { block: 0, offset: 1 });
  assert.deepEqual((await findInFile(source(["aaa", "aa"]), "aaa", { block: 0, offset: 1 }))?.from, { block: 0, offset: 1 });
  assert.equal(editorText("\uFEFFone\r\ntwo\r\n", 0), "one\ntwo\n");
});
test("line navigation joins long line fragments and uses indexed line starts", async () => {
  const text = source(["one\nlo", "ng line\ntwo\n", "three"]);
  assert.deepEqual(await lineInFile(text, 2), { block: 0, offset: 4 });
  assert.deepEqual(await lineInFile(text, 3), { block: 1, offset: 8 });
  assert.deepEqual(await lineInFile(text, 4), { block: 2, offset: 0 });
  assert.deepEqual(await lineInFile(source(["one\n", "", "two"]), 2), { block: 2, offset: 0 });
  assert.deepEqual(await lineInFile(source(["", "two"]), 1), { block: 1, offset: 0 });
  const reads: number[] = [];
  text.lines = [{ line: 1, continuation: false }, { line: 2, continuation: true }, { line: 4, continuation: false }];
  const read = text.read; text.read = (i) => { reads.push(i); return read(i); };
  assert.deepEqual(await lineInFile(text, 4), { block: 2, offset: 0 });
  assert.deepEqual(reads, [2]);
  reads.length = 0;
  assert.deepEqual(await lineInFile(text, 2), { block: 0, offset: 4 });
  assert.deepEqual(reads, [0]);
});
test("pending global operations reject changed document versions", async () => {
  let valid = true;
  const text = source(["one", "two"]);
  text.valid = () => valid;
  text.read = async () => { valid = false; return "one"; };
  await assert.rejects(findInFile(text, "one", { block: 0, offset: 0 }), /document changed/);
  valid = true;
  await assert.rejects(lineInFile(text, 2), /document changed/);
});
test("loading size is configurable, invalidates cached layouts, and does not cap edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "boatyard-policy-"));
  try {
    assert.equal(DEFAULT_BLOCK_BYTES, 5 * 1024 * 1024);
    const cache = join(root, "cache");
    await writeFile(join(root, "file.txt"), "a".repeat(48));
    const first = new ProjectFileIndex(cache, { blockBytes: 16 });
    const a = await first.read(root, "file.txt");
    const second = new ProjectFileIndex(cache, { blockBytes: 32 });
    const b = await second.read(root, "file.txt");
    assert.equal(a.block!.count, 3); assert.equal(b.block!.count, 2);
    assert.equal(a.revision, b.revision);
    assert.equal(b.block!.blockBytes, 32);
    await first.save(root, "file.txt", 0, a.revision, "b".repeat(100));
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "b".repeat(100) + "a".repeat(32));
    assert.throws(() => new ProjectFileIndex(cache, { blockBytes: 0 }), /Invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("hex overwrite spans blocks with drafts and one undo, and leaves no partial edits on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "boatyard-paste-"));
  try {
    const index = new ProjectFileIndex(undefined, { blockBytes: 8 });
    const original = "abcdefghijklmnopqrstuvwx";
    await writeFile(join(root, "file.txt"), original);
    const read = (i: number) => index.read(root, "file.txt", i, true);
    const base = await read(0), changes = new FileChanges(base);
    changes.edit(base, contentBytes({ text: "++" + base.text }));
    const draft = changes.draft("file.txt");
    const replacement = contentBytes({ text: "0123456789ABC" });
    await pasteFileBytes(changes, base, 8, replacement, read);
    const combined = async () => {
      let result = "";
      for (let i = 0; i < 3; i++) result += byteContent(changes.apply(await read(i))).text;
      return result;
    };
    assert.equal(await combined(), ("++" + original).slice(0, 8) + "0123456789ABC" + ("++" + original).slice(21));
    assert.equal(changes.history(false), 0);
    assert.deepEqual(changes.draft("file.txt"), draft);
    changes.history(true);
    const pasted = changes.draft("file.txt");
    await assert.rejects(pasteFileBytes(changes, base, 7, replacement, async (i) => {
      if (i === 1) throw new Error("read failed"); return read(i);
    }), /read failed/);
    assert.deepEqual(changes.draft("file.txt"), pasted);
    await assert.rejects(pasteFileBytes(changes, base, 20, replacement, read), /fit inside/);
    assert.deepEqual(changes.draft("file.txt"), pasted);
    assert.equal(pasted!.blockBytes, 8);
    let calls = 0;
    await assert.rejects(pasteFileBytes(changes, base, 7, replacement, read, () => ++calls < 3), /changed during paste/);
    assert.deepEqual(changes.draft("file.txt"), pasted);
    const expected = await combined();
    await index.saveChanges(root, "file.txt", changes.revision, changes.edits);
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a complete document can grow beyond loading size, save, and continue as a paged changeset", async () => {
  const root = await mkdtemp(join(tmpdir(), "boatyard-grow-"));
  try {
    const index = new ProjectFileIndex(undefined, { blockBytes: 8 });
    await writeFile(join(root, "file.txt"), "small");
    const base = await index.read(root, "file.txt");
    assert.equal(base.block, undefined);
    const doc = new EditorDocument(base, {
      read: path => index.read(root, path),
      save: (path, text, revision, encoding) => index.save(root, path, 0, revision, text, encoding),
      saveChanges: (path, revision, patches) => index.saveChanges(root, path, revision, patches)
    });
    doc.edit("larger than a single loading block");
    await doc.save();
    assert.equal(doc.error, "");
    assert.equal(doc.base.block!.count, 5);
    assert.equal(doc.text, "larger t");
    assert.ok(doc.changes);
    assert.equal(doc.dirty, false);
    doc.edit("LARGER t");
    assert.ok(doc.changes.dirty);
    await doc.save();
    assert.equal(await readFile(join(root, "file.txt"), "utf8"), "LARGER than a single loading block");
    doc.disconnectChanges();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("draft line metadata follows removal of a newline at a loading boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "boatyard-line-edge-"));
  try {
    const index = new ProjectFileIndex(undefined, { blockBytes: 8 });
    await writeFile(join(root, "file.txt"), "one\nabc\nsecond\n");
    const first = await index.read(root, "file.txt");
    const second = await index.read(root, "file.txt", 1);
    const changes = new FileChanges(first);
    changes.edit(first, contentBytes({ text: "one\nabc" }));
    const block = changes.viewBlock(first.block!);
    assert.equal(block.positions[1].continuation, true);
    const stream = source(["one\nabc", second.text]); stream.lines = block.positions;
    assert.deepEqual(await lineInFile(stream, 2), { block: 0, offset: 4 });
    changes.history(false);
    assert.equal(changes.viewBlock(first.block!).positions[1].continuation, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
