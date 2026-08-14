import type {
  LayoutPaneNode,
  WorkspaceLayout
} from "./storeTypes";
import { isRecord, normalizeText, toRecord } from "./storeUtils";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeRatio(value: unknown): number {
  const ratio = Number(value);
  return clamp(Number.isFinite(ratio) ? ratio : 0.5, Number.EPSILON, 1 - Number.EPSILON);
}

function normalizeLayoutPaneNode(
  value: unknown,
  seenIds = new Set<string>()
): LayoutPaneNode | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeText(value.id);
  if (!id || seenIds.has(id)) {
    return null;
  }
  seenIds.add(id);

  if (value.type === "pane") {
    return {
      type: "pane",
      id,
      paneTypeId: normalizeText(value.paneTypeId) || null
    };
  }

  if (value.type !== "split") {
    return null;
  }
  const first = normalizeLayoutPaneNode(value.first, seenIds);
  const second = normalizeLayoutPaneNode(value.second, seenIds);
  if (!first || !second) {
    return null;
  }

  return {
    type: "split",
    id,
    direction: value.direction === "horizontal" ? "horizontal" : "vertical",
    ratio: normalizeRatio(value.ratio),
    first,
    second
  };
}

export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayout | null {
  const source = toRecord(value);
  const id = normalizeText(source.id);
  const name = normalizeText(source.name);
  if (!id || !name) {
    return null;
  }
  const legacyWindow = Array.isArray(source.windows)
    ? toRecord(source.windows[0])
    : {};
  const paneLayout = normalizeLayoutPaneNode(source.paneLayout || legacyWindow.paneLayout);
  return paneLayout ? {
    id,
    name,
    paneLayout,
    projectId: normalizeText(source.projectId) || null
  } : null;
}

export function normalizeWorkspaceLayouts(
  value: unknown,
  validProjectIds?: ReadonlySet<string>
): WorkspaceLayout[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  const layouts: WorkspaceLayout[] = [];
  for (const entry of value) {
    const layout = normalizeWorkspaceLayout(entry);
    if (
      !layout ||
      seenIds.has(layout.id) ||
      (layout.projectId && validProjectIds && !validProjectIds.has(layout.projectId))
    ) {
      continue;
    }
    seenIds.add(layout.id);
    layouts.push(layout);
  }
  return layouts;
}

function pane(id: string, paneTypeId: string | null = null): LayoutPaneNode {
  return { type: "pane", id, paneTypeId };
}

export const BUILT_IN_WORKSPACE_LAYOUTS: WorkspaceLayout[] = [
  {
    id: "boatyard.single-pane",
    name: "Blank — single pane",
    paneLayout: pane("pane-1"),
    projectId: null
  }
];

const BUILT_IN_LAYOUT_IDS = new Set(BUILT_IN_WORKSPACE_LAYOUTS.map((layout) => layout.id));

export function isBuiltInWorkspaceLayoutId(value: unknown): boolean {
  return BUILT_IN_LAYOUT_IDS.has(normalizeText(value));
}

export function listWorkspaceLayouts(
  customLayouts: WorkspaceLayout[],
  projectId: unknown = null
): WorkspaceLayout[] {
  const normalizedProjectId = normalizeText(projectId);
  const projectLayouts = normalizedProjectId
    ? customLayouts.filter((layout) => layout.projectId === normalizedProjectId)
    : [];
  const globalLayouts = customLayouts.filter((layout) => !layout.projectId);
  return structuredClone([
    ...BUILT_IN_WORKSPACE_LAYOUTS.map((layout) => ({ ...layout, builtIn: true })),
    ...projectLayouts
      .filter((layout) => !BUILT_IN_LAYOUT_IDS.has(layout.id))
      .map((layout) => ({ ...layout, builtIn: false })),
    ...globalLayouts
      .filter((layout) => !BUILT_IN_LAYOUT_IDS.has(layout.id))
      .map((layout) => ({ ...layout, builtIn: false }))
  ]);
}
