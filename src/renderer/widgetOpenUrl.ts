import type { UnknownRecord } from "./rendererRecords.js";

type WidgetOpenUrlSourceElement = Element & {
  closest<T extends Element = Element>(selectors: string): T | null;
  getBoundingClientRect(): DOMRect;
};

type WidgetOpenUrlOptions = {
  sourceElement?: WidgetOpenUrlSourceElement;
  url: string;
  widgetId: string;
  widgetName: string;
};

export function createWidgetOpenUrlPayload({
  sourceElement,
  url,
  widgetId,
  widgetName
}: WidgetOpenUrlOptions): UnknownRecord {
  const sourcePane = sourceElement?.closest<HTMLElement>(".webapp-pane") || null;
  const bounds = sourceElement?.getBoundingClientRect();
  return {
    source: "explicit",
    sourceBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    } : undefined,
    sourceId: `widget:${widgetId}`,
    sourceLabel: widgetName,
    sourcePaneId: sourcePane?.dataset.paneId || "",
    sourcePaneWebAppId: sourcePane?.dataset.webAppId || "",
    url
  };
}
