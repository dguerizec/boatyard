import type { Bounds } from "./storeUtils";

export type WindowState = {
  bounds: Bounds;
  isMaximized: boolean;
};

export type WebAppOpenRule = {
  pattern: string;
  target: string;
  scope: string;
  label: string;
  sourcePaneId?: string;
  targetLabel?: string;
  projectId?: string;
};

export type SettingsState = {
  projectsBasePath: string;
  blurWebAppOverlays: boolean;
  passwordManagerEnabled: boolean;
  passwordManagerDisclaimerAccepted: boolean;
  widgetRailWidth: number;
  terminalEnv: string;
  webAppOpenRules: WebAppOpenRule[];
};

export type NavigationState = {
  view: string;
  projectId: string | null;
  collapsedProjectGroups: string[];
  pinnedProjectIds: string[];
};

export type AppState = {
  lastSeenVersion: string;
  pendingChangelogFromVersion: string;
  dismissedChangelogVersion: string;
};

export type OnboardingState = {
  completedVersion: number;
  completedAt: string;
};

export type PasswordCredentialState = {
  username: string;
  encryptedPassword: string;
  updatedAt: string;
};

export type WebAppState = {
  url: string;
};

export type WebAppHomeTab = {
  id: string;
  parentWebAppId: string;
  parentLabel: string;
  label: string;
  url: string;
};

export type PaneWebApp = WebAppHomeTab;

export type PaneLayoutNode = {
  type: "pane";
  id: string;
  selectedWebAppId?: string;
  transientWebApp?: PaneWebApp;
} | {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: PaneLayoutNode;
  second: PaneLayoutNode;
  expandedChild?: "first" | "second";
};

export type WidgetSize = {
  columns: number;
  rows: number;
};

export type WidgetPosition = {
  x: number;
  y: number;
};

export type WidgetLayout = {
  order: string[];
  hidden: string[];
  sizes: Record<string, WidgetSize>;
  positions: Record<string, WidgetPosition>;
  locked: boolean;
};

export type ProjectWidgetLayout = {
  panes: Record<string, WidgetLayout>;
};

export type PluginConfigValue = string | number | boolean;
export type PluginConfigObject = Record<string, PluginConfigValue>;

export type ProjectUrl = {
  id: string;
  label: string;
  url: string;
};

export type ProjectWidgetPane = {
  id: string;
  label: string;
};

export type StoredProject = {
  id: string;
  slug: string;
  name: string;
  group: string;
  sourcePath: string;
  gitUrl: string;
  repoUrl: string;
  devBranch: string;
  terminalEnv: string;
  previewUrl: string;
  urls: ProjectUrl[];
  webAppHomeTabs: WebAppHomeTab[];
  webAppOpenRules: WebAppOpenRule[];
  widgetPanes: ProjectWidgetPane[];
  bounds: Bounds;
  isOpen: boolean;
};

export type ProjectStoreState = {
  app: AppState;
  globalUrls: ProjectUrl[];
  navigation: NavigationState;
  onboarding: OnboardingState;
  paneLayouts: Record<string, PaneLayoutNode>;
  passwordVault: Record<string, PasswordCredentialState>;
  pluginConfig: {
    global: Record<string, PluginConfigObject>;
    projects: Record<string, Record<string, PluginConfigObject>>;
  };
  plugins: {
    enabled: Record<string, boolean>;
  };
  projects: StoredProject[];
  schemaVersion: number;
  settings: SettingsState;
  terminalSelections: Record<string, Record<string, string>>;
  terminalTabOrders: Record<string, string[]>;
  webApps: Record<string, WebAppState>;
  widgetLayouts: Record<string, ProjectWidgetLayout>;
  window: WindowState;
};
