import type { UnknownRecord } from "./rendererRecords.js";
import { createSettingsShell } from "./settingsShell.js";

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
  let activeSectionId = "general";

  function renderGlobalSettingsPage() {
    closeWidgetAddMenu();
    closeTerminalTabMenu();
    resetVisibleWebAppHosts();
    hideWebApps();
    workspace.classList.remove("project-mode");
    workspaceKicker.textContent = "Global";
    workspaceTitle.textContent = "Global settings";
    workspaceSummary.textContent = "Manage Boatyard preferences from one place.";
    dashboardGrid.innerHTML = "";
    dashboardGrid.className = "global-settings-layout";
    dashboardGrid.style.gridTemplateColumns = "";

    const projectsSettings = createGlobalProjectsSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
      }
    });
    const globalUrlsSettings = createGlobalUrlsSettingsForm({
      onSubmit: async (urls: unknown) => {
        await updateGlobalUrls(urls);
      }
    });
    const presentationSettings = createGlobalPresentationSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
      }
    });
    const terminalSettings = createGlobalTerminalSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
      }
    });
    const passwordSettings = createGlobalPasswordManagerSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
      }
    });
    const openRulesSettings = createGlobalWebAppOpenRulesSettingsForm({
      settings: getSettings(),
      onSubmit: async (values: unknown) => {
        await updateSettings(values);
      }
    });
    const pluginsSettings = createGlobalPluginsSettingsView();
    const widgetsSettings = createGlobalWidgetsSettingsView();
    const updateSettingsCard = createGlobalUpdateCard();

    const pluginCount = pluginsSettings.querySelectorAll(".installed-plugin-item").length;
    const widgetCount = widgetsSettings.querySelectorAll(".installed-widget-item").length;
    const shell = createSettingsShell({
      ariaLabel: "Global settings categories",
      className: "global-settings-shell",
      groups: [
        { id: "boatyard", label: "Boatyard" },
        { id: "extensions", label: "Extensions" },
        { id: "system", label: "System" }
      ],
      initialSectionId: activeSectionId,
      onDiscard() {
        renderGlobalSettingsPage();
      },
      onSaveComplete() {
        hydratePaneLayouts();
        hydrateWidgetLayouts();
        renderGlobalSettingsPage();
      },
      onSectionChange(sectionId) {
        activeSectionId = sectionId;
      },
      sections: [
        {
          id: "general",
          label: "General",
          description: "Core defaults shared by projects and tooling.",
          group: "boatyard",
          icon: "sliders",
          keywords: ["projects", "base path", "defaults"],
          elements: [projectsSettings]
        },
        {
          id: "appearance",
          label: "Appearance",
          description: "Presentation preferences for embedded webapps.",
          group: "boatyard",
          icon: "settingsMonitor",
          keywords: ["presentation", "blur", "screenshots", "widget rail", "width"],
          elements: [presentationSettings]
        },
        {
          id: "terminal",
          label: "Terminal",
          description: "Defaults applied to new terminal sessions.",
          group: "boatyard",
          icon: "terminal",
          keywords: ["environment", "variables", "shell"],
          elements: [terminalSettings]
        },
        {
          id: "security",
          label: "Security",
          description: "Local credentials and autofill preferences.",
          group: "boatyard",
          icon: "settingsShield",
          keywords: ["password manager", "credentials", "autofill"],
          elements: [passwordSettings]
        },
        {
          id: "webapps",
          label: "Web apps",
          description: "Global URLs and link routing behavior.",
          group: "boatyard",
          icon: "settingsGlobe",
          keywords: ["urls", "rules", "links", "domains"],
          elements: [globalUrlsSettings, openRulesSettings]
        },
        {
          id: "plugins",
          label: "Plugins",
          description: "Installed extensions, health and contributions.",
          group: "extensions",
          icon: "plug",
          badge: String(pluginCount),
          keywords: ["extensions", "Pier", "Twicc", "Hawser", "Telegram"],
          elements: [pluginsSettings]
        },
        {
          id: "widgets",
          label: "Widgets",
          description: "Widget extensions available to workspaces.",
          group: "extensions",
          icon: "grid",
          badge: String(widgetCount),
          keywords: ["extensions", "panes", "dashboard"],
          elements: [widgetsSettings]
        },
        {
          id: "about",
          label: "About",
          description: "Version, updates and release notes.",
          group: "system",
          icon: "info",
          keywords: ["version", "updates", "changelog"],
          elements: [updateSettingsCard]
        }
      ]
    });

    dashboardGrid.append(shell.element);

    emitOpened();
  }

  return Object.freeze({
    renderGlobalSettingsPage
  });
}
