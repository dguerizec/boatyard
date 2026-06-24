type NavigationState = {
  projectId?: string | null;
  view?: string;
};

type RendererNavigationControllerOptions = {
  closeProjectGroupMenu: () => void;
  closeTerminalTabMenu: () => void;
  getCollapsedProjectGroups: () => Set<string>;
  hasProject: (projectId?: string | null) => boolean;
  render: () => void;
  updateNavigation: (values: {
    collapsedProjectGroups: string[];
    projectId: string | null;
    view: string;
  }) => Promise<unknown>;
};

function isRestorableView(view: string) {
  return ["global", "global-settings", "project", "project-edit"].includes(view);
}

export function createRendererNavigationController({
  closeProjectGroupMenu,
  closeTerminalTabMenu,
  getCollapsedProjectGroups,
  hasProject,
  render,
  updateNavigation
}: RendererNavigationControllerOptions) {
  let currentView = "global";
  let currentProjectId: string | null = null;
  let returnView = { view: "global", projectId: null as string | null };

  function persistNavigation() {
    if (!isRestorableView(currentView)) {
      return;
    }

    updateNavigation({
      view: currentView,
      projectId: currentProjectId,
      collapsedProjectGroups: [...getCollapsedProjectGroups()]
    }).catch((error) => {
      console.error("Could not persist navigation:", error);
    });
  }

  function setCurrentView(view: string, projectId: string | null = null, { persist = true } = {}) {
    if (view !== currentView || projectId !== currentProjectId) {
      closeProjectGroupMenu();
      closeTerminalTabMenu();
    }

    currentView = view;
    currentProjectId = projectId;

    if (persist) {
      persistNavigation();
    }
  }

  function restoreNavigation(navigation: NavigationState = {}) {
    if (navigation.view === "global-settings") {
      setCurrentView("global-settings", null, { persist: false });
    } else if ((navigation.view === "project" || navigation.view === "project-edit") && hasProject(navigation.projectId)) {
      setCurrentView(navigation.view, navigation.projectId || null, { persist: false });
    } else {
      setCurrentView("global", null, { persist: false });
    }
  }

  function selectGlobal() {
    setCurrentView("global");
    render();
  }

  function selectGlobalSettings() {
    setCurrentView("global-settings");
    render();
  }

  function selectCreateProject() {
    if (currentView !== "project-create") {
      returnView = {
        view: currentView,
        projectId: currentProjectId
      };
    }
    setCurrentView("project-create", null, { persist: false });
    render();
  }

  function selectProject(id: string) {
    setCurrentView("project", id);
    render();
  }

  function selectEditProject(id: string) {
    setCurrentView("project-edit", id);
    render();
  }

  function reloadProjectSettings(id: string) {
    setCurrentView("project-edit", id);
    render();
  }

  function restoreReturnView() {
    if (returnView.view === "project" && hasProject(returnView.projectId)) {
      selectProject(returnView.projectId as string);
      return;
    }

    selectGlobal();
  }

  return Object.freeze({
    getCurrentProjectId: () => currentProjectId,
    getCurrentView: () => currentView,
    reloadProjectSettings,
    restoreNavigation,
    restoreReturnView,
    selectCreateProject,
    selectEditProject,
    selectGlobal,
    selectGlobalSettings,
    selectProject,
    setCurrentView
  });
}
