import type {
  RendererPaneLayoutNode,
  RendererProject,
  WebAppDefinition
} from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

type PluginPaneDefinition = UnknownRecord & {
  key?: string;
  pluginId?: string;
  resolveUrl?: (context: UnknownRecord) => string;
  resolveWebApps?: (context: UnknownRecord) => WebAppDefinition[];
  title?: string;
  webAppId?: string;
};

type ProjectWebAppsOptions = {
  findPaneNode: (layout: unknown, paneId?: string) => RendererPaneLayoutNode | null;
  getGlobalPluginConfig: (pluginId?: string) => UnknownRecord;
  getPaneLayout: (project: RendererProject) => unknown;
  getPluginPaneDefinitions: (filter: UnknownRecord) => PluginPaneDefinition[];
  getProjectPluginConfig: (projectId?: string, pluginId?: string) => UnknownRecord;
  getProjectWidgetPanes: (project: RendererProject) => UnknownRecord[];
  isGlobalWorkspace: (project: RendererProject) => boolean;
};

export function createProjectWebApps({
  findPaneNode,
  getGlobalPluginConfig,
  getPaneLayout,
  getPluginPaneDefinitions,
  getProjectPluginConfig,
  getProjectWidgetPanes,
  isGlobalWorkspace
}: ProjectWebAppsOptions) {
  function getProjectWebApps(project: RendererProject, paneId: string) {
    const paneNode = findPaneNode(getPaneLayout(project), paneId);
    const webApps: WebAppDefinition[] = getProjectWidgetPanes(project).map((widgetPane, index) => ({
      id: `widgets:${widgetPane.id}`,
      label: widgetPane.label || `Widgets ${index + 1}`,
      key: `${paneId}:widgets:${widgetPane.id}`,
      kind: "widgets",
      widgetPane
    }));

    if (paneNode?.transientWebApp?.url && paneNode.selectedWebAppId === paneNode.transientWebApp.id) {
      webApps.push({
        id: paneNode.transientWebApp.id,
        label: paneNode.transientWebApp.label || "Link",
        parentLabel: paneNode.transientWebApp.parentLabel || "",
        parentWebAppId: paneNode.transientWebApp.parentWebAppId || "",
        key: `${paneId}:transient:${paneNode.transientWebApp.id}`,
        url: paneNode.transientWebApp.url,
        restoreUrl: false,
        transient: true
      });
    }

    for (const homeTab of project.webAppHomeTabs || []) {
      webApps.push({
        id: homeTab.id,
        label: homeTab.label || "Link",
        parentLabel: homeTab.parentLabel || "",
        parentWebAppId: homeTab.parentWebAppId || "",
        key: `${paneId}:home:${homeTab.id}`,
        url: homeTab.url,
        homeTab: true,
        homeTabId: homeTab.id
      });
    }

    if (isGlobalWorkspace(project) || project.sourcePath) {
      webApps.push({
        id: "terminal",
        label: "Terminal",
        key: `${paneId}:terminal`,
        kind: "terminal"
      });
    }

    webApps.push({
      id: "manual",
      label: "Manual",
      key: `${paneId}:manual`,
      url: "https://boatyard.dev/doc/",
      restoreUrl: false
    });

    for (const pluginPane of getPluginPaneDefinitions({ scope: isGlobalWorkspace(project) ? "global" : "project", kind: "dom" })) {
      webApps.push({
        id: pluginPane.webAppId,
        label: pluginPane.title,
        key: `${paneId}:${pluginPane.key}`,
        kind: "dom",
        pluginPane
      });
    }

    for (const pluginPane of getPluginPaneDefinitions({ scope: isGlobalWorkspace(project) ? "global" : "project", kind: "wcv" })) {
      const projectPluginConfig = isGlobalWorkspace(project) ? {} : getProjectPluginConfig(project.id, pluginPane.pluginId);
      const context = {
        project,
        projectConfig: projectPluginConfig,
        globalPluginConfig: getGlobalPluginConfig(pluginPane.pluginId)
      };

      if (typeof pluginPane.resolveWebApps === "function") {
        for (const webApp of pluginPane.resolveWebApps(context) || []) {
          if (!webApp?.url) {
            continue;
          }
          webApps.push({
            id: webApp.id || `${pluginPane.webAppId}:${webApp.key || webApp.url}`,
            label: webApp.label || pluginPane.title,
            key: `${paneId}:${pluginPane.key}:${webApp.key || webApp.id || webApp.url}`,
            url: webApp.url,
            restoreUrl: webApp.restoreUrl
          });
        }
        continue;
      }

      const url = pluginPane.resolveUrl?.(context);
      if (!url) {
        continue;
      }

      webApps.push({
        id: pluginPane.webAppId,
        label: pluginPane.title,
        key: `${paneId}:${pluginPane.key}`,
        url
      });
    }

    if (!isGlobalWorkspace(project) && project.repoUrl) {
      webApps.push({
        id: "repo",
        label: "Repo",
        key: `${paneId}:repo`,
        url: project.repoUrl
      });
    }

    for (const projectUrl of project.urls || []) {
      const label = String(projectUrl.label || "");
      const url = String(projectUrl.url || "");
      webApps.push({
        id: `url:${projectUrl.id}`,
        label: isGlobalWorkspace(project) ? label : `URL: ${label}`,
        key: `${paneId}:url:${projectUrl.id}`,
        url
      });
    }

    return webApps;
  }

  return Object.freeze({
    getProjectWebApps
  });
}
