/** Loading policy, independent of edit sizes. Resolve once per indexed document. */
export const DEFAULT_BLOCK_BYTES = 5 * 1024 * 1024;
export const LEGACY_BLOCK_BYTES = 2 * 1024 * 1024;
export type FileLoadingOptions = { blockBytes?: number };

export function resolveBlockBytes(options: FileLoadingOptions = {}): number {
  const value = options.blockBytes ?? DEFAULT_BLOCK_BYTES;
  if (!Number.isSafeInteger(value) || value < 4 || value > 64 * 1024 * 1024) throw new Error("Invalid file loading block size.");
  return value;
}
