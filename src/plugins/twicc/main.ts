"use strict";

import type { ExecFileAsync, PluginActions, PluginProjectInspectors, PluginResources, PluginTools, PluginStateMigrations } from "../../shared/pluginTypes";
import { registerTwiccTools } from "./tools.js";
import { migrateTwiccSessionFlowLanes, getTwiccProjectIdFromUrl } from "./service.js";
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
  tools: PluginTools;
  stateMigrations: PluginStateMigrations<TwiccState>;
  execFileAsync: ExecFileAsync;
  getState(): TwiccState;
  projectInspectors: PluginProjectInspectors;
  resources: Pick<PluginResources, "registerProvider">;
};

const TWICC_RESTART_OPTIONS = Object.freeze({ timeout: 30_000, windowsHide: true });
const TWICC_UPGRADE_OPTIONS = Object.freeze({ timeout: 300_000, windowsHide: true });
const TWICC_PROCESS_LIST_OPTIONS = Object.freeze({ timeout: 5_000, windowsHide: true });
const TWICC_PROCESS_PAGE_SIZE = 1000;

type TwiccServiceProcess = { state?: unknown };
type TwiccServiceRestartReadiness = {
  blockingCount: number;
  processCount: number;
  ready: boolean;
  states: Record<string, number>;
};

async function restartTwiccService(execFileAsync: ExecFileAsync) {
  await execFileAsync("systemctl", ["--user", "restart", "twicc"], TWICC_RESTART_OPTIONS);
  return { restarted: true };
}

async function upgradeTwiccService(execFileAsync: ExecFileAsync) {
  await execFileAsync("uv", ["tool", "upgrade", "twicc"], TWICC_UPGRADE_OPTIONS);
  return { upgraded: true };
}

async function getTwiccServiceRestartReadiness(
  execFileAsync: ExecFileAsync
): Promise<TwiccServiceRestartReadiness> {
  const processes: TwiccServiceProcess[] = [];
  for (let offset = 0; ; offset += TWICC_PROCESS_PAGE_SIZE) {
    const result = await execFileAsync("twicc", [
      "processes",
      "--limit",
      String(TWICC_PROCESS_PAGE_SIZE),
      "--offset",
      String(offset),
      "--include-hidden"
    ], TWICC_PROCESS_LIST_OPTIONS);
    const page = JSON.parse(String(result.stdout || "[]"));
    if (!Array.isArray(page)) {
      throw new Error("TwiCC returned an invalid process list.");
    }
    processes.push(...page);
    if (page.length < TWICC_PROCESS_PAGE_SIZE) {
      break;
    }
  }

  const states = processes.reduce<Record<string, number>>((counts, process) => {
    const state = String(process?.state || "unknown").trim() || "unknown";
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});
  const blockingCount = processes.reduce((count, process) => (
    String(process?.state || "").trim() === "user_turn" ? count : count + 1
  ), 0);
  return {
    blockingCount,
    processCount: processes.length,
    ready: blockingCount === 0,
    states
  };
}

function activate(ctx: TwiccPluginContext) {
  const projectCache = createTwiccProjectCache();
  let latestProcesses: Array<Record<string, unknown>> = [];
  let latestTwiccProjects: Array<Record<string, unknown>> = [];
  let serviceOperationActive = false;

  async function runServiceOperation<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    if (serviceOperationActive) {
      throw new Error("Another TwiCC service operation is already running.");
    }
    serviceOperationActive = true;
    try {
      return await operation();
    } finally {
      serviceOperationActive = false;
    }
  }

  const getOptions = () => ({
    execFileAsync: ctx.execFileAsync,
    globalConfig: ctx.getState()?.pluginConfig?.global?.["boatyard.twicc"] || {}
  });
  registerTwiccTools({
    tools: ctx.tools,
    getOptions,
    resolveProject: (projectId) => {
      const state = ctx.getState();
      const project = state.projects?.find((candidate) => candidate.id === projectId);
      if (!project) { throw new Error(`Unknown Boatyard project: ${projectId}`); }
      const config = state.pluginConfig?.projects?.[projectId]?.["boatyard.twicc"];
      const reference = String(project.sourcePath || "").trim()
        || getTwiccProjectIdFromUrl(config?.twiccProjectUrl);
      if (!reference) { throw new Error("Configure this project's TwiCC URL to load sessions."); }
      return reference;
    }
  });
  ctx.stateMigrations.register(async () => {
    try {
      const result = await migrateTwiccSessionFlowLanes(getOptions());
      if (!result.allSucceeded) {
        console.warn("TwiCC Done lane migration is incomplete; failed sessions will be retried on next startup.");
      }
    } catch {
      console.warn("TwiCC Done lane migration could not run; it will be retried on next startup.");
    }
  });

  ctx.resources.registerProvider(TWICC_RESOURCE_PROVIDER_ID, () => collectTwiccResourceProvider({
    execFileAsync: ctx.execFileAsync,
    state: ctx.getState()
  }));

  ctx.actions.handle("restartService", () => runServiceOperation(
    () => restartTwiccService(ctx.execFileAsync)
  ));
  ctx.actions.handle("upgradeService", () => runServiceOperation(
    () => upgradeTwiccService(ctx.execFileAsync)
  ));
  ctx.actions.handle("serviceRestartReadiness", () => (
    getTwiccServiceRestartReadiness(ctx.execFileAsync)
  ));

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
