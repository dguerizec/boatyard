import type { WebAppPaneSidePanel } from "./rendererTypes.js";

export const DEFAULT_PANE_SIDE_PANEL_WIDTH = 360;
export const DEFAULT_PANE_SIDE_PANEL_MIN_WIDTH = 280;
export const DEFAULT_PANE_SIDE_PANEL_MAX_WIDTH = 720;
export const DEFAULT_PANE_SIDE_PANEL_MIN_MAIN_WIDTH = 360;

function finitePositive(value: unknown, fallback: number): number {
  const normalized = Math.round(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

export function normalizePaneSidePanel(value: unknown): WebAppPaneSidePanel | null {
  if (value === null || value === false) {
    return null;
  }

  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<WebAppPaneSidePanel>
    : {};
  const minWidth = finitePositive(source.minWidth, DEFAULT_PANE_SIDE_PANEL_MIN_WIDTH);
  const maxWidth = Math.max(
    minWidth,
    finitePositive(source.maxWidth, DEFAULT_PANE_SIDE_PANEL_MAX_WIDTH)
  );

  return {
    defaultOpen: source.defaultOpen !== false,
    defaultWidth: Math.min(
      maxWidth,
      Math.max(minWidth, finitePositive(source.defaultWidth, DEFAULT_PANE_SIDE_PANEL_WIDTH))
    ),
    maxWidth,
    minMainWidth: finitePositive(source.minMainWidth, DEFAULT_PANE_SIDE_PANEL_MIN_MAIN_WIDTH),
    minWidth,
    position: source.position === "right" ? "right" : "left",
    title: String(source.title || "Side panel").trim() || "Side panel"
  };
}

export function clampPaneSidePanelWidth(
  width: unknown,
  containerWidth: unknown,
  sidePanel: WebAppPaneSidePanel
): number {
  const availableWidth = Math.max(0, Math.floor(Number(containerWidth) || 0));
  const configuredMin = finitePositive(sidePanel.minWidth, DEFAULT_PANE_SIDE_PANEL_MIN_WIDTH);
  const configuredMax = Math.max(
    configuredMin,
    finitePositive(sidePanel.maxWidth, DEFAULT_PANE_SIDE_PANEL_MAX_WIDTH)
  );
  const minMainWidth = finitePositive(sidePanel.minMainWidth, DEFAULT_PANE_SIDE_PANEL_MIN_MAIN_WIDTH);
  const maxWidth = Math.max(0, Math.min(configuredMax, availableWidth - minMainWidth));
  const minWidth = Math.min(configuredMin, maxWidth);
  const normalizedWidth = finitePositive(width, sidePanel.defaultWidth);
  return Math.min(maxWidth, Math.max(minWidth, normalizedWidth));
}

export function resizePaneSidePanelWidth({
  clientX,
  containerWidth,
  position,
  sidePanel,
  startClientX,
  startWidth
}: {
  clientX: number;
  containerWidth: number;
  position: WebAppPaneSidePanel["position"];
  sidePanel: WebAppPaneSidePanel;
  startClientX: number;
  startWidth: number;
}): number {
  const delta = clientX - startClientX;
  const nextWidth = startWidth + (position === "right" ? -delta : delta);
  return clampPaneSidePanelWidth(nextWidth, containerWidth, sidePanel);
}

export function getPaneSidePanelStorageKey(
  projectId: unknown,
  webAppKey: unknown
): string {
  const project = String(projectId || "global").trim() || "global";
  const webApp = String(webAppKey || "pane").trim() || "pane";
  return `${encodeURIComponent(project)}:${encodeURIComponent(webApp)}`;
}
