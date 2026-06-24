import type { UnknownRecord } from "./rendererRecords.js";

type GlobalSettingsPageViewOptions = {
  closeTerminalTabMenu: () => void;
  closeWidgetAddMenu: () => void;
  createGlobalPasswordManagerSettingsForm: (options: UnknownRecord) => HTMLElement;
  createGlobalPluginsSettingsView: () => HTMLElement;
  createGlobalPresentationSettingsForm: (options: UnknownRecord) => HTMLElement;
  createGlobalProjectsSettingsForm: (options: UnknownRecord) => HTMLElement;
  createGlobalTerminalSettingsForm: (options: UnknownRecord) => HTMLElement;
  createGlobalUpdateCard: () => HTMLElement;
  createGlobalUrlsSettingsForm: (options: UnknownRecord) => HTMLElement;
  createGlobalWebAppOpenRulesSettingsForm: (options: UnknownRecord) => HTMLElement;
  createGlobalWidgetsSettingsView: () => HTMLElement;
  dashboardGrid: HTMLElement;
  emitOpened: () => void;
  getSettings: () => UnknownRecord;
  hideWebApps: () => void;
  hydratePaneLayouts: () => void;
  hydrateWidgetLayouts: () => void;
  resetVisibleWebAppHosts: () => void;
  updateGlobalUrls: (urls: unknown) => Promise<unknown>;
  updateSettings: (values: unknown) => Promise<unknown>;
  workspace: HTMLElement;
  workspaceKicker: HTMLElement;
  workspaceSummary: HTMLElement;
  workspaceTitle: HTMLElement;
};

export function createGlobalSettingsPageView({
  closeTerminalTabMenu,
  closeWidgetAddMenu,
  createGlobalPasswordManagerSettingsForm,
  createGlobalPluginsSettingsView,
  createGlobalPresentationSettingsForm,
  createGlobalProjectsSettingsForm,
  createGlobalTerminalSettingsForm,
  createGlobalUpdateCard,
  createGlobalUrlsSettingsForm,
  createGlobalWebAppOpenRulesSettingsForm,
  createGlobalWidgetsSettingsView,
  dashboardGrid,
  emitOpened,
  getSettings,
  hideWebApps,
  hydratePaneLayouts,
  hydrateWidgetLayouts,
  resetVisibleWebAppHosts,
  updateGlobalUrls,
  updateSettings,
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
}: GlobalSettingsPageViewOptions) {
  function renderGlobalSettingsPage() {
    closeWidgetAddMenu();
    closeTerminalTabMenu();
    resetVisibleWebAppHosts();
    hideWebApps();
    workspace.classList.remove("project-mode");
    workspaceKicker.textContent = "Global";
    workspaceTitle.textContent = "Global settings";
    workspaceSummary.textContent = "";
    dashboardGrid.innerHTML = "";
    dashboardGrid.className = "project-form-layout global-settings-layout";
    dashboardGrid.style.gridTemplateColumns = "";

    dashboardGrid.append(createGlobalUpdateCard(), createGlobalProjectsSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
        renderGlobalSettingsPage();
      }
    }), createGlobalUrlsSettingsForm({
      onSubmit: async (urls: unknown) => {
        await updateGlobalUrls(urls);
        hydratePaneLayouts();
        hydrateWidgetLayouts();
        renderGlobalSettingsPage();
      }
    }), createGlobalPresentationSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
        renderGlobalSettingsPage();
      }
    }), createGlobalTerminalSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
        renderGlobalSettingsPage();
      }
    }), createGlobalPasswordManagerSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
        renderGlobalSettingsPage();
      }
    }), createGlobalWebAppOpenRulesSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
        renderGlobalSettingsPage();
      }
    }), createGlobalPluginsSettingsView(), createGlobalWidgetsSettingsView());

    emitOpened();
  }

  return Object.freeze({
    renderGlobalSettingsPage
  });
}
