import { createPluginLoader } from "./pluginLoader.js";
import { hasActiveSettingsInteraction } from "./settingsFormController.js";
import type { BoatyardBridge, RendererProject } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

const WEBAPP_URL_CHANGED_EVENT = "boatyard:webapp-url-changed";

type RendererEventBindingsOptions = {
  addProjectButton: HTMLElement;
  applyMatchingWebAppOpenRule: (payload: UnknownRecord) => Promise<boolean>;
  applyWebAppOpenChoice: (payload: UnknownRecord, choice: UnknownRecord) => Promise<unknown>;
  boatyard: BoatyardBridge;
  globalNav: HTMLElement;
  globalSettingsButton: HTMLElement;
  getCurrentProject: () => RendererProject;
  getCurrentView: () => string;
  handleTerminalData: (payload: { terminalId: unknown; data: unknown }) => void;
  handleTerminalExit: (payload: { terminalId: unknown; projectId: unknown; windowId: unknown }) => void;
  loadState: () => Promise<void>;
  manualTourButton: HTMLElement;
  markWebAppAutofillEnabled: (key: string, enabled: boolean) => void;
  markWebAppLoaded: (payload: { key?: string; url?: string }) => void;
  openOnboardingTour: (options?: UnknownRecord) => unknown;
  openWebAppOpenUrlDialog: (payload?: UnknownRecord) => unknown;
  persistVisibleWebAppPaneLayout: (key: string, url: string) => void;
  queueWebAppSync: () => void;
  renderGlobalSettingsPage: () => void;
  renderProjectList: () => void;
  renderWorkspacePaneArea: (project: RendererProject) => void;
  selectCreateProject: () => void;
  selectGlobal: () => void;
  selectGlobalSettings: () => void;
  setCurrentWebAppFavicons: (key: string, favicons: unknown, url?: string) => unknown;
  setCurrentWebAppUrl: (key: string, url: string) => void;
  syncWebAppAutofillButton: (button: HTMLButtonElement, enabled: boolean) => void;
  windowObject: Window;
  workspace: HTMLElement;
};

export function registerRendererEventBindings({
  addProjectButton,
  applyMatchingWebAppOpenRule,
  applyWebAppOpenChoice,
  boatyard,
  globalNav,
  globalSettingsButton,
  getCurrentProject,
  getCurrentView,
  handleTerminalData,
  handleTerminalExit,
  loadState,
  manualTourButton,
  markWebAppAutofillEnabled,
  markWebAppLoaded,
  openOnboardingTour,
  openWebAppOpenUrlDialog,
  persistVisibleWebAppPaneLayout,
  queueWebAppSync,
  renderGlobalSettingsPage,
  renderProjectList,
  renderWorkspacePaneArea,
  selectCreateProject,
  selectGlobal,
  selectGlobalSettings,
  setCurrentWebAppFavicons,
  setCurrentWebAppUrl,
  syncWebAppAutofillButton,
  windowObject,
  workspace
}: RendererEventBindingsOptions) {
  let pierWorkloadPaneRefreshFrame: number | null = null;

  boatyard.onWebAppUrlChanged(({ key, url }) => {
    if (!key || !url) {
      return;
    }

    setCurrentWebAppUrl(key, url);
    persistVisibleWebAppPaneLayout(key, url);
    windowObject.dispatchEvent(new CustomEvent(WEBAPP_URL_CHANGED_EVENT, {
      detail: { key, url }
    }));
    for (const input of document.querySelectorAll<HTMLInputElement>(".webapp-url")) {
      if (input.dataset.webappKey === key && input !== document.activeElement) {
        input.value = url;
      }
    }
  });

  boatyard.onWebAppLoaded?.((payload) => {
    const { key, url } = payload || {};
    if (!key || !url) {
      return;
    }

    markWebAppLoaded({ key, url });
  });

  boatyard.onWebAppFaviconChanged?.(({ key, favicons, url }) => {
    if (!key || !favicons?.length) {
      return;
    }
    setCurrentWebAppFavicons(key, favicons, url);
  });

  boatyard.onWebAppAutofillChanged?.(({ key, enabled }) => {
    if (!key) {
      return;
    }

    markWebAppAutofillEnabled(key, enabled === true);
    for (const button of document.querySelectorAll<HTMLButtonElement>(".webapp-tool-button.autofill")) {
      if (button.dataset.webappKey === key) {
        syncWebAppAutofillButton(button, enabled === true);
      }
    }
  });

  boatyard.onWebAppOpenUrlRequested?.((payload) => {
    if (payload?.target) {
      applyWebAppOpenChoice(payload, {
        target: payload.target,
        persist: false,
        scope: "url-pattern",
        label: ""
      }).catch((error) => {
        console.error("Could not apply webapp URL opening rule:", error);
      });
      return;
    }

    if (payload?.source === "context-menu") {
      openWebAppOpenUrlDialog(payload);
      return;
    }

    applyMatchingWebAppOpenRule(payload).then((applied) => {
      if (!applied) {
        openWebAppOpenUrlDialog(payload);
      }
    }).catch((error) => {
      console.error("Could not apply saved webapp URL opening rule:", error);
      openWebAppOpenUrlDialog(payload);
    });
  });

  boatyard.onTerminalData(handleTerminalData);
  boatyard.onTerminalExit(handleTerminalExit);

  windowObject.addEventListener("boatyard:plugin-status-changed", () => {
    if (
      getCurrentView() === "global-settings" &&
      !hasActiveSettingsInteraction(windowObject.document)
    ) {
      renderGlobalSettingsPage();
    }
  });

  windowObject.addEventListener("boatyard:project-nav-badges-changed", renderProjectList);

  windowObject.addEventListener("boatyard:pier-workloads-changed", () => {
    if (getCurrentView() !== "project" || pierWorkloadPaneRefreshFrame) {
      return;
    }

    pierWorkloadPaneRefreshFrame = requestAnimationFrame(() => {
      pierWorkloadPaneRefreshFrame = null;
      renderWorkspacePaneArea(getCurrentProject());
    });
  });

  globalNav.addEventListener("click", selectGlobal);
  globalSettingsButton.addEventListener("click", selectGlobalSettings);
  manualTourButton.addEventListener("click", () => openOnboardingTour({ force: true }));
  addProjectButton.addEventListener("click", selectCreateProject);
  windowObject.addEventListener("keydown", (event) => {
    if (
      ["global-settings", "project-edit"].includes(getCurrentView()) &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLocaleLowerCase() === "k"
    ) {
      event.preventDefault();
      windowObject.document
        .querySelector<HTMLInputElement>(".settings-search input")
        ?.focus();
    }
  });
  windowObject.addEventListener("resize", queueWebAppSync);
  workspace.addEventListener("scroll", queueWebAppSync);

  const pluginLoader = createPluginLoader(windowObject);
  pluginLoader.ready
    .catch((error) => {
      console.error("Could not load plugins:", error);
    })
    .finally(loadState);
}
