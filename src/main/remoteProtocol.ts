export type RemoteViewport = { x: number; y: number; width: number; height: number; revision: number };
export type RemoteModifier = "shift" | "control" | "alt" | "meta";
export type RemoteInput =
  | { kind: "pointer"; action: "move" | "down" | "up" | "wheel"; x: number; y: number; revision: number; button: "left" | "middle" | "right"; deltaX: number; deltaY: number }
  | { kind: "key"; action: "down" | "up"; key: string; modifiers: RemoteModifier[] }
  | { kind: "text"; text: string }
  | { kind: "release" };

export function parseRemoteViewport(value: unknown, width: number, height: number): RemoteViewport {
  const v = value as Partial<RemoteViewport> | null;
  if (!v || ![v.x, v.y, v.width, v.height, v.revision].every(Number.isFinite) ||
      !Number.isSafeInteger(v.revision) || v.revision! < 0 || v.width! < 1 || v.height! < 1) {
    throw new Error("Invalid viewport");
  }
  const w = Math.min(width, v.width!), h = Math.min(height, v.height!);
  return { x: Math.max(0, Math.min(width - w, v.x!)), y: Math.max(0, Math.min(height - h, v.y!)), width: w, height: h, revision: v.revision! };
}

export function parseRemoteInput(value: unknown): RemoteInput {
  if (!value || typeof value !== "object") throw new Error("Invalid input");
  const v = value as Record<string, unknown>;
  if (v.kind === "release") return { kind: "release" };
  if (v.kind === "text" && typeof v.text === "string" && v.text.length > 0 && v.text.length <= 4096) return { kind: "text", text: v.text };
  if (v.kind === "key" && (v.action === "down" || v.action === "up") && typeof v.key === "string" && v.key.length > 0 && v.key.length <= 64 &&
      Array.isArray(v.modifiers) && v.modifiers.length <= 4 && v.modifiers.every(m => ["shift", "control", "alt", "meta"].includes(String(m)))) {
    return { kind: "key", action: v.action, key: v.key, modifiers: v.modifiers as RemoteModifier[] };
  }
  if (v.kind === "pointer" && ["move", "down", "up", "wheel"].includes(String(v.action)) &&
      typeof v.x === "number" && typeof v.y === "number" && Number.isFinite(v.x) && Number.isFinite(v.y) &&
      v.x >= 0 && v.x <= 1 && v.y >= 0 && v.y <= 1 && Number.isSafeInteger(v.revision) &&
      ["left", "middle", "right"].includes(String(v.button)) &&
      typeof v.deltaX === "number" && typeof v.deltaY === "number" && Number.isFinite(v.deltaX) && Number.isFinite(v.deltaY) &&
      Math.abs(v.deltaX) <= 10000 && Math.abs(v.deltaY) <= 10000) {
    return v as unknown as RemoteInput;
  }
  throw new Error("Invalid input");
}

export function remotePoint(view: RemoteViewport, input: Extract<RemoteInput, { kind: "pointer" }>) {
  if (view.revision !== input.revision) throw new Error("Viewport changed");
  return { x: Math.floor(view.x + Math.min(view.width - 1, input.x * view.width)), y: Math.floor(view.y + Math.min(view.height - 1, input.y * view.height)) };
}
