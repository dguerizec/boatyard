type PierProject = PluginRegistryRecord & {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  sourcePath?: unknown;
};

type PierConfig = {
  pierApiUrl?: string;
  pierEnabledEntryPoints?: string;
  pierPreviewUrl?: string;
  pierProjectName?: string;
  pierUrl?: string;
  pierWorktreeDirectory?: string;
  pierWorktreePattern?: string;
};

type PierOptions = {
  createIcon?: (name: string) => Node;
  globalPluginConfig?: PierConfig;
  openUrl?: (url: string, options?: { sourceElement?: Element }) => unknown;
  overlay?: {
    freeze(element: Element, options?: { margin?: number }): Promise<void>;
    restore(): Promise<void>;
  };
  pluginConfig?: PierConfig;
};

type PierWorkload = {
  hasWorkload?: boolean;
  indicatorStatus?: "error" | "pending" | "running" | "stopped";
  project?: string;
  primary?: boolean;
  running?: boolean;
  slug?: string;
  status?: string;
  url?: string;
  urls?: PierWorkloadUrl[];
  worktreePath?: string;
};

type PierWorkloadUrl = {
  default?: boolean;
  label?: string;
  url?: string;
};

type PierEntryPoint = {
  default?: boolean;
  key: string;
  label: string;
  title: string;
};

type PierProjectEntry = {
  name?: string;
  repo_path?: string;
};

type PierWorktreePayload = {
  branchName?: string;
  force?: boolean;
  fromRef?: string;
  keepImages?: boolean;
  keepVolumes?: boolean;
  skipDown?: boolean;
  startAfterCreate?: boolean;
  worktreePath?: string;
};

type PierUrlRow = HTMLDivElement & {
  pierCreateIcon: (name: string) => Node;
  pierCopyPathButton: HTMLButtonElement;
  pierCopyUrlButton: HTMLButtonElement;
  pierDownButton: HTMLButtonElement;
  pierEntry: PierWorkload;
  pierLink: HTMLButtonElement;
  pierMenu: HTMLDivElement;
  pierMenuButton: HTMLButtonElement;
  pierMenuSeparator: HTMLDivElement;
  pierOpenUrlButton: HTMLButtonElement;
  pierProject: PierProject;
  pierRemoveButton: HTMLButtonElement;
  pierStatusDot: HTMLSpanElement;
  pierTrackedWorkloadStopButton: HTMLButtonElement;
  pierUpButton: HTMLButtonElement;
};

type PierService = {
  createWorktree(project: PierProject, payload?: PierWorktreePayload): Promise<unknown> | undefined;
  down(workload: PierWorkload, options?: PierOptions): Promise<unknown>;
  getDefaultWorktreePath(project: PierProject, branchName?: unknown, options?: PierOptions): string;
  getProjectAvailability(project: PierProject): Promise<{ available: boolean; worktreePattern: string }>;
  isProjectEnabled(project: PierProject): Promise<boolean>;
  listProjectWorkloads(project: PierProject, options?: PierOptions): Promise<PierWorkload[]>;
  openUrl(entry: PierWorkload | string, options?: PierOptions, sourceElement?: Element): unknown;
  removeWorktree(project: PierProject, payload?: PierWorktreePayload): Promise<unknown> | undefined;
  up(workload: PierWorkload, options?: PierOptions): Promise<unknown>;
};

type PierResourceWorkload = {
  containerCount?: number;
  memoryBytes?: number;
  project?: string;
  slug?: string;
};

type PierResourceProject = {
  containerCount?: number;
  error?: string;
  memoryBytes?: number;
  pierProject?: string;
  projectId?: string;
  projectName?: string;
  workloads?: PierResourceWorkload[];
};

type PierResourceSnapshot = {
  available?: boolean;
  containerCount?: number;
  error?: string;
  errors?: Array<{ message?: string; projectId?: string; projectName?: string }>;
  memoryBytes?: number;
  projects?: PierResourceProject[];
  workloads?: PierResourceWorkload[];
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
