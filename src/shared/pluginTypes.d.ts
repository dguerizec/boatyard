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
  register(handler: (payload?: { globalConfig?: Record<string, unknown>; sourcePath?: unknown }) => TResult | Promise<TResult>): void;
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

export type PluginWebContentsViewResource = {
  key: string;
  label: string;
  pid: number;
  projectId: string;
  url: string;
  windowId: string;
};

export type PluginResourceProviderResult = {
  data?: unknown;
  exclusiveMemoryBytes?: number;
};

export type PluginResourceProviderSnapshot = {
  data?: unknown;
  error: string;
  exclusiveMemoryBytes: number;
  id: string;
  pluginId: string;
};

export type PluginResourceProviderCollector = () => (
  PluginResourceProviderResult | Promise<PluginResourceProviderResult>
);

export interface PluginResources {
  collectProviderSnapshots(): Promise<PluginResourceProviderSnapshot[]>;
  listWebContentsViews(): PluginWebContentsViewResource[];
  registerProvider(id: string, collector: PluginResourceProviderCollector): void;
}

export interface PluginContext<TState = unknown> {
  actions: PluginActions;
  events: PluginEvents;
  execFileAsync: ExecFileAsync;
  getState(): TState;
  paths: PluginPaths;
  plugin: PluginMetadata;
  projectInspectors: PluginProjectInspectors;
  resources: PluginResources;
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

  type PluginManagedResourceSnapshot = {
    data?: unknown;
    error?: string;
    exclusiveMemoryBytes?: number;
    id?: string;
    pluginId?: string;
  };

  type PluginResourceMetric = {
    label: string;
    tone?: "default" | "count" | "warning";
    value: string;
  };

  type PluginResourceShare = {
    label: string;
    total: unknown;
    unitLabel: string;
    value: unknown;
  };

  type PluginResourceBadge = {
    label: string;
    tone?: "accent" | "default" | "success" | "warning";
  };

  type PluginResourceGroupOptions = {
    metrics?: PluginResourceMetric[];
    share: PluginResourceShare;
    stateKey: string;
    subtitle?: string;
    title: string;
  };

  type PluginResourceItemOptions = {
    badges?: PluginResourceBadge[];
    metadata?: string[];
    metrics?: PluginResourceMetric[];
    share: PluginResourceShare;
    title: string;
  };

  type PluginResourceRendererUi = {
    addError(container: HTMLElement, message: unknown): void;
    createCard(title: string, count: string, countLabel: string): {
      card: HTMLElement;
      header: HTMLElement;
      stats: HTMLElement;
    };
    createDetailGroup(title: string, subtitle: string, stats: HTMLElement[]): {
      group: HTMLElement;
      rows: HTMLElement;
    };
    createDetailRow(
      title: string,
      subtitle: string,
      metrics: Array<{ label: string; value: string }>
    ): HTMLElement;
    createResourceGroup(options: PluginResourceGroupOptions): {
      group: HTMLDetailsElement;
      rows: HTMLElement;
    };
    createResourceItem(options: PluginResourceItemOptions): HTMLElement;
    createResourceList(): HTMLElement;
    createShareBar(share: PluginResourceShare): HTMLElement;
    createStat(label: string, value: string, detail?: string): HTMLElement;
    element<K extends keyof HTMLElementTagNameMap>(
      tagName: K,
      className?: string,
      text?: string
    ): HTMLElementTagNameMap[K];
    formatCount(value: unknown): string;
    formatMemory(value: unknown): string;
  };

  type PluginResourceRendererProvider = PluginRegistryRecord & {
    id: string;
    kind: "boatyard.resourceProvider";
    label: string;
    order: number;
    paneId: string;
    sectionId: string;
    subtitle: string;
    title: string;
    renderDetails(
      content: HTMLElement,
      snapshot: PluginManagedResourceSnapshot | undefined,
      ui: PluginResourceRendererUi
    ): void;
    renderOverview(
      snapshot: PluginManagedResourceSnapshot | undefined,
      ui: PluginResourceRendererUi
    ): HTMLElement | null;
  };

  type PluginResourceRendererHost = PluginRegistryRecord & {
    renderProviderPane(container: HTMLElement, providerId: string): (() => void) | void;
    resolveNavigation(): PluginPaneNavigation;
  };

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
    options?: Array<{ label?: string; value?: unknown }>;
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
    icon?: string;
    iconOnly?: boolean;
    iconUrl?: string;
    id: string;
    key: string;
    label: string;
    minHeight?: string;
    minWidth?: string;
    navigation?: PluginPaneNavigation;
    paneTypeId?: string;
    showInMenu?: boolean;
    url: string;
    restoreUrl?: boolean;
  };

  type PluginPaneNavigationItem = {
    activeUrlPatterns?: string[];
    id: string;
    label: string;
    url?: string;
    webAppId?: string;
  };

  type PluginPaneNavigation = {
    browserControls?: "compact" | "full" | "hidden";
    items: PluginPaneNavigationItem[];
    showAddressBar?: boolean;
    showHomeButton?: boolean;
  };

  type PluginPaneSidePanel = {
    defaultOpen?: boolean;
    defaultWidth?: number;
    maxWidth?: number;
    minMainWidth?: number;
    minWidth?: number;
    position?: "left" | "right";
    title?: string;
  };

  type PluginPaneResolveContext = {
    project?: PluginRegistryRecord;
    projectConfig?: PluginRegistryRecord;
    globalPluginConfig?: PluginRegistryRecord;
  };

  type PluginPaneDefinitionInput = PluginRegistryRecord & {
    id?: unknown;
    icon?: unknown;
    iconOnly?: unknown;
    iconUrl?: unknown;
    isAvailable?: (context: PluginPaneResolveContext) => boolean;
    key?: unknown;
    kind?: unknown;
    mobileDev?: unknown;
    minHeight?: unknown;
    minWidth?: unknown;
    name?: unknown;
    navigation?: PluginPaneNavigation;
    parentLabel?: unknown;
    parentWebAppId?: unknown;
    paneTypeId?: unknown;
    replacesWebAppIds?: unknown;
    scope?: unknown;
    showInMenu?: unknown;
    title?: unknown;
    webAppId?: unknown;
    render?: (container: HTMLElement, props?: PluginRegistryRecord) => unknown;
    renderHeaderActions?: (container: HTMLElement, props?: PluginRegistryRecord) => unknown;
    renderSidePanel?: (container: HTMLElement, props?: PluginRegistryRecord) => unknown;
    resolveNavigation?: (context: PluginPaneResolveContext) => PluginPaneNavigation | null | undefined;
    resolveSidePanel?: (context: PluginPaneResolveContext) => PluginPaneSidePanel | null | undefined;
    resolveUrl?: (context: PluginPaneResolveContext) => string;
    resolveWebApps?: (context: PluginPaneResolveContext) => PluginPaneWebApp[];
  };

  type PluginPaneDefinition = PluginPaneDefinitionInput & {
    id: string;
    pluginId: string;
    title: string;
    kind: "wcv" | "dom";
    parentLabel: string;
    parentWebAppId: string;
    paneTypeId: string;
    replacesWebAppIds: string[];
    scope: string;
    showInMenu: boolean;
    webAppId: string;
    key: string;
    minHeight?: string;
    minWidth?: string;
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
