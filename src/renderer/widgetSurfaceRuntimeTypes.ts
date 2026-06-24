import type {
  PersistedWidgetLayout,
  WidgetDefinition,
  WidgetGridPosition,
  WidgetGridSize
} from "./widgetSurfaceTypes.js";
import type { BoatyardBridge, RendererProject, RendererState } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

export type WidgetSurfacesBridge = BoatyardBridge & {
  updateWidgetLayout(projectId: string | undefined, layout: PersistedWidgetLayout): Promise<unknown>;
};

export type WidgetSurfacesState = RendererState & {
  pluginConfig?: {
    projects?: Record<string, Record<string, UnknownRecord>>;
  };
  widgetLayouts?: Record<string, PersistedWidgetLayout>;
};

export type WidgetSurfacesOptions = {
  boatyard: WidgetSurfacesBridge;
  getState: () => WidgetSurfacesState;
  getProjectPluginConfig: (projectId: string | undefined, pluginId: string) => UnknownRecord;
  getGlobalPluginConfig: (pluginId: string) => UnknownRecord;
  isGlobalWorkspace: (project: RendererProject | null | undefined) => boolean;
  openProjectWebApp: (projectId: string | undefined, webAppId: string, url: string) => unknown;
  createCard: (content: unknown) => HTMLElement;
  createToolIcon: (name: string) => Node;
  renderWorkspaceDashboard: (project: RendererProject) => void;
  dashboardGrid: HTMLElement;
  clamp: (value: number, min: number, max: number) => number;
  minWidgetRailWidth: number;
  defaultWidgetPaneId: string;
  widgetGridMinColumnWidth: number;
  widgetGridMaxColumnWidth: number;
  widgetGridRowHeight: number;
  widgetGridGap: number;
  widgetGridScrollGuard: number;
  legacyWidgetIds: Map<string, string>;
};

export type WidgetPluginProps = UnknownRecord & {
  allProjectPluginConfig: UnknownRecord;
  globalPluginConfig: UnknownRecord;
  openProjectWebApp(webAppId: string, url?: string): unknown;
  pluginConfig: UnknownRecord;
  project: RendererProject;
  projectId?: string;
  widgetPaneId: string;
};

export type WidgetElementDefinition = WidgetDefinition & {
  create?: (project: RendererProject, props: WidgetPluginProps) => unknown;
  createElement?: (project: RendererProject, props: WidgetPluginProps) => HTMLElement;
};

export type WidgetPointerOffset = {
  x: number;
  y: number;
};

export type WidgetGeometry = {
  position: WidgetGridPosition;
  size: WidgetGridSize;
};
