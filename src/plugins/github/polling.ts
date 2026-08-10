"use strict";

const {
  resolveGitHubRepository
} = require("./service");

type UnknownRecord = Record<string, unknown>;

type GitHubProject = {
  gitUrl?: unknown;
  repoUrl?: unknown;
};

type GitHubRepositoryRef = {
  host: string;
  owner: string;
  repo: string;
};

type GitHubPollingChannel = "actions" | "pullRequests";
type GitHubPollingDetail = "full" | "summary";
type GitHubPollingPriority = "background" | "foreground";

type GitHubPollingSubscription = {
  channel: GitHubPollingChannel;
  detail: GitHubPollingDetail;
  priority: GitHubPollingPriority;
  project: GitHubProject;
};

type GitHubPollingError = {
  code: string;
  message: string;
  retryAt: string;
};

type GitHubPollingChannelState = {
  channel: GitHubPollingChannel;
  channelKey: string;
  error: GitHubPollingError | null;
  loading: boolean;
  repository: GitHubRepositoryRef;
  revision: number;
  snapshot: unknown;
  stale: boolean;
};

type GitHubPollingService = {
  actionsSnapshotForProject(
    project: GitHubProject,
    options?: {
      detail?: GitHubPollingDetail;
      force?: boolean;
      priority?: GitHubPollingPriority | "interactive";
    }
  ): Promise<unknown>;
  pullRequestsSnapshotForProject(
    project: GitHubProject,
    options?: {
      detail?: GitHubPollingDetail;
      force?: boolean;
      priority?: GitHubPollingPriority | "interactive";
    }
  ): Promise<unknown>;
};

type GitHubPollingCoordinatorOptions = {
  backgroundRefreshMs?: number;
  backgroundStaggerMs?: number;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  emit: (state: GitHubPollingChannelState) => void;
  foregroundActionsActiveRefreshMs?: number;
  foregroundRefreshMs?: number;
  leaseMs?: number;
  minimumPollGapMs?: number;
  now?: () => number;
  random?: () => number;
  service: GitHubPollingService;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
};

type GitHubPollingClient = {
  expiresAt: number;
  subscriptions: GitHubPollingSubscription[];
};

type GitHubPollingDemand = GitHubPollingSubscription & {
  channelKey: string;
  repository: GitHubRepositoryRef;
  subscriberCount: number;
};

type GitHubPollingChannelEntry = GitHubPollingDemand & {
  active: boolean;
  error: GitHubPollingError | null;
  failureCount: number;
  forceRequested: boolean;
  forceWaiters: Array<(state: GitHubPollingChannelState) => void>;
  inFlight: boolean;
  nextDueAt: number;
  revision: number;
  snapshot: unknown;
};

const DEFAULT_BACKGROUND_REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_BACKGROUND_STAGGER_MS = 2500;
const DEFAULT_FOREGROUND_ACTIONS_ACTIVE_REFRESH_MS = 5000;
const DEFAULT_FOREGROUND_REFRESH_MS = 30 * 1000;
const DEFAULT_LEASE_MS = 60 * 1000;
const DEFAULT_MINIMUM_POLL_GAP_MS = 1000;
const DEFAULT_RATE_LIMIT_RETRY_MS = 60 * 1000;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeChannel(value: unknown): GitHubPollingChannel | null {
  return value === "actions" || value === "pullRequests" ? value : null;
}

function normalizeDetail(value: unknown): GitHubPollingDetail {
  return value === "full" ? "full" : "summary";
}

function normalizePriority(value: unknown): GitHubPollingPriority {
  return value === "foreground" ? "foreground" : "background";
}

function getRepositoryKey(repository: GitHubRepositoryRef): string {
  return `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
}

function getGitHubPollingChannelKey(
  repository: GitHubRepositoryRef,
  channel: GitHubPollingChannel
): string {
  return `github:${getRepositoryKey(repository)}:${channel}`;
}

function normalizeSubscription(value: unknown): GitHubPollingDemand | null {
  if (!isRecord(value)) {
    return null;
  }
  const channel = normalizeChannel(value.channel);
  const project = isRecord(value.project) ? value.project : {};
  const repository = resolveGitHubRepository(project) as GitHubRepositoryRef | null;
  if (!channel || !repository) {
    return null;
  }
  return {
    channel,
    channelKey: getGitHubPollingChannelKey(repository, channel),
    detail: normalizeDetail(value.detail),
    priority: normalizePriority(value.priority),
    project: {
      repoUrl: `https://${repository.host}/${repository.owner}/${repository.repo}`
    },
    repository,
    subscriberCount: 1
  };
}

function mergeDemand(
  current: GitHubPollingDemand | undefined,
  incoming: GitHubPollingDemand
): GitHubPollingDemand {
  if (!current) {
    return incoming;
  }
  return {
    ...current,
    detail: current.detail === "full" || incoming.detail === "full" ? "full" : "summary",
    priority: current.priority === "foreground" || incoming.priority === "foreground"
      ? "foreground"
      : "background",
    subscriberCount: current.subscriberCount + incoming.subscriberCount
  };
}

function normalizePollingError(error: unknown, now: number): GitHubPollingError {
  const source = isRecord(error) ? error : {};
  const code = normalizeText(source.code) || "unknown";
  const message = normalizeText(source.message)
    || (error instanceof Error ? error.message : "GitHub request failed.");
  const retryAfterMs = Math.max(0, Number(source.retryAfterMs) || 0);
  const effectiveRetryMs = code === "rateLimited"
    ? Math.max(DEFAULT_RATE_LIMIT_RETRY_MS, retryAfterMs)
    : retryAfterMs;
  return {
    code,
    message,
    retryAt: effectiveRetryMs
      ? new Date(now + effectiveRetryMs).toISOString()
      : ""
  };
}

function snapshotHasActiveActions(snapshot: unknown): boolean {
  return isRecord(snapshot) && Number(snapshot.activeRunCount) > 0;
}

function createGitHubPollingCoordinator({
  backgroundRefreshMs = DEFAULT_BACKGROUND_REFRESH_MS,
  backgroundStaggerMs = DEFAULT_BACKGROUND_STAGGER_MS,
  clearTimer = clearTimeout,
  emit,
  foregroundActionsActiveRefreshMs = DEFAULT_FOREGROUND_ACTIONS_ACTIVE_REFRESH_MS,
  foregroundRefreshMs = DEFAULT_FOREGROUND_REFRESH_MS,
  leaseMs = DEFAULT_LEASE_MS,
  minimumPollGapMs = DEFAULT_MINIMUM_POLL_GAP_MS,
  now = Date.now,
  random = Math.random,
  service,
  setTimer = setTimeout
}: GitHubPollingCoordinatorOptions) {
  const clients = new Map<string, GitHubPollingClient>();
  const channels = new Map<string, GitHubPollingChannelEntry>();
  let backgroundSequence = 0;
  let lastPollFinishedAt = 0;
  let plannerRunning = false;
  let plannerTimer: ReturnType<typeof setTimeout> | null = null;

  function getState(channel: GitHubPollingChannelEntry): GitHubPollingChannelState {
    return {
      channel: channel.channel,
      channelKey: channel.channelKey,
      error: channel.error,
      loading: channel.inFlight,
      repository: channel.repository,
      revision: channel.revision,
      snapshot: channel.snapshot ?? null,
      stale: Boolean(channel.error && channel.snapshot !== undefined)
    };
  }

  function emitState(channel: GitHubPollingChannelEntry): void {
    emit(getState(channel));
  }

  function clearPlannerTimer(): void {
    if (plannerTimer !== null) {
      clearTimer(plannerTimer);
      plannerTimer = null;
    }
  }

  function pruneExpiredClients(): boolean {
    let changed = false;
    const timestamp = now();
    for (const [clientId, client] of clients) {
      if (client.expiresAt <= timestamp) {
        clients.delete(clientId);
        changed = true;
      }
    }
    return changed;
  }

  function collectDemand(): Map<string, GitHubPollingDemand> {
    const demand = new Map<string, GitHubPollingDemand>();
    for (const client of clients.values()) {
      for (const subscription of client.subscriptions) {
        const normalized = normalizeSubscription(subscription);
        if (!normalized) {
          continue;
        }
        demand.set(
          normalized.channelKey,
          mergeDemand(demand.get(normalized.channelKey), normalized)
        );
      }
    }
    return demand;
  }

  function resolveAbandonedChannel(channel: GitHubPollingChannelEntry): void {
    const state = getState(channel);
    for (const resolve of channel.forceWaiters.splice(0)) {
      resolve(state);
    }
  }

  function rebuildChannels(): void {
    pruneExpiredClients();
    const demand = collectDemand();
    const timestamp = now();

    if (!channels.size) {
      backgroundSequence = 0;
    }

    for (const channel of channels.values()) {
      channel.active = false;
    }

    for (const [channelKey, requested] of demand) {
      let channel = channels.get(channelKey);
      if (!channel) {
        const initialDelay = requested.priority === "foreground"
          ? 0
          : Math.min(
            Math.max(0, backgroundRefreshMs),
            backgroundSequence++ * Math.max(0, backgroundStaggerMs)
          );
        channel = {
          ...requested,
          active: true,
          error: null,
          failureCount: 0,
          forceRequested: false,
          forceWaiters: [],
          inFlight: false,
          nextDueAt: timestamp + initialDelay,
          revision: 0,
          snapshot: undefined
        };
        channels.set(channelKey, channel);
        continue;
      }

      const priorityPromoted = channel.priority === "background" && requested.priority === "foreground";
      const detailPromoted = channel.detail === "summary" && requested.detail === "full";
      Object.assign(channel, requested, { active: true });
      if (priorityPromoted || detailPromoted) {
        channel.nextDueAt = Math.min(channel.nextDueAt, timestamp);
      }
    }

    for (const [channelKey, channel] of channels) {
      if (!channel.active && !channel.inFlight) {
        resolveAbandonedChannel(channel);
        channels.delete(channelKey);
      }
    }
  }

  function getNextLeaseExpiry(): number {
    return Math.min(
      ...[...clients.values()].map((client) => client.expiresAt),
      Number.POSITIVE_INFINITY
    );
  }

  function getNextChannelDue(): number {
    return Math.min(
      ...[...channels.values()]
        .filter((channel) => channel.active && !channel.inFlight)
        .map((channel) => channel.nextDueAt),
      Number.POSITIVE_INFINITY
    );
  }

  function schedulePlanner(): void {
    clearPlannerTimer();
    if (plannerRunning) {
      return;
    }
    const timestamp = now();
    const channelDue = getNextChannelDue();
    const pacedChannelDue = Number.isFinite(channelDue)
      ? Math.max(channelDue, lastPollFinishedAt + Math.max(0, minimumPollGapMs))
      : Number.POSITIVE_INFINITY;
    const nextAt = Math.min(pacedChannelDue, getNextLeaseExpiry());
    if (!Number.isFinite(nextAt)) {
      return;
    }
    plannerTimer = setTimer(() => {
      plannerTimer = null;
      void runPlanner();
    }, Math.max(0, nextAt - timestamp));
  }

  function getRefreshInterval(channel: GitHubPollingChannelEntry): number {
    if (channel.error) {
      if (channel.error.code === "rateLimited" && channel.error.retryAt) {
        return Math.max(
          DEFAULT_RATE_LIMIT_RETRY_MS,
          Date.parse(channel.error.retryAt) - now()
        );
      }
      return Math.min(
        backgroundRefreshMs,
        foregroundRefreshMs * Math.min(16, 2 ** channel.failureCount)
      );
    }
    if (channel.priority === "foreground") {
      return channel.channel === "actions" && snapshotHasActiveActions(channel.snapshot)
        ? foregroundActionsActiveRefreshMs
        : foregroundRefreshMs;
    }
    const jitter = 0.9 + Math.max(0, Math.min(1, random())) * 0.2;
    return Math.round(backgroundRefreshMs * jitter);
  }

  function selectDueChannel(): GitHubPollingChannelEntry | null {
    const timestamp = now();
    const priorityWeights: Record<GitHubPollingPriority, number> = {
      background: 0,
      foreground: 1
    };
    return [...channels.values()]
      .filter((channel) => channel.active && !channel.inFlight && channel.nextDueAt <= timestamp)
      .sort((left, right) => (
        Number(right.forceRequested) - Number(left.forceRequested)
        || priorityWeights[right.priority] - priorityWeights[left.priority]
        || left.nextDueAt - right.nextDueAt
        || left.channelKey.localeCompare(right.channelKey)
      ))[0] || null;
  }

  async function pollChannel(channel: GitHubPollingChannelEntry): Promise<void> {
    const force = channel.forceRequested;
    const pollWaiters = force ? channel.forceWaiters.splice(0) : [];
    channel.forceRequested = false;
    channel.inFlight = true;
    emitState(channel);

    try {
      channel.snapshot = channel.channel === "actions"
        ? await service.actionsSnapshotForProject(channel.project, {
          detail: channel.detail,
          force,
          priority: force ? "interactive" : channel.priority
        })
        : await service.pullRequestsSnapshotForProject(channel.project, {
          detail: channel.detail,
          force,
          priority: force ? "interactive" : channel.priority
        });
      channel.error = null;
      channel.failureCount = 0;
      channel.revision += 1;
    } catch (error) {
      channel.error = normalizePollingError(error, now());
      channel.failureCount += 1;
    } finally {
      channel.inFlight = false;
      lastPollFinishedAt = now();
      if (channel.active) {
        channel.nextDueAt = channel.forceRequested
          ? now()
          : now() + getRefreshInterval(channel);
        emitState(channel);
      }
      const state = getState(channel);
      for (const resolve of pollWaiters) {
        resolve(state);
      }
      if (!channel.active) {
        resolveAbandonedChannel(channel);
        channels.delete(channel.channelKey);
      }
    }
  }

  async function runPlanner(): Promise<void> {
    if (plannerRunning) {
      return;
    }
    plannerRunning = true;
    rebuildChannels();
    const channel = selectDueChannel();
    if (channel) {
      await pollChannel(channel);
    }
    plannerRunning = false;
    schedulePlanner();
  }

  function syncClient(clientIdValue: unknown, values: unknown): GitHubPollingChannelState[] {
    const clientId = normalizeText(clientIdValue);
    if (!clientId) {
      throw new Error("GitHub polling subscriptions require a client id.");
    }
    const subscriptions = (Array.isArray(values) ? values : [])
      .map(normalizeSubscription)
      .filter((subscription): subscription is GitHubPollingDemand => !!subscription)
      .map(({ channel, detail, priority, project }) => ({ channel, detail, priority, project }));
    if (subscriptions.length) {
      clients.set(clientId, {
        expiresAt: now() + Math.max(1000, leaseMs),
        subscriptions
      });
    } else {
      clients.delete(clientId);
    }
    rebuildChannels();
    schedulePlanner();
    const keys = new Set(
      subscriptions
        .map(normalizeSubscription)
        .filter((subscription): subscription is GitHubPollingDemand => !!subscription)
        .map((subscription) => subscription.channelKey)
    );
    return [...keys]
      .map((key) => channels.get(key))
      .filter((channel): channel is GitHubPollingChannelEntry => !!channel)
      .map(getState);
  }

  function refresh(
    channelValue: unknown,
    projectValue: unknown
  ): Promise<GitHubPollingChannelState> {
    const channelName = normalizeChannel(channelValue);
    const project = isRecord(projectValue) ? projectValue : {};
    const repository = resolveGitHubRepository(project) as GitHubRepositoryRef | null;
    if (!channelName || !repository) {
      return Promise.reject(new Error("GitHub polling refresh requires a supported channel and repository."));
    }
    const channelKey = getGitHubPollingChannelKey(repository, channelName);
    const channel = channels.get(channelKey);
    if (!channel?.active) {
      return Promise.reject(new Error("GitHub polling channel is not subscribed."));
    }
    channel.forceRequested = true;
    channel.nextDueAt = Math.min(channel.nextDueAt, now());
    const result = new Promise<GitHubPollingChannelState>((resolve) => {
      channel.forceWaiters.push(resolve);
    });
    schedulePlanner();
    return result;
  }

  function inspect(): UnknownRecord {
    return {
      channels: [...channels.values()].map((channel) => ({
        channel: channel.channel,
        channelKey: channel.channelKey,
        detail: channel.detail,
        nextDueAt: channel.nextDueAt,
        priority: channel.priority,
        subscriberCount: channel.subscriberCount
      })),
      clientCount: clients.size
    };
  }

  return Object.freeze({
    inspect,
    refresh,
    syncClient
  });
}

module.exports = {
  createGitHubPollingCoordinator,
  getGitHubPollingChannelKey
};

export {};
