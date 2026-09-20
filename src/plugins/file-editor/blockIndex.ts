import { readChangesDraft, type FilePatch } from "./changes";
import { constants } from "node:fs";
import { access, open, stat, mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { byteContent, bytesToHex, contentBytes, type ByteEncoding } from "./bytes";
import { MAX_FILE_BYTES, resolveEditorFile, editorFilePath, type FileSnapshot } from "./service";

export const BLOCK_BYTES = MAX_FILE_BYTES;
export type BlockPosition = {
  offset: number; length: number; line: number; continuation: boolean;
  characterOffset: number; characters: number; utf16Offset: number; utf16Units: number; lineBreaks: number;
};
type Entry = BlockPosition & { hash: string };
type Index = { version: 2; signature: string; size: number; revision: string; binary: boolean; blocks: Entry[] };
export type FileBlock = BlockPosition & {
  index: number; count: number; size: number; totalCharacters: number; totalUtf16Units: number; totalLines: number;
  positions: BlockPosition[];
};
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const signature = (value: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }) =>
  [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");

/** Cache metadata only. Scans and saves keep at most a few blocks in memory. */
export class ProjectFileIndex {
  private indexes = new Map<string, Index>();
  private pending = new Map<string, Promise<Index>>();
  constructor(private cacheDirectory?: string) {}
  private cachePath(path: string) { return this.cacheDirectory && join(this.cacheDirectory, `${digest(Buffer.from(path))}.json`); }
  private remember(path: string, index: Index) {
    this.indexes.delete(path);
    this.indexes.set(path, index);
    while (this.indexes.size > 64) this.indexes.delete(this.indexes.keys().next().value!);
  }
  private valid(value: Index, expected: string): boolean {
    if (!value || value.version !== 2 || value.signature !== expected || !Number.isSafeInteger(value.size) || value.size < 0
      || typeof value.binary !== "boolean" || !/^[a-f0-9]{64}$/.test(value.revision) || !Array.isArray(value.blocks) || !value.blocks.length) return false;
    let end = 0, characters = 0, units = 0, line = 1;
    for (const block of value.blocks) {
      if (block.offset !== end || !Number.isSafeInteger(block.length) || block.length < 0 || block.length > BLOCK_BYTES
        || (block.length === 0 && value.size !== 0) || !Number.isSafeInteger(block.line) || block.line < 1
        || block.characterOffset !== characters || block.utf16Offset !== units || block.line !== line
        || ![block.characters, block.utf16Units, block.lineBreaks].every((count) => Number.isSafeInteger(count) && count >= 0)
        || block.characters > block.utf16Units || block.utf16Units > block.length || block.lineBreaks > block.characters
        || typeof block.continuation !== "boolean" || !/^[a-f0-9]{64}$/.test(block.hash)) return false;
      end += block.length; characters += block.characters; units += block.utf16Units; line += block.lineBreaks;
    }
    return end === value.size;
  }
  private async get(path: string, force = false): Promise<Index> {
    const stats = await stat(path, { bigint: true });
    if (!stats.isFile()) throw new Error("Only regular files can be opened.");
    if (stats.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("This file is too large to index safely.");
    const expected = signature(stats);
    const cached = this.indexes.get(path);
    if (!force && cached?.signature === expected) { this.remember(path, cached); return cached; }
    const pending = this.pending.get(path);
    if (pending) { await pending; return this.get(path, force); }
    const task = (async () => {
      const cachePath = this.cachePath(path);
      if (!force && cachePath) {
        try {
          const value = JSON.parse(await readFile(cachePath, "utf8")) as Index;
          if (this.valid(value, expected)) { this.remember(path, value); return value; }
        } catch { /* Missing or obsolete caches are rebuilt. */ }
      }
      const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const before = await file.stat({ bigint: true });
        if (!before.isFile() || signature(before) !== expected) throw new Error("The file changed while indexing. Open it again.");
        const size = Number(before.size);
        const buffer = Buffer.alloc(BLOCK_BYTES + 4);
        const hash = createHash("sha256");
        const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
        const blocks: Entry[] = [];
        let offset = 0, line = 1, characterOffset = 0, utf16Offset = 0, previous = 10, binary = false;
        do {
          const wanted = Math.min(buffer.length, size - offset);
          let received = 0;
          while (received < wanted) {
            const { bytesRead } = await file.read(buffer, received, wanted - received, offset + received);
            if (!bytesRead) throw new Error("The file changed while indexing. Open it again.");
            received += bytesRead;
          }
          let length = Math.min(BLOCK_BYTES, received);
          if (offset + length < size) {
            // Avoid splitting UTF-8 code points or CRLF, including very long lines.
            let boundary = length;
            while (boundary > length - 3 && (buffer[boundary] & 0xc0) === 0x80) boundary--;
            if ((buffer[boundary] & 0xc0) !== 0x80) length = boundary;
            if (buffer[length - 1] === 13 && buffer[length] === 10) length--;
          }
          const bytes = buffer.subarray(0, length);
          hash.update(bytes);
          let characters = 0, utf16Units = 0, lineBreaks = 0;
          if (!binary) {
            try {
              const text = decoder.decode(bytes);
              if (bytes.includes(0)) binary = true;
              else {
                utf16Units = text.length;
                for (let i = 0; i < text.length; i++, characters++) {
                  if (text.codePointAt(i)! > 0xffff) i++;
                }
                for (let i = 0; i < text.length; i++) {
                  if (text[i] === "\n" || (text[i] === "\r" && text[i + 1] !== "\n")) lineBreaks++;
                }
              }
            } catch { binary = true; }
          }
          blocks.push({ offset, length, line, continuation: offset > 0 && previous !== 10 && previous !== 13,
            characterOffset, characters, utf16Offset, utf16Units, lineBreaks, hash: digest(bytes) });
          line += lineBreaks; characterOffset += characters; utf16Offset += utf16Units;
          previous = bytes[length - 1] ?? previous;
          offset += length;
        } while (offset < size);
        if (binary) for (const block of blocks) {
          block.line = 1; block.characterOffset = block.characters = block.utf16Offset = block.utf16Units = block.lineBreaks = 0;
        }
        if (signature(await file.stat({ bigint: true })) !== expected || signature(await stat(path, { bigint: true })) !== expected) {
          throw new Error("The file changed while indexing. Open it again.");
        }
        const index: Index = { version: 2, signature: expected, size, revision: hash.digest("hex"), binary, blocks };
        this.remember(path, index);
        if (cachePath) {
          const temporary = `${cachePath}.${randomUUID()}.tmp`;
          try {
            await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
            await writeFile(temporary, JSON.stringify(index), { mode: 0o600 });
            await rename(temporary, cachePath);
          } catch { /* File access remains available when cache storage is unavailable. */ }
          finally { await unlink(temporary).catch(() => {}); }
        }
        return index;
      } finally { await file.close(); }
    })();
    this.pending.set(path, task);
    try { return await task; } finally { if (this.pending.get(path) === task) this.pending.delete(path); }
  }

  async read(root: string, path: string, blockIndex = 0, forceBlock = false): Promise<FileSnapshot> {
    if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) throw new Error("Invalid file block.");
    const target = resolveEditorFile(root, path);
    const index = await this.get(target);
    const block = index.blocks[blockIndex];
    if (!block) throw new Error("This block no longer exists. Open the file again.");
    const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      if (signature(await file.stat({ bigint: true })) !== index.signature) throw new Error("The file changed while reading. Open it again.");
      bytes = Buffer.alloc(block.length);
      let received = 0;
      while (received < bytes.length) {
        const { bytesRead } = await file.read(bytes, received, bytes.length - received, block.offset + received);
        if (!bytesRead) break;
        received += bytesRead;
      }
      if (received !== bytes.length || digest(bytes) !== block.hash || signature(await file.stat({ bigint: true })) !== index.signature
        || resolveEditorFile(root, path) !== target || signature(await stat(target, { bigint: true })) !== index.signature) {
        this.indexes.delete(target);
        await this.get(target, true);
        throw new Error("The file changed while reading. Open it again.");
      }
    } finally { await file.close(); }
    const positions = index.blocks.map(({ hash: _hash, ...position }) => position);
    return {
      path: editorFilePath(root, target),
      ...(index.binary ? { text: bytesToHex(bytes), encoding: "hex" as const } : byteContent(bytes)),
      revision: index.revision,
      ...(index.blocks.length > 1 || forceBlock ? { block: {
        ...positions[blockIndex],
        index: blockIndex, count: index.blocks.length, size: index.size,
        totalCharacters: index.blocks.reduce((sum, entry) => sum + entry.characters, 0),
        totalUtf16Units: index.blocks.reduce((sum, entry) => sum + entry.utf16Units, 0),
        totalLines: 1 + index.blocks.reduce((sum, entry) => sum + entry.lineBreaks, 0),
        positions
      } } : {})
    };
  }

  async save(root: string, path: string, blockIndex: number, revision: string, text: string, encoding?: ByteEncoding): Promise<FileSnapshot> {
    if (!Number.isSafeInteger(blockIndex) || blockIndex < 0 || typeof text !== "string" || text.length > BLOCK_BYTES * 4
      || (encoding !== undefined && encoding !== "hex")) throw new Error("Invalid block edit.");
    const replacement = contentBytes({ text, encoding });
    if (replacement.length > BLOCK_BYTES * 2) throw new Error("An edited block can contain at most 4 MiB. Save before adding more text.");
    const target = resolveEditorFile(root, path);
    const index = await this.get(target);
    const block = index.blocks[blockIndex];
    if (index.revision !== revision || !block) throw new Error("The file changed on disk. Compare or reload it before saving.");
    const snapshot = await this.read(root, path, blockIndex, true);
    return this.saveChanges(root, path, revision, [{ block: blockIndex, offset: block.offset,
      before: bytesToHex(contentBytes(snapshot)), after: bytesToHex(replacement) }], blockIndex);
  }

  async rebaseChanges(root: string, path: string, revision: string, patches: FilePatch[], size: number): Promise<FilePatch[]> {
    const target = resolveEditorFile(root, path);
    const index = await this.get(target);
    if (index.revision !== revision || index.size !== size) throw new Error("The file changed size or revision. Compare it again before keeping the changeset.");
    if (!readChangesDraft({ path, revision, size, patches })) throw new Error("Invalid file changeset.");
    const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const result: FilePatch[] = [];
      for (const patch of patches) {
        const block = index.blocks[patch.block];
        if (!block || patch.offset < block.offset || patch.offset + patch.before.length / 2 > block.offset + block.length) {
          throw new Error("The indexed boundaries changed. Reload the file before rebasing the changeset.");
        }
        const bytes = Buffer.alloc(patch.before.length / 2);
        let received = 0;
        while (received < bytes.length) {
          const { bytesRead } = await file.read(bytes, received, bytes.length - received, patch.offset + received);
          if (!bytesRead) throw new Error("The file changed while comparing the changeset.");
          received += bytesRead;
        }
        result.push({ ...patch, before: bytesToHex(bytes) });
      }
      if (signature(await file.stat({ bigint: true })) !== index.signature || resolveEditorFile(root, path) !== target
        || signature(await stat(target, { bigint: true })) !== index.signature) throw new Error("The file changed while comparing the changeset.");
      return result;
    } finally { await file.close(); }
  }

  async saveChanges(root: string, path: string, revision: string, patches: FilePatch[], blockIndex = 0): Promise<FileSnapshot> {
    const target = resolveEditorFile(root, path);
    const index = await this.get(target);
    if (index.revision !== revision) throw new Error("The file changed on disk. Compare or reload it before saving.");
    if (!readChangesDraft({ path, revision, size: index.size, patches }) || !Number.isSafeInteger(blockIndex) || blockIndex < 0) throw new Error("Invalid file changeset.");
    await access(target, constants.W_OK);
    const input = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
    const temporary = join(dirname(target), `.boatyard-editor-${randomUUID()}.tmp`);
    try {
      const before = await input.stat({ bigint: true });
      if (signature(before) !== index.signature || !before.isFile()) throw new Error("The file changed on disk. Reload it before saving.");
      if (before.nlink > 1n) throw new Error("Saving files with multiple hard links is not supported.");
      const output = await open(temporary, "wx", Number(before.mode & 0o777n));
      try {
        await output.chmod(Number(before.mode & 0o777n));
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(BLOCK_BYTES);
        async function writeAll(bytes: Uint8Array) {
          let written = 0;
          while (written < bytes.length) {
            const result = await output.write(bytes, written, bytes.length - written);
            if (!result.bytesWritten) throw new Error("Could not write the edited file.");
            written += result.bytesWritten;
          }
        }
        async function copy(start: number, end: number, write: boolean, expected?: Uint8Array) {
          for (let position = start; position < end;) {
            const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, end - position), position);
            if (!bytesRead) throw new Error("The file changed during save.");
            const bytes = buffer.subarray(0, bytesRead);
            if (expected && !bytes.equals(expected.subarray(position - start, position - start + bytesRead))) {
              throw new Error("The changeset does not match the original file. Reload it before saving.");
            }
            hash.update(bytes);
            if (write) await writeAll(bytes);
            position += bytesRead;
          }
        }
        let position = 0;
        for (const patch of patches) {
          await copy(position, patch.offset, true);
          await copy(patch.offset, patch.offset + patch.before.length / 2, false, contentBytes({ text: patch.before, encoding: "hex" }));
          await writeAll(contentBytes({ text: patch.after, encoding: "hex" }));
          position = patch.offset + patch.before.length / 2;
        }
        await copy(position, index.size, true);
        if (hash.digest("hex") !== revision || signature(await input.stat({ bigint: true })) !== index.signature
          || resolveEditorFile(root, path) !== target || signature(await stat(target, { bigint: true })) !== index.signature) {
          throw new Error("The file changed during save. Compare or reload it before saving.");
        }
        await output.sync();
      } finally { await output.close(); }
      if (resolveEditorFile(root, path) !== target || signature(await stat(target, { bigint: true })) !== index.signature) {
        throw new Error("The file changed during save. Compare or reload it before saving.");
      }
      await rename(temporary, target);
      this.indexes.delete(target);
      const updated = await this.get(target);
      return this.read(root, path, Math.min(blockIndex, updated.blocks.length - 1), true);
    } finally {
      await input.close();
      await unlink(temporary).catch(() => {});
    }
  }
}
