import { createGlobalSettingsViews } from "./globalSettingsViews.js";
import { createProjectSettingsViews } from "./projectSettingsViews.js";
import type { BoatyardBridge, RendererState } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

type RendererSettingsViewBridgeOptions = {
  applyFormControl: (control: HTMLElement) => void;
  applyFormControls: (root: HTMLElement) => void;
  boatyard: BoatyardBridge;
  deriveProjectNameFromPath: (sourcePath: unknown) => string;
  deriveRepoUrl: (gitUrl?: unknown) => string;
  formatProjectNameFromPath: (sourcePath: unknown) => string;
  getGlobalPluginConfig: (pluginId?: string) => UnknownRecord;
  getInstalledWidgets: (filter?: UnknownRecord) => unknown[];
  getPluginGlobalSettingsSections: () => unknown[];
  getPluginProjectSettingsSections: () => unknown[];
  getProjectGroups: () => string[];
  getProjectPaneLayout: (project: UnknownRecord) => unknown;
  getProjectPluginConfig: (projectId?: string, pluginId?: string) => UnknownRecord;
  getProjectWidgetPanes: (project: UnknownRecord) => UnknownRecord[];
  getSelectedWebAppForPane: (paneId: string) => string | undefined;
  getSettings: () => UnknownRecord;
  getState: () => RendererState;
  readPluginSettingsFieldValue: (field?: unknown, input?: unknown, options?: UnknownRecord) => string;
  renderGlobalSettingsPage: () => void;
  showOverlayDialog: (dialog: HTMLDialogElement, options?: UnknownRecord) => Promise<boolean>;
  slugify: (value: unknown) => string;
  updateGlobalPluginConfig: (pluginId: string, values: UnknownRecord) => Promise<unknown>;
  updatePluginEnabled: (pluginId: string, enabled: boolean) => Promise<unknown>;
};

export function createRendererSettingsViewBridge({
  applyFormControl,
  applyFormControls,
  boatyard,
  deriveProjectNameFromPath,
  deriveRepoUrl,
  formatProjectNameFromPath,
  getGlobalPluginConfig,
  getInstalledWidgets,
  getPluginGlobalSettingsSections,
  getPluginProjectSettingsSections,
  getProjectGroups,
  getProjectPaneLayout,
  getProjectPluginConfig,
  getProjectWidgetPanes,
  getSelectedWebAppForPane,
  getSettings,
  getState,
  readPluginSettingsFieldValue,
  renderGlobalSettingsPage,
  showOverlayDialog,
  slugify,
  updateGlobalPluginConfig,
  updatePluginEnabled
}: RendererSettingsViewBridgeOptions) {
  const projectSettingsViews = createProjectSettingsViews({
    boatyard,
    getState,
    getSettings,
    getProjectGroups,
    getProjectPaneLayout: getProjectPaneLayout as never,
    getProjectWidgetPanes,
    getSelectedWebAppForPane,
    getProjectPluginConfig,
    getGlobalPluginConfig,
    getPluginProjectSettingsSections,
    applyFormControl,
    applyFormControls,
    showOverlayDialog,
    readPluginSettingsFieldValue,
    deriveRepoUrl,
    deriveProjectNameFromPath,
    formatProjectNameFromPath,
    slugify
  });

  const globalSettingsViews = createGlobalSettingsViews({
    boatyard,
    applyFormControl,
    applyFormControls,
    getInstalledWidgets,
    getPluginGlobalSettingsSections,
    getGlobalPluginConfig,
    readPluginSettingsFieldValue,
    showOverlayDialog,
    renderGlobalSettingsPage,
    updatePluginEnabled,
    updateGlobalPluginConfig
  });

  return Object.freeze({
    createGlobalPasswordManagerSettingsForm: globalSettingsViews.createGlobalPasswordManagerSettingsForm,
    createGlobalPluginsSettingsView: globalSettingsViews.createGlobalPluginsSettingsView,
    createGlobalPresentationSettingsForm: globalSettingsViews.createGlobalPresentationSettingsForm,
    createGlobalProjectsSettingsForm: globalSettingsViews.createGlobalProjectsSettingsForm,
    createGlobalTerminalSettingsForm: globalSettingsViews.createGlobalTerminalSettingsForm,
    createGlobalUrlsSettingsForm: projectSettingsViews.createGlobalUrlsSettingsForm,
    createGlobalWebAppOpenRulesSettingsForm: globalSettingsViews.createGlobalWebAppOpenRulesSettingsForm,
    createGlobalWidgetsSettingsView: globalSettingsViews.createGlobalWidgetsSettingsView,
    createProjectDangerZone: projectSettingsViews.createProjectDangerZone,
    createProjectFormView: projectSettingsViews.createProjectFormView,
    createProjectTerminalSettingsForm: projectSettingsViews.createProjectTerminalSettingsForm,
    createProjectUrlsForm: projectSettingsViews.createProjectUrlsForm,
    createProjectWebAppHomeTabsForm: projectSettingsViews.createProjectWebAppHomeTabsForm,
    createProjectWebAppOpenRulesForm: projectSettingsViews.createProjectWebAppOpenRulesForm,
    createProjectWidgetPanesForm: projectSettingsViews.createProjectWidgetPanesForm
  });
}
