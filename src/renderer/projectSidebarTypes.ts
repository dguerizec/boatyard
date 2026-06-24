import type { UnknownRecord } from "./rendererRecords.js";
import type { ProjectNavBadgeRenderOptions, RendererProject } from "./rendererTypes.js";

export type ProjectNavRowOptions = {
  grouped?: boolean;
  groupName?: string;
};

export type ProjectGroupDragOptions = {
  dragImage?: "collapsed-group";
};

export type ProjectSidebarElements = {
  addProjectButton: HTMLButtonElement;
  globalNav: HTMLElement;
  globalNavRow: HTMLElement;
  globalViewButton: HTMLButtonElement;
  projectCount: HTMLElement;
  projectList: HTMLElement;
  projectSearchInput: HTMLInputElement;
};

export type ProjectSidebarViewState = {
  currentProjectId?: string | null;
  currentView?: string;
};

export type ProjectListInsertionTarget = {
  beforeNode: Element | null;
  beforeProjectId: string | null;
  groupName?: string;
};

export type ProjectSidebarOptions = {
  applyFormControl: (control: HTMLElement) => void;
  clamp: (value: number, min: number, max: number) => number;
  elements: ProjectSidebarElements;
  ensureOnboardingDemoProject: () => Promise<unknown> | unknown;
  getCollapsedProjectGroups: () => Set<string>;
  getProjectGroups: () => string[];
  getProjectGroupsByName: (projects?: RendererProject[]) => Map<string, RendererProject[]>;
  getProjects: () => RendererProject[];
  getViewState: () => ProjectSidebarViewState;
  isOnboardingDemoProjectVisible: () => boolean;
  normalizeProjectSearchText: (value: unknown) => string;
  projectMatchesSearch: (project: RendererProject, query: string) => boolean;
  renderApp: () => void;
  renderProjectNavBadges: (
    project: RendererProject,
    container: HTMLElement,
    options?: ProjectNavBadgeRenderOptions
  ) => void;
  renderSidebarUpdateNotice: () => void;
  reorderProjectIds: (projectIds: string[]) => Promise<unknown>;
  selectEditProject: (projectId: string) => void;
  selectProject: (projectId: string) => void;
  showOverlayDialog: (dialog: HTMLDialogElement, options: UnknownRecord) => Promise<boolean>;
  updateNavigation: (values: UnknownRecord) => Promise<unknown>;
  updateProject: (projectId: string, values: UnknownRecord) => Promise<unknown>;
};
