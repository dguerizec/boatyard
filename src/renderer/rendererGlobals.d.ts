type RendererPluginDescriptor = {
  rendererPath?: string;
  stylePaths?: string[];
};

type PluginLoaderRendererApi = {
  listPlugins?: () => Promise<RendererPluginDescriptor[]>;
};

type PluginLoaderApi = {
  ready: Promise<RendererPluginDescriptor[]>;
};

type PluginLoaderWindow = Window & {
  boatyard?: PluginLoaderRendererApi;
  BoatyardPluginLoader?: PluginLoaderApi;
};

type PluginRegistryWindow = Window & {
  BoatyardPluginRegistry?: PluginRegistryApi;
  BoatyardWidgetRegistry?: WidgetRegistryApi;
  CustomEvent?: typeof CustomEvent;
};

type WidgetRegistryWindow = Window & {
  BoatyardWidgetRegistry?: WidgetRegistryApi;
};

type PluginSettingsField = {
  defaultValue?: unknown | ((context: Record<string, unknown>) => unknown);
  options?: Array<{ label?: string; value?: unknown }>;
  required?: boolean;
  label?: string;
  type?: string;
  valueType?: string;
};

type PluginSettingsInput = {
  value?: unknown;
  dataset?: {
    defaultValue?: unknown;
  };
};

type PluginSettingsReadOptions = {
  normalizeUrl?: (value: string) => string;
};

type PluginSettingsFieldsApi = {
  readFieldValue: (
    field?: PluginSettingsField,
    input?: PluginSettingsInput | null,
    options?: PluginSettingsReadOptions
  ) => string;
  resolveFieldDefault: (field?: PluginSettingsField, context?: Record<string, unknown>) => string;
};

type PluginSettingsFieldsGlobal = typeof globalThis & {
  BoatyardPluginSettingsFields?: PluginSettingsFieldsApi;
};

type RendererModuleFactory<TOptions = unknown, TInstance = unknown> = {
  create(options: TOptions): TInstance;
};

type GlobalSettingsViewsGlobal = Window & {
  BoatyardPluginRegistry?: PluginRegistryApi;
  BoatyardPluginSettingsFields?: Pick<PluginSettingsFieldsApi, "resolveFieldDefault">;
  BoatyardGlobalSettingsViews?: RendererModuleFactory;
};

type ProjectSettingsViewsGlobal = Window & {
  BoatyardPluginRegistry?: PluginRegistryApi;
  BoatyardPluginSettingsFields?: Pick<PluginSettingsFieldsApi, "resolveFieldDefault">;
  BoatyardProjectSettingsViews?: RendererModuleFactory;
};

type PaneLayoutViewGlobal = Window & {
  BoatyardPaneLayoutView?: RendererModuleFactory;
};

type UpdateViewsGlobal = Window & {
  BoatyardUpdateViews?: RendererModuleFactory;
};

type WebAppSurfacesGlobal = Window & {
  BoatyardWebAppSurfaces?: RendererModuleFactory;
};

type WidgetSurfacesGlobal = Window & {
  BoatyardWidgetRegistry?: WidgetRegistryApi;
  BoatyardWidgetSurfaces?: RendererModuleFactory;
};

type WebAppMenusGlobal = Window & {
  BoatyardWebAppMenus?: RendererModuleFactory;
};

type ProjectSidebarGlobal = Window & {
  BoatyardProjectSidebar?: RendererModuleFactory;
};

type PaneLayoutStateWindow = Window & {
  BoatyardPaneLayoutState?: RendererModuleFactory;
};

type OnboardingTourGlobal = Window & {
  BoatyardOnboardingTour?: RendererModuleFactory;
};

type XtermTerminal = {
  clear(): void;
  clearSelection(): void;
  cols?: number;
  dispose(): void;
  focus(): void;
  getSelection(): string;
  hasSelection(): boolean;
  loadAddon(addon: unknown): void;
  modes: {
    mouseTrackingMode?: string;
  };
  onData(callback: (data: string) => void): { dispose(): void };
  onSelectionChange(callback: () => void): { dispose(): void };
  open(container: Element | null): void;
  resize(cols: number, rows: number): void;
  rows?: number;
  write(data: string): void;
};

type XtermConstructor = new (options: Record<string, unknown>) => XtermTerminal;

type XtermGlobal = XtermConstructor | {
  Terminal?: XtermConstructor;
};

type FitAddonInstance = {
  dispose?: () => void;
  fit(): void;
  proposeDimensions(): { cols?: number; rows?: number } | undefined;
};

type FitAddonConstructor = new () => FitAddonInstance;

type FitAddonGlobal = FitAddonConstructor | {
  FitAddon?: FitAddonConstructor;
};

type TerminalSurfacesGlobal = Window & {
  Terminal?: XtermGlobal;
  FitAddon?: FitAddonGlobal;
  BoatyardTerminalSurfaces?: RendererModuleFactory;
};

type BoatyardPluginRendererBridge = {
  invokePlugin?: (pluginId: string, actionName: string, payload?: unknown) => Promise<unknown>;
  onPluginEvent?: (pluginId: string, eventName: string, callback: (payload: unknown) => void) => () => void;
  openExternal?: (url: string) => unknown;
  updateGlobalPluginConfig?: (pluginId: string, config: Record<string, unknown>) => Promise<unknown>;
  updateProjectPluginConfig?: (projectId: string, pluginId: string, config: Record<string, unknown>) => Promise<unknown>;
  writeClipboardText?: (value: string) => Promise<unknown>;
};

type BoatyardPluginRendererGlobal = Window & {
  CustomEvent?: typeof CustomEvent;
  MutationObserver?: typeof MutationObserver;
  BoatyardOverlayDialog?: {
    show?: (dialog: HTMLDialogElement, options?: Record<string, unknown>) => Promise<boolean>;
  };
  BoatyardPaneNavigation?: {
    openProjectWebApp?: (projectId: string | undefined, webAppId: string, url: string) => void;
  };
  BoatyardPluginRegistry?: PluginRegistryApi;
  boatyard?: BoatyardPluginRendererBridge;
};
