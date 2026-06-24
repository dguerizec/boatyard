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
  required?: boolean;
  label?: string;
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
