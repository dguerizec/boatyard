import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, statSync, chmodSync, linkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjectDirectory, readProjectEditableFile, saveProjectBytes, readProjectImage, MAX_IMAGE_BYTES, readProjectFile, saveProjectFile, MAX_FILE_BYTES } from "../src/plugins/file-editor/service";
import { EditorDocument, type FileAccess } from "../src/plugins/file-editor/document";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "boatyard-editor-test-"));
  const root = join(directory, "project");
  mkdirSync(root);
  writeFileSync(join(root, "file.ts"), "const answer = 42;\n");
  return { root, directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("editor saves atomically, preserves BOM, CRLF and file permissions", () => {
  const f = fixture();
  try {
    const path = join(f.root, "file.ts");
    writeFileSync(path, "\uFEFFfirst\r\nsecond\r\n");
    chmodSync(path, 0o764);
    const before = readProjectFile(f.root, "file.ts");
    assert.equal(before.text, "\uFEFFfirst\r\nsecond\r\n");
    const after = saveProjectFile(f.root, "file.ts", before.text.replace("first", "edited"), before.revision);
    assert.equal(readFileSync(path, "utf8"), "\uFEFFedited\r\nsecond\r\n");
    assert.notEqual(after.revision, before.revision);
    assert.equal(statSync(path).mode & 0o777, 0o764);
    assert.deepEqual(readdirSync(f.root), ["file.ts"]);
  } finally { f.cleanup(); }
});

test("editor refuses stale saves and leaves the external version untouched", () => {
  const f = fixture();
  try {
    const before = readProjectFile(f.root, "file.ts");
    writeFileSync(join(f.root, "file.ts"), "external edit");
    assert.throws(() => saveProjectFile(f.root, "file.ts", "my edit", before.revision), /changed on disk/);
    assert.equal(readFileSync(join(f.root, "file.ts"), "utf8"), "external edit");
  } finally { f.cleanup(); }
});

test("editor confines file access to the project, including symlinks", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.directory, "outside"), "private");
    symlinkSync(join(f.directory, "outside"), join(f.root, "escape"));
    for (const path of ["../outside", "escape", f.directory]) {
      assert.throws(() => readProjectFile(f.root, path), /inside this project/);
      assert.throws(() => saveProjectFile(f.root, path, "bad", ""), /inside this project/);
    }
    symlinkSync(join(f.root, "file.ts"), join(f.root, "inside"));
    const file = readProjectFile(f.root, "inside");
    saveProjectFile(f.root, "inside", "safe", file.revision);
    assert.equal(readFileSync(join(f.root, "file.ts"), "utf8"), "safe");
  } finally { f.cleanup(); }
});

test("editor rejects binary, invalid UTF-8, oversized, directory and hard-linked writes", () => {
  const f = fixture();
  try {
    const path = join(f.root, "file.ts");
    for (const [data, error] of [[Buffer.from([0]), /Binary/], [Buffer.from([255]), /UTF-8/], [Buffer.alloc(MAX_FILE_BYTES + 1, 65), /2 MiB/]] as const) {
      writeFileSync(path, data);
      assert.throws(() => readProjectFile(f.root, "file.ts"), error);
    }
    mkdirSync(join(f.root, "sub"));
    assert.throws(() => readProjectFile(f.root, "sub"), /regular files/);
    writeFileSync(path, "text");
    linkSync(path, join(f.root, "hard-link"));
    assert.throws(() => saveProjectFile(f.root, "file.ts", "changed", readProjectFile(f.root, "file.ts").revision), /hard links/);
  } finally { f.cleanup(); }
});

const snapshot = (text: string) => ({ path: "file.ts", text, revision: text });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("external changes reload clean documents but preserve drafts and expose conflicts", async () => {
  let disk = snapshot("initial");
  const access: FileAccess = { read: async () => disk, save: async (_path, text) => snapshot(text) };
  const doc = new EditorDocument(disk, access);
  disk = snapshot("external");
  await doc.refresh();
  assert.equal(doc.text, "external");
  doc.edit("draft");
  disk = snapshot("new external");
  await doc.refresh();
  assert.equal(doc.text, "draft");
  assert.equal(doc.conflict, true);
  await doc.save();
  assert.equal(doc.base.text, "external");
  doc.keepDraft();
  await doc.save();
  assert.equal(doc.base.text, "draft");
  assert.equal(doc.dirty, false);
});

test("typing during a disk read or save survives asynchronous completion", async () => {
  const read = deferred<ReturnType<typeof snapshot>>();
  const save = deferred<ReturnType<typeof snapshot>>();
  const doc = new EditorDocument(snapshot("initial"), { read: () => read.promise, save: () => save.promise });
  const refreshing = doc.refresh();
  doc.edit("typing");
  read.resolve(snapshot("external"));
  await refreshing;
  assert.equal(doc.text, "typing");
  assert.equal(doc.conflict, true);
  doc.keepDraft();
  const saving = doc.save();
  doc.edit("more typing");
  save.resolve(snapshot("typing"));
  await saving;
  assert.equal(doc.text, "more typing");
  assert.equal(doc.base.text, "typing");
  assert.equal(doc.dirty, true);
});

test("restored drafts compare against their original revision and can use the disk version", () => {
  const access: FileAccess = { read: async () => snapshot("disk"), save: async () => snapshot("saved") };
  const doc = new EditorDocument(snapshot("disk"), access, { ...snapshot("draft"), revision: "original", baseText: "original" });
  assert.equal(doc.conflict, true);
  assert.equal(doc.text, "draft");
  doc.useDisk();
  assert.equal(doc.text, "disk");
  assert.equal(doc.draft(), null);
  const alreadySaved = new EditorDocument(snapshot("draft"), access, { ...snapshot("draft"), revision: "original", baseText: "original" });
  assert.equal(alreadySaved.dirty, false);
  assert.equal(alreadySaved.conflict, false);
});

test("failed reads and writes retain editable drafts and report the error", async () => {
  const doc = new EditorDocument(snapshot("initial"), {
    read: async () => { throw new Error("File missing"); },
    save: async () => { throw new Error("Permission denied"); }
  });
  doc.edit("keep me");
  await doc.refresh();
  assert.equal(doc.error, "File missing");
  await doc.save();
  assert.equal(doc.error, "Permission denied");
  assert.equal(doc.text, "keep me");
  assert.equal(doc.draft()?.text, "keep me");
});


test("a save requested during a background read waits instead of being dropped", async () => {
  const read = deferred<ReturnType<typeof snapshot>>();
  let saved = "";
  const doc = new EditorDocument(snapshot("initial"), {
    read: () => read.promise,
    save: async (_path, text) => { saved = text; return snapshot(text); }
  });
  doc.edit("draft");
  const refreshing = doc.refresh();
  const saving = doc.save();
  read.resolve(snapshot("initial"));
  await Promise.all([refreshing, saving]);
  assert.equal(saved, "draft");
  assert.equal(doc.dirty, false);
});


test("project browser lists directories first, including hidden files, without recursing", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "docs"));
    writeFileSync(join(f.root, ".gitignore"), "build/");
    writeFileSync(join(f.root, "docs", "readme.md"), "# Docs");
    const root = await listProjectDirectory(f.root);
    assert.deepEqual(root.entries.map((entry) => [entry.name, entry.kind]), [["docs", "directory"], [".gitignore", "file"], ["file.ts", "file"]]);
    assert.equal(root.nextOffset, null);
    const docs = await listProjectDirectory(f.root, "docs");
    assert.deepEqual(docs.entries, [{ name: "readme.md", path: join("docs", "readme.md"), kind: "file" }]);
    await assert.rejects(listProjectDirectory(f.root, "file.ts"), /directory/);
  } finally { f.cleanup(); }
});

test("project browser blocks traversal and outside links while allowing in-project directories", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "docs"));
    symlinkSync(f.directory, join(f.root, "outside"));
    symlinkSync(join(f.root, "missing"), join(f.root, "broken"));
    symlinkSync(join(f.root, "docs"), join(f.root, "inside"));
    const page = await listProjectDirectory(f.root);
    assert.equal(page.entries.find((entry) => entry.name === "outside")?.kind, "unavailable");
    assert.equal(page.entries.find((entry) => entry.name === "broken")?.kind, "unavailable");
    assert.equal(page.entries.find((entry) => entry.name === "inside")?.kind, "directory");
    assert.equal((await listProjectDirectory(f.root, "inside")).total, 0);
    await assert.rejects(listProjectDirectory(f.root, "../"), /inside this project/);
    await assert.rejects(listProjectDirectory(f.root, "outside"), /inside this project/);
  } finally { f.cleanup(); }
});

test("project browser paginates large folders without dropping entries", async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 220; index++) writeFileSync(join(f.root, `item-${index}.txt`), "");
    const first = await listProjectDirectory(f.root);
    assert.equal(first.entries.length, 200);
    assert.equal(first.total, 221);
    assert.equal(first.nextOffset, 200);
    const second = await listProjectDirectory(f.root, "", first.nextOffset!);
    assert.equal(second.entries.length, 21);
    assert.equal(second.nextOffset, null);
    assert.equal(new Set([...first.entries, ...second.entries].map((entry) => entry.path)).size, 221);
    await assert.rejects(listProjectDirectory(f.root, "", -1), /offset/);
  } finally { f.cleanup(); }
});


test("image reads preserve bytes and enforce project boundaries and size limits", () => {
  const f = fixture();
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64");
    writeFileSync(join(f.root, "pixel.PNG"), png);
    const image = readProjectImage(f.root, "pixel.PNG");
    assert.equal(image.path, "pixel.PNG");
    assert.equal(image.size, png.length);
    assert.equal(image.dataUrl, `data:image/png;base64,${png.toString("base64")}`);
    writeFileSync(join(f.directory, "outside.png"), png);
    symlinkSync(join(f.directory, "outside.png"), join(f.root, "escape.png"));
    assert.throws(() => readProjectImage(f.root, "escape.png"), /inside this project/);
    assert.throws(() => readProjectImage(f.root, "../outside.png"), /inside this project/);
    assert.throws(() => readProjectImage(f.root, "file.ts"), /format is not supported/);
    mkdirSync(join(f.root, "folder.png"));
    assert.throws(() => readProjectImage(f.root, "folder.png"), /regular files/);
    writeFileSync(join(f.root, "large.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1));
    assert.throws(() => readProjectImage(f.root, "large.png"), /20 MiB/);
  } finally { f.cleanup(); }
});

test("hex edits preserve arbitrary bytes, BOM and CRLF and use revision-checked saves", async () => {
  const f = fixture();
  try {
    const original = Buffer.from([0xef, 0xbb, 0xbf, 65, 13, 10, 0, 255]);
    writeFileSync(join(f.root, "bytes.bin"), original);
    const first = readProjectEditableFile(f.root, "bytes.bin");
    assert.equal(first.encoding, "hex");
    assert.equal(first.text, original.toString("hex"));
    const next = saveProjectBytes(f.root, "bytes.bin", "efbbbf420d0a00ff", first.revision, "hex");
    assert.deepEqual(readFileSync(join(f.root, "bytes.bin")), Buffer.from([0xef, 0xbb, 0xbf, 66, 13, 10, 0, 255]));
    assert.throws(() => saveProjectBytes(f.root, "bytes.bin", "ff", first.revision, "hex"), /changed on disk/);
    assert.throws(() => saveProjectBytes(f.root, "bytes.bin", "0xz", next.revision, "hex"), /Invalid hexadecimal/);
    symlinkSync(join(f.directory, "outside.bin"), join(f.root, "escape.bin"));
    writeFileSync(join(f.directory, "outside.bin"), original);
    assert.throws(() => saveProjectBytes(f.root, "escape.bin", "ff", next.revision, "hex"), /inside this project/);
  } finally { f.cleanup(); }
});

test("text and hex share a draft and survive binary edits, restoration and undo", () => {
  const base = { path: "file.md", text: "\uFEFFHello\r\n", revision: "original" };
  const access: FileAccess = { read: async () => base, save: async () => base };
  const doc = new EditorDocument(base, access);
  const original = doc.bytes;
  const binary = original.slice();
  binary[3] = 255;
  doc.editBytes(binary);
  assert.equal(doc.encoding, "hex");
  assert.equal(doc.dirty, true);
  const restored = new EditorDocument(base, access, doc.draft()!);
  assert.deepEqual(restored.bytes, binary);
  assert.equal(restored.conflict, false);
  restored.editBytes(original);
  assert.equal(restored.encoding, undefined);
  assert.equal(restored.text, base.text);
  assert.equal(restored.dirty, false);
});
