import type { UnknownRecord } from "./rendererRecords";
import type { PaneLayoutNode, PaneNode } from "./paneLayoutState.js";

export type RendererProject = UnknownRecord & {
  devBranch?: string;
  group?: string;
  id?: string;
  name?: string;
  previewUrl?: string;
  repoUrl?: string;
  slug?: string;
  sourcePath?: string;
  urls?: UnknownRecord[];
  webAppHomeTabs?: WebAppDefinition[];
  webAppOpenRules?: UnknownRecord[];
  widgetPanes?: UnknownRecord[];
};

export type RendererState = UnknownRecord & {
  globalUrls?: UnknownRecord[];
  navigation?: {
    collapsedProjectGroups?: string[];
    pinnedProjectIds?: string[];
    projectId?: string | null;
    view?: string;
  };
  onboarding?: {
    completedVersion?: number;
  };
  paneLayouts?: UnknownRecord;
  pluginConfig?: {
    global?: Record<string, UnknownRecord>;
    projects?: Record<string, Record<string, UnknownRecord>>;
  };
  plugins?: {
    enabled?: Record<string, boolean>;
  };
  projects: RendererProject[];
  settings?: UnknownRecord;
  webApps?: Record<string, { url?: string }>;
};

export type WebAppDefinition = UnknownRecord & {
  backgroundColor?: string;
  id?: string;
  key?: string;
  label?: unknown;
  mobileDev?: boolean;
  parentLabel?: string;
  parentWebAppId?: string;
  restoreUrl?: boolean;
  transient?: boolean;
  url?: string;
};

export type RendererPaneLayoutNode = PaneLayoutNode;
export type RendererPaneNode = PaneNode;

type RendererManualSection = {
  body?: string;
  id: string;
  title: string;
};

type RendererManual = {
  description?: string;
  sections?: RendererManualSection[];
  title?: string;
  version?: number;
};

export type RendererModuleInstance = Record<string, (...args: unknown[]) => unknown>;

export type RendererCreateModule<TInstance extends RendererModuleInstance = RendererModuleInstance> = {
  create(options: UnknownRecord): TInstance;
};

export type PaneLayoutStateInstance = RendererModuleInstance & {
  collectPaneNodes(node: RendererPaneLayoutNode | null | undefined, panes?: RendererPaneNode[]): RendererPaneNode[];
  countPaneNodes(node: RendererPaneLayoutNode | null | undefined): number;
  createSplitNode(project: RendererProject, direction: string, first: RendererPaneLayoutNode, selectedWebAppId?: string | null): RendererPaneLayoutNode;
  deleteSelectedWebAppForPane(paneId: string): unknown;
  deleteSelectedWebAppForProject(projectId?: string): unknown;
  findFirstPaneNode(node: RendererPaneLayoutNode | null | undefined): RendererPaneNode | null;
  findPaneNode(node: RendererPaneLayoutNode | null | undefined, paneId?: string): RendererPaneNode | null;
  findPaneNodeBySelectedWebApp(node: RendererPaneLayoutNode | null | undefined, webAppId?: string): RendererPaneNode | null;
  getPaneLayout(project: RendererProject): RendererPaneLayoutNode;
  getSelectedWebAppForPane(paneId: string): string;
  getSelectedWebAppForProject(projectId?: string): string;
  hydratePaneLayouts(layouts: unknown): void;
  replacePaneNode(node: RendererPaneLayoutNode, paneId: string, replacement: RendererPaneLayoutNode): RendererPaneLayoutNode;
  setPaneLayout(projectId: string | undefined, layout: RendererPaneLayoutNode): unknown;
  setSelectedWebAppForPane(paneId: string, webAppId?: string): unknown;
  setSelectedWebAppForProject(projectId: string | undefined, webAppId?: string): unknown;
};

export type PaneLayoutViewInstance = RendererModuleInstance & {
  createPaneLayout(project: RendererProject, node: RendererPaneLayoutNode): HTMLElement;
  renderPaneLayoutPreservingPanes(project: RendererProject): void;
};

export type WidgetSurfacesInstance = RendererModuleInstance & {
  getProjectWidgetPanes(project: RendererProject): UnknownRecord[];
};

export type WebAppMenusInstance = RendererModuleInstance & {
  applyWebAppOpenChoice(payload: UnknownRecord, choice: UnknownRecord): Promise<unknown>;
};

export type UpdateViewsInstance = RendererModuleInstance & {
  createGlobalUpdateCard(): HTMLElement;
};

export type GlobalSettingsViewsInstance = RendererModuleInstance & {
  createGlobalPasswordManagerSettingsForm(options: UnknownRecord): HTMLElement;
  createGlobalPresentationSettingsForm(options: UnknownRecord): HTMLElement;
  createGlobalProjectsSettingsForm(options: UnknownRecord): HTMLElement;
  createGlobalTerminalSettingsForm(options: UnknownRecord): HTMLElement;
  createGlobalWebAppOpenRulesSettingsForm(options: UnknownRecord): HTMLElement;
  createGlobalPluginsSettingsView(): HTMLElement;
  createGlobalWidgetsSettingsView(): HTMLElement;
};

export type ProjectSettingsViewsInstance = RendererModuleInstance & {
  createProjectDangerZone(options: UnknownRecord): HTMLElement;
  createGlobalUrlsSettingsForm(options: UnknownRecord): HTMLElement;
  createProjectFormView(options: UnknownRecord): HTMLElement;
  createProjectTerminalSettingsForm(options: UnknownRecord): HTMLElement;
  createProjectUrlsForm(options: UnknownRecord): HTMLElement;
  createProjectWebAppHomeTabsForm(options: UnknownRecord): HTMLElement;
  createProjectWebAppOpenRulesForm(options: UnknownRecord): HTMLElement;
  createProjectWidgetPanesForm(options: UnknownRecord): HTMLElement;
};

export type BoatyardBridge = {
  addProject(values: UnknownRecord): Promise<RendererState>;
  dismissChangelog?: () => Promise<unknown>;
  freezeWebApps(options?: unknown): Promise<unknown>;
  getChangelogHistory?: () => Promise<unknown>;
  getPendingChangelog?: () => Promise<unknown>;
  getState(): Promise<RendererState>;
  getUpdateInfo?: () => Promise<unknown>;
  hideWebApp(): Promise<unknown>;
  navigateWebApp(...payload: unknown[]): Promise<unknown>;
  onTerminalData(callback: (payload: { terminalId: unknown; data: unknown }) => void): void;
  onTerminalExit(callback: (payload: { terminalId: unknown; projectId: unknown; windowId: unknown }) => void): void;
  onWebAppAutofillChanged?: (callback: (payload: { enabled?: boolean; key?: string }) => void) => void;
  onWebAppLoaded?: (callback: (payload: { key?: string; url?: string }) => void) => void;
  onWebAppOpenUrlRequested?: (callback: (payload: UnknownRecord & { target?: string }) => void) => void;
  onWebAppUrlChanged(callback: (payload: { key?: string; url?: string }) => void): void;
  openExternal(url: string): unknown;
  prepareUpdate?: () => Promise<unknown>;
  removeProject(projectId: string): Promise<RendererState>;
  reorderProjects(projectIds: string[]): Promise<RendererState>;
  restoreWebApps(): Promise<unknown>;
  restartToUpdate(update: UnknownRecord): Promise<unknown>;
  setVisibleWebApps(...payload: unknown[]): Promise<unknown>;
  showWebApp(...payload: unknown[]): Promise<unknown>;
  updateGlobalPluginConfig(pluginId: string, values: UnknownRecord): Promise<RendererState>;
  updateGlobalUrls(urls: UnknownRecord[]): Promise<RendererState>;
  updateNavigation(values: UnknownRecord): Promise<UnknownRecord>;
  updateOnboarding(values: UnknownRecord): Promise<RendererState["onboarding"]>;
  updatePaneLayout(projectId: string | null | undefined, layout: unknown): Promise<RendererState>;
  updatePluginEnabled(pluginId: string, enabled: boolean): Promise<RendererState>;
  updateProject(projectId: string, values: UnknownRecord): Promise<RendererState>;
  updateProjectPluginConfig(projectId: string, pluginId: string, config: UnknownRecord): Promise<RendererState>;
  updateSettings(values: UnknownRecord): Promise<RendererState>;
  updateWebAppAutofill(...payload: unknown[]): Promise<unknown>;
  updateWebAppHomeTab(projectId: string, tab: UnknownRecord): Promise<RendererState>;
  updateWebAppHomeTabs(projectId: string, tabs: UnknownRecord[]): Promise<RendererState>;
};

export type ProjectNavBadgeRenderOptions = {
  isActiveProject?: boolean;
};

type BoatyardRendererGlobals = {
  boatyard: BoatyardBridge;
  BoatyardManual?: RendererManual;
  BoatyardOverlayDialog?: {
    show(dialog: HTMLDialogElement, options?: UnknownRecord): Promise<boolean>;
  };
  BoatyardPaneNavigation?: {
    openProjectWebApp(projectId: string | undefined, webAppId: string, url: string): boolean;
  };
  BoatyardPluginRegistry: PluginRegistryApi;
  BoatyardPluginSettingsFields: PluginSettingsFieldsApi;
  BoatyardWidgetRegistry: WidgetRegistryApi;
};

declare global {
  interface Window extends BoatyardRendererGlobals {}
}
