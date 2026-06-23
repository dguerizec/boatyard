// @ts-check
"use strict";

const {
  aliasTwiccProjectProcessStatuses,
  createTwiccProject,
  createTwiccProjectCache,
  inspectTwiccProject,
  inspectTwiccProjectFromProjects,
  loadTwiccProcesses,
  getTwiccProjectProcessStatuses
} = require("./service");

/**
 * @typedef {import("../pluginTypes").ExecFileAsync} ExecFileAsync
 * @typedef {import("../pluginTypes").PluginActions} PluginActions
 * @typedef {import("../pluginTypes").PluginProjectInspectors} PluginProjectInspectors
 * @typedef {{ id: string, sourcePath?: string }} BoatyardProject
 * @typedef {{ projects?: BoatyardProject[] }} TwiccState
 * @typedef {{
 *   actions: PluginActions,
 *   execFileAsync: ExecFileAsync,
 *   getState(): TwiccState,
 *   projectInspectors: PluginProjectInspectors
 * }} TwiccPluginContext
 */

/**
 * @param {TwiccPluginContext} ctx
 */
function activate(ctx) {
  const projectCache = createTwiccProjectCache();

  ctx.actions.handle("createProject", async ({ sourcePath } = {}) => {
    const project = await createTwiccProject(sourcePath, { execFileAsync: ctx.execFileAsync });
    projectCache.invalidate();
    return project;
  });

  ctx.actions.handle("projectProcessStatuses", async () => {
    const processes = await loadTwiccProcesses({ execFileAsync: ctx.execFileAsync });
    const statuses = getTwiccProjectProcessStatuses(processes);
    const twiccProjects = await projectCache.get(
      { execFileAsync: ctx.execFileAsync },
      { projectIds: Object.keys(statuses) }
    );
    return aliasTwiccProjectProcessStatuses(
      statuses,
      twiccProjects,
      ctx.getState()?.projects || []
    );
  });

  ctx.projectInspectors.register(async ({ sourcePath } = {}) => {
    const project = inspectTwiccProjectFromProjects(
      sourcePath,
      await projectCache.get({ execFileAsync: ctx.execFileAsync }, { force: true })
    ) || await inspectTwiccProject(sourcePath, { execFileAsync: ctx.execFileAsync });
    return {
      matchType: project?.matchType || "",
      projectUrl: project?.url || ""
    };
  });
}

module.exports = { activate };
