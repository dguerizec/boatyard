"use strict";

import type { ExecFileAsync, PluginActions, PluginProjectInspectors, PluginResources } from "../../shared/pluginTypes";
import { TWICC_RESOURCE_PROVIDER_ID, collectTwiccResourceProvider } from "./resources.js";

const {
  aliasTwiccProjectProcessStatuses,
  archiveTwiccSession,
  createTwiccSession,
  createTwiccProject,
  createTwiccProjectCache,
  inspectTwiccProject,
  inspectTwiccProjectFromProjects,
  loadGitSessionCreationOptions,
  loadTwiccSession,
  loadTwiccSessionFlow,
  loadTwiccProcesses,
  getTwiccProjectProcessStatuses,
  reorderTwiccSessionFlow,
  resolveTwiccSessionNavigationTarget,
  updateTwiccSessionTitle,
  updateTwiccSessionFlowLane
} = require("./service");

type BoatyardProject = { id: string; sourcePath?: string };
type TwiccState = {
  pluginConfig?: {
    global?: Record<string, Record<string, unknown> | undefined>;
    projects?: Record<string, Record<string, Record<string, unknown> | undefined> | undefined>;
  };
  projects?: BoatyardProject[];
};
type GlobalConfigPayload = { globalConfig?: Record<string, unknown> };
type SourcePathPayload = { name?: unknown; sourcePath?: unknown };
type SessionFlowPayload = GlobalConfigPayload & { project?: unknown };
type SessionFlowSessionPayload = GlobalConfigPayload & { sessionId?: unknown };
type SessionNavigationTargetPayload = GlobalConfigPayload & {
  sessionId?: unknown;
  sourceTwiccProjectId?: unknown;
};
type SessionTitlePayload = SessionFlowSessionPayload & { title?: unknown };
type SessionFlowLanePayload = GlobalConfigPayload & { lane?: unknown; sessionId?: unknown };
type SessionFlowOrderPayload = GlobalConfigPayload & { lane?: unknown; sessionIds?: unknown };
type SessionCreationPayload = GlobalConfigPayload & {
  attachments?: unknown;
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
  resources: Pick<PluginResources, "registerProvider">;
};

function activate(ctx: TwiccPluginContext) {
  const projectCache = createTwiccProjectCache();
  let latestProcesses: Array<Record<string, unknown>> = [];
  let latestTwiccProjects: Array<Record<string, unknown>> = [];

  ctx.resources.registerProvider(TWICC_RESOURCE_PROVIDER_ID, () => collectTwiccResourceProvider({
    execFileAsync: ctx.execFileAsync,
    state: ctx.getState()
  }));

  ctx.actions.handle<SourcePathPayload & GlobalConfigPayload>("createProject", async ({ name, sourcePath, globalConfig } = {}) => {
    const project = await createTwiccProject({ name, sourcePath }, {
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
    latestProcesses = processes;
    latestTwiccProjects = twiccProjects;
    return aliasTwiccProjectProcessStatuses(
      statuses,
      twiccProjects,
      ctx.getState()?.projects || []
    );
  });

  ctx.actions.handle<SessionNavigationTargetPayload>("resolveSessionNavigationTarget", async ({ sessionId, sourceTwiccProjectId, globalConfig } = {}) => {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedSourceTwiccProjectId = String(sourceTwiccProjectId || "").trim();
    if (!normalizedSessionId) {
      return null;
    }

    const state = ctx.getState() || {};
    const projectPluginConfig = state.pluginConfig?.projects || {};
    const cachedProcess = latestProcesses.find((process) => (
      String(process.session_id || "").trim() === normalizedSessionId
    ));
    if (cachedProcess) {
      return resolveTwiccSessionNavigationTarget(
        cachedProcess,
        latestTwiccProjects,
        state.projects || [],
        projectPluginConfig,
        globalConfig?.twiccBaseUrl,
        normalizedSourceTwiccProjectId
      );
    }

    const options = {
      execFileAsync: ctx.execFileAsync,
      globalConfig
    };
    const session = await loadTwiccSession(normalizedSessionId, options);
    if (!session) {
      return null;
    }
    const twiccProjectId = String(session.project_id || "").trim();
    const twiccProjects = await projectCache.get(options, {
      projectIds: [...new Set([twiccProjectId, normalizedSourceTwiccProjectId].filter(Boolean))]
    });
    latestTwiccProjects = twiccProjects;
    return resolveTwiccSessionNavigationTarget(
      session,
      twiccProjects,
      state.projects || [],
      projectPluginConfig,
      globalConfig?.twiccBaseUrl,
      normalizedSourceTwiccProjectId
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

  ctx.actions.handle<SessionFlowOrderPayload>("reorderSessionFlow", async ({ sessionIds, lane, globalConfig } = {}) => {
    return reorderTwiccSessionFlow(sessionIds, lane, {
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

  ctx.actions.handle<SessionTitlePayload>("renameSession", async ({ sessionId, title, globalConfig } = {}) => {
    return updateTwiccSessionTitle(sessionId, title, {
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
