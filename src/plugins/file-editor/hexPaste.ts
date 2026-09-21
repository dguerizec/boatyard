import type { FileChanges } from "./changes";
import type { FileSnapshot } from "./service";

/** Prepare every affected block before committing a single undoable overwrite. */
export async function pasteFileBytes(changes: FileChanges, base: FileSnapshot, offset: number, replacement: Uint8Array,
  read: (block: number) => Promise<FileSnapshot>, valid: () => boolean = () => true) {
  const version = changes.version, revision = changes.revision;
  const check = () => {
    if (!valid() || changes.version !== version || changes.revision !== revision || changes.saving || changes.conflict) {
      throw new Error("The file changed during paste. Paste again.");
    }
  };
  check();
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + replacement.length > changes.length) throw new Error("Paste must fit inside the file.");
  const positions = changes.viewBlock(base.block!).positions;
  const edits: { snapshot: FileSnapshot; bytes: Uint8Array }[] = [];
  let consumed = 0;
  for (let block = 0; block < positions.length && consumed < replacement.length; block++) {
    const position = positions[block];
    if (position.offset + position.length <= offset + consumed) continue;
    const snapshot = await read(block);
    check();
    if (snapshot.revision !== revision) throw new Error("The file changed on disk. Reload it before pasting.");
    const bytes = changes.apply(snapshot);
    const local = offset + consumed - position.offset;
    const length = Math.min(bytes.length - local, replacement.length - consumed);
    if (local < 0 || length <= 0) throw new Error("The file layout changed. Paste again.");
    bytes.set(replacement.subarray(consumed, consumed + length), local);
    edits.push({ snapshot, bytes }); consumed += length;
  }
  check();
  if (consumed !== replacement.length) throw new Error("Paste must fit inside the file.");
  if (!changes.editMany(edits)) throw new Error("The file is not editable right now.");
}
