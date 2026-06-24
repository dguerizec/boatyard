import { toUnknownRecord, type UnknownRecord } from "./rendererRecords.js";
import type { ProjectNavBadgeRenderOptions, RendererProject, RendererState } from "./rendererTypes.js";

type RendererPluginHelpersOptions = {
  boatyard: {
    updateProjectPluginConfig: (projectId: string, pluginId: string, config: UnknownRecord) => Promise<RendererState>;
  };
  getCurrentView: () => string;
  getGlobalPluginConfig: (pluginId?: string) => UnknownRecord;
  getProjectPluginConfig: (projectId?: string, pluginId?: string) => UnknownRecord;
  getState: () => RendererState;
  normalizeUrl: (value: string) => string;
  windowObject: PluginRegistryWindow & PluginSettingsFieldsGlobal;
};

export function createRendererPluginHelpers({
  boatyard,
  getCurrentView,
  getGlobalPluginConfig,
  getProjectPluginConfig,
  getState,
  normalizeUrl,
  windowObject
}: RendererPluginHelpersOptions) {
  function getPluginPaneDefinitions(filter = {}) {
    return windowObject.BoatyardPluginRegistry?.listPanes(filter) || [];
  }

  function getPluginProjectNavBadgeDefinitions() {
    return windowObject.BoatyardPluginRegistry?.listProjectNavBadges() || [];
  }

  function getPluginProjectSettingsSections() {
    return windowObject.BoatyardPluginRegistry?.listProjectSettingsSections() || [];
  }

  function getPluginGlobalSettingsSections() {
    return windowObject.BoatyardPluginRegistry?.listGlobalSettingsSections() || [];
  }

  function renderProjectNavBadges(
    project: RendererProject,
    container: HTMLElement,
    options: ProjectNavBadgeRenderOptions = {}
  ) {
    for (const badge of getPluginProjectNavBadgeDefinitions()) {
      try {
        const element = badge.render({
          project,
          projectConfig: getProjectPluginConfig(project.id, badge.pluginId),
          globalConfig: getGlobalPluginConfig(badge.pluginId),
          isActiveProject: options.isActiveProject === true,
          currentView: getCurrentView()
        });

        if (element && typeof element === "object" && typeof element.nodeType === "number") {
          container.append(element);
        }
      } catch (error) {
        console.error(`Could not render project nav badge ${badge.id}:`, error);
      }
    }
  }

  async function persistProjectPluginConfig(projectId: string, pluginConfig = {}) {
    let nextState = getState();

    for (const [pluginId, config] of Object.entries(toUnknownRecord(pluginConfig))) {
      nextState = await boatyard.updateProjectPluginConfig(projectId, pluginId, toUnknownRecord(config));
    }

    return nextState;
  }

  function readPluginSettingsFieldValue(field: unknown, input: unknown) {
    return windowObject.BoatyardPluginSettingsFields?.readFieldValue(field, input, {
      normalizeUrl
    }) || "";
  }

  return Object.freeze({
    getPluginGlobalSettingsSections,
    getPluginPaneDefinitions,
    getPluginProjectSettingsSections,
    persistProjectPluginConfig,
    readPluginSettingsFieldValue,
    renderProjectNavBadges
  });
}
