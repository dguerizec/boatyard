import { createWidgetSurfaces } from "./widgetSurfaces.js";
import type { BoatyardBridge, RendererState } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

type WidgetRegistryWindow = Window & {
  BoatyardWidgetRegistry?: {
    register: (definition: UnknownRecord) => void;
  };
};

type RendererWidgetBridgeOptions = {
  boatyard: BoatyardBridge;
  clamp: (value: number, min: number, max: number) => number;
  createCard: (options: UnknownRecord) => HTMLElement;
  createTerminalWidget: (project: unknown, props?: UnknownRecord) => HTMLElement;
  createToolIcon: (name: string) => Element;
  dashboardGrid: HTMLElement;
  defaultWidgetPaneId: string;
  getGlobalPluginConfig: (pluginId?: string) => UnknownRecord;
  getProjectPluginConfig: (projectId?: string, pluginId?: string) => UnknownRecord;
  getState: () => RendererState;
  isGlobalWorkspace: (project: unknown) => boolean;
  legacyWidgetIds: Map<string, string>;
  minWidgetRailWidth: number;
  openProjectWebApp: (projectId: string, webAppId: string, url?: string) => boolean;
  renderWorkspaceDashboard: (project: unknown) => void;
  widgetGridGap: number;
  widgetGridMaxColumnWidth: number;
  widgetGridMinColumnWidth: number;
  widgetGridRowHeight: number;
  widgetGridScrollGuard: number;
  windowObject: WidgetRegistryWindow;
};

function registerBuiltinWidgets(windowObject: WidgetRegistryWindow, createTerminalWidget: RendererWidgetBridgeOptions["createTerminalWidget"]) {
  const registry = windowObject.BoatyardWidgetRegistry;

  if (!registry) {
    throw new Error("Widget registry is unavailable.");
  }

  [
    {
      id: "terminal-shell",
      name: "Terminal",
      title: "Terminal",
      scopes: ["global", "project"],
      category: "Developer tools",
      status: "experimental",
      description: "Persistent multi-tab tmux terminal.",
      layout: {
        default: { columns: 4, rows: 5 },
        min: { columns: 2, rows: 3 }
      },
      createElement: (project: unknown, props: UnknownRecord) => createTerminalWidget(project, props)
    }
  ].forEach((definition) => registry.register(definition));
}

export function createRendererWidgetBridge(options: RendererWidgetBridgeOptions) {
  registerBuiltinWidgets(options.windowObject, options.createTerminalWidget);

  return createWidgetSurfaces({
    boatyard: options.boatyard as Parameters<typeof createWidgetSurfaces>[0]["boatyard"],
    getState: options.getState,
    getProjectPluginConfig: options.getProjectPluginConfig,
    getGlobalPluginConfig: options.getGlobalPluginConfig,
    isGlobalWorkspace: options.isGlobalWorkspace,
    openProjectWebApp: options.openProjectWebApp,
    createCard: options.createCard,
    createToolIcon: options.createToolIcon,
    renderWorkspaceDashboard: options.renderWorkspaceDashboard,
    dashboardGrid: options.dashboardGrid,
    clamp: options.clamp,
    minWidgetRailWidth: options.minWidgetRailWidth,
    defaultWidgetPaneId: options.defaultWidgetPaneId,
    widgetGridMinColumnWidth: options.widgetGridMinColumnWidth,
    widgetGridMaxColumnWidth: options.widgetGridMaxColumnWidth,
    widgetGridRowHeight: options.widgetGridRowHeight,
    widgetGridGap: options.widgetGridGap,
    widgetGridScrollGuard: options.widgetGridScrollGuard,
    legacyWidgetIds: options.legacyWidgetIds
  });
}
