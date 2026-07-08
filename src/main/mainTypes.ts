import type {
  Rectangle,
  WebContentsView as ElectronWebContentsView
} from "electron";

export type UnknownRecord = Record<string, unknown>;

export type WebAppOpenRule = {
  pattern?: string;
  projectId?: string;
  scope?: string;
  sourcePaneId?: string;
  target?: string;
  targetLabel?: string;
};

export type MainProject = UnknownRecord & {
  id?: string;
  name?: string;
  slug?: string;
  sourcePath?: string;
};

export type AppState = UnknownRecord & {
  projects: MainProject[];
  settings?: UnknownRecord & {
    projectsBasePath?: string;
    webAppOpenRules?: WebAppOpenRule[];
  };
};

export type ProjectStoreInstance = {
  addProject(values: unknown): unknown;
  dismissChangelog(version: string): unknown;
  getAppState(): unknown;
  getState(): AppState;
  getWebAppUrl(key: string): string;
  getWindowState(): { bounds: Partial<Rectangle>; isMaximized?: boolean };
  load(): unknown;
  reconcileAppVersion(version: string): unknown;
  removeProject(id: string): unknown;
  reorderProjects(projectIds: unknown): unknown;
  updateGlobalPluginConfig(pluginId: string, patch: unknown): unknown;
  updateGlobalUrls(urls: unknown): unknown;
  updateNavigation(navigation: unknown): unknown;
  updateOnboarding(onboarding: unknown): unknown;
  updatePaneLayout(projectId: string | null | undefined, layout: unknown): unknown;
  updatePluginEnabled(pluginId: string, enabled: boolean): unknown;
  updateProject(id: string, patch: unknown): unknown;
  updateProjectPluginConfig(projectId: string, pluginId: string, patch: unknown): unknown;
  updateSettings(patch: UnknownRecord): unknown;
  updateTerminalSelection(projectId: string, surfaceKey: string, windowId: string): unknown;
  updateTerminalTabOrder(projectId: string, windowIds: unknown): unknown;
  updateWebAppHomeTab(projectId: string, tab: unknown): unknown;
  updateWebAppHomeTabs(projectId: string, tabs: unknown): unknown;
  updateWebAppState(key: string, state: UnknownRecord): unknown;
  updateTopbarWidgets(topbarWidgets: unknown): unknown;
  updateWidgetLayout(projectId: string | null | undefined, layout: unknown): unknown;
  updateWindowState(state: { bounds: Rectangle; isMaximized: boolean }): unknown;
};

export type TerminalServiceInstance = {
  attach(projectId: string, windowId: string, size: unknown): unknown;
  closeTab(projectId: string, windowId: string): unknown;
  createTab(projectId: string, name: string): unknown;
  detach(terminalId: string): unknown;
  detachAll(): unknown;
  listTabs(projectId: string): unknown;
  renameTab(projectId: string, windowId: string, name: string): unknown;
  resize(terminalId: string, size: unknown): unknown;
  write(terminalId: string, data: string): void;
};

export type PasswordManagerInstance = {
  getCredential(url: string): unknown;
  getStatus(): { encryptionAvailable?: boolean };
  saveCredential(credential: unknown): unknown;
};

export type PluginHostInstance = {
  applyStateMigrations(): Promise<unknown>;
  discover(): unknown;
  inspectSourcePath(values: UnknownRecord): Promise<unknown>;
  invoke(pluginId: string, actionName: string, payload: unknown): unknown;
  listRendererPlugins(): unknown;
};

export type UpdateManagerInstance = {
  checkForUpdates(): unknown;
  cleanupOldAppImages(): Promise<unknown>;
  ensureCurrentAppImageInstalled(): Promise<unknown>;
  getPendingChangelog(): unknown;
  getUpdateInfo(): unknown;
  prepareUpdate(): unknown;
  readChangelogReleases(): unknown;
  restartToUpdate(update: unknown): unknown;
};

export type WebAppItem = {
  autofillEnabled: boolean;
  bounds: Rectangle | null;
  url: string | null;
  view: ElectronWebContentsView;
};

export type WebAppLookup = {
  item: WebAppItem;
  key: string;
};

export type ShowWebAppPayload = {
  autofillEnabled?: unknown;
  backgroundColor?: unknown;
  bounds?: unknown;
  key?: unknown;
  restoreUrl?: boolean;
  url?: string;
};

export type WebAppOpenOptions = UnknownRecord & {
  sourceBounds?: unknown;
  sourceUrl?: unknown;
  target?: unknown;
};

export type WebAppCapture = {
  bounds: Rectangle;
  dataUrl: string;
  key: string;
};
