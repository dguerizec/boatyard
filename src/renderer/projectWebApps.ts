import type {
  RendererPaneLayoutNode,
  RendererPaneNode,
  RendererProject,
  WebAppDefinition,
  WebAppPaneNavigation
} from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";
import { normalizePaneSidePanel } from "./paneSidePanel.js";

type PluginPaneDefinition = UnknownRecord & {
  icon?: string;
  iconOnly?: boolean;
  iconUrl?: string;
  isAvailable?: (context: UnknownRecord) => boolean;
  key?: string;
  mobileDev?: boolean;
  minHeight?: string;
  minWidth?: string;
  parentLabel?: string;
  parentWebAppId?: string;
  paneTypeId?: string;
  pluginId?: string;
  replacesWebAppIds?: string[];
  navigation?: WebAppPaneNavigation;
  resolveNavigation?: (context: UnknownRecord) => WebAppPaneNavigation | null | undefined;
  renderHeaderActions?: (container: HTMLElement, props: UnknownRecord) => unknown;
  renderSidePanel?: (container: HTMLElement, props: UnknownRecord) => unknown;
  resolveSidePanel?: (context: UnknownRecord) => unknown;
  resolveUrl?: (context: UnknownRecord) => string;
  resolveWebApps?: (context: UnknownRecord) => WebAppDefinition[];
  showInMenu?: boolean;
  title?: string;
  webAppId?: string;
};

type ProjectWebAppsOptions = {
  findPaneNode: (layout: RendererPaneLayoutNode | null | undefined, paneId?: string) => RendererPaneNode | null;
  getGlobalPluginConfig: (pluginId?: string) => UnknownRecord;
  getPaneLayout: (project: RendererProject) => RendererPaneLayoutNode;
  getPluginPaneDefinitions: (filter: UnknownRecord) => PluginPaneDefinition[];
  getProjectPluginConfig: (projectId?: string, pluginId?: string) => UnknownRecord;
  getProjectWidgetPanes: (project: RendererProject) => UnknownRecord[];
  getWebAppFavicon: (key?: string) => string;
  isGlobalWorkspace: (project: RendererProject) => boolean;
};

function resolvePaneNavigation(
  pluginPane: PluginPaneDefinition,
  context: UnknownRecord,
  override?: WebAppPaneNavigation
) {
  const navigation = override || (
    typeof pluginPane.resolveNavigation === "function"
      ? pluginPane.resolveNavigation(context)
      : pluginPane.navigation
  );
  return navigation && Array.isArray(navigation.items) && (
    navigation.items.length > 0 ||
    navigation.browserControls === "compact" ||
    navigation.browserControls === "hidden" ||
    navigation.browserControls === "full"
  )
    ? navigation
    : undefined;
}

function resolvePaneSidePanel(pluginPane: PluginPaneDefinition, context: UnknownRecord) {
  if (typeof pluginPane.renderSidePanel !== "function") {
    return undefined;
  }

  const value = typeof pluginPane.resolveSidePanel === "function"
    ? pluginPane.resolveSidePanel(context)
    : {};
  return normalizePaneSidePanel(value) || undefined;
}

export function createProjectWebApps({
  findPaneNode,
  getGlobalPluginConfig,
  getPaneLayout,
  getPluginPaneDefinitions,
  getProjectPluginConfig,
  getProjectWidgetPanes,
  getWebAppFavicon,
  isGlobalWorkspace
}: ProjectWebAppsOptions) {
  function getProjectWebApps(project: RendererProject, paneId: string) {
    const paneNode = findPaneNode(getPaneLayout(project), paneId);
    const replacedWebAppIds = new Set<string>();
    const webApps: WebAppDefinition[] = getProjectWidgetPanes(project).map((widgetPane, index) => ({
      icon: "grid",
      id: `widgets:${widgetPane.id}`,
      label: widgetPane.label || `Widgets ${index + 1}`,
      key: `${paneId}:widgets:${widgetPane.id}`,
      kind: "widgets",
      paneTypeId: "widgets",
      minHeight: typeof widgetPane.minHeight === "string" ? widgetPane.minHeight : undefined,
      minWidth: typeof widgetPane.minWidth === "string" ? widgetPane.minWidth : undefined,
      widgetPane
    }));

    if (paneNode?.transientWebApp?.url && paneNode.selectedWebAppId === paneNode.transientWebApp.id) {
      webApps.push({
        backgroundColor: "#ffffff",
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
        minHeight: homeTab.minHeight,
        minWidth: homeTab.minWidth,
        url: homeTab.url,
        homeTab: true,
        homeTabId: homeTab.id
      });
    }

    if (isGlobalWorkspace(project) || project.sourcePath) {
      webApps.push({
        icon: "terminal",
        id: "terminal",
        label: "Terminal",
        key: `${paneId}:terminal`,
        kind: "terminal",
        paneTypeId: "terminal"
      });
    }

    webApps.push({
      icon: "info",
      id: "manual",
      label: "Manual",
      key: `${paneId}:manual`,
      url: "https://boatyard.dev/doc/",
      restoreUrl: false,
      paneTypeId: "manual"
    });

    function getPluginPaneContext(pluginPane: PluginPaneDefinition) {
      return {
        project,
        projectConfig: isGlobalWorkspace(project)
          ? {}
          : getProjectPluginConfig(project.id, pluginPane.pluginId),
        globalPluginConfig: getGlobalPluginConfig(pluginPane.pluginId)
      };
    }

    for (const pluginPane of getPluginPaneDefinitions({ scope: isGlobalWorkspace(project) ? "global" : "project", kind: "dom" })) {
      const context = getPluginPaneContext(pluginPane);
      if (pluginPane.isAvailable?.(context) === false) {
        continue;
      }
      for (const webAppId of pluginPane.replacesWebAppIds || []) {
        replacedWebAppIds.add(webAppId);
      }
      webApps.push({
        icon: pluginPane.icon,
        iconOnly: pluginPane.iconOnly,
        iconUrl: pluginPane.iconUrl,
        id: pluginPane.webAppId,
        label: pluginPane.title,
        key: `${paneId}:${pluginPane.key}`,
        kind: "dom",
        minHeight: pluginPane.minHeight,
        minWidth: pluginPane.minWidth,
        navigation: resolvePaneNavigation(pluginPane, context),
        parentLabel: pluginPane.parentLabel || "",
        parentWebAppId: pluginPane.parentWebAppId || "",
        paneTypeId: pluginPane.paneTypeId || pluginPane.webAppId,
        pluginPane,
        showInMenu: pluginPane.showInMenu !== false
      });
    }

    for (const pluginPane of getPluginPaneDefinitions({ scope: isGlobalWorkspace(project) ? "global" : "project", kind: "wcv" })) {
      const context = getPluginPaneContext(pluginPane);
      if (pluginPane.isAvailable?.(context) === false) {
        continue;
      }
      for (const webAppId of pluginPane.replacesWebAppIds || []) {
        replacedWebAppIds.add(webAppId);
      }

      if (typeof pluginPane.resolveWebApps === "function") {
        for (const webApp of pluginPane.resolveWebApps(context) || []) {
          if (!webApp?.url) {
            continue;
          }
          webApps.push({
            icon: webApp.icon || pluginPane.icon,
            iconOnly: Boolean(webApp.iconOnly ?? pluginPane.iconOnly),
            iconUrl: webApp.iconUrl || pluginPane.iconUrl,
            id: webApp.id || `${pluginPane.webAppId}:${webApp.key || webApp.url}`,
            label: webApp.label || pluginPane.title,
            key: `${paneId}:${pluginPane.key}:${webApp.key || webApp.id || webApp.url}`,
            minHeight: webApp.minHeight || pluginPane.minHeight,
            minWidth: webApp.minWidth || pluginPane.minWidth,
            mobileDev: Boolean(webApp.mobileDev ?? pluginPane.mobileDev),
            navigation: resolvePaneNavigation(pluginPane, context, webApp.navigation),
            parentLabel: webApp.parentLabel || pluginPane.parentLabel || "",
            parentWebAppId: webApp.parentWebAppId || pluginPane.parentWebAppId || "",
            paneTypeId: webApp.paneTypeId || pluginPane.paneTypeId || pluginPane.webAppId,
            pluginPane,
            showInMenu: webApp.showInMenu ?? pluginPane.showInMenu !== false,
            sidePanel: resolvePaneSidePanel(pluginPane, context),
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
        icon: pluginPane.icon,
        iconOnly: pluginPane.iconOnly,
        iconUrl: pluginPane.iconUrl,
        id: pluginPane.webAppId,
        label: pluginPane.title,
        key: `${paneId}:${pluginPane.key}`,
        minHeight: pluginPane.minHeight,
        minWidth: pluginPane.minWidth,
        mobileDev: Boolean(pluginPane.mobileDev),
        navigation: resolvePaneNavigation(pluginPane, context),
        parentLabel: pluginPane.parentLabel || "",
        parentWebAppId: pluginPane.parentWebAppId || "",
        paneTypeId: pluginPane.paneTypeId || pluginPane.webAppId,
        pluginPane,
        showInMenu: pluginPane.showInMenu !== false,
        sidePanel: resolvePaneSidePanel(pluginPane, context),
        url
      });
    }

    if (!isGlobalWorkspace(project) && project.repoUrl && !replacedWebAppIds.has("repo")) {
      webApps.push({
        icon: "git",
        id: "repo",
        label: "Repo",
        key: `${paneId}:repo`,
        paneTypeId: "repo",
        url: project.repoUrl
      });
    }

    for (const projectUrl of project.urls || []) {
      const label = String(projectUrl.label || "");
      const url = String(projectUrl.url || "");
      webApps.push({
        backgroundColor: "#ffffff",
        id: `url:${projectUrl.id}`,
        label: isGlobalWorkspace(project) ? label : `URL: ${label}`,
        key: `${paneId}:url:${projectUrl.id}`,
        minHeight: typeof projectUrl.minHeight === "string" ? projectUrl.minHeight : undefined,
        minWidth: typeof projectUrl.minWidth === "string" ? projectUrl.minWidth : undefined,
        url,
        mobileDev: true
      });
    }

    webApps.push({
      icon: "square-dashed",
      id: "empty",
      key: `${paneId}:empty`,
      kind: "empty",
      label: "Empty pane",
      paneTypeId: "empty"
    });

    const webAppsById = new Map(webApps.map((webApp) => [webApp.id, webApp]));
    return webApps.map((webApp) => ({
      ...webApp,
      paneTypeId: webApp.paneTypeId || (
        webApp.parentWebAppId
          ? webAppsById.get(webApp.parentWebAppId)?.paneTypeId
          : undefined
      ),
      faviconUrl: getWebAppFavicon(webApp.key),
      projectId: project.id || ""
    }));
  }

  return Object.freeze({
    getProjectWebApps
  });
}
