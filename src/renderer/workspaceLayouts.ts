import type { RendererPaneLayoutNode, RendererPaneNode } from "./rendererTypes.js";
import type {
  WorkspaceLayout,
  WorkspaceLayoutPaneNode,
  WorkspaceLayoutPreviewMetrics
} from "./rendererTypes.js";

type RuntimePaneTypeResolver = (pane: RendererPaneNode) => string | null | undefined;
type PaneTypeInstantiationResolver = (paneTypeId: string, paneId: string) => string | null | undefined;
type RuntimePaneSelectionResolver = (pane: RendererPaneNode) => string | null | undefined;

type WorkspaceLayoutInstantiationOptions = {
  createId?: (prefix: string) => string;
  currentLayout?: RendererPaneLayoutNode | null;
  resolveCurrentPaneType: RuntimePaneTypeResolver;
  resolveCurrentWebAppId?: RuntimePaneSelectionResolver;
  resolveDefaultPaneType: PaneTypeInstantiationResolver;
};

function createRuntimeId(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

export function captureWorkspaceLayoutPane(
  node: RendererPaneLayoutNode,
  resolvePaneType: RuntimePaneTypeResolver,
  createId: (prefix: string) => string = createRuntimeId
): WorkspaceLayoutPaneNode {
  if (node.type === "pane") {
    const paneTypeId = String(resolvePaneType(node) || "").trim();
    return {
      type: "pane",
      id: createId("layout-pane"),
      paneTypeId: paneTypeId && paneTypeId !== "empty" ? paneTypeId : null
    };
  }

  return {
    type: "split",
    id: createId("layout-split"),
    direction: node.direction === "horizontal" ? "horizontal" : "vertical",
    ratio: Number.isFinite(node.ratio) ? node.ratio : 0.5,
    first: captureWorkspaceLayoutPane(node.first, resolvePaneType, createId),
    second: captureWorkspaceLayoutPane(node.second, resolvePaneType, createId)
  };
}

function normalizePaneTypeId(value: unknown) {
  const paneTypeId = String(value || "").trim();
  return paneTypeId && paneTypeId !== "empty" ? paneTypeId : null;
}

function collectRuntimePanes(
  node: RendererPaneLayoutNode | null | undefined,
  panes: RendererPaneNode[] = []
) {
  if (!node) {
    return panes;
  }
  if (node.type === "pane") {
    panes.push(node);
    return panes;
  }
  collectRuntimePanes(node.first, panes);
  collectRuntimePanes(node.second, panes);
  return panes;
}

export function instantiateWorkspaceLayoutPane(
  node: WorkspaceLayoutPaneNode,
  resolvePaneType: PaneTypeInstantiationResolver,
  takeCurrentPane: (paneTypeId: string | null) => RendererPaneNode | null = () => null,
  resolveCurrentWebAppId: RuntimePaneSelectionResolver = (pane) => pane.selectedWebAppId,
  createId: (prefix: string) => string = createRuntimeId
): RendererPaneLayoutNode {
  if (node.type === "pane") {
    const paneTypeId = normalizePaneTypeId(node.paneTypeId);
    const currentPane = takeCurrentPane(paneTypeId);
    if (currentPane) {
      const selectedWebAppId = String(resolveCurrentWebAppId(currentPane) || "").trim();
      return {
        type: "pane",
        id: currentPane.id,
        ...(selectedWebAppId ? { selectedWebAppId } : {}),
        ...(currentPane.transientWebApp
          ? { transientWebApp: structuredClone(currentPane.transientWebApp) }
          : {})
      };
    }
    const id = createId("pane");
    return {
      type: "pane",
      id,
      selectedWebAppId: paneTypeId
        ? String(resolvePaneType(paneTypeId, id) || "empty")
        : "empty"
    };
  }

  return {
    type: "split",
    id: createId("split"),
    direction: node.direction,
    ratio: node.ratio,
    first: instantiateWorkspaceLayoutPane(
      node.first,
      resolvePaneType,
      takeCurrentPane,
      resolveCurrentWebAppId,
      createId
    ),
    second: instantiateWorkspaceLayoutPane(
      node.second,
      resolvePaneType,
      takeCurrentPane,
      resolveCurrentWebAppId,
      createId
    )
  };
}

export function instantiateWorkspaceLayout(
  layout: WorkspaceLayout,
  {
    createId = createRuntimeId,
    currentLayout = null,
    resolveCurrentPaneType,
    resolveCurrentWebAppId = (pane) => pane.selectedWebAppId,
    resolveDefaultPaneType
  }: WorkspaceLayoutInstantiationOptions
) {
  const currentPanes = collectRuntimePanes(currentLayout).map((pane) => ({
    pane,
    paneTypeId: normalizePaneTypeId(resolveCurrentPaneType(pane))
  }));
  const takeCurrentPane = (paneTypeId: string | null) => {
    if (!paneTypeId) {
      return null;
    }
    const index = currentPanes.findIndex((candidate) => candidate.paneTypeId === paneTypeId);
    if (index < 0) {
      return null;
    }
    return currentPanes.splice(index, 1)[0].pane;
  };
  return instantiateWorkspaceLayoutPane(
    layout.paneLayout,
    resolveDefaultPaneType,
    takeCurrentPane,
    resolveCurrentWebAppId,
    createId
  );
}

export function resolveWorkspaceLayoutAspectRatio(metrics: WorkspaceLayoutPreviewMetrics) {
  return Math.max(0.1, Number(metrics.windowAspectRatio) || 1);
}
