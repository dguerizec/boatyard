export const HUGESCREEN_EDGES = ["top", "right", "bottom", "left"] as const;
export type HugescreenEdgeName = typeof HUGESCREEN_EDGES[number];
export type HugescreenZones = Record<HugescreenEdgeName, number>;
export const DEFAULT_HUGESCREEN_ZONES: HugescreenZones = { top: 3, right: 3, bottom: 3, left: 3 };
export const MAX_HUGESCREEN_ZONE = 200;

export function normalizeHugescreenZones(value: unknown): HugescreenZones {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const zones = { ...DEFAULT_HUGESCREEN_ZONES };
  for (const edge of HUGESCREEN_EDGES) {
    const size = source[edge];
    if (typeof size === "number" && Number.isFinite(size)) zones[edge] = Math.max(1, Math.min(MAX_HUGESCREEN_ZONE, Math.round(size)));
  }
  return zones;
}

export function parseHugescreenZones(value: unknown): HugescreenZones {
  if (!value || typeof value !== "object" || HUGESCREEN_EDGES.some(edge => {
    const size = (value as Record<string, unknown>)[edge];
    return typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_HUGESCREEN_ZONE;
  })) throw new Error(`Each edge zone must be between 1 and ${MAX_HUGESCREEN_ZONE} pixels.`);
  return normalizeHugescreenZones(value);
}

/** Keep an interior region and move the pointer out of the zones after a half-screen step. */
export function effectiveHugescreenZones(zones: HugescreenZones, width: number, height: number): HugescreenZones {
  return { top: Math.min(zones.top, height / 4), bottom: Math.min(zones.bottom, height / 4),
    left: Math.min(zones.left, width / 4), right: Math.min(zones.right, width / 4) };
}
