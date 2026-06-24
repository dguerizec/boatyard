import type { UnknownRecord } from "./rendererRecords";
import type { RendererProject, RendererState } from "./rendererTypes";

type ProjectPageViewsOptions = {
  addProject: (values: UnknownRecord) => Promise<RendererState>;
  createProjectDangerZone: (options: UnknownRecord) => HTMLElement;
  createProjectFormView: (options: UnknownRecord) => HTMLElement;
  createProjectTerminalSettingsForm: (options: UnknownRecord) => HTMLElement;
  createProjectUrlsForm: (options: UnknownRecord) => HTMLElement;
  createProjectWebAppHomeTabsForm: (options: UnknownRecord) => HTMLElement;
  createProjectWidgetPanesForm: (options: UnknownRecord) => HTMLElement;
  dashboardGrid: HTMLElement;
  hideWebApps: () => void;
  persistProjectPluginConfig: (projectId: string, pluginConfig?: UnknownRecord) => Promise<RendererState>;
  reloadProjectSettings: (projectId: string) => void;
  removeProject: (projectId: string) => Promise<RendererState>;
  resetVisibleWebAppHosts: () => void;
  restoreReturnView: () => void;
  selectGlobal: () => void;
  selectProject: (projectId: string) => void;
  setState: (state: RendererState) => void;
  updateProject: (projectId: string, values: UnknownRecord) => Promise<RendererState>;
  updateWebAppHomeTabs: (projectId: string, tabs: UnknownRecord[]) => Promise<RendererState>;
  workspace: HTMLElement;
  workspaceKicker: HTMLElement;
  workspaceSummary: HTMLElement;
  workspaceTitle: HTMLElement;
};

export function createProjectPageViews({
  addProject,
  createProjectDangerZone,
  createProjectFormView,
  createProjectTerminalSettingsForm,
  createProjectUrlsForm,
  createProjectWebAppHomeTabsForm,
  createProjectWidgetPanesForm,
  dashboardGrid,
  hideWebApps,
  persistProjectPluginConfig,
  reloadProjectSettings,
  removeProject,
  resetVisibleWebAppHosts,
  restoreReturnView,
  selectGlobal,
  selectProject,
  setState,
  updateProject,
  updateWebAppHomeTabs,
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
}: ProjectPageViewsOptions) {
  function prepareProjectFormPage(className: string) {
    resetVisibleWebAppHosts();
    hideWebApps();
    workspace.classList.remove("project-mode");
    workspaceKicker.textContent = "Project";
    workspaceSummary.textContent = "";
    dashboardGrid.innerHTML = "";
    dashboardGrid.className = className;
    dashboardGrid.style.gridTemplateColumns = "";
  }

  function renderCreateProjectPage() {
    prepareProjectFormPage("project-form-layout");
    workspaceTitle.textContent = "Add project";

    dashboardGrid.append(createProjectFormView({
      title: "Project details",
      submitLabel: "Add project",
      initialValues: {},
      onCancel: () => restoreReturnView(),
      onSubmit: async (values: UnknownRecord) => {
        let nextState = await addProject({
          name: values.name,
          slug: values.slug,
          group: values.group,
          sourcePath: values.sourcePath,
          gitUrl: values.gitUrl,
          repoUrl: values.repoUrl,
          devBranch: values.devBranch,
          isOpen: false
        });
        const project = nextState.projects[nextState.projects.length - 1];
        nextState = await persistProjectPluginConfig(
          project.id,
          values.pluginConfig as UnknownRecord | undefined
        );
        setState(nextState);
        selectProject(project.id);
      }
    }));
  }

  function renderEditProjectPage(project: RendererProject) {
    prepareProjectFormPage("project-form-layout project-settings-layout");
    workspaceTitle.textContent = `${project.name} settings`;
    workspaceSummary.textContent = project.slug || "";

    const primaryColumn = document.createElement("div");
    primaryColumn.className = "project-settings-primary";

    const secondaryColumn = document.createElement("div");
    secondaryColumn.className = "project-settings-secondary";

    primaryColumn.append(createProjectFormView({
      title: "Project settings",
      submitLabel: "Save changes",
      initialValues: project,
      onCancel: () => selectProject(project.id),
      onSubmit: async (values: UnknownRecord) => {
        let nextState = await updateProject(project.id, {
          name: values.name,
          slug: values.slug,
          group: values.group,
          sourcePath: values.sourcePath,
          gitUrl: values.gitUrl,
          repoUrl: values.repoUrl,
          devBranch: values.devBranch
        });
        setState(nextState);
        nextState = await persistProjectPluginConfig(
          project.id,
          values.pluginConfig as UnknownRecord | undefined
        );
        setState(nextState);
        reloadProjectSettings(project.id);
      }
    }));

    secondaryColumn.append(createProjectTerminalSettingsForm({
      project,
      onSubmit: async (values: UnknownRecord) => {
        setState(await updateProject(project.id, values));
        reloadProjectSettings(project.id);
      }
    }), createProjectUrlsForm({
      project,
      onSubmit: async (urls: UnknownRecord[]) => {
        setState(await updateProject(project.id, { urls }));
        reloadProjectSettings(project.id);
      }
    }), createProjectWebAppHomeTabsForm({
      project,
      onSubmit: async (homeTabs: UnknownRecord[]) => {
        setState(await updateWebAppHomeTabs(project.id, homeTabs));
        reloadProjectSettings(project.id);
      }
    }), createProjectWidgetPanesForm({
      project,
      onSubmit: async (widgetPanes: UnknownRecord[]) => {
        setState(await updateProject(project.id, { widgetPanes }));
        reloadProjectSettings(project.id);
      }
    }), createProjectDangerZone({
      project,
      onUnregister: async () => {
        setState(await removeProject(project.id));
        selectGlobal();
      }
    }));

    dashboardGrid.append(primaryColumn, secondaryColumn);
  }

  return Object.freeze({
    renderCreateProjectPage,
    renderEditProjectPage
  });
}
