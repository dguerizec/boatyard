"use strict";

import type { ExecFileAsync, PluginResourceProviderResult } from "../../shared/pluginTypes";
import {
  EMPTY_PROCESS_MEMORY,
  aggregateProcessMemory,
  collectDescendantProcessIds,
  createLinuxProcessSource
} from "../../main/linuxProcessResources.js";
import type { ProcessSource } from "../../main/linuxProcessResources.js";
import { loadTwiccProcesses, loadTwiccProjects } from "./service.js";

const TWICC_RESOURCE_PROVIDER_ID = "boatyard.twicc.systemResources";

type TwiccGlobalConfig = {
  twiccApiToken?: unknown;
  twiccBaseUrl?: unknown;
};
type TwiccProcess = {
  pid?: unknown;
  project_id?: unknown;
  provider?: unknown;
  session_id?: unknown;
  session_title?: unknown;
  state?: unknown;
};
type TwiccProject = {
  directory?: unknown;
  git_root?: unknown;
  id?: unknown;
  name?: unknown;
};
type TwiccResourceState = {
  pluginConfig?: {
    global?: Record<string, TwiccGlobalConfig | undefined>;
  };
};
type TwiccResourceSession = {
  pid: number;
  processCount: number;
  projectId: string;
  provider: string;
  pssBytes: number;
  rssBytes: number;
  sessionId: string;
  state: string;
  swapPssBytes: number;
  title: string;
};
type TwiccResourceProject = {
  processCount: number;
  projectId: string;
  projectName: string;
  pssBytes: number;
  rssBytes: number;
  sessions: TwiccResourceSession[];
  swapPssBytes: number;
};
type TwiccResourceSnapshot = {
  available: boolean;
  backend: {
    pid: number;
    processCount: number;
    pssBytes: number;
    rssBytes: number;
    swapPssBytes: number;
  };
  error: string;
  processCount: number;
  projects: TwiccResourceProject[];
  pssBytes: number;
  rssBytes: number;
  sessionCount: number;
  swapPssBytes: number;
};
type TwiccResourceCollectorOptions = {
  execFileAsync: ExecFileAsync;
  loadProcesses?: (options: Record<string, unknown>) => Promise<TwiccProcess[]>;
  loadProjects?: (options: Record<string, unknown>) => Promise<TwiccProject[]>;
  platform?: NodeJS.Platform;
  processSource?: ProcessSource;
  state?: TwiccResourceState;
};
type TwiccStatus = { pid: number; port: number; status: string };

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseTwiccStatus(value: unknown): TwiccStatus {
  const source = isRecord(value) ? value : {};
  return {
    pid: Math.max(0, Number(source.pid) || 0),
    port: Math.max(0, Number(source.port) || 0),
    status: normalizeText(source.status)
  };
}

function parseJson(value: unknown): unknown {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

async function loadLocalTwiccStatus(execFileAsync: ExecFileAsync): Promise<TwiccStatus> {
  try {
    const result = await execFileAsync("twicc", ["status"], {
      timeout: 5000,
      windowsHide: true
    });
    return parseTwiccStatus(parseJson(result.stdout));
  } catch (error) {
    const source = isRecord(error) ? error : {};
    return parseTwiccStatus(parseJson(source.stdout));
  }
}

function isLocalTwiccUrl(value: unknown): boolean {
  const configuredUrl = normalizeText(value);
  if (!configuredUrl) {
    return true;
  }
  try {
    const hostname = new URL(configuredUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  } catch {
    return false;
  }
}

function getConfiguredTwiccPort(value: unknown): number {
  const configuredUrl = normalizeText(value);
  if (!configuredUrl) {
    return 0;
  }
  try {
    const url = new URL(configuredUrl);
    return Number(url.port) || (url.protocol === "https:" ? 443 : url.protocol === "http:" ? 80 : 0);
  } catch {
    return 0;
  }
}

function emptySnapshot(error: string): TwiccResourceSnapshot {
  return {
    available: false,
    backend: { pid: 0, processCount: 0, ...EMPTY_PROCESS_MEMORY },
    error,
    processCount: 0,
    projects: [],
    sessionCount: 0,
    ...EMPTY_PROCESS_MEMORY
  };
}

function resolveNearestSessionRoot(
  pid: number,
  parentByPid: Map<number, number>,
  sessionRoots: Set<number>,
  backendProcessIds: Set<number>
): number {
  const visited = new Set<number>();
  let currentPid = pid;
  while (backendProcessIds.has(currentPid) && !visited.has(currentPid)) {
    if (sessionRoots.has(currentPid)) {
      return currentPid;
    }
    visited.add(currentPid);
    currentPid = parentByPid.get(currentPid) || 0;
  }
  return 0;
}

function getProjectNames(projects: TwiccProject[]): Map<string, string> {
  return new Map(projects.flatMap((project) => {
    const projectId = normalizeText(project.id);
    if (!projectId) {
      return [];
    }
    const projectPath = normalizeText(project.directory || project.git_root);
    const fallbackName = projectPath.split(/[\\/]/).filter(Boolean).pop() || projectId;
    return [[projectId, normalizeText(project.name) || fallbackName] as [string, string]];
  }));
}

async function collectTwiccResourceSnapshot({
  execFileAsync,
  loadProcesses = loadTwiccProcesses as (options: Record<string, unknown>) => Promise<TwiccProcess[]>,
  loadProjects = loadTwiccProjects as (options: Record<string, unknown>) => Promise<TwiccProject[]>,
  platform = process.platform,
  processSource = createLinuxProcessSource(),
  state = {}
}: TwiccResourceCollectorOptions): Promise<TwiccResourceSnapshot> {
  if (platform !== "linux") {
    return emptySnapshot("TwiCC process memory is currently available on Linux only.");
  }

  const globalConfig = state.pluginConfig?.global?.["boatyard.twicc"] || {};
  if (!isLocalTwiccUrl(globalConfig.twiccBaseUrl)) {
    return emptySnapshot("Process memory is unavailable for a remote TwiCC instance.");
  }

  const status = await loadLocalTwiccStatus(execFileAsync);
  if (status.status !== "running" || !status.pid) {
    return emptySnapshot("The local TwiCC backend is not running.");
  }
  const configuredPort = getConfiguredTwiccPort(globalConfig.twiccBaseUrl);
  if (configuredPort && status.port && configuredPort !== status.port) {
    return emptySnapshot("The configured TwiCC URL does not match the local backend reported by TwiCC.");
  }

  const identities = await processSource.list();
  const backendProcessIds = collectDescendantProcessIds([status.pid], identities);
  if (!backendProcessIds.has(status.pid) || !identities.some((identity) => identity.pid === status.pid)) {
    return emptySnapshot("The local TwiCC process tree changed while memory was being sampled.");
  }

  const loaderOptions = { execFileAsync, globalConfig };
  const [rawProcesses, rawProjects] = await Promise.all([
    loadProcesses(loaderOptions),
    loadProjects(loaderOptions)
  ]);
  const processes = rawProcesses.filter((entry) => {
    const pid = Number(entry.pid);
    return Number.isInteger(pid) && pid > 0 && backendProcessIds.has(pid);
  });
  const processByRoot = new Map(processes.map((entry) => [Number(entry.pid), entry]));
  const sessionRoots = new Set(processByRoot.keys());
  const parentByPid = new Map(identities.map(({ pid, parentPid }) => [pid, parentPid]));
  const ownedProcessIds = new Map<number, Set<number>>();
  const backendOnlyProcessIds = new Set<number>();
  for (const pid of backendProcessIds) {
    const ownerPid = resolveNearestSessionRoot(pid, parentByPid, sessionRoots, backendProcessIds);
    if (!ownerPid) {
      backendOnlyProcessIds.add(pid);
      continue;
    }
    const ownerProcessIds = ownedProcessIds.get(ownerPid) || new Set<number>();
    ownerProcessIds.add(pid);
    ownedProcessIds.set(ownerPid, ownerProcessIds);
  }

  const memoryEntries = await Promise.all([...backendProcessIds].map(async (pid) => [
    pid,
    await processSource.readMemory(pid)
  ] as const));
  const memoryByPid = new Map(memoryEntries);
  const projectNames = getProjectNames(rawProjects);
  const sessions = [...processByRoot].map(([pid, entry]) => {
    const processIds = ownedProcessIds.get(pid) || new Set([pid]);
    const sessionId = normalizeText(entry.session_id);
    return {
      pid,
      processCount: processIds.size,
      projectId: normalizeText(entry.project_id) || "__unassigned__",
      provider: normalizeText(entry.provider) || "Unknown provider",
      sessionId,
      state: normalizeText(entry.state) || "unknown",
      title: normalizeText(entry.session_title) || sessionId || `Session ${pid}`,
      ...aggregateProcessMemory(processIds, memoryByPid)
    };
  }).sort((left, right) => right.pssBytes - left.pssBytes || left.title.localeCompare(right.title));

  const projectIds = [...new Set(sessions.map((session) => session.projectId))];
  const projects = projectIds.map((projectId) => {
    const projectSessions = sessions.filter((session) => session.projectId === projectId);
    const processCount = projectSessions.reduce((total, session) => total + session.processCount, 0);
    return {
      processCount,
      projectId,
      projectName: projectId === "__unassigned__" ? "Unassigned" : projectNames.get(projectId) || projectId,
      sessions: projectSessions,
      pssBytes: projectSessions.reduce((total, session) => total + session.pssBytes, 0),
      rssBytes: projectSessions.reduce((total, session) => total + session.rssBytes, 0),
      swapPssBytes: projectSessions.reduce((total, session) => total + session.swapPssBytes, 0)
    };
  }).sort((left, right) => right.pssBytes - left.pssBytes || left.projectName.localeCompare(right.projectName));
  const backendMemory = aggregateProcessMemory(backendOnlyProcessIds, memoryByPid);
  const totalMemory = aggregateProcessMemory(backendProcessIds, memoryByPid);

  return {
    available: true,
    backend: {
      pid: status.pid,
      processCount: backendOnlyProcessIds.size,
      ...backendMemory
    },
    error: "",
    processCount: backendProcessIds.size,
    projects,
    sessionCount: sessions.length,
    ...totalMemory
  };
}

async function collectTwiccResourceProvider(
  options: TwiccResourceCollectorOptions
): Promise<PluginResourceProviderResult> {
  return {
    data: await collectTwiccResourceSnapshot(options),
    // TwiCC is a shared local service, not memory exclusively owned by this Boatyard instance.
    exclusiveMemoryBytes: 0
  };
}

export {
  TWICC_RESOURCE_PROVIDER_ID,
  collectTwiccResourceProvider,
  collectTwiccResourceSnapshot,
  getConfiguredTwiccPort,
  isLocalTwiccUrl,
  loadLocalTwiccStatus,
  resolveNearestSessionRoot
};

export type {
  TwiccResourceCollectorOptions,
  TwiccResourceProject,
  TwiccResourceSession,
  TwiccResourceSnapshot,
  TwiccResourceState
};
