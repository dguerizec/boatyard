type PierProject = PluginRegistryRecord & {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  sourcePath?: unknown;
};

type PierConfig = {
  pierApiUrl?: string;
  pierPreviewUrl?: string;
  pierProjectName?: string;
  pierUrl?: string;
  pierWorktreeDirectory?: string;
  pierWorktreePattern?: string;
};

type PierOptions = {
  globalPluginConfig?: PierConfig;
  openProjectWebApp?: (webAppId: string, url: string) => boolean;
  pluginConfig?: PierConfig;
};

type PierWorkload = {
  project?: string;
  running?: boolean;
  slug?: string;
  status?: string;
  url?: string;
  urls?: Array<{ default?: boolean; url?: string }>;
  worktreePath?: string;
};

type PierProjectEntry = {
  name?: string;
  repo_path?: string;
};

type PierWorktreePayload = {
  branchName?: string;
  force?: boolean;
  fromRef?: string;
  purge?: boolean;
  skipDown?: boolean;
  startAfterCreate?: boolean;
  worktreePath?: string;
};

type PierUrlRow = HTMLDivElement & {
  pierActionButton: HTMLButtonElement;
  pierEntry: PierWorkload;
  pierLink: HTMLAnchorElement;
  pierPathButton: HTMLButtonElement;
  pierPathText: HTMLSpanElement;
  pierProject: PierProject;
  pierRemoveButton: HTMLButtonElement;
};

type PierService = {
  createWorktree(project: PierProject, payload?: PierWorktreePayload): Promise<unknown> | undefined;
  down(workload: PierWorkload, options?: PierOptions): Promise<unknown>;
  listProjectWorkloads(project: PierProject, options?: PierOptions): Promise<PierWorkload[]>;
  openUrl(entry: PierWorkload | string, options?: PierOptions): unknown;
  removeWorktree(project: PierProject, payload?: PierWorktreePayload): Promise<unknown> | undefined;
  up(workload: PierWorkload, options?: PierOptions): Promise<unknown>;
};

type PierFieldContext = {
  project: PierProject;
};

type PierCoreFieldChangedEvent = {
  coreFields: PierProject;
  field: string;
  fields?: {
    setDefaultValue(key: string, value: string): void;
  };
};

type PierPluginContext = PluginRegistryRecord & {
  events: {
    on<TEvent extends PluginRegistryRecord = PluginRegistryRecord>(eventName: string, callback: (event: TEvent) => void): void;
  };
  panes: {
    register(definition: Record<string, unknown>): void;
  };
  services: {
    provide(id: string, service: unknown): void;
  };
  settings: {
    registerGlobalSection(section: Record<string, unknown>): void;
    registerProjectSection(section: Record<string, unknown>): void;
  };
  status: {
    set(status: unknown): void;
  };
  widgets: {
    register(definition: Record<string, unknown>): void;
    registerAlias(alias: string, targetId: string): void;
  };
};
