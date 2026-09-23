import { toRecord } from "./storeUtils";
import { normalizeHugescreenZones, type HugescreenZones } from "../renderer/hugescreenZones.js";

import type { HugescreenState } from "../renderer/hugescreenState.js";
export type { HugescreenState } from "../renderer/hugescreenState.js";

export function normalizeHugescreenState(value: unknown): HugescreenState | undefined {
  const state = toRecord(value);
  const { widthMultiplier, heightMultiplier, panMode, enabled } = state;
  // Ordinary windows can be smaller than one screen; snapshots must preserve that too.
  if (typeof widthMultiplier !== "number" || !Number.isFinite(widthMultiplier) || widthMultiplier <= 0 ||
      typeof heightMultiplier !== "number" || !Number.isFinite(heightMultiplier) || heightMultiplier <= 0 ||
      (panMode !== "continuous" && panMode !== "edge") || typeof enabled !== "boolean") return undefined;
  return { widthMultiplier, heightMultiplier, panMode, enabled };
}

export function normalizeProjectHugescreenStates(value: unknown, projectIds: ReadonlySet<string>) {
  const result: Record<string, HugescreenState> = {};
  for (const [id, raw] of Object.entries(toRecord(value))) {
    const state = normalizeHugescreenState(raw);
    if (state && (id === "__global__" || projectIds.has(id))) result[id] = state;
  }
  return result;
}

/** Local session preferences win; legacy conflicts resolve in stable window ID order. */
export function migrateHugescreenZones(value: unknown): HugescreenZones {
  const source = toRecord(value);
  const windows = toRecord(toRecord(source.workspaceSession).windows);
  const legacy = toRecord(source.window).hugescreenEdgeZones ?? Object.keys(windows).sort()
    .map(id => toRecord(toRecord(windows[id]).window).hugescreenEdgeZones).find(Boolean);
  return normalizeHugescreenZones(source.hugescreenEdgeZones ?? legacy);
}

/** Keep native transitions and navigation atomic with respect to other IPC requests. */
export class HugescreenOperationQueue {
  private pending: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }
}
