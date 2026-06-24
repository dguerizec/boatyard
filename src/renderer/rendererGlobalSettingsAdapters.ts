import type { createRendererSettingsViewBridge } from "./rendererSettingsViewBridge.js";
import type { UnknownRecord } from "./rendererRecords.js";

type SettingsViewBridge = ReturnType<typeof createRendererSettingsViewBridge>;

export function createRendererGlobalSettingsAdapters(getSettingsViewBridge: () => SettingsViewBridge) {
  function createGlobalProjectsSettingsForm(options: UnknownRecord) {
    const settingsViewBridge = getSettingsViewBridge();
    return settingsViewBridge.createGlobalProjectsSettingsForm(
      options as Parameters<typeof settingsViewBridge.createGlobalProjectsSettingsForm>[0]
    );
  }

  function createGlobalPresentationSettingsForm(options: UnknownRecord) {
    const settingsViewBridge = getSettingsViewBridge();
    return settingsViewBridge.createGlobalPresentationSettingsForm(
      options as Parameters<typeof settingsViewBridge.createGlobalPresentationSettingsForm>[0]
    );
  }

  function createGlobalTerminalSettingsForm(options: UnknownRecord) {
    const settingsViewBridge = getSettingsViewBridge();
    return settingsViewBridge.createGlobalTerminalSettingsForm(
      options as Parameters<typeof settingsViewBridge.createGlobalTerminalSettingsForm>[0]
    );
  }

  function createGlobalPasswordManagerSettingsForm(options: UnknownRecord) {
    const settingsViewBridge = getSettingsViewBridge();
    return settingsViewBridge.createGlobalPasswordManagerSettingsForm(
      options as Parameters<typeof settingsViewBridge.createGlobalPasswordManagerSettingsForm>[0]
    );
  }

  function createGlobalWebAppOpenRulesSettingsForm(options: UnknownRecord) {
    const settingsViewBridge = getSettingsViewBridge();
    return settingsViewBridge.createGlobalWebAppOpenRulesSettingsForm(
      options as Parameters<typeof settingsViewBridge.createGlobalWebAppOpenRulesSettingsForm>[0]
    );
  }

  function createGlobalPluginsSettingsView() {
    return getSettingsViewBridge().createGlobalPluginsSettingsView();
  }

  function createGlobalWidgetsSettingsView() {
    return getSettingsViewBridge().createGlobalWidgetsSettingsView();
  }

  function createGlobalUrlsSettingsForm(options: UnknownRecord) {
    const settingsViewBridge = getSettingsViewBridge();
    return settingsViewBridge.createGlobalUrlsSettingsForm(
      options as Parameters<typeof settingsViewBridge.createGlobalUrlsSettingsForm>[0]
    );
  }

  return Object.freeze({
    createGlobalPasswordManagerSettingsForm,
    createGlobalPluginsSettingsView,
    createGlobalPresentationSettingsForm,
    createGlobalProjectsSettingsForm,
    createGlobalTerminalSettingsForm,
    createGlobalUrlsSettingsForm,
    createGlobalWebAppOpenRulesSettingsForm,
    createGlobalWidgetsSettingsView
  });
}
