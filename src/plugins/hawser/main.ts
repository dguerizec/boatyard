"use strict";

import type { ExecFileAsync, PluginActions, PluginProjectInspectors } from "../pluginTypes";

const {
  createHawserProject,
  getHawserStatus,
  getHawserWidgetData,
  inspectHawserProject
} = require("./service");

/**
 * @typedef {import("../pluginTypes").ExecFileAsync} ExecFileAsync
 * @typedef {import("../pluginTypes").PluginActions} PluginActions
 * @typedef {import("../pluginTypes").PluginProjectInspectors} PluginProjectInspectors
 * @typedef {{ id: string, hawserMainSession?: string }} HawserProject
 * @typedef {{ projects?: HawserProject[] }} HawserState
 * @typedef {{ hawserMainSession?: unknown }} HawserProjectConfig
 * @typedef {{ hawserApiUrl?: unknown, hawserToken?: unknown }} HawserGlobalConfig
 * @typedef {{ sourcePath?: unknown, runtime?: unknown }} CreateProjectPayload
 * @typedef {{ projectId?: unknown, projectConfig?: HawserProjectConfig, globalConfig?: HawserGlobalConfig }} WidgetDataPayload
 * @typedef {{ globalConfig?: HawserGlobalConfig }} StatusPayload
 * @typedef {{ sourcePath?: unknown }} SourcePathPayload
 * @typedef {{
 *   actions: PluginActions,
 *   execFileAsync: ExecFileAsync,
 *   getState(): HawserState,
 *   projectInspectors: PluginProjectInspectors
 * }} HawserPluginContext
 */

type HawserProject = { id: string; hawserMainSession?: string };
type HawserState = { projects?: HawserProject[] };
type HawserProjectConfig = { hawserMainSession?: unknown };
type HawserGlobalConfig = { hawserApiUrl?: unknown; hawserToken?: unknown };
type CreateProjectPayload = { sourcePath?: unknown; runtime?: unknown };
type WidgetDataPayload = { projectId?: unknown; projectConfig?: HawserProjectConfig; globalConfig?: HawserGlobalConfig };
type StatusPayload = { globalConfig?: HawserGlobalConfig };
type SourcePathPayload = { sourcePath?: unknown };
type HawserPluginContext = {
  actions: PluginActions;
  execFileAsync: ExecFileAsync;
  getState(): HawserState;
  projectInspectors: PluginProjectInspectors;
};

/**
 * @param {HawserPluginContext} ctx
 */
function activate(ctx: HawserPluginContext) {
  ctx.actions.handle<CreateProjectPayload>("createProject", ({ sourcePath, runtime } = {}) => {
    return createHawserProject(sourcePath, runtime, { execFileAsync: ctx.execFileAsync });
  });

  ctx.actions.handle<WidgetDataPayload>("widgetDataForConfig", ({ projectId, projectConfig = {}, globalConfig = {} } = {}) => {
    const state = ctx.getState();
    const project = state?.projects?.find((item) => item.id === String(projectId || ""));

    return getHawserWidgetData({
      ...project,
      hawserMainSession: projectConfig.hawserMainSession
    }, {
      hawserApiUrl: globalConfig.hawserApiUrl,
      hawserToken: globalConfig.hawserToken
    });
  });

  ctx.actions.handle<StatusPayload>("statusForConfig", ({ globalConfig = {} } = {}) => {
    return getHawserStatus({
      hawserApiUrl: globalConfig.hawserApiUrl,
      hawserToken: globalConfig.hawserToken
    });
  });

  ctx.projectInspectors.register(async ({ sourcePath }: SourcePathPayload = {}) => {
    const project = await inspectHawserProject(sourcePath, { execFileAsync: ctx.execFileAsync });
    return {
      matchType: project?.matchType || "",
      projectName: project?.name || "",
      projectUrl: project?.url || ""
    };
  });
}

export { activate };
