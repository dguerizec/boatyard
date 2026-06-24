import { createProjectWebApps } from "./projectWebApps.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type {
  BoatyardBridge,
  RendererPaneLayoutNode,
  RendererProject,
  RendererState,
  WebAppDefinition
} from "./rendererTypes.js";

type RendererWebAppRuntimeOptions = {
  boatyard: BoatyardBridge;
  findFirstPaneNode: (node: unknown) => RendererPaneLayoutNode | null;
  findPaneNode: (node: unknown, paneId?: string) => RendererPaneLayoutNode | null;
  findPaneNodeBySelectedWebApp: (node: unknown, webAppId?: string) => RendererPaneLayoutNode | null;
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
};

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
  renderWorkspacePaneArea
}: RendererWebAppRuntimeOptions) {
  const currentWebAppUrlsByKey = new Map<string, string>();
  const webAppAutofillEnabledByKey = new Map<string, boolean>();
  const projectWebApps = createProjectWebApps({
    findPaneNode,
    getGlobalPluginConfig,
    getPaneLayout,
    getPluginPaneDefinitions,
    getProjectPluginConfig,
    getProjectWidgetPanes,
    isGlobalWorkspace
  });

  function hydrateCurrentWebAppUrls(webApps: RendererState["webApps"] = {}) {
    currentWebAppUrlsByKey.clear();
    for (const [key, webApp] of Object.entries(webApps || {})) {
      if (webApp.url) {
        currentWebAppUrlsByKey.set(key, webApp.url);
      }
    }
  }

  function invokeWebApp(action: string, ...payload: unknown[]) {
    const bridge = boatyard as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    return bridge[action](...payload).catch((error: unknown) => {
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
    if (webApp.restoreUrl === false) {
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

  function openProjectWebApp(projectId: string | undefined, webAppId: string, url = "") {
    const project = getProjects().find((candidate) => candidate.id === projectId);
    if (!project) {
      return false;
    }

    const layout = getPaneLayout(project);
    const paneNode = findPaneNodeBySelectedWebApp(layout, webAppId) || findFirstPaneNode(layout);
    if (!paneNode) {
      return false;
    }

    const webApp = projectWebApps.getProjectWebApps(project, paneNode.id || "").find((candidate) => candidate.id === webAppId);
    if (!webApp) {
      return false;
    }

    paneLayoutState.setSelectedWebAppForPane(paneNode.id || "", webApp.id);
    paneNode.selectedWebAppId = webApp.id;
    paneLayoutState.setSelectedWebAppForProject(project.id, webApp.id);

    if (url) {
      currentWebAppUrlsByKey.set(webApp.key || "", url);
    }

    persistPaneLayout(project);
    renderWorkspacePaneArea(project);

    if (url) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => invokeWebApp("navigateWebApp", webApp.key, "open", url));
      });
    }

    return true;
  }

  return Object.freeze({
    getCurrentWebAppUrl,
    getProjectWebApps: projectWebApps.getProjectWebApps,
    getVisibleWebAppProject,
    hydrateCurrentWebAppUrls,
    invokeWebApp,
    isPasswordManagerEnabled,
    isWebAppAutofillEnabled,
    markWebAppAutofillEnabled: (key: string, enabled: boolean) => {
      webAppAutofillEnabledByKey.set(key, enabled);
    },
    openProjectWebApp,
    setCurrentWebAppUrl: (key: string, url: string) => {
      currentWebAppUrlsByKey.set(key, url);
    },
    syncWebAppAutofillButton,
    toggleWebAppAutofill
  });
}
