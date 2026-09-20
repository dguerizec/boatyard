import type { FileBlock } from "./blockIndex";
import { byteContent, contentBytes, type ByteEncoding } from "./bytes";
import { imageMimeType, type ImageSnapshot } from "./imageTypes";
import { constants, accessSync, closeSync, existsSync, fstatSync, fchmodSync, openSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, fsyncSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export type FileSnapshot = { path: string; text: string; revision: string; encoding?: ByteEncoding; block?: FileBlock };

export function resolveProjectFile(root: string, file: string): string {
  if (!root || !file || file.includes("\0")) throw new Error("Choose a file inside this project.");
  const base = realpathSync(root);
  const target = realpathSync(resolve(base, file));
  const local = relative(base, target);
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error("The file must be inside this project.");
  }
  return target;
}

/** Absolute paths explicitly opt into external files; project-relative paths stay scoped. */
export function resolveEditorFile(root: string, file: string): string {
  if (!file || file.includes("\0")) throw new Error("Choose a file path.");
  return isAbsolute(file) ? realpathSync(file) : resolveProjectFile(root, file);
}

/** Keep project files relative and external files canonical and absolute. */
export function editorFilePath(root: string, target: string): string {
  const local = relative(realpathSync(root), target);
  return local && local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local) ? local : target;
}

function readFileBytes(target: string, limit: number): Buffer {
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("Only regular files can be opened.");
    if (stats.size > limit) throw new Error(`Files larger than ${limit / 1024 / 1024} MiB are not supported.`);
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    const bytes = buffer.subarray(0, length);
    if (bytes.length > limit) throw new Error(`Files larger than ${limit / 1024 / 1024} MiB are not supported.`);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export function readProjectImage(root: string, file: string): ImageSnapshot {
  const target = resolveEditorFile(root, file);
  const mime = imageMimeType(target);
  if (!mime) throw new Error("This image format is not supported.");
  const bytes = readFileBytes(target, MAX_IMAGE_BYTES);
  return { path: editorFilePath(root, target), dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, size: bytes.length };
}

export function readProjectFile(root: string, file: string): FileSnapshot {
  const target = resolveEditorFile(root, file);
  const bytes = readFileBytes(target, MAX_FILE_BYTES);
  if (bytes.includes(0)) throw new Error("Binary files are not supported.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("Only UTF-8 text files are supported.");
  }
  return { path: editorFilePath(root, target), text, revision: createHash("sha256").update(bytes).digest("hex") };
}

export function readProjectEditableFile(root: string, file: string): FileSnapshot {
  const target = resolveEditorFile(root, file);
  const bytes = readFileBytes(target, MAX_FILE_BYTES);
  return { path: editorFilePath(root, target), ...byteContent(bytes), revision: createHash("sha256").update(bytes).digest("hex") };
}

export function saveProjectFile(root: string, file: string, text: string, revision: string): FileSnapshot {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES || text.includes("\0")) {
    throw new Error("Save requires a UTF-8 text file of at most 2 MiB.");
  }
  // Preserve the text-only API contract for callers that do not request byte editing.
  readProjectFile(root, file);
  return saveProjectBytes(root, file, text, revision);
}

export function saveProjectBytes(root: string, file: string, text: string, revision: string, encoding?: ByteEncoding): FileSnapshot {
  if (typeof text !== "string" || text.length > MAX_FILE_BYTES * 2 || (encoding !== undefined && encoding !== "hex")) {
    throw new Error("Save requires a file of at most 2 MiB.");
  }
  const bytes = contentBytes({ text, encoding });
  if (bytes.length > MAX_FILE_BYTES) throw new Error("Files larger than 2 MiB are not supported.");
  const target = resolveEditorFile(root, file);
  const current = readProjectEditableFile(root, file);
  if (current.revision !== revision) throw new Error("The file changed on disk. Compare or reload it before saving.");
  const stats = statSync(target);
  if (stats.nlink > 1) throw new Error("Saving files with multiple hard links is not supported.");
  accessSync(target, constants.W_OK);
  const temporary = resolve(dirname(target), `.boatyard-editor-${randomUUID()}.tmp`);
  try {
    const descriptor = openSync(temporary, "wx", stats.mode & 0o777);
    try {
      fchmodSync(descriptor, stats.mode & 0o777);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (resolveEditorFile(root, file) !== target || readProjectEditableFile(root, file).revision !== revision) {
      throw new Error("The file changed on disk. Compare or reload it before saving.");
    }
    renameSync(temporary, target);
    return readProjectEditableFile(root, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export type ProjectDirectoryEntry = {
  name: string;
  path: string;
  kind: "directory" | "file" | "unavailable";
};
export type ProjectDirectoryPage = {
  path: string;
  entries: ProjectDirectoryEntry[];
  nextOffset: number | null;
  total: number;
};

/** Read one directory only; avoid recursive scans of large worktrees. */
export async function listProjectDirectory(root: string, directory = "", offset = 0): Promise<ProjectDirectoryPage> {
  const base = realpathSync(root);
  const target = directory === "" || directory === "." ? base : resolveProjectFile(root, directory);
  if (!statSync(target).isDirectory()) throw new Error("Choose a project directory.");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid directory offset.");
  const { opendir } = await import("node:fs/promises");
  const entries: ProjectDirectoryEntry[] = [];
  for await (const entry of await opendir(target)) {
    if (entries.length >= 10000) throw new Error("This directory has more than 10,000 entries. Enter a file path directly to open it.");
    const path = relative(base, resolve(target, entry.name));
    let kind: ProjectDirectoryEntry["kind"] = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "unavailable";
    if (entry.isSymbolicLink()) {
      try {
        const linked = statSync(resolveProjectFile(root, path));
        kind = linked.isDirectory() ? "directory" : linked.isFile() ? "file" : "unavailable";
      } catch { /* Outside-project and broken links stay visible but cannot be opened. */ }
    }
    entries.push({ name: entry.name, path, kind });
  }
  const order = { directory: 0, file: 1, unavailable: 2 };
  entries.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, "en", { numeric: true }) || a.name.localeCompare(b.name));
  const nextOffset = Math.min(entries.length, offset + 200);
  return { path: relative(base, target), entries: entries.slice(offset, nextOffset), nextOffset: nextOffset < entries.length ? nextOffset : null, total: entries.length };
}
