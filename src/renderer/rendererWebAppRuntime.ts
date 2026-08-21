import { createProjectWebApps } from "./projectWebApps.js";
import {
  getPaneFaviconUrl,
  getSafePaneIconUrl,
  haveSamePaneOrigin,
  updatePaneFaviconElements
} from "./paneIcons.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type {
  BoatyardBridge,
  RendererPaneLayoutNode,
  RendererPaneNode,
  RendererProject,
  RendererState,
  WebAppDefinition
} from "./rendererTypes.js";

type RendererWebAppRuntimeOptions = {
  boatyard: BoatyardBridge;
  findFirstPaneNode: (node: RendererPaneLayoutNode | null | undefined) => RendererPaneNode | null;
  findPaneNode: (node: RendererPaneLayoutNode | null | undefined, paneId?: string) => RendererPaneNode | null;
  findPaneNodeBySelectedWebApp: (node: RendererPaneLayoutNode | null | undefined, webAppId?: string) => RendererPaneNode | null;
  getCurrentProject: () => RendererProject | null | undefined;
  getCurrentView: () => string;
  getGlobalPluginConfig: (pluginId?: string) => UnknownRecord;
  getGlobalWorkspace: () => RendererProject;
  getPaneLayout: (project: RendererProject) => RendererPaneLayoutNode;
  getPluginPaneDefinitions: (filter: UnknownRecord) => UnknownRecord[];
  getProjectPluginConfig: (projectId?: string, pluginId?: string) => UnknownRecord;
  getProjectWidgetPanes: (project: RendererProject) => UnknownRecord[];
  getProjects: () => RendererProject[];
  getSettings: () => UnknownRecord;
  isGlobalWorkspace: (project: RendererProject) => boolean;
  paneLayoutState: {
    setSelectedWebAppForPane(paneId: string, webAppId?: string): unknown;
    setSelectedWebAppForProject(projectId: string | undefined, webAppId?: string): unknown;
  };
  persistPaneLayout: (project: RendererProject) => void;
  renderWorkspacePaneArea: (project: RendererProject) => void;
  selectProject?: (projectId: string) => void;
};

type ActivateProjectWebAppOptions = {
  restoreSourceWebAppUrl?: string;
  sourceWebAppKey?: string;
};

type WebAppBridgeActionName =
  | "hideWebApp"
  | "navigateWebApp"
  | "setVisibleWebApps"
  | "showWebApp"
  | "updateWebAppAutofill";

type CurrentWebAppFavicon = {
  iconUrl: string;
  pageUrl: string;
};

const WEB_APP_BRIDGE_ACTIONS: readonly WebAppBridgeActionName[] = [
  "hideWebApp",
  "navigateWebApp",
  "setVisibleWebApps",
  "showWebApp",
  "updateWebAppAutofill"
];

function isWebAppBridgeActionName(action: string): action is WebAppBridgeActionName {
  return WEB_APP_BRIDGE_ACTIONS.includes(action as WebAppBridgeActionName);
}

export function createRendererWebAppRuntime({
  boatyard,
  findFirstPaneNode,
  findPaneNode,
  findPaneNodeBySelectedWebApp,
  getCurrentProject,
  getCurrentView,
  getGlobalPluginConfig,
  getGlobalWorkspace,
  getPaneLayout,
  getPluginPaneDefinitions,
  getProjectPluginConfig,
  getProjectWidgetPanes,
  getProjects,
  getSettings,
  isGlobalWorkspace,
  paneLayoutState,
  persistPaneLayout,
  renderWorkspacePaneArea,
  selectProject
}: RendererWebAppRuntimeOptions) {
  const currentWebAppUrlsByKey = new Map<string, string>();
  const liveWebAppUrlKeys = new Set<string>();
  const currentWebAppFaviconsByKey = new Map<string, CurrentWebAppFavicon>();
  const webAppAutofillEnabledByKey = new Map<string, boolean>();

  function getWebAppFavicon(key = "") {
    return currentWebAppFaviconsByKey.get(key)?.iconUrl || "";
  }

  const projectWebApps = createProjectWebApps({
    findPaneNode,
    getGlobalPluginConfig,
    getPaneLayout,
    getPluginPaneDefinitions,
    getProjectPluginConfig,
    getProjectWidgetPanes,
    getWebAppFavicon,
    isGlobalWorkspace
  });

  function hydrateCurrentWebAppUrls(webApps: RendererState["webApps"] = {}) {
    currentWebAppUrlsByKey.clear();
    liveWebAppUrlKeys.clear();
    currentWebAppFaviconsByKey.clear();
    for (const [key, webApp] of Object.entries(webApps || {})) {
      if (webApp.url) {
        currentWebAppUrlsByKey.set(key, webApp.url);
      }
      const faviconUrl = getSafePaneIconUrl(webApp.faviconUrl);
      if (
        faviconUrl &&
        webApp.url &&
        haveSamePaneOrigin(webApp.faviconPageUrl, webApp.url)
      ) {
        currentWebAppFaviconsByKey.set(key, {
          iconUrl: faviconUrl,
          pageUrl: webApp.faviconPageUrl || webApp.url
        });
      }
    }
  }

  function invokeWebApp(action: string, ...payload: unknown[]) {
    const bridgeAction = isWebAppBridgeActionName(action)
      ? boatyard[action]
      : () => Promise.reject(new Error(`Unknown webapp bridge action: ${action}`));
    return bridgeAction(...payload).catch((error: unknown) => {
      console.error(`Could not ${action}:`, error);
    });
  }

  function isWebAppAutofillEnabled(webApp: WebAppDefinition) {
    return webAppAutofillEnabledByKey.get(webApp.key || "") === true;
  }

  function isPasswordManagerEnabled() {
    const settings = getSettings();
    return settings.passwordManagerEnabled === true && settings.passwordManagerDisclaimerAccepted === true;
  }

  function syncWebAppAutofillButton(button: HTMLButtonElement, enabled: boolean) {
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.title = enabled
      ? "Saved login and password fill is enabled. Click to disable."
      : "Enable one-time fill with the saved login and password.";
    button.setAttribute("aria-label", button.title);
  }

  async function toggleWebAppAutofill(webApp: WebAppDefinition, button: HTMLButtonElement) {
    const enabled = !isWebAppAutofillEnabled(webApp);
    webAppAutofillEnabledByKey.set(webApp.key || "", enabled);
    syncWebAppAutofillButton(button, enabled);
    await invokeWebApp("updateWebAppAutofill", webApp.key, enabled);
  }

  function getCurrentWebAppUrl(webApp: WebAppDefinition) {
    if (webApp.restoreUrl === false && !liveWebAppUrlKeys.has(webApp.key || "")) {
      return webApp.url;
    }

    return currentWebAppUrlsByKey.get(webApp.key || "") || webApp.url;
  }

  function getVisibleWebAppProject() {
    const currentView = getCurrentView();

    if (currentView === "global") {
      return getGlobalWorkspace();
    }

    if (currentView === "project") {
      return getCurrentProject();
    }

    return null;
  }

  function resolveProjectWebApp(projectId: string | undefined, webAppId: string) {
    const project = getProjects().find((candidate) => candidate.id === projectId);
    if (!project) {
      return null;
    }

    const layout = getPaneLayout(project);
    const selectedPaneNode = findPaneNodeBySelectedWebApp(layout, webAppId);
    const paneNode = selectedPaneNode || findFirstPaneNode(layout);
    if (!paneNode) {
      return null;
    }

    const webApp = projectWebApps.getProjectWebApps(project, paneNode.id || "").find((candidate) => candidate.id === webAppId);
    if (!webApp) {
      return null;
    }
    return { paneNode, project, selectedPaneNode, webApp };
  }

  function resolveProjectWebAppByKey(webAppKey: string) {
    function findInLayout(project: RendererProject, node: RendererPaneLayoutNode): {
      paneNode: RendererPaneNode;
      project: RendererProject;
      webApp: WebAppDefinition;
    } | null {
      if (node.type === "split") {
        return findInLayout(project, node.first) || findInLayout(project, node.second);
      }

      const webApp = projectWebApps.getProjectWebApps(project, node.id || "")
        .find((candidate) => candidate.key === webAppKey);
      return webApp ? { paneNode: node, project, webApp } : null;
    }

    for (const project of getProjects()) {
      const target = findInLayout(project, getPaneLayout(project));
      if (target) {
        return target;
      }
    }
    return null;
  }

  function openResolvedProjectWebApp(
    target: NonNullable<ReturnType<typeof resolveProjectWebApp>>,
    url = "",
    navigationAction = "open"
  ) {
    const { paneNode, project, selectedPaneNode, webApp } = target;
    const shouldNavigate = Boolean(url && getCurrentWebAppUrl(webApp) !== url);

    paneLayoutState.setSelectedWebAppForPane(paneNode.id || "", webApp.id);
    paneNode.selectedWebAppId = webApp.id;
    paneLayoutState.setSelectedWebAppForProject(project.id, webApp.id);

    if (url) {
      currentWebAppUrlsByKey.set(webApp.key || "", url);
    }

    persistPaneLayout(project);
    const selectedPaneIsMounted = selectedPaneNode && getVisibleWebAppProject()?.id === project.id;
    if (!selectedPaneIsMounted) {
      renderWorkspacePaneArea(project);
    }

    if (shouldNavigate) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void invokeWebApp("navigateWebApp", webApp.key, navigationAction, url).then((navigated) => {
            if (navigationAction === "soft-open" && navigated !== true) {
              return invokeWebApp("navigateWebApp", webApp.key, "open", url);
            }
            return navigated;
          });
        });
      });
    }

    return true;
  }

  function openProjectWebApp(projectId: string | undefined, webAppId: string, url = "") {
    const target = resolveProjectWebApp(projectId, webAppId);
    return target ? openResolvedProjectWebApp(target, url) : false;
  }

  function openProjectWebAppInPage(projectId: string | undefined, webAppId: string, url = "") {
    const target = resolveProjectWebApp(projectId, webAppId);
    return target ? openResolvedProjectWebApp(target, url, "soft-open") : false;
  }

  function restoreSourceProjectWebAppUrl(
    targetProjectId: string | undefined,
    webAppId: string,
    sourceWebAppKey = "",
    sourceWebAppUrl = ""
  ) {
    const currentProject = getCurrentView() === "project" ? getCurrentProject() : null;
    const sourceTarget = sourceWebAppKey
      ? resolveProjectWebAppByKey(sourceWebAppKey)
      : resolveProjectWebApp(currentProject?.id, webAppId);
    const sourceUrl = String(sourceWebAppUrl || sourceTarget?.webApp.url || "").trim();
    const sourceKey = String(sourceTarget?.webApp.key || "").trim();
    if (
      !sourceTarget
      || sourceTarget.project.id === targetProjectId
      || !sourceUrl
      || !sourceKey
      || getCurrentWebAppUrl(sourceTarget.webApp) === sourceUrl
    ) {
      return;
    }

    currentWebAppUrlsByKey.set(sourceKey, sourceUrl);
    liveWebAppUrlKeys.add(sourceKey);
    persistPaneLayout(sourceTarget.project);
    void invokeWebApp("navigateWebApp", sourceKey, "home", sourceUrl);
  }

  function activateProjectWebApp(
    projectId: string | undefined,
    webAppId: string,
    url = "",
    options: ActivateProjectWebAppOptions = {}
  ) {
    const target = resolveProjectWebApp(projectId, webAppId);
    if (!target || typeof selectProject !== "function") {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(options, "restoreSourceWebAppUrl")) {
      restoreSourceProjectWebAppUrl(
        target.project.id,
        webAppId,
        options.sourceWebAppKey,
        options.restoreSourceWebAppUrl
      );
    }
    if (getCurrentView() !== "project" || getCurrentProject()?.id !== target.project.id) {
      selectProject(String(target.project.id || ""));
    }
    return openResolvedProjectWebApp(target, url);
  }

  return Object.freeze({
    activateProjectWebApp,
    getCurrentWebAppUrl,
    getProjectIdForWebAppKey: (key: string) => String(resolveProjectWebAppByKey(key)?.project.id || ""),
    getProjectWebApps: projectWebApps.getProjectWebApps,
    getWebAppFavicon,
    getVisibleWebAppProject,
    hydrateCurrentWebAppUrls,
    invokeWebApp,
    isPasswordManagerEnabled,
    isWebAppAutofillEnabled,
    markWebAppAutofillEnabled: (key: string, enabled: boolean) => {
      webAppAutofillEnabledByKey.set(key, enabled);
    },
    openProjectWebApp,
    openProjectWebAppInPage,
    setCurrentWebAppFavicons: (key: string, favicons: unknown, url = "") => {
      const faviconUrl = (Array.isArray(favicons) ? favicons : [])
        .map((candidate) => getSafePaneIconUrl(candidate))
        .find(Boolean) || "";
      if (!key || !faviconUrl) {
        return "";
      }
      currentWebAppFaviconsByKey.set(key, {
        iconUrl: faviconUrl,
        pageUrl: String(url || currentWebAppUrlsByKey.get(key) || "")
      });
      updatePaneFaviconElements(key, faviconUrl, url);
      return faviconUrl;
    },
    setCurrentWebAppUrl: (key: string, url: string) => {
      const previousUrl = currentWebAppUrlsByKey.get(key) || "";
      const currentFavicon = currentWebAppFaviconsByKey.get(key);
      currentWebAppUrlsByKey.set(key, url);
      liveWebAppUrlKeys.add(key);

      if (currentFavicon && haveSamePaneOrigin(currentFavicon.pageUrl || previousUrl, url)) {
        currentFavicon.pageUrl = url;
        updatePaneFaviconElements(key, currentFavicon.iconUrl, url);
        return previousUrl;
      }

      currentWebAppFaviconsByKey.delete(key);
      updatePaneFaviconElements(key, getPaneFaviconUrl(url), url);
      return previousUrl;
    },
    syncWebAppAutofillButton,
    toggleWebAppAutofill
  });
}
