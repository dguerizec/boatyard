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
    sidebarCollapsed?: boolean;
    view?: string;
  };
  layouts?: WorkspaceLayout[];
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
  topbarWidgets?: {
    order?: string[];
  };
  webApps?: Record<string, { faviconPageUrl?: string; faviconUrl?: string; url?: string }>;
};

export type WebAppPaneNavigationItem = {
  activeUrlPatterns?: string[];
  id: string;
  label: string;
  url?: string;
  webAppId?: string;
};

export type WebAppPaneNavigation = {
  browserControls?: "compact" | "full" | "hidden";
  items: WebAppPaneNavigationItem[];
  showAddressBar?: boolean;
  showHomeButton?: boolean;
};

export type WebAppPaneSidePanel = {
  defaultOpen: boolean;
  defaultWidth: number;
  maxWidth: number;
  minMainWidth: number;
  minWidth: number;
  position: "left" | "right";
  title: string;
};

export type WebAppDefinition = UnknownRecord & {
  backgroundColor?: string;
  faviconUrl?: string;
  homeTab?: boolean;
  icon?: string;
  iconOnly?: boolean;
  iconUrl?: string;
  id?: string;
  key?: string;
  label?: unknown;
  minHeight?: string;
  minWidth?: string;
  menuOnly?: boolean;
  mobileDev?: boolean;
  navigation?: WebAppPaneNavigation;
  pluginPane?: UnknownRecord;
  parentLabel?: string;
  parentWebAppId?: string;
  paneTypeId?: string;
  restoreUrl?: boolean;
  showInMenu?: boolean;
  sidePanel?: WebAppPaneSidePanel;
  transient?: boolean;
  url?: string;
};

export type WorkspaceLayoutPaneNode = {
  type: "pane";
  id: string;
  paneTypeId: string | null;
} | {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: WorkspaceLayoutPaneNode;
  second: WorkspaceLayoutPaneNode;
};

export type WorkspaceLayout = {
  id: string;
  name: string;
  builtIn?: boolean;
  paneLayout: WorkspaceLayoutPaneNode;
  projectId: string | null;
};

export type WorkspaceLayoutPreviewMetrics = {
  windowAspectRatio: number;
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
  applyPaneClose(project: RendererProject, paneId: string): boolean;
  applyPaneSplit(project: RendererProject, paneId: string, replacement: RendererPaneLayoutNode): boolean;
  collectPaneNodes(node: RendererPaneLayoutNode | null | undefined, panes?: RendererPaneNode[]): RendererPaneNode[];
  countPaneNodes(node: RendererPaneLayoutNode | null | undefined): number;
  createSplitNode(project: RendererProject, direction: string, first: RendererPaneLayoutNode, selectedWebAppId?: string | null): RendererPaneLayoutNode;
  deleteSelectedWebAppForPane(paneId: string): unknown;
  deleteSelectedWebAppForProject(projectId?: string): unknown;
  findFirstPaneNode(node: RendererPaneLayoutNode | null | undefined): RendererPaneNode | null;
  findPaneNode(node: RendererPaneLayoutNode | null | undefined, paneId?: string): RendererPaneNode | null;
  findPaneNodeBySelectedWebApp(node: RendererPaneLayoutNode | null | undefined, webAppId?: string): RendererPaneNode | null;
  getPaneLayout(project: RendererProject): RendererPaneLayoutNode;
  getPaneStructuralActionState(project: RendererProject, paneId: string): { canClose: boolean; canSplit: boolean };
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
  describeMobileDevViewport(webApp: WebAppDefinition): {
    enabled: boolean;
    height: number;
    width: number;
  } | null;
  renderPaneLayoutPreservingPanes(project: RendererProject, options?: UnknownRecord): void;
  updateMobileDevViewport(
    project: RendererProject,
    paneId: string,
    webApp: WebAppDefinition,
    update: { enabled?: boolean; height?: number; width?: number },
    options?: { render?: boolean }
  ): { enabled: boolean; height: number; width: number } | null;
};

export type WidgetSurfacesInstance = RendererModuleInstance & {
  getProjectWidgetPanes(project: RendererProject): UnknownRecord[];
};

export type WebAppMenusInstance = RendererModuleInstance & {
  applyWebAppOpenChoice(payload: UnknownRecord, choice: UnknownRecord): Promise<unknown>;
  assignWebAppToPane(
    project: RendererProject,
    pane: RendererPaneNode,
    webApp: WebAppDefinition,
    options?: { render?: boolean }
  ): void;
};

export type UpdateViewsInstance = RendererModuleInstance & {
  createGlobalUpdateCard(): HTMLElement;
};

export type GlobalSettingsViewsInstance = RendererModuleInstance & {
  createGlobalMcpSettingsForm(): HTMLElement;
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
  applyLayout(payload: UnknownRecord): Promise<{ state: RendererState; undoToken: string }>;
  createWorkspaceWindow?: () => Promise<boolean>;
  dispatchWebAppEvent(...payload: unknown[]): Promise<unknown>;
  dismissChangelog?: () => Promise<unknown>;
  freezeWebApps(options?: unknown): Promise<unknown>;
  getChangelogHistory?: () => Promise<unknown>;
  getPendingChangelog?: () => Promise<unknown>;
  getLayoutPreviewMetrics(): Promise<WorkspaceLayoutPreviewMetrics>;
  getWebAppTextContent(...payload: unknown[]): Promise<unknown>;
  listLayouts(projectId?: string | null): Promise<WorkspaceLayout[]>;
  getWebAppNavigationHistory?: (key: unknown) => Promise<unknown>;
  getState(): Promise<RendererState>;
  getMcpStatus?: () => Promise<UnknownRecord>;
  installMcpAgentConnection?: (targetId: string) => Promise<unknown>;
  installMcpSkill?: (targetId: string) => Promise<unknown>;
  listMcpAgentConnections?: () => Promise<unknown>;
  listMcpSkillTargets?: () => Promise<unknown>;
  getUpdateInfo?: () => Promise<unknown>;
  hideWebApp(): Promise<unknown>;
  navigateWebApp(...payload: unknown[]): Promise<unknown>;
  openWebAppModal(options: UnknownRecord): Promise<unknown>;
  onTerminalData(callback: (payload: { terminalId: unknown; data: unknown }) => void): void;
  onTerminalExit(callback: (payload: { terminalId: unknown; projectId: unknown; windowId: unknown }) => void): void;
  onMcpRequest?: (callback: (payload: unknown) => void) => void;
  onWebAppAutofillChanged?: (callback: (payload: { enabled?: boolean; key?: string }) => void) => void;
  onWebAppFaviconChanged?: (callback: (payload: { favicons?: string[]; key?: string; url?: string }) => void) => void;
  onWebAppLoaded?: (callback: (payload: { key?: string; url?: string }) => void) => void;
  onWebAppOpenUrlRequested?: (callback: (payload: UnknownRecord & { target?: string }) => void) => void;
  onWorkspaceNavigationChanged?: (callback: (navigation: RendererState["navigation"]) => void) => void;
  onWebAppUrlChanged(callback: (payload: { key?: string; url?: string }) => void): void;
  openExternal(url: string): unknown;
  prepareUpdate?: () => Promise<unknown>;
  removeProject(projectId: string): Promise<RendererState>;
  removeLayout(layoutId: string): Promise<boolean>;
  reorderProjects(projectIds: string[]): Promise<RendererState>;
  restoreWebApps(token?: unknown): Promise<unknown>;
  restartToUpdate(update: UnknownRecord): Promise<unknown>;
  respondMcpRequest?: (payload: unknown) => void;
  saveLayout(layout: WorkspaceLayout): Promise<WorkspaceLayout>;
  setTheme?: (theme: "dark" | "light") => Promise<unknown>;
  setVisibleWebApps(...payload: unknown[]): Promise<unknown>;
  showWebApp(...payload: unknown[]): Promise<unknown>;
  updateGlobalPluginConfig(pluginId: string, values: UnknownRecord): Promise<RendererState>;
  updateGlobalUrls(urls: UnknownRecord[]): Promise<RendererState>;
  updateNavigation(values: UnknownRecord): Promise<UnknownRecord>;
  updateOnboarding(values: UnknownRecord): Promise<RendererState["onboarding"]>;
  updatePaneLayout(projectId: string | null | undefined, layout: unknown): Promise<RendererState>;
  updateMcpSettings?: (settings: UnknownRecord) => Promise<UnknownRecord>;
  updateTopbarWidgets(topbarWidgets: unknown): Promise<{ order: string[] }>;
  updatePluginEnabled(pluginId: string, enabled: boolean): Promise<RendererState>;
  updateProject(projectId: string, values: UnknownRecord): Promise<RendererState>;
  updateProjectPluginConfig(projectId: string, pluginId: string, config: UnknownRecord): Promise<RendererState>;
  updateSettings(values: UnknownRecord): Promise<RendererState>;
  updateWebAppAutofill(...payload: unknown[]): Promise<unknown>;
  updateWebAppHomeTab(projectId: string, tab: UnknownRecord): Promise<RendererState>;
  updateWebAppHomeTabs(projectId: string, tabs: UnknownRecord[]): Promise<RendererState>;
  rotateMcpToken?: () => Promise<UnknownRecord>;
  uninstallMcpAgentConnection?: (targetId: string, force?: boolean) => Promise<unknown>;
  uninstallMcpSkill?: (targetId: string, force?: boolean) => Promise<unknown>;
  writeClipboardText?: (text: string) => Promise<unknown>;
  undoLayout(undoToken: string): Promise<RendererState | null>;
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
    activateProjectWebApp(
      projectId: string | undefined,
      webAppId: string,
      url: string,
      options?: { restoreSourceWebAppUrl?: string; sourceWebAppKey?: string }
    ): boolean;
    openProjectWebApp(projectId: string | undefined, webAppId: string, url: string): boolean;
    openProjectWebAppInPage(projectId: string | undefined, webAppId: string, url: string): boolean;
  };
  BoatyardPluginRegistry: PluginRegistryApi;
  BoatyardPluginSettingsFields: PluginSettingsFieldsApi;
  BoatyardWidgetRegistry: WidgetRegistryApi;
};

declare global {
  interface Window extends BoatyardRendererGlobals {}
}
