"use strict";

import type { ExecFileAsync, PluginActions, PluginProjectInspectors } from "../../shared/pluginTypes";

const {
  aliasTwiccProjectProcessStatuses,
  archiveTwiccSession,
  createTwiccSession,
  createTwiccProject,
  createTwiccProjectCache,
  inspectTwiccProject,
  inspectTwiccProjectFromProjects,
  loadGitSessionCreationOptions,
  loadTwiccSessionFlow,
  loadTwiccProcesses,
  getTwiccProjectProcessStatuses,
  updateTwiccSessionFlowLane
} = require("./service");

type BoatyardProject = { id: string; sourcePath?: string };
type TwiccState = { projects?: BoatyardProject[] };
type GlobalConfigPayload = { globalConfig?: Record<string, unknown> };
type SourcePathPayload = { sourcePath?: unknown };
type SessionFlowPayload = GlobalConfigPayload & { project?: unknown };
type SessionFlowSessionPayload = GlobalConfigPayload & { sessionId?: unknown };
type SessionFlowLanePayload = GlobalConfigPayload & { lane?: unknown; sessionId?: unknown };
type SessionCreationPayload = GlobalConfigPayload & {
  project?: unknown;
  prompt?: unknown;
  sessionFlowLane?: unknown;
  title?: unknown;
  worktreeBranch?: unknown;
  worktreePath?: unknown;
  worktreeStartFrom?: unknown;
};
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

  ctx.actions.handle<SessionFlowPayload>("sessionFlow", async ({ project, globalConfig } = {}) => {
    return loadTwiccSessionFlow(project, {
      execFileAsync: ctx.execFileAsync,
      globalConfig
    });
  });

  ctx.actions.handle<SessionFlowLanePayload>("setSessionFlowLane", async ({ sessionId, lane, globalConfig } = {}) => {
    return updateTwiccSessionFlowLane(sessionId, lane, {
      execFileAsync: ctx.execFileAsync,
      globalConfig
    });
  });

  ctx.actions.handle<SessionFlowSessionPayload>("archiveSession", async ({ sessionId, globalConfig } = {}) => {
    return archiveTwiccSession(sessionId, {
      execFileAsync: ctx.execFileAsync,
      globalConfig
    });
  });

  ctx.actions.handle<SessionCreationPayload>("createSession", async ({ globalConfig, ...input } = {}) => {
    return createTwiccSession(input, {
      execFileAsync: ctx.execFileAsync,
      globalConfig
    });
  });

  ctx.actions.handle<SourcePathPayload>("sessionCreationOptions", async ({ sourcePath } = {}) => {
    return loadGitSessionCreationOptions(sourcePath, {
      execFileAsync: ctx.execFileAsync
    });
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
