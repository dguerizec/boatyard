// @ts-check
"use strict";

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
 * @typedef {{
 *   actions: PluginActions,
 *   execFileAsync: ExecFileAsync,
 *   getState(): HawserState,
 *   projectInspectors: PluginProjectInspectors
 * }} HawserPluginContext
 */

/**
 * @param {HawserPluginContext} ctx
 */
function activate(ctx) {
  ctx.actions.handle("createProject", ({ sourcePath, runtime } = {}) => {
    return createHawserProject(sourcePath, runtime, { execFileAsync: ctx.execFileAsync });
  });

  ctx.actions.handle("widgetDataForConfig", ({ projectId, projectConfig = {}, globalConfig = {} } = {}) => {
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

  ctx.actions.handle("statusForConfig", ({ globalConfig = {} } = {}) => {
    return getHawserStatus({
      hawserApiUrl: globalConfig.hawserApiUrl,
      hawserToken: globalConfig.hawserToken
    });
  });

  ctx.projectInspectors.register(async ({ sourcePath } = {}) => {
    const project = await inspectHawserProject(sourcePath, { execFileAsync: ctx.execFileAsync });
    return {
      matchType: project?.matchType || "",
      projectName: project?.name || "",
      projectUrl: project?.url || ""
    };
  });
}

module.exports = { activate };
