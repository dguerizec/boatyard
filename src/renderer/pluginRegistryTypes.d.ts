type PluginRegistryRecord = Record<string, unknown>;

type PluginStatus = {
  state: string;
  summary: string;
  details: PluginRegistryRecord;
  actions: unknown[];
};

type PluginManifest = PluginRegistryRecord & {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  contributes?: Record<string, unknown[]>;
};

type PluginRuntime = {
  activate?: (context: PluginRegistryContext) => void;
  deactivate?: (context: PluginRegistryContext) => void;
};

type RegisteredPlugin = {
  manifest: PluginManifest;
  runtime: PluginRuntime;
  active: boolean;
  enabled: boolean;
};

type PluginSettingsFieldDefinition = PluginRegistryRecord & {
  key: string;
  label: string;
  type: string;
  valueType: string;
  placeholder: string;
  required: boolean;
};

type PluginSettingsSection = PluginRegistryRecord & {
  id: string;
  pluginId: string;
  title: string;
  fields: PluginSettingsFieldDefinition[];
};

type PluginPaneWebApp = {
  id: string;
  key: string;
  label: string;
  url: string;
  restoreUrl?: boolean;
};

type PluginPaneResolveContext = {
  project?: PluginRegistryRecord;
  projectConfig?: PluginRegistryRecord;
  globalPluginConfig?: PluginRegistryRecord;
};

type PluginPaneDefinitionInput = PluginRegistryRecord & {
  id?: unknown;
  key?: unknown;
  kind?: unknown;
  name?: unknown;
  scope?: unknown;
  title?: unknown;
  webAppId?: unknown;
  render?: (container: HTMLElement, props?: PluginRegistryRecord) => unknown;
  resolveUrl?: (context: PluginPaneResolveContext) => string;
  resolveWebApps?: (context: PluginPaneResolveContext) => PluginPaneWebApp[];
};

type PluginPaneDefinition = PluginPaneDefinitionInput & {
  id: string;
  pluginId: string;
  title: string;
  kind: "wcv" | "dom";
  scope: string;
  webAppId: string;
  key: string;
};

type PluginProjectNavBadgeRenderContext = {
  project?: PluginRegistryRecord;
  projectConfig?: PluginRegistryRecord;
  globalConfig?: PluginRegistryRecord;
  isActiveProject?: boolean;
  currentView?: string;
};

type PluginProjectNavBadgeDefinitionInput = PluginRegistryRecord & {
  id?: unknown;
  render?: (context: PluginProjectNavBadgeRenderContext) => HTMLElement | null;
};

type PluginProjectNavBadgeDefinition = PluginProjectNavBadgeDefinitionInput & {
  id: string;
  pluginId: string;
  render: (context: PluginProjectNavBadgeRenderContext) => HTMLElement | null;
};

type PluginService = {
  id: string;
  pluginId: string;
  implementation: PluginRegistryRecord;
};

type PluginEventHandler = {
  pluginId: string;
  handler: (payload: PluginRegistryRecord) => void;
};

type PluginRegistryContext = {
  plugin: PluginManifest;
  status: {
    set(status: Partial<PluginStatus>): void;
    get(): PluginStatus | null;
  };
  panes: {
    register(definition: PluginPaneDefinitionInput): PluginPaneDefinition;
  };
  projectNavBadges: {
    register(definition: PluginProjectNavBadgeDefinitionInput): PluginProjectNavBadgeDefinition;
  };
  settings: {
    registerGlobalSection(section: PluginRegistryRecord): PluginSettingsSection;
    registerProjectSection(section: PluginRegistryRecord): PluginSettingsSection;
  };
  widgets: {
    register(definition: WidgetDefinitionInput): WidgetDefinition;
    registerAlias(alias: unknown, targetId: unknown): WidgetAlias;
  };
  services: {
    provide(serviceId: unknown, implementation: PluginRegistryRecord): PluginRegistryRecord;
    get<TService extends PluginRegistryRecord = PluginRegistryRecord>(serviceId: unknown): TService | null;
    list(): Array<{ id: string; pluginId: string }>;
  };
  events: {
    on(eventName: unknown, handler: (payload: PluginRegistryRecord) => void): () => void;
  };
};

type PluginRegistryApi = {
  register(manifestInput: PluginRegistryRecord, runtime?: PluginRuntime): RegisteredPlugin;
  list(): Array<PluginManifest & { enabled: boolean; active: boolean }>;
  setEnabled(pluginId: unknown, enabled: unknown): PluginManifest & { enabled: boolean; active: boolean };
  reload(pluginId: unknown): PluginManifest & { enabled: boolean; active: boolean };
  applyEnabledState(enabledByPlugin?: PluginRegistryRecord): void;
  listPanes(filter?: { scope?: string; kind?: string }): PluginPaneDefinition[];
  listProjectNavBadges(): PluginProjectNavBadgeDefinition[];
  listGlobalSettingsSections(): PluginSettingsSection[];
  listProjectSettingsSections(): PluginSettingsSection[];
  getService<TService extends PluginRegistryRecord = PluginRegistryRecord>(serviceId: unknown): TService | null;
  listServices(): Array<{ id: string; pluginId: string }>;
  emit(eventName: unknown, payload?: PluginRegistryRecord & { forPlugin?: (pluginId: string) => PluginRegistryRecord }): void;
  getStatus(pluginId: unknown): PluginStatus | null;
};
