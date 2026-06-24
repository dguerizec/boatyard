import type { RendererProject, RendererState } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

type RendererStateSelectorsOptions = {
  defaultWidgetPaneId: string;
  getCurrentProjectId: () => string | null;
  getManualSource: () => unknown;
  getState: () => RendererState;
  globalWorkspaceId: string;
};

export function createRendererStateSelectors({
  defaultWidgetPaneId,
  getCurrentProjectId,
  getManualSource,
  getState,
  globalWorkspaceId
}: RendererStateSelectorsOptions) {
  function getProjects() {
    return getState().projects;
  }

  function getProjectGroups() {
    const groups = [...new Set(getProjects()
      .map((project) => String(project.group || "").trim())
      .filter((group): group is string => Boolean(group)))];
    return groups.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }

  function getCollapsedProjectGroups() {
    const state = getState();
    return new Set(Array.isArray(state.navigation?.collapsedProjectGroups)
      ? state.navigation.collapsedProjectGroups
      : []);
  }

  function getProjectGroupsByName(projects = getProjects()) {
    const groups = new Map<string, RendererProject[]>();

    for (const project of projects) {
      const groupName = String(project.group || "").trim();
      if (!groupName) {
        continue;
      }

      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName)?.push(project);
    }

    return groups;
  }

  function getSettings() {
    return {
      projectsBasePath: "",
      blurWebAppOverlays: false,
      passwordManagerDisclaimerAccepted: false,
      passwordManagerEnabled: false,
      webAppOpenRules: [],
      widgetRailWidth: 340,
      terminalEnv: "",
      ...(getState().settings || {})
    };
  }

  function getManual() {
    return getManualSource() || {
      title: "Boatyard Manual",
      description: "",
      sections: [],
      onboarding: []
    };
  }

  function getCurrentProject() {
    return getProjects().find((project) => project.id === getCurrentProjectId()) || null;
  }

  function getProjectById(projectId?: string) {
    return getProjects().find((project) => project.id === projectId) || null;
  }

  function getGlobalWorkspace(): RendererProject & { id: string; name: string; slug: string } {
    const state = getState();
    return {
      id: globalWorkspaceId,
      name: "Global",
      slug: "global",
      urls: state.globalUrls || [],
      widgetPanes: [{
        id: defaultWidgetPaneId,
        label: "Widgets"
      }],
      isGlobalWorkspace: true
    };
  }

  function isGlobalWorkspace(project?: RendererProject | null) {
    return project?.isGlobalWorkspace === true || project?.id === globalWorkspaceId;
  }

  function getProjectPluginConfig(projectId?: string, pluginId?: string) {
    return getState().pluginConfig?.projects?.[projectId || ""]?.[pluginId || ""] || {};
  }

  function getGlobalPluginConfig(pluginId?: string) {
    return getState().pluginConfig?.global?.[pluginId || ""] || {};
  }

  function getPluginEnabledState() {
    return getState().plugins?.enabled || {};
  }

  function getProjectSummaryTarget(project: UnknownRecord) {
    return String(project.sourcePath || project.slug || "");
  }

  return Object.freeze({
    getCollapsedProjectGroups,
    getCurrentProject,
    getGlobalPluginConfig,
    getGlobalWorkspace,
    getManual,
    getPluginEnabledState,
    getProjectById,
    getProjectGroups,
    getProjectGroupsByName,
    getProjectPluginConfig,
    getProjects,
    getProjectSummaryTarget,
    getSettings,
    isGlobalWorkspace
  });
}
