"use strict";

import type { ExecFileAsync, PluginActions, PluginProjectInspectors } from "../../shared/pluginTypes";

const {
  aliasTwiccProjectProcessStatuses,
  createTwiccProject,
  createTwiccProjectCache,
  inspectTwiccProject,
  inspectTwiccProjectFromProjects,
  loadTwiccProcesses,
  getTwiccProjectProcessStatuses
} = require("./service");

type BoatyardProject = { id: string; sourcePath?: string };
type TwiccState = { projects?: BoatyardProject[] };
type GlobalConfigPayload = { globalConfig?: Record<string, unknown> };
type SourcePathPayload = { sourcePath?: unknown };
type TwiccPluginContext = {
  actions: PluginActions;
  execFileAsync: ExecFileAsync;
  getState(): TwiccState;
  projectInspectors: PluginProjectInspectors;
};

function activate(ctx: TwiccPluginContext) {
  const projectCache = createTwiccProjectCache();

  ctx.actions.handle<SourcePathPayload & GlobalConfigPayload>("createProject", async ({ sourcePath, globalConfig } = {}) => {
    const project = await createTwiccProject(sourcePath, {
      execFileAsync: ctx.execFileAsync,
      globalConfig
    });
    projectCache.invalidate();
    return project;
  });

  ctx.actions.handle<GlobalConfigPayload>("projectProcessStatuses", async ({ globalConfig } = {}) => {
    const options = {
      execFileAsync: ctx.execFileAsync,
      globalConfig
    };
    const processes = await loadTwiccProcesses(options);
    const statuses = getTwiccProjectProcessStatuses(processes);
    const twiccProjects = await projectCache.get(
      options,
      { projectIds: Object.keys(statuses) }
    );
    return aliasTwiccProjectProcessStatuses(
      statuses,
      twiccProjects,
      ctx.getState()?.projects || []
    );
  });

  ctx.projectInspectors.register(async ({ sourcePath, globalConfig }: SourcePathPayload & GlobalConfigPayload = {}) => {
    const options = {
      execFileAsync: ctx.execFileAsync,
      globalConfig
    };
    const project = inspectTwiccProjectFromProjects(
      sourcePath,
      await projectCache.get(options, { force: true }),
      globalConfig?.twiccBaseUrl
    ) || await inspectTwiccProject(sourcePath, options);
    return {
      matchType: project?.matchType || "",
      projectUrl: project?.url || ""
    };
  });
}

export { activate };
