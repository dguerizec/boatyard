export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toUnknownRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}
