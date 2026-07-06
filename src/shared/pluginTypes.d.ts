import type { ChildProcess } from "node:child_process";

export type PluginActionHandler<TPayload = unknown, TResult = unknown> = (
  payload?: TPayload
) => TResult | Promise<TResult>;

export interface PluginActions {
  handle<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: PluginActionHandler<TPayload, TResult>
  ): void;
}

export interface PluginEvents {
  emit(name: string, payload?: unknown): void;
}

export interface PluginProjectInspectors<TResult = unknown> {
  register(handler: (payload?: { sourcePath?: unknown }) => TResult | Promise<TResult>): void;
}

export interface PluginStateMigrations<TState = unknown, TResult = unknown> {
  register(handler: (payload: { state: TState }) => TResult): void;
}

export interface PromiseWithChild<T> extends Promise<T> {
  child: ChildProcess;
}

export interface ExecFileAsync {
  (file: string): PromiseWithChild<{ stdout?: string; stderr?: string }>;
  (file: string, args: readonly string[]): PromiseWithChild<{ stdout?: string; stderr?: string }>;
  (
    file: string,
    args: readonly string[],
    options: Record<string, unknown>
  ): PromiseWithChild<{ stdout?: string; stderr?: string }>;
  (file: string, options: Record<string, unknown>): PromiseWithChild<{ stdout?: string; stderr?: string }>;
}

export interface PluginMetadata {
  id: string;
}

export interface PluginPaths {
  pluginData: string;
  userData: string;
}

export interface PluginContext<TState = unknown> {
  actions: PluginActions;
  events: PluginEvents;
  execFileAsync: ExecFileAsync;
  getState(): TState;
  paths: PluginPaths;
  plugin: PluginMetadata;
  projectInspectors: PluginProjectInspectors;
  stateMigrations: PluginStateMigrations<TState>;
}

declare global {
  type WidgetGridSize = {
    columns: number;
    rows: number;
  };

  type WidgetLayoutInput = {
    default?: Partial<WidgetGridSize>;
    min?: Partial<WidgetGridSize>;
    max?: Partial<WidgetGridSize>;
  };

  type WidgetLayout = {
    default: WidgetGridSize;
    min: WidgetGridSize;
    max?: WidgetGridSize;
  };

  type WidgetStatus = "stable" | "experimental";

  type WidgetDefinitionInput = {
    id?: unknown;
    name?: unknown;
    title?: unknown;
    scope?: unknown;
    scopes?: unknown[];
    category?: unknown;
    status?: unknown;
    description?: unknown;
    provider?: unknown;
    layout?: WidgetLayoutInput;
    requires?: unknown;
    create?: unknown;
    createElement?: unknown;
    [key: string]: unknown;
  };

  type WidgetDefinition = WidgetDefinitionInput & {
    id: string;
    name: string;
    title: string;
    scope: string;
    scopes: string[];
    category: string;
    status: WidgetStatus;
    description: string;
    provider: string;
    layout: WidgetLayout;
    requires: unknown[];
  };

  type WidgetListFilter = {
    scope?: string;
    status?: WidgetStatus;
  };

  type WidgetAlias = {
    alias: string;
    targetId: string;
  };

  type WidgetRegistryApi = {
    register(definition: WidgetDefinitionInput): WidgetDefinition;
    registerAlias(alias: unknown, targetId: unknown): WidgetAlias;
    list(filter?: WidgetListFilter): WidgetDefinition[];
    get(id: unknown): WidgetDefinition | null;
    resolveId(id: unknown): string;
    listAliases(): WidgetAlias[];
    unregister(id: unknown): boolean;
    unregisterAlias(alias: unknown): boolean;
  };

  type PluginRegistryRecord = Record<string, unknown>;

  type PluginStatusAction = PluginRegistryRecord & {
    id?: string;
    label?: string;
  };

  type PluginStatus = {
    state: string;
    summary: string;
    details: PluginRegistryRecord;
    actions: PluginStatusAction[];
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

  type PluginListEntry = PluginManifest & {
    enabled: boolean;
    active: boolean;
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
    mobileDev?: unknown;
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

  type PluginPaneListFilter = {
    scope?: string;
    kind?: PluginPaneDefinition["kind"];
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
      on<TPayload extends PluginRegistryRecord = PluginRegistryRecord>(
        eventName: unknown,
        handler: (payload: TPayload) => void
      ): () => void;
    };
  };

  type PluginRegistryApi = {
    register(manifestInput: PluginRegistryRecord, runtime?: PluginRuntime): RegisteredPlugin;
    list(): PluginListEntry[];
    setEnabled(pluginId: unknown, enabled: unknown): PluginListEntry;
    reload(pluginId: unknown): PluginListEntry;
    applyEnabledState(enabledByPlugin?: PluginRegistryRecord): void;
    listPanes(filter?: PluginPaneListFilter): PluginPaneDefinition[];
    listProjectNavBadges(): PluginProjectNavBadgeDefinition[];
    listGlobalSettingsSections(): PluginSettingsSection[];
    listProjectSettingsSections(): PluginSettingsSection[];
    getService<TService extends PluginRegistryRecord = PluginRegistryRecord>(serviceId: unknown): TService | null;
    listServices(): Array<{ id: string; pluginId: string }>;
    emit(eventName: unknown, payload?: PluginRegistryRecord & { forPlugin?: (pluginId: string) => PluginRegistryRecord }): void;
    getStatus(pluginId: unknown): PluginStatus | null;
  };
}

export {};
