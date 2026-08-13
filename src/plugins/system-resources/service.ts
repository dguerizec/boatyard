"use strict";

import type {
  ExecFileAsync,
  PluginResourceProviderSnapshot,
  PluginWebContentsViewResource
} from "../../shared/pluginTypes";
import { getProjectTmuxSessionName } from "../../main/terminalSessionNames.js";
import {
  EMPTY_PROCESS_MEMORY,
  aggregateProcessMemory,
  collectDescendantProcessIds,
  createLinuxProcessSource,
  parseProcessMemory
} from "../../main/linuxProcessResources.js";
import type {
  ProcessIdentity,
  ProcessMemory,
  ProcessSource
} from "../../main/linuxProcessResources.js";
type Project = { id?: string; name?: string; slug?: string; sourcePath?: string };
type ResourceState = {
  plugins?: { enabled?: Record<string, boolean | undefined> };
  projects?: Project[];
};
type WebContentsViewInfo = {
  count?: number;
  entries?: PluginWebContentsViewResource[];
  processIds?: number[];
};
type CollectorOptions = {
  collectResourceProviders?: () => Promise<PluginResourceProviderSnapshot[]>;
  execFileAsync: ExecFileAsync;
  now?: () => number;
  platform?: NodeJS.Platform;
  processSource?: ProcessSource;
  rootPid?: number;
  sessionPrefix?: string;
  staleTmuxClientGraceMs?: number;
  state?: ResourceState;
  tmuxCleanup?: TmuxCleanupReport | null;
  webContentsViews?: WebContentsViewInfo;
};
type TmuxSession = {
  createdAt: number;
  group: string;
  name: string;
};
type TmuxPane = { group: string; id: string; pid: number };
type TmuxClient = { pid: number; session: string };
type TmuxSessionState = "active" | "linked" | "primary" | "stale" | "starting";
type TmuxSessionSnapshot = TmuxSession & {
  clientCount: number;
  linked: boolean;
  state: TmuxSessionState;
};
type TmuxTopology = {
  activeClientSessionCount: number;
  available: boolean;
  error: string;
  groupCount: number;
  groups: TmuxGroupTopology[];
  linkedSessionCount: number;
  paneCount: number;
  processIds: Set<number>;
  serverPid: number;
  serverShared: boolean;
  sessionCount: number;
  staleSessionCount: number;
};
type ManagedTmuxGroup = {
  projectId: string;
  projectName: string;
};
type TmuxGroupTopology = ManagedTmuxGroup & {
  panes: TmuxPane[];
  processIds: Set<number>;
  sessions: TmuxSessionSnapshot[];
};
type TmuxCleanupFailure = { message: string; sessionName: string };
type TmuxCleanupReport = {
  completedAt: string;
  error: string;
  failed: TmuxCleanupFailure[];
  mode: "automatic" | "manual";
  removedSessionNames: string[];
};
type TmuxCleanupOptions = {
  execFileAsync: ExecFileAsync;
  mode?: TmuxCleanupReport["mode"];
  now?: () => number;
  sessionPrefix?: string;
  staleTmuxClientGraceMs?: number;
  state?: ResourceState;
};

const EMPTY_MEMORY = EMPTY_PROCESS_MEMORY;
const DEFAULT_STALE_TMUX_CLIENT_GRACE_MS = 60_000;

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeError(error: unknown, fallback: string): string {
  const source = error && typeof error === "object"
    ? error as { message?: unknown; stderr?: unknown; stdout?: unknown }
    : {};
  return normalizeText(source.stderr) || normalizeText(source.stdout) || normalizeText(source.message) || fallback;
}

function aggregateMemory(processIds: Iterable<number>, memoryByPid: Map<number, ProcessMemory>): ProcessMemory {
  return aggregateProcessMemory(processIds, memoryByPid);
}

function parseLines<T>(text: unknown, mapper: (fields: string[]) => T | null): T[] {
  return normalizeText(text)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => mapper(line.split("|")))
    .filter((entry): entry is T => Boolean(entry));
}

function parseTmuxSessions(text: unknown): TmuxSession[] {
  return parseLines(text, ([name = "", group = "", createdAt = "0"]) => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      return null;
    }
    return {
      createdAt: Math.max(0, Number(createdAt) || 0) * 1000,
      name: normalizedName,
      group: normalizeText(group) || normalizedName
    };
  });
}

function parseTmuxPanes(text: unknown): TmuxPane[] {
  return parseLines(text, ([group = "", id = "", pid = "0"]) => {
    const normalizedId = normalizeText(id);
    const normalizedPid = Number(pid);
    if (!normalizedId || !Number.isInteger(normalizedPid) || normalizedPid <= 0) {
      return null;
    }
    return { group: normalizeText(group), id: normalizedId, pid: normalizedPid };
  });
}

function parseTmuxClients(text: unknown): TmuxClient[] {
  return parseLines(text, ([session = "", pid = "0"]) => {
    const normalizedPid = Number(pid);
    if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
      return null;
    }
    return { session: normalizeText(session), pid: normalizedPid };
  });
}

function isNoTmuxServerError(error: unknown): boolean {
  return /no server running|failed to connect to server/i.test(normalizeError(error, ""));
}

function createManagedTmuxGroups(
  state: ResourceState = {},
  sessionPrefix = "boatyard"
): Map<string, ManagedTmuxGroup> {
  const globalSessionName = getProjectTmuxSessionName(
    { id: "__global__", name: "Global", slug: "global" },
    sessionPrefix
  );
  return new Map<string, ManagedTmuxGroup>([
    [globalSessionName, {
      projectId: "__global__",
      projectName: "Global workspace"
    }],
    ...(state.projects || []).map((project) => {
      const sessionName = getProjectTmuxSessionName(project, sessionPrefix);
      return [sessionName, {
        projectId: normalizeText(project.id),
        projectName: normalizeText(project.name || project.slug || project.id) || "Project"
      }] as [string, ManagedTmuxGroup];
    })
  ]);
}

function isManagedTmuxClientSession(session: TmuxSession): boolean {
  return session.name.startsWith(`${session.group}-client-`) && session.name.length > session.group.length + 8;
}

function classifyTmuxSession(
  session: TmuxSession,
  clientCount: number,
  now: number,
  staleClientGraceMs: number
): TmuxSessionState {
  if (session.name === session.group) {
    return "primary";
  }
  if (clientCount > 0) {
    return "active";
  }
  if (!isManagedTmuxClientSession(session)) {
    return "linked";
  }
  const age = session.createdAt > 0 ? now - session.createdAt : Number.POSITIVE_INFINITY;
  return age >= staleClientGraceMs ? "stale" : "starting";
}

function snapshotTmuxSessions(
  sessions: TmuxSession[],
  clients: TmuxClient[],
  now: number,
  staleClientGraceMs: number
): TmuxSessionSnapshot[] {
  const clientCountBySession = new Map<string, number>();
  for (const client of clients) {
    clientCountBySession.set(client.session, (clientCountBySession.get(client.session) || 0) + 1);
  }
  return sessions.map((session) => {
    const clientCount = clientCountBySession.get(session.name) || 0;
    return {
      ...session,
      clientCount,
      linked: session.name !== session.group,
      state: classifyTmuxSession(session, clientCount, now, staleClientGraceMs)
    };
  });
}

async function cleanupStaleTmuxClientSessions({
  execFileAsync,
  mode = "manual",
  now = Date.now,
  sessionPrefix = "boatyard",
  staleTmuxClientGraceMs = DEFAULT_STALE_TMUX_CLIENT_GRACE_MS,
  state = {}
}: TmuxCleanupOptions): Promise<TmuxCleanupReport> {
  const completedAt = () => new Date(now()).toISOString();
  try {
    const [sessionsResult, clientsResult] = await Promise.all([
      execFileAsync("tmux", ["list-sessions", "-F", "#{session_name}|#{session_group}|#{session_created}"], { timeout: 5000, windowsHide: true }),
      execFileAsync("tmux", ["list-clients", "-F", "#{client_session}|#{client_pid}"], { timeout: 5000, windowsHide: true })
    ]);
    const managedGroups = createManagedTmuxGroups(state, sessionPrefix);
    const sessions = snapshotTmuxSessions(
      parseTmuxSessions(sessionsResult.stdout).filter((session) => managedGroups.has(session.group)),
      parseTmuxClients(clientsResult.stdout),
      now(),
      staleTmuxClientGraceMs
    );
    const removedSessionNames: string[] = [];
    const failed: TmuxCleanupFailure[] = [];
    for (const session of sessions.filter((candidate) => candidate.state === "stale")) {
      try {
        await execFileAsync("tmux", ["kill-session", "-t", session.name], { timeout: 5000, windowsHide: true });
        removedSessionNames.push(session.name);
      } catch (error) {
        failed.push({
          message: normalizeError(error, "Could not remove this stale tmux session."),
          sessionName: session.name
        });
      }
    }
    return {
      completedAt: completedAt(),
      error: "",
      failed,
      mode,
      removedSessionNames
    };
  } catch (error) {
    return {
      completedAt: completedAt(),
      error: isNoTmuxServerError(error) ? "" : normalizeError(error, "Could not inspect stale tmux sessions."),
      failed: [],
      mode,
      removedSessionNames: []
    };
  }
}

async function collectTmuxTopology(
  execFileAsync: ExecFileAsync,
  managedGroups: Map<string, ManagedTmuxGroup>,
  identities: ProcessIdentity[],
  now: number,
  staleClientGraceMs: number
): Promise<TmuxTopology> {
  try {
    const [sessionsResult, panesResult, clientsResult, serverResult] = await Promise.all([
      execFileAsync("tmux", ["list-sessions", "-F", "#{session_name}|#{session_group}|#{session_created}"], { timeout: 5000, windowsHide: true }),
      execFileAsync("tmux", ["list-panes", "-a", "-F", "#{session_group}|#{pane_id}|#{pane_pid}"], { timeout: 5000, windowsHide: true }),
      execFileAsync("tmux", ["list-clients", "-F", "#{client_session}|#{client_pid}"], { timeout: 5000, windowsHide: true }),
      execFileAsync("tmux", ["display-message", "-p", "#{pid}"], { timeout: 5000, windowsHide: true })
    ]);
    const sessions = parseTmuxSessions(sessionsResult.stdout);
    const panes = parseTmuxPanes(panesResult.stdout);
    const clients = parseTmuxClients(clientsResult.stdout);
    const groups = [...managedGroups.entries()].flatMap(([groupName, managedGroup]) => {
      const groupSessions = snapshotTmuxSessions(
        sessions.filter((session) => session.group === groupName),
        clients,
        now,
        staleClientGraceMs
      );
      if (!groupSessions.length) {
        return [];
      }
      const sessionNames = new Set(groupSessions.map((session) => session.name));
      const uniquePanes = new Map(
        panes.filter((pane) => pane.group === groupName).map((pane) => [pane.id, pane])
      );
      const paneProcessIds = collectDescendantProcessIds(
        [...uniquePanes.values()].map((pane) => pane.pid),
        identities
      );
      const clientProcessIds = clients
        .filter((client) => sessionNames.has(client.session))
        .map((client) => client.pid);
      return [{
        ...managedGroup,
        panes: [...uniquePanes.values()],
        processIds: new Set([...paneProcessIds, ...clientProcessIds]),
        sessions: groupSessions
      }];
    });
    const serverPid = Number(normalizeText(serverResult.stdout));
    const serverShared = sessions.some((session) => !managedGroups.has(session.group));
    const processIds = new Set(groups.flatMap((group) => [...group.processIds]));
    if (groups.length && Number.isInteger(serverPid) && serverPid > 0) {
      processIds.add(serverPid);
    }
    return {
      activeClientSessionCount: groups.reduce(
        (total, group) => total + group.sessions.filter((session) => session.state === "active").length,
        0
      ),
      available: true,
      error: "",
      groupCount: groups.length,
      groups,
      linkedSessionCount: groups.reduce(
        (total, group) => total + group.sessions.filter((session) => session.name !== session.group).length,
        0
      ),
      paneCount: new Set(groups.flatMap((group) => group.panes.map((pane) => pane.id))).size,
      processIds,
      serverPid: Number.isInteger(serverPid) ? serverPid : 0,
      serverShared,
      sessionCount: groups.reduce((total, group) => total + group.sessions.length, 0),
      staleSessionCount: groups.reduce(
        (total, group) => total + group.sessions.filter((session) => session.state === "stale").length,
        0
      )
    };
  } catch (error) {
    if (isNoTmuxServerError(error)) {
      return {
        activeClientSessionCount: 0,
        available: true,
        error: "",
        groupCount: 0,
        groups: [],
        linkedSessionCount: 0,
        paneCount: 0,
        processIds: new Set(),
        serverPid: 0,
        serverShared: false,
        sessionCount: 0,
        staleSessionCount: 0
      };
    }
    return {
      activeClientSessionCount: 0,
      available: false,
      error: normalizeError(error, "Could not inspect tmux."),
      groupCount: 0,
      groups: [],
      linkedSessionCount: 0,
      paneCount: 0,
      processIds: new Set(),
      serverPid: 0,
      serverShared: false,
      sessionCount: 0,
      staleSessionCount: 0
    };
  }
}

async function collectSystemResources(options: CollectorOptions) {
  const platform = options.platform || process.platform;
  const state = options.state || {};
  const rootPid = Number(options.rootPid || process.pid);
  const webContentsViews = options.webContentsViews || {};
  const webContentsViewEntries = webContentsViews.entries || (webContentsViews.processIds || []).map((pid, index) => ({
    key: `wcv-${index + 1}`,
    label: `Web app ${index + 1}`,
    pid,
    projectId: "",
    url: "",
    windowId: ""
  }));
  if (platform !== "linux") {
    return {
      sampledAt: new Date().toISOString(),
      supported: false,
      error: "Detailed process memory accounting is currently available on Linux only."
    };
  }

  const processSource = options.processSource || createLinuxProcessSource();
  const identities = await processSource.list();
  const appProcessIds = collectDescendantProcessIds([rootPid], identities);
  const wcvProcessIds = new Set(webContentsViewEntries.map((entry) => entry.pid).filter((pid) => appProcessIds.has(pid)));
  const sessionPrefix = options.sessionPrefix || process.env.BOATYARD_TERMINAL_SESSION_PREFIX || "boatyard";
  const managedTmuxGroups = createManagedTmuxGroups(state, sessionPrefix);
  const now = options.now?.() ?? Date.now();
  const staleClientGraceMs = Math.max(
    0,
    Number(options.staleTmuxClientGraceMs ?? DEFAULT_STALE_TMUX_CLIENT_GRACE_MS) || 0
  );
  const [tmuxTopology, providers] = await Promise.all([
    collectTmuxTopology(options.execFileAsync, managedTmuxGroups, identities, now, staleClientGraceMs),
    options.collectResourceProviders?.() || Promise.resolve([])
  ]);

  const allMeasuredProcessIds = new Set([...appProcessIds, ...tmuxTopology.processIds]);
  const memoryEntries = await Promise.all([...allMeasuredProcessIds].map(async (pid) => [
    pid,
    await processSource.readMemory(pid)
  ] as const));
  const memoryByPid = new Map(memoryEntries);
  const appMemory = aggregateMemory(appProcessIds, memoryByPid);
  const wcvMemory = aggregateMemory(wcvProcessIds, memoryByPid);
  const wcvShareCountByPid = new Map<number, number>();
  for (const entry of webContentsViewEntries) {
    if (appProcessIds.has(entry.pid)) {
      wcvShareCountByPid.set(entry.pid, (wcvShareCountByPid.get(entry.pid) || 0) + 1);
    }
  }
  const projectNamesById = new Map((state.projects || []).map((project) => [
    normalizeText(project.id),
    normalizeText(project.name || project.slug || project.id) || "Project"
  ]));
  const wcvEntries = webContentsViewEntries.map((entry) => {
    const memory = memoryByPid.get(entry.pid) || EMPTY_MEMORY;
    const shareCount = Math.max(1, wcvShareCountByPid.get(entry.pid) || 1);
    return {
      key: entry.key,
      label: entry.label || "Web app",
      pid: entry.pid,
      projectId: entry.projectId,
      projectName: entry.projectId === "__global__"
        ? "Global workspace"
        : projectNamesById.get(entry.projectId) || "Unassigned",
      pssBytes: Math.round(memory.pssBytes / shareCount),
      rssBytes: Math.round(memory.rssBytes / shareCount),
      sharedProcessViews: shareCount,
      url: entry.url,
      windowId: entry.windowId
    };
  }).sort((left, right) => `${left.projectName}/${left.label}`.localeCompare(`${right.projectName}/${right.label}`));
  const tmuxMemory = aggregateMemory(tmuxTopology.processIds, memoryByPid);
  const tmuxGroups = tmuxTopology.groups.map((group) => ({
    projectId: group.projectId,
    projectName: group.projectName,
    sessions: group.sessions.map((session) => ({
      clientCount: session.clientCount,
      createdAt: session.createdAt,
      linked: session.linked,
      name: session.name,
      state: session.state
    })),
    panes: group.panes.map((pane) => {
      const processIds = collectDescendantProcessIds([pane.pid], identities);
      return {
        id: pane.id,
        pid: pane.pid,
        processCount: processIds.size,
        ...aggregateMemory(processIds, memoryByPid)
      };
    }),
    processCount: group.processIds.size,
    ...aggregateMemory(group.processIds, memoryByPid)
  }));
  const tmuxOutsideAppIds = new Set([...tmuxTopology.processIds].filter((pid) => !appProcessIds.has(pid)));
  const sharedServerExcluded = tmuxTopology.serverShared && tmuxOutsideAppIds.delete(tmuxTopology.serverPid);
  const tmuxExclusiveMemory = aggregateMemory(tmuxOutsideAppIds, memoryByPid);
  const sharedServerMemory = sharedServerExcluded
    ? aggregateMemory([tmuxTopology.serverPid], memoryByPid)
    : { ...EMPTY_MEMORY };

  return {
    sampledAt: new Date().toISOString(),
    supported: true,
    accounting: {
      hostMetric: "PSS",
      note: "Web app memory is included in Boatyard. tmux processes already inside Boatyard and shared tmux server memory are excluded from the estimated total."
    },
    total: {
      estimatedBytes: appMemory.pssBytes + tmuxExclusiveMemory.pssBytes + providers.reduce(
        (total, provider) => total + provider.exclusiveMemoryBytes,
        0
      )
    },
    boatyard: {
      processCount: appProcessIds.size,
      ...appMemory
    },
    wcv: {
      count: webContentsViews.count ?? webContentsViewEntries.length,
      entries: wcvEntries,
      processCount: wcvProcessIds.size,
      ...wcvMemory
    },
    tmux: {
      activeClientSessionCount: tmuxTopology.activeClientSessionCount,
      available: tmuxTopology.available,
      cleanup: options.tmuxCleanup || null,
      error: tmuxTopology.error,
      groupCount: tmuxTopology.groupCount,
      groups: tmuxGroups,
      linkedSessionCount: tmuxTopology.linkedSessionCount,
      paneCount: tmuxTopology.paneCount,
      processCount: tmuxTopology.processIds.size,
      sessionCount: tmuxTopology.sessionCount,
      staleSessionCount: tmuxTopology.staleSessionCount,
      serverShared: tmuxTopology.serverShared,
      sharedServerPssBytes: sharedServerMemory.pssBytes,
      pssBytes: tmuxMemory.pssBytes,
      rssBytes: tmuxMemory.rssBytes,
      swapPssBytes: tmuxMemory.swapPssBytes,
      exclusivePssBytes: tmuxExclusiveMemory.pssBytes
    },
    providers
  };
}

export {
  DEFAULT_STALE_TMUX_CLIENT_GRACE_MS,
  aggregateMemory,
  cleanupStaleTmuxClientSessions,
  collectDescendantProcessIds,
  collectSystemResources,
  createLinuxProcessSource,
  parseProcessMemory,
  parseTmuxClients,
  parseTmuxPanes,
  parseTmuxSessions
};

export type {
  CollectorOptions,
  ProcessIdentity,
  ProcessMemory,
  ProcessSource,
  ResourceState,
  TmuxCleanupOptions,
  TmuxCleanupReport
};
