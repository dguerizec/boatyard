import type { UnknownRecord } from "./rendererRecords";
import type { RendererProject, RendererState } from "./rendererTypes";
import { createSettingsShell } from "./settingsShell.js";

type ProjectPageViewsOptions = {
  addProject: (values: UnknownRecord) => Promise<RendererState>;
  createProjectDangerZone: (options: UnknownRecord) => HTMLElement;
  createProjectFormView: (options: UnknownRecord) => HTMLElement;
  createProjectTerminalSettingsForm: (options: UnknownRecord) => HTMLElement;
  createProjectUrlsForm: (options: UnknownRecord) => HTMLElement;
  createProjectWebAppHomeTabsForm: (options: UnknownRecord) => HTMLElement;
  createProjectWebAppOpenRulesForm: (options: UnknownRecord) => HTMLElement;
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
  createProjectWebAppOpenRulesForm,
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
  let activeProjectSettingsSectionId = "general";

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
        if (!project?.id) {
          throw new Error("Created project is missing an id.");
        }
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
    const projectId = project.id;
    if (!projectId) {
      return;
    }
    prepareProjectFormPage("project-form-layout project-settings-layout");
    workspaceTitle.textContent = `${project.name} settings`;
    workspaceSummary.textContent = project.slug || "";

    const projectDetails = createProjectFormView({
      deferred: true,
      title: "Project settings",
      submitLabel: "Save changes",
      initialValues: project,
      onCancel: () => selectProject(projectId),
      onSubmit: async (values: UnknownRecord) => {
        let nextState = await updateProject(projectId, {
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
          projectId,
          values.pluginConfig as UnknownRecord | undefined
        );
        setState(nextState);
      }
    });

    const terminalSettings = createProjectTerminalSettingsForm({
      project,
      onSubmit: async (values: UnknownRecord) => {
        setState(await updateProject(projectId, values));
      }
    });
    const projectUrls = createProjectUrlsForm({
      project,
      onSubmit: async (urls: UnknownRecord[]) => {
        setState(await updateProject(projectId, { urls }));
      }
    });
    const homeTabs = createProjectWebAppHomeTabsForm({
      project,
      onSubmit: async (homeTabs: UnknownRecord[]) => {
        setState(await updateWebAppHomeTabs(projectId, homeTabs));
      }
    });
    const openRules = createProjectWebAppOpenRulesForm({
      project,
      onSubmit: async (webAppOpenRules: UnknownRecord[]) => {
        setState(await updateProject(projectId, { webAppOpenRules }));
      }
    });
    const widgetPanes = createProjectWidgetPanesForm({
      project,
      onSubmit: async (widgetPanes: UnknownRecord[]) => {
        setState(await updateProject(projectId, { widgetPanes }));
      }
    });
    const dangerZone = createProjectDangerZone({
      project,
      onUnregister: async () => {
        setState(await removeProject(projectId));
        selectGlobal();
      }
    });

    const shell = createSettingsShell({
      ariaLabel: "Project settings categories",
      className: "project-settings-shell",
      groups: [
        { id: "project", label: "Project" },
        { id: "workspace", label: "Workspace" },
        { id: "system", label: "System" }
      ],
      initialSectionId: activeProjectSettingsSectionId,
      onDiscard() {
        reloadProjectSettings(projectId);
      },
      onSaveComplete() {
        reloadProjectSettings(projectId);
      },
      onSectionChange(sectionId) {
        activeProjectSettingsSectionId = sectionId;
      },
      sections: [
        {
          id: "general",
          label: "General",
          description: "Project identity, source checkout, and linked integrations.",
          group: "project",
          icon: "sliders",
          keywords: ["name", "slug", "group", "source", "git", "repository", "plugins", "integrations"],
          elements: [projectDetails]
        },
        {
          id: "terminal",
          label: "Terminal",
          description: "Environment variables applied to this project's terminal sessions.",
          group: "project",
          icon: "terminal",
          keywords: ["environment", "variables", "shell"],
          elements: [terminalSettings]
        },
        {
          id: "web-apps",
          label: "Web apps",
          description: "Project links, home tabs, and URL opening behavior.",
          group: "workspace",
          icon: "settingsGlobe",
          keywords: ["urls", "links", "tabs", "opening", "rules"],
          elements: [projectUrls, homeTabs, openRules]
        },
        {
          id: "widgets",
          label: "Widgets",
          description: "Named widget panes available in this project.",
          group: "workspace",
          icon: "grid",
          keywords: ["panes", "tabs", "layout"],
          elements: [widgetPanes]
        },
        {
          id: "danger",
          label: "Danger zone",
          description: "Remove this project from Boatyard without deleting its files.",
          group: "system",
          icon: "trash",
          keywords: ["unregister", "remove", "delete"],
          elements: [dangerZone]
        }
      ]
    });

    dashboardGrid.append(shell.element);
  }

  return Object.freeze({
    renderCreateProjectPage,
    renderEditProjectPage
  });
}
