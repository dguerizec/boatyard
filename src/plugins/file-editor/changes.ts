import { DEFAULT_BLOCK_BYTES, resolveBlockBytes } from "./config";
import type { FileBlock } from "./blockIndex";
import { bytesToHex, contentBytes } from "./bytes";
import type { FileSnapshot } from "./service";

export type FilePatch = { block: number; offset: number; before: string; after: string; endsWithLineBreak?: boolean };
export type FileChangesDraft = { path: string; revision: string; size: number; patches: FilePatch[]; blockBytes?: number };
type Change = { block: number; before?: FilePatch; after?: FilePatch };

/** Sparse replacements in original-file coordinates, shared by all loaded blocks. */
export class FileChanges {
  readonly listeners = new Set<() => void>();
  private patches = new Map<number, FilePatch>();
  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  revision: string;
  diskRevision: string;
  size: number;
  saving = false;
  version = 0;
  readonly blockBytes: number;
  constructor(snapshot: FileSnapshot, draft?: FileChangesDraft) {
    this.blockBytes = snapshot.block?.blockBytes ?? DEFAULT_BLOCK_BYTES;
    this.revision = draft?.revision ?? snapshot.revision;
    this.diskRevision = snapshot.revision;
    this.size = draft?.size ?? snapshot.block!.size;
    if (draft) for (const patch of draft.patches) this.patches.set(patch.block, patch);
  }
  hasBlock(index: number) { return this.patches.has(index); }
  get dirty() { return this.patches.size > 0; }
  get conflict() { return this.dirty && this.revision !== this.diskRevision; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get edits() { return [...this.patches.values()].sort((a, b) => a.offset - b.offset || a.block - b.block); }
  get length() { return this.size + this.edits.reduce((sum, patch) => sum + (patch.after.length - patch.before.length) / 2, 0); }
  notify() { this.version++; for (const listener of this.listeners) listener(); }
  blockStart(snapshot: FileSnapshot) {
    const index = snapshot.block!.index;
    return snapshot.block!.offset + this.edits.filter((patch) => patch.block < index)
      .reduce((sum, patch) => sum + (patch.after.length - patch.before.length) / 2, 0);
  }
  blockOffset(index: number, original: number) {
    return original + this.edits.filter((patch) => patch.block < index)
      .reduce((sum, patch) => sum + (patch.after.length - patch.before.length) / 2, 0);
  }
  apply(snapshot: FileSnapshot): Uint8Array {
    const bytes = contentBytes(snapshot), patch = this.patches.get(snapshot.block!.index);
    if (!patch) return bytes;
    const start = patch.offset - snapshot.block!.offset;
    const replacement = contentBytes({ text: patch.after, encoding: "hex" });
    const removed = patch.before.length / 2;
    if (start < 0 || start + removed > bytes.length) throw new Error("The file size changed. Resolve the changeset conflict before editing.");
    const result = new Uint8Array(bytes.length - removed + replacement.length);
    result.set(bytes.subarray(0, start)); result.set(replacement, start); result.set(bytes.subarray(start + removed), start + replacement.length);
    return result;
  }
  viewBlock(block: FileBlock): FileBlock {
    const measure = (hex: string) => {
      if (block.totalCharacters === 0 && block.size > 0) return { characters: 0, units: 0, lines: 0 };
      try {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(contentBytes({ text: hex, encoding: "hex" }));
        let characters = 0;
        for (let i = 0; i < text.length; i++, characters++) if (text.codePointAt(i)! > 0xffff) i++;
        return { characters, units: text.length, lines: (text.match(/\r\n|\r|\n/g) || []).length };
      } catch { return { characters: 0, units: 0, lines: 0 }; }
    };
    let bytes = 0, characters = 0, units = 0, lines = 0;
    let continuation: boolean | undefined;
    const positions = block.positions.map((position, index) => {
      const patch = this.patches.get(index);
      const before = patch ? measure(patch.before) : { characters: 0, units: 0, lines: 0 };
      const after = patch ? measure(patch.after) : before;
      const byteDelta = patch ? (patch.after.length - patch.before.length) / 2 : 0;
      const result = { ...position, continuation: continuation ?? position.continuation, offset: position.offset + bytes, length: position.length + byteDelta,
        characterOffset: position.characterOffset + characters, utf16Offset: position.utf16Offset + units, line: position.line + lines,
        characters: position.characters + after.characters - before.characters,
        utf16Units: position.utf16Units + after.units - before.units, lineBreaks: position.lineBreaks + after.lines - before.lines };
      continuation = result.length === 0 ? result.continuation : patch?.endsWithLineBreak === undefined ? undefined : !patch.endsWithLineBreak;
      bytes += byteDelta; characters += after.characters - before.characters; units += after.units - before.units; lines += after.lines - before.lines;
      return result;
    });
    return { ...block, ...positions[block.index], positions, size: block.size + bytes,
      totalCharacters: block.totalCharacters + characters, totalUtf16Units: block.totalUtf16Units + units, totalLines: block.totalLines + lines };
  }
  private change(snapshot: FileSnapshot, bytes: Uint8Array): Change | undefined {
    const original = contentBytes(snapshot);
    let start = 0, suffix = 0;
    while (start < original.length && start < bytes.length && original[start] === bytes[start]) start++;
    while (suffix < original.length - start && suffix < bytes.length - start && original[original.length - 1 - suffix] === bytes[bytes.length - 1 - suffix]) suffix++;
    if (snapshot.encoding !== "hex") {
      // Keep textual patch boundaries on code points and outside CRLF pairs.
      while (start > 0 && ((original[start] & 0xc0) === 0x80 || (bytes[start] & 0xc0) === 0x80)) start--;
      while (suffix > 0 && ((original[original.length - suffix] & 0xc0) === 0x80 || (bytes[bytes.length - suffix] & 0xc0) === 0x80)) suffix--;
      if (start > 0 && ((original[start - 1] === 13 && original[start] === 10) || (bytes[start - 1] === 13 && bytes[start] === 10))) start--;
      if (suffix > 0 && ((original[original.length - suffix - 1] === 13 && original[original.length - suffix] === 10)
        || (bytes[bytes.length - suffix - 1] === 13 && bytes[bytes.length - suffix] === 10))) suffix--;
    }
    const block = snapshot.block!.index;
    const before = this.patches.get(block);
    const after = start === original.length && start === bytes.length ? undefined : {
      block, offset: snapshot.block!.offset + start,
      before: bytesToHex(original.subarray(start, original.length - suffix)), after: bytesToHex(bytes.subarray(start, bytes.length - suffix)),
      ...(suffix === 0 ? { endsWithLineBreak: bytes[bytes.length - 1] === 10 || bytes[bytes.length - 1] === 13 } : {})
    };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    return { block, before, after };
  }
  edit(snapshot: FileSnapshot, bytes: Uint8Array) { this.editMany([{ snapshot, bytes }]); }
  /** Validate and prepare the complete transaction before exposing any edits. */
  editMany(edits: { snapshot: FileSnapshot; bytes: Uint8Array }[]) {
    if (this.saving || this.conflict || edits.some(({ snapshot }) => snapshot.revision !== this.revision)) return false;
    const changes = edits.map(({ snapshot, bytes }) => this.change(snapshot, bytes)).filter((change): change is Change => Boolean(change));
    if (!changes.length) return true;
    this.undoStack.push(changes); this.redoStack = [];
    while (this.undoStack.length > 100 || (this.undoStack.length > 1 && JSON.stringify(this.undoStack).length > 16 * 1024 * 1024)) this.undoStack.shift();
    this.applyTransaction(changes, true);
    return true;
  }
  private applyTransaction(changes: Change[], forward: boolean) {
    for (const change of changes) {
      const patch = forward ? change.after : change.before;
      if (patch) this.patches.set(change.block, patch); else this.patches.delete(change.block);
    }
    this.notify();
  }
  history(forward: boolean): number | undefined {
    if (this.saving || this.conflict) return;
    const changes = (forward ? this.redoStack : this.undoStack).pop();
    if (!changes) return;
    (forward ? this.undoStack : this.redoStack).push(changes);
    this.applyTransaction(changes, forward);
    return changes[0].block;
  }
  observe(snapshot: FileSnapshot) {
    this.diskRevision = snapshot.revision;
    if (!this.dirty && this.revision !== snapshot.revision) this.reset(snapshot);
  }
  reset(snapshot: FileSnapshot) {
    this.patches.clear(); this.undoStack = []; this.redoStack = [];
    this.revision = this.diskRevision = snapshot.revision; this.size = snapshot.block!.size;
    this.notify();
  }
  rebase(revision: string, patches: FilePatch[]) {
    this.patches.clear();
    for (const patch of patches) if (patch.before !== patch.after) this.patches.set(patch.block, patch);
    this.revision = this.diskRevision = revision;
    this.undoStack = []; this.redoStack = [];
    this.notify();
  }
  draft(path: string): FileChangesDraft | null {
    return this.dirty ? { path, revision: this.revision, size: this.size, patches: this.edits, blockBytes: this.blockBytes } : null;
  }
}

export function readChangesDraft(value: unknown): FileChangesDraft | undefined {
  const draft = value as FileChangesDraft;
  if (!draft || typeof draft.path !== "string" || typeof draft.revision !== "string" || !Number.isSafeInteger(draft.size) || draft.size < 0 || !Array.isArray(draft.patches)) return;
  try { if (draft.blockBytes !== undefined) resolveBlockBytes(draft); } catch { return; }
  let end = 0;
  const blocks = new Set<number>();
  for (const patch of draft.patches) {
    if (!patch || (patch.endsWithLineBreak !== undefined && typeof patch.endsWithLineBreak !== "boolean") || !Number.isSafeInteger(patch.block) || patch.block < 0 || blocks.has(patch.block)
      || !Number.isSafeInteger(patch.offset) || patch.offset < end || typeof patch.before !== "string" || typeof patch.after !== "string"
      || !/^(?:[a-f\d]{2})*$/i.test(patch.before) || !/^(?:[a-f\d]{2})*$/i.test(patch.after)) return;
    end = patch.offset + patch.before.length / 2;
    if (end > draft.size) return;
    blocks.add(patch.block);
  }
  return draft;
}
