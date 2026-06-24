import type { RendererProject } from "./rendererTypes.js";

type WorkspaceDashboardViewState = {
  currentProjectId?: string | null;
  currentView?: string;
};

type WorkspaceDashboardViewsOptions = {
  closeProjectGroupMenu: () => void;
  closeTerminalTabMenu: () => void;
  closeWebAppTabMenu: () => void;
  closeWidgetAddMenu: () => void;
  createPaneLayout: (project: RendererProject, paneLayout: unknown) => HTMLElement;
  dashboardGrid: HTMLElement;
  detachProjectTerminal: (projectId?: string) => void;
  getGlobalWorkspace: () => RendererProject;
  getPaneLayout: (project: RendererProject) => unknown;
  getProjectSummaryTarget: (project: RendererProject) => string;
  getViewState: () => WorkspaceDashboardViewState;
  resetVisibleWebAppHosts: () => void;
  workspace: HTMLElement;
  workspaceKicker: HTMLElement;
  workspaceSummary: HTMLElement;
  workspaceTitle: HTMLElement;
};

export function createWorkspaceDashboardViews({
  closeProjectGroupMenu,
  closeTerminalTabMenu,
  closeWebAppTabMenu,
  closeWidgetAddMenu,
  createPaneLayout,
  dashboardGrid,
  detachProjectTerminal,
  getGlobalWorkspace,
  getPaneLayout,
  getProjectSummaryTarget,
  getViewState,
  resetVisibleWebAppHosts,
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
}: WorkspaceDashboardViewsOptions) {
  function renderGlobalDashboard() {
    const globalWorkspace = getGlobalWorkspace();
    closeWidgetAddMenu();
    closeProjectGroupMenu();
    closeTerminalTabMenu();
    resetVisibleWebAppHosts();
    workspace.classList.add("project-mode");
    workspaceKicker.textContent = "Global";
    workspaceTitle.textContent = "System overview";
    workspaceSummary.textContent = "Global workspace for cross-project widgets and operations dashboards.";
    dashboardGrid.innerHTML = "";
    dashboardGrid.className = "project-workbench";
    dashboardGrid.style.gridTemplateColumns = "";

    dashboardGrid.append(createPaneLayout(globalWorkspace, getPaneLayout(globalWorkspace)));
  }

  function renderGlobalPaneArea() {
    if (
      getViewState().currentView !== "global" ||
      !dashboardGrid.classList.contains("project-workbench")
    ) {
      renderGlobalDashboard();
      return;
    }

    const globalWorkspace = getGlobalWorkspace();
    closeWebAppTabMenu();
    closeProjectGroupMenu();
    closeTerminalTabMenu();
    resetVisibleWebAppHosts();
    const paneLayoutElement = createPaneLayout(globalWorkspace, getPaneLayout(globalWorkspace));
    const currentPaneLayoutElement = dashboardGrid.lastElementChild;

    if (!currentPaneLayoutElement) {
      renderGlobalDashboard();
      return;
    }

    currentPaneLayoutElement.replaceWith(paneLayoutElement);
  }

  function renderProjectDashboard(project: RendererProject) {
    closeWidgetAddMenu();
    closeTerminalTabMenu();
    detachProjectTerminal(project.id);
    workspace.classList.add("project-mode");
    workspaceKicker.textContent = "Project";
    workspaceTitle.textContent = project.name || "";
    workspaceSummary.textContent = getProjectSummaryTarget(project);
    dashboardGrid.innerHTML = "";
    dashboardGrid.className = "project-workbench";
    dashboardGrid.style.gridTemplateColumns = "";
    resetVisibleWebAppHosts();

    dashboardGrid.append(createPaneLayout(project, getPaneLayout(project)));
  }

  function renderProjectPaneArea(project: RendererProject) {
    const viewState = getViewState();
    if (
      viewState.currentView !== "project" ||
      viewState.currentProjectId !== project.id ||
      !dashboardGrid.classList.contains("project-workbench")
    ) {
      renderProjectDashboard(project);
      return;
    }

    closeWebAppTabMenu();
    closeTerminalTabMenu();
    resetVisibleWebAppHosts();
    const paneLayoutElement = createPaneLayout(project, getPaneLayout(project));
    const currentPaneLayoutElement = dashboardGrid.lastElementChild;

    if (!currentPaneLayoutElement) {
      renderProjectDashboard(project);
      return;
    }

    currentPaneLayoutElement.replaceWith(paneLayoutElement);
  }

  return Object.freeze({
    renderGlobalDashboard,
    renderGlobalPaneArea,
    renderProjectDashboard,
    renderProjectPaneArea
  });
}
