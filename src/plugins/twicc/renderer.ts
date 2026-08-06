"use strict";

(function registerTwiccPlugin(globalScope: BoatyardPluginRendererGlobal) {
  const rendererScriptUrl = (document.currentScript as HTMLScriptElement | null)?.src || "";
  const twiccIconUrl = rendererScriptUrl ? new URL("twicc-icon.svg", rendererScriptUrl).href : "";

  type TwiccProject = PluginRegistryRecord & {
    id?: unknown;
    name?: unknown;
    slug?: unknown;
    sourcePath?: unknown;
  };

  type TwiccConfig = {
    twiccApiToken?: string;
    twiccBaseUrl?: string;
    twiccProjectStatusDisplay?: string;
    twiccProjectUrl?: string;
    twiccTopbarUsageDisplay?: string;
  };

  type TwiccPluginOptions = {
    closeContextMenu?: () => void;
    globalPluginConfig?: TwiccConfig;
    getProjectWebAppState?: (webAppId: string) => { key?: string; url?: string } | null;
    isActiveProject?: boolean;
    openContextMenu?: (menu: HTMLElement, event: MouseEvent) => void;
    openProjectWebApp?: (webAppId: string, url?: string) => unknown;
    pluginConfig?: TwiccConfig;
    projectConfig?: TwiccConfig;
  };

  type TwiccSessionFlowOrientation = "horizontal" | "vertical";
  type TwiccSessionFlowLane = "backlog" | "in_progress" | "testing";
  type TwiccSessionFlowItem = {
    branch?: string;
    contextUsage?: number;
    id: string;
    lane: TwiccSessionFlowLane;
    lastActivityAt?: string;
    order?: number;
    processState?: string;
    provider?: string;
    title: string;
    totalCost?: number;
    userMessageCount?: number;
  };
  type TwiccSessionFlowSurface = HTMLElement & {
    cleanup?: () => void;
    setOrientation?: (orientation: TwiccSessionFlowOrientation) => void;
  };
  type TwiccSessionFlowInsertionTarget = {
    beforeNode: HTMLElement | null;
    beforeSessionId: string | null;
    lane: TwiccSessionFlowLane;
  };
  type TwiccSessionArchiveResult = {
    archivedCount: number;
    failures: string[];
  };
  type TwiccSessionFlowPaneOptions = TwiccPluginOptions & {
    host?: HTMLElement;
    paneId?: string;
    project?: TwiccProject;
  };
  type TwiccCreatedSession = {
    projectId: string;
    provider: string;
    sessionId: string;
    status: string;
    title: string;
  };
  type TwiccGitBranch = {
    checkedOut: boolean;
    name: string;
  };
  type TwiccGitWorktree = {
    branch: string;
    detached: boolean;
    path: string;
    usable: boolean;
  };
  type TwiccSessionCreationOptions = {
    branches: TwiccGitBranch[];
    defaultWorktreeBase: string;
    gitRoot: string;
    worktrees: TwiccGitWorktree[];
  };
  type TwiccSessionComposerMode = "" | "direct" | "worktree";
  type TwiccWorktreeMode = "existing" | "new";
  type TwiccSessionImageAttachment = {
    dataUrl: string;
    name: string;
  };
  type TwiccSessionCreationDraft = {
    attachments: TwiccSessionImageAttachment[];
    attachmentsLoading: number;
    branch: string;
    path: string;
    pathEdited: boolean;
    prompt: string;
    startFrom: string;
    title: string;
    usePier: boolean;
    worktreeMode: TwiccWorktreeMode;
  };
  type PierSessionFlowService = PluginRegistryRecord & {
    createWorktree(project: TwiccProject, payload?: Record<string, unknown>): Promise<unknown> | undefined;
    getDefaultWorktreePath(project: TwiccProject, branchName?: unknown, options?: PluginRegistryRecord): string;
    getProjectAvailability(project: TwiccProject): Promise<{ available: boolean; worktreePattern: string }>;
    isProjectEnabled(project: TwiccProject): Promise<boolean>;
  };

  type TwiccProjectSession = {
    id?: string;
    lastStateChangeAt?: string;
    rawState?: string;
    state?: string;
    title?: string;
  };

  type TwiccProjectStatus = {
    count?: number;
    sessions?: TwiccProjectSession[];
    state?: string;
  };

  type TwiccCreatedProject = {
    url?: string;
  };

  type TwiccUsageProvider = {
    extra_usage_is_enabled?: boolean;
    extra_usage_remaining_credits?: number;
    extra_usage_utilization?: number;
    fetched_at?: string;
    five_hour_burn_rate?: number;
    five_hour_burn_rate_1h?: number;
    five_hour_burn_rate_30min?: number;
    five_hour_resets_at?: string;
    five_hour_utilization?: number;
    provider?: string;
    seven_day_burn_rate?: number;
    seven_day_burn_rate_12h?: number;
    seven_day_burn_rate_24h?: number;
    seven_day_resets_at?: string;
    seven_day_utilization?: number;
  };
  type TwiccSettingsFields = {
    getValue(key: string): string;
    isEdited(key: string): boolean;
    setActionVisible(key: string, visible: boolean): void;
    setValue(key: string, value: string, options?: Record<string, unknown>): void;
  };
  type TwiccProjectFieldContext = {
    coreFields: {
      sourcePath?: unknown;
    };
    fields: TwiccSettingsFields;
    globalConfig?: TwiccConfig;
  };
  type TwiccSourcePathInspectedEvent = {
    fields?: TwiccSettingsFields;
    inspected?: {
      plugins?: {
        "boatyard.twicc"?: {
          matchType?: string;
          projectUrl?: string;
        };
      };
    };
  };
  type TwiccPluginContext = PluginRegistryRecord & {
    events: {
      on<TEvent extends PluginRegistryRecord = PluginRegistryRecord>(eventName: string, callback: (event: TEvent) => void): void;
    };
    panes: {
      register(definition: Record<string, unknown>): void;
    };
    projectNavBadges: {
      register(definition: Record<string, unknown>): void;
    };
    services: {
      provide(id: string, service: unknown): void;
    };
    settings: {
      registerGlobalSection(section: Record<string, unknown>): void;
      registerProjectSection(section: Record<string, unknown>): void;
    };
    status: {
      set(status: unknown): void;
    };
    widgets: {
      register(definition: Record<string, unknown>): void;
      registerAlias(alias: string, targetId: string): void;
    };
  };

  const registry = globalScope.BoatyardPluginRegistry;
  const DEFAULT_TWICC_URL = "http://localhost:3500";
  const TWICC_PROJECT_STATUS_REFRESH_MS = 5000;
  const TWICC_SESSION_FLOW_REFRESH_MS = 15000;
  const TWICC_SESSION_FLOW_OPTIMISTIC_TTL_MS = 60000;
  const TWICC_SESSION_FLOW_SINGLE_CLICK_DELAY_MS = 300;
  const WEBAPP_URL_CHANGED_EVENT = "boatyard:webapp-url-changed";
  const TWICC_SESSION_FLOW_ORIENTATION_EVENT = "boatyard:twicc-session-flow-orientation";
  const TWICC_SESSION_FLOW_ORIENTATION_STORAGE_PREFIX = "boatyard:twicc-session-flow-orientation:";
  const TWICC_SESSION_FLOW_LANES: Array<{ id: TwiccSessionFlowLane; label: string }> = [
    { id: "in_progress", label: "In progress" },
    { id: "backlog", label: "Backlog" },
    { id: "testing", label: "Done" }
  ];
  const TWICC_PROJECT_STATUS_LABELS = {
    working: "Working",
    input: "Input",
    done: "Done"
  };
  const TWICC_PROJECT_STATUS_DISPLAY_DEFAULT = "labels";
  const TWICC_PROJECT_STATUS_DISPLAY_OPTIONS = [
    { value: "labels", label: "Labels" },
    { value: "icon", label: "Colored icon" }
  ];
  const TWICC_USAGE_REFRESH_MS = 60000;
  const TWICC_TOPBAR_USAGE_DISPLAY_DEFAULT = "chartsWithValues";
  const TWICC_TOPBAR_USAGE_DISPLAY_OPTIONS = [
    { value: "numbers", label: "Numeric values" },
    { value: "charts", label: "Charts only" },
    { value: "chartsWithValues", label: "Charts with values" }
  ];
  let projectProcessStatuses: Record<string, TwiccProjectStatus> = {};
  let nextSessionFlowSurfaceId = 0;
  const retainedDoneProjectStatuses = new Map<string, TwiccProjectStatus>();
  const acknowledgedDoneProjectSignatures = new Map<string, string>();
  let projectStatusRefreshTimer: number | null = null;
  let latestGlobalConfig: TwiccConfig = {};

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function invokePlugin(actionName: string, payload: Record<string, unknown> = {}) {
    return globalScope.boatyard?.invokePlugin?.("boatyard.twicc", actionName, payload);
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeOptionalNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function normalizeProjectSession(value: unknown): TwiccProjectSession {
    const source = isRecord(value) ? value : {};
    return {
      id: String(source.id || "").trim() || undefined,
      lastStateChangeAt: String(source.lastStateChangeAt || "").trim() || undefined,
      rawState: String(source.rawState || "").trim() || undefined,
      state: String(source.state || "").trim() || undefined,
      title: String(source.title || "").trim() || undefined
    };
  }

  function normalizeProjectStatus(value: unknown): TwiccProjectStatus {
    const source = isRecord(value) ? value : {};
    const sessions = Array.isArray(source.sessions)
      ? source.sessions.map(normalizeProjectSession)
      : undefined;

    return {
      count: normalizeOptionalNumber(source.count),
      sessions,
      state: String(source.state || "").trim() || undefined
    };
  }

  function asProjectProcessStatuses(value: unknown): Record<string, TwiccProjectStatus> {
    if (!isRecord(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, status]) => [key, normalizeProjectStatus(status)])
    );
  }

  function getDoneStatusSignature(status: TwiccProjectStatus): string {
    const sessions = (status.sessions || [])
      .filter((session) => !session.state || session.state === "done")
      .map((session) => [
        session.id || "",
        session.lastStateChangeAt || "",
        session.rawState || "",
        session.title || ""
      ].join("\u0000"))
      .sort();

    return JSON.stringify([status.count || sessions.length, sessions]);
  }

  function hasProjectStatusState(status: TwiccProjectStatus | null, state: string): boolean {
    if (!status) {
      return false;
    }
    const sessions = status.sessions || [];
    return sessions.some((session) => session.state === state)
      || (!sessions.length && status.state === state);
  }

  function getDoneProjectStatus(status: TwiccProjectStatus | null): TwiccProjectStatus | null {
    if (!hasProjectStatusState(status, "done")) {
      return null;
    }
    const doneSessions = (status?.sessions || []).filter((session) => session.state === "done");
    return {
      ...status,
      count: doneSessions.length || status?.count,
      sessions: doneSessions.length ? doneSessions : status?.sessions,
      state: "done"
    };
  }

  function getLiveProjectStatusForState(
    status: TwiccProjectStatus | null,
    state: string
  ): TwiccProjectStatus | null {
    return hasProjectStatusState(status, state)
      ? { ...status, state }
      : null;
  }

  function asCreatedProject(value: unknown): TwiccCreatedProject {
    const source = isRecord(value) ? value : {};
    return {
      url: String(source.url || "").trim() || undefined
    };
  }

  function normalizeBaseUrl(value: unknown): string {
    return String(value || DEFAULT_TWICC_URL).replace(/\/+$/g, "");
  }

  function resolveProjectUrl(_project: TwiccProject, options: TwiccPluginOptions = {}) {
    return options.pluginConfig?.twiccProjectUrl || "";
  }

  function resolveSessionUrl(project: TwiccProject, sessionId: unknown, options: TwiccPluginOptions = {}) {
    const projectUrl = resolveProjectUrl(project, options);
    const id = String(sessionId || "").trim();
    if (!projectUrl || !id) {
      return "";
    }

    try {
      const parsed = new URL(projectUrl);
      parsed.pathname = `${parsed.pathname.replace(/\/+$/g, "")}/session/${encodeURIComponent(id)}`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function resolveSessionUrlForProjectId(projectId: unknown, sessionId: unknown, options: TwiccPluginOptions = {}) {
    const normalizedProjectId = String(projectId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedProjectId || !normalizedSessionId) {
      return "";
    }

    try {
      const parsed = new URL(normalizeBaseUrl(options.globalPluginConfig?.twiccBaseUrl));
      parsed.pathname = `/project/${encodeURIComponent(normalizedProjectId)}/session/${encodeURIComponent(normalizedSessionId)}`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function getSessionIdFromUrl(value: unknown): string {
    try {
      const pathname = new URL(String(value || ""), DEFAULT_TWICC_URL).pathname;
      const match = pathname.match(/\/session\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  }

  function getProjectIdFromUrl(url: unknown) {
    try {
      const parsed = new URL(String(url || ""));
      const segments = parsed.pathname.split("/").filter(Boolean);
      const projectSegmentIndex = segments.indexOf("project");
      const id = projectSegmentIndex === -1 ? "" : segments[projectSegmentIndex + 1] || "";
      return id ? decodeURIComponent(id) : "";
    } catch {
      return "";
    }
  }

  function getStatusKeysForProject(project: TwiccProject, projectConfig: TwiccConfig = {}) {
    return [
      getProjectIdFromUrl(projectConfig.twiccProjectUrl),
      String(project.id || "").trim()
    ].filter(Boolean);
  }

  function dispatchProjectBadgeChange() {
    if (typeof globalScope.dispatchEvent === "function" && typeof globalScope.CustomEvent === "function") {
      globalScope.dispatchEvent(new globalScope.CustomEvent("boatyard:project-nav-badges-changed"));
    }
  }

  async function refreshProjectProcessStatuses() {
    if (!globalScope.boatyard?.invokePlugin) {
      return;
    }

    try {
      const nextStatuses = asProjectProcessStatuses(await invokePlugin("projectProcessStatuses", {
        globalConfig: latestGlobalConfig
      }));
      if (JSON.stringify(projectProcessStatuses) !== JSON.stringify(nextStatuses)) {
        projectProcessStatuses = nextStatuses;
      }
      dispatchProjectBadgeChange();
    } catch (error) {
      console.error("Could not refresh Twicc project statuses:", error);
    }
  }

  function startProjectStatusRefresh() {
    if (!globalScope.boatyard?.invokePlugin) {
      return;
    }

    refreshProjectProcessStatuses();
    if (typeof globalScope.setInterval === "function") {
      projectStatusRefreshTimer = globalScope.setInterval(
        refreshProjectProcessStatuses,
        TWICC_PROJECT_STATUS_REFRESH_MS
      );
    }
  }

  function stopProjectStatusRefresh() {
    if (projectStatusRefreshTimer && typeof globalScope.clearInterval === "function") {
      globalScope.clearInterval(projectStatusRefreshTimer);
    }
    projectStatusRefreshTimer = null;
    projectProcessStatuses = {};
    retainedDoneProjectStatuses.clear();
    acknowledgedDoneProjectSignatures.clear();
    dispatchProjectBadgeChange();
  }

  function createProjectStatusBadge(project: TwiccProject, projectConfig: TwiccConfig = {}, options: TwiccPluginOptions = {}) {
    const statusKey = getStatusKeysForProject(project, projectConfig)
      .find((key) => projectProcessStatuses?.[key]);
    const liveStatus = statusKey ? projectProcessStatuses[statusKey] : null;
    const retainKey = String(project.id || statusKey || "").trim();
    const liveInputStatus = getLiveProjectStatusForState(liveStatus, "input");
    const liveWorkingStatus = getLiveProjectStatusForState(liveStatus, "working");
    const liveDoneStatus = getDoneProjectStatus(liveStatus);
    const retainedDoneStatus = retainKey ? retainedDoneProjectStatuses.get(retainKey) || null : null;
    const doneStatus = liveDoneStatus || retainedDoneStatus;
    const doneSignature = doneStatus ? getDoneStatusSignature(doneStatus) : "";

    if (options.isActiveProject && retainKey) {
      retainedDoneProjectStatuses.delete(retainKey);
      if (doneSignature) {
        acknowledgedDoneProjectSignatures.set(retainKey, doneSignature);
      }
    } else if (liveDoneStatus && retainKey) {
      retainedDoneProjectStatuses.set(retainKey, liveDoneStatus);
    }

    const needsAttention = !!(
      doneSignature
      && retainKey
      && acknowledgedDoneProjectSignatures.get(retainKey) !== doneSignature
    );
    const readDoneStatus = liveDoneStatus || (!options.isActiveProject ? retainedDoneStatus : null);
    const status = liveInputStatus
      || (needsAttention ? doneStatus : null)
      || liveWorkingStatus
      || readDoneStatus;
    if (!status?.state) {
      return null;
    }
    const showsAttention = needsAttention && status.state === "done";
    const label = TWICC_PROJECT_STATUS_LABELS[status.state as keyof typeof TWICC_PROJECT_STATUS_LABELS] || status.state;
    const iconOnly = options.globalPluginConfig?.twiccProjectStatusDisplay === "icon";
    const badge = document.createElement("span");
    badge.className = [
      "project-nav-badge",
      "project-twicc-status",
      status.state,
      iconOnly ? "icon-only" : "",
      showsAttention ? "needs-attention" : ""
    ].filter(Boolean).join(" ");
    badge.textContent = iconOnly ? "" : label;

    const sessionLabel = status.count === 1 ? "session" : "sessions";
    const primarySession = status.sessions?.find((session) => session.state === status.state) || status.sessions?.[0];
    badge.title = primarySession?.title
      ? `Twicc: ${label.toLowerCase()} (${status.count} ${sessionLabel}) - ${primarySession.title}`
      : `Twicc: ${label.toLowerCase()} (${status.count} ${sessionLabel})`;
    badge.setAttribute("aria-label", badge.title);

    return badge;
  }

  function createTwiccService() {
    return Object.freeze({
      version: "0.1.0",
      getBaseUrl(options: TwiccPluginOptions = {}) {
        return normalizeBaseUrl(options.globalPluginConfig?.twiccBaseUrl);
      },
      getProjectUrl: resolveProjectUrl,
      getSessionIdFromUrl,
      getSessionUrl: resolveSessionUrl,
      openProject(project: TwiccProject, options: TwiccPluginOptions = {}) {
        const url = resolveProjectUrl(project, options);
        return url ? globalScope.boatyard?.openExternal?.(url) : null;
      }
    });
  }

  function getFetch() {
    if (typeof globalScope.fetch === "function") {
      return globalScope.fetch.bind(globalScope);
    }

    if (typeof fetch === "function") {
      return fetch;
    }

    return null;
  }

  function formatProviderName(provider: unknown) {
    return String(provider || "")
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ") || "Provider";
  }

  function formatPercent(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number)}%` : "--";
  }

  function formatResetRelative(value: unknown) {
    if (!value) {
      return "--";
    }

    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return "--";
    }

    const diffMs = date.getTime() - Date.now();
    if (diffMs <= 0) {
      return "now";
    }

    const minutes = Math.ceil(diffMs / 60000);
    if (minutes < 60) {
      return `in ${minutes}m`;
    }

    const hours = Math.ceil(minutes / 60);
    if (hours < 48) {
      return `in ${hours}h`;
    }

    return `in ${Math.ceil(hours / 24)}d`;
  }

  function getUsageTone(value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "unknown";
    }
    if (number >= 90) {
      return "danger";
    }
    if (number >= 70) {
      return "warn";
    }
    return "ok";
  }

  function getProviderInitials(provider: unknown) {
    return formatProviderName(provider)
      .split(/\s+/)
      .map((part) => part.slice(0, 1))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  }

  function getProviderIconClass(provider: unknown) {
    const normalized = String(provider || "").toLowerCase();
    if (normalized === "claude_code" || normalized === "claude" || normalized === "anthropic") {
      return "claude";
    }
    if (normalized === "codex" || normalized === "openai") {
      return "openai";
    }
    return "";
  }

  function getTopbarUsageDisplayMode(globalPluginConfig: TwiccConfig = {}) {
    const value = String(globalPluginConfig.twiccTopbarUsageDisplay || "").trim();
    return TWICC_TOPBAR_USAGE_DISPLAY_OPTIONS.some((option) => option.value === value)
      ? value
      : TWICC_TOPBAR_USAGE_DISPLAY_DEFAULT;
  }

  function createProviderIcon(provider: unknown) {
    const iconClass = getProviderIconClass(provider);
    const icon = document.createElement("span");
    icon.className = `twicc-usage-provider-icon${iconClass ? ` ${iconClass}` : ""}`;
    icon.setAttribute("aria-hidden", "true");
    if (!iconClass) {
      icon.textContent = getProviderInitials(provider);
    }
    return icon;
  }

  function getGaugePercent(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
  }

  function getFiveHourBurnRate(provider: TwiccUsageProvider) {
    return provider.five_hour_burn_rate ??
      provider.five_hour_burn_rate_1h ??
      provider.five_hour_burn_rate_30min;
  }

  function getSevenDayBurnRate(provider: TwiccUsageProvider) {
    return provider.seven_day_burn_rate ??
      provider.seven_day_burn_rate_24h ??
      provider.seven_day_burn_rate_12h;
  }

  function formatBurnRate(value: unknown) {
    const percent = normalizeBurnRatePercent(value);
    return Number.isFinite(percent) ? `${Math.round(percent)}%` : "--";
  }

  function normalizeBurnRatePercent(value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return Number.NaN;
    }

    return Math.abs(number) <= 2 ? number * 100 : number;
  }

  function getBurnRateArcSegments(value: unknown) {
    const percent = normalizeBurnRatePercent(value);
    if (!Number.isFinite(percent) || percent <= 0) {
      return {
        safe: 0,
        danger: 0
      };
    }

    if (percent <= 100) {
      const safe = Math.max(0, Math.min(50, percent / 2));
      return {
        safe,
        danger: safe
      };
    }

    return {
      safe: Math.max(0, Math.min(50, (100 / percent) * 50)),
      danger: 50
    };
  }

  function getBurnRateTone(value: unknown) {
    const percent = normalizeBurnRatePercent(value);
    if (!Number.isFinite(percent)) {
      return "unknown";
    }
    if (percent > 100) {
      return "danger";
    }
    if (percent >= 90) {
      return "warn";
    }
    return "ok";
  }

  function createUsageGauge(label: string, percentValue: unknown, detail: string, options: { compact?: boolean; values?: boolean } = {}) {
    const gauge = document.createElement("div");
    gauge.className = `twicc-usage-gauge ${getUsageTone(percentValue)}`;
    gauge.classList.toggle("compact", options.compact === true);
    gauge.classList.toggle("charts-only", options.values === false);
    gauge.style.setProperty("--twicc-usage-percent", `${getGaugePercent(percentValue)}%`);

    const ring = document.createElement("span");
    ring.className = "twicc-usage-ring";
    ring.textContent = options.values === false ? "" : formatPercent(percentValue);

    const copy = document.createElement("span");
    copy.className = "twicc-usage-gauge-copy";

    const labelElement = document.createElement("strong");
    labelElement.textContent = label;
    const detailElement = document.createElement("small");
    detailElement.textContent = detail;
    copy.append(labelElement, detailElement);

    gauge.append(ring, copy);
    return gauge;
  }

  function createBurnRateGauge(label: string, value: unknown, options: { compact?: boolean; values?: boolean } = {}) {
    const arcs = getBurnRateArcSegments(value);
    const gauge = document.createElement("div");
    gauge.className = `twicc-usage-burn-gauge ${getBurnRateTone(value)}`;
    gauge.classList.toggle("compact", options.compact === true);
    gauge.classList.toggle("charts-only", options.values === false);
    gauge.style.setProperty("--twicc-burn-safe-arc", `${arcs.safe}%`);
    gauge.style.setProperty("--twicc-burn-danger-arc", `${arcs.danger}%`);

    const dial = document.createElement("span");
    dial.className = "twicc-usage-burn-dial";
    dial.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "twicc-usage-gauge-copy";

    const labelElement = document.createElement("strong");
    labelElement.textContent = label;
    const detailElement = document.createElement("small");
    detailElement.textContent = formatBurnRate(value);
    copy.append(labelElement, detailElement);

    gauge.append(dial, copy);
    return gauge;
  }

  function asUsageProvider(value: unknown): TwiccUsageProvider {
    return isRecord(value) ? value : {};
  }

  function normalizeUsageEntries(value: unknown): Record<string, TwiccUsageProvider> {
    if (!isRecord(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, provider]) => [key, asUsageProvider(provider)])
    );
  }

  function normalizeUsageResult(payload: unknown): Record<string, TwiccUsageProvider> {
    if (!isRecord(payload)) {
      return {};
    }

    if ("result" in payload || "exit_code" in payload || "error" in payload) {
      if (payload.exit_code && payload.exit_code !== 0) {
        throw new Error(String(payload.error || "TwiCC usage request failed."));
      }
      if (payload.error) {
        throw new Error(String(payload.error));
      }
      return normalizeUsageEntries(payload.result);
    }

    return normalizeUsageEntries(payload);
  }

  async function fetchUsage(globalPluginConfig: TwiccConfig = {}) {
    const request = getFetch();
    if (!request) {
      throw new Error("Fetch is unavailable.");
    }

    const token = String(globalPluginConfig.twiccApiToken || "").trim();
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await request(`${normalizeBaseUrl(globalPluginConfig.twiccBaseUrl)}/rpc/usage`, {
      method: "POST",
      headers,
      body: "{}"
    });
    if (!response?.ok) {
      throw new Error(`TwiCC usage request failed with HTTP ${response?.status || "error"}.`);
    }

    return normalizeUsageResult(await response.json());
  }

  function renderProviderUsage(providerKey: string, usage: TwiccUsageProvider) {
    const provider = asUsageProvider(usage);
    const providerName = formatProviderName(provider.provider || providerKey);
    const row = document.createElement("section");
    row.className = "twicc-usage-provider";
    row.title = provider.fetched_at ? `${providerName} fetched ${new Date(provider.fetched_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })}` : providerName;
    row.setAttribute("aria-label", providerName);

    const icon = createProviderIcon(provider.provider || providerKey);

    const metrics = document.createElement("div");
    metrics.className = "twicc-usage-metrics";
    metrics.append(
      createUsageGauge(
        "5h",
        provider.five_hour_utilization,
        formatResetRelative(provider.five_hour_resets_at)
      ),
      createBurnRateGauge("5h Burn", getFiveHourBurnRate(provider)),
      createUsageGauge(
        "7d",
        provider.seven_day_utilization,
        formatResetRelative(provider.seven_day_resets_at)
      ),
      createBurnRateGauge("7d Burn", getSevenDayBurnRate(provider))
    );

    if (provider.extra_usage_is_enabled) {
      metrics.append(createUsageGauge(
        "Extra",
        provider.extra_usage_utilization,
        `${Number(provider.extra_usage_remaining_credits || 0).toFixed(1)} left`
      ));
    }

    row.append(icon, metrics);
    return row;
  }

  function createUsageWidget(_project: TwiccProject, props: TwiccPluginOptions = {}) {
    const card = document.createElement("article");
    card.className = "widget-card twicc-usage-widget";

    const providers = document.createElement("div");
    providers.className = "twicc-usage-providers";

    const footer = document.createElement("p");
    footer.className = "twicc-usage-footer";
    footer.hidden = true;

    async function load() {
      if (!card.isConnected && card.parentElement) {
        return;
      }

      try {
        const result = await fetchUsage(props.globalPluginConfig || {});
        const entries = Object.entries(result || {});
        providers.replaceChildren();

        if (!entries.length) {
          const empty = document.createElement("p");
          empty.className = "twicc-usage-empty";
          empty.textContent = "No usage snapshot.";
          providers.append(empty);
        } else {
          entries
            .sort(([left], [right]) => left.localeCompare(right))
            .forEach(([providerKey, usage]) => providers.append(renderProviderUsage(providerKey, usage)));
        }

        footer.hidden = true;
        footer.textContent = "";
      } catch (error) {
        footer.hidden = false;
        footer.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    load();
    const refreshInterval = globalScope.setInterval?.(() => {
      if (!card.isConnected) {
        globalScope.clearInterval?.(refreshInterval);
        return;
      }

      load();
    }, TWICC_USAGE_REFRESH_MS);

    card.append(providers, footer);
    return card;
  }

  function createCompactUsageWidget(_project: TwiccProject, props: TwiccPluginOptions = {}) {
    const chip = document.createElement("span");
    chip.className = "twicc-usage-compact";
    chip.setAttribute("aria-label", "TwiCC usage");

    let currentUsageEntries: [string, TwiccUsageProvider][] = [];

    function getDisplayMode() {
      return getTopbarUsageDisplayMode(props.globalPluginConfig || {});
    }

    function renderCompactProvider(providerKey: string, provider: TwiccUsageProvider) {
      const entry = document.createElement("span");
      entry.className = "twicc-usage-compact-provider";
      entry.append(createProviderIcon(providerKey));
      const mode = getDisplayMode();

      if (mode === "numbers") {
        for (const [label, value, title] of [
          ["5h", provider.five_hour_utilization, "utilization"],
          ["5h Burn", getFiveHourBurnRate(provider), "burn rate"],
          ["7d", provider.seven_day_utilization, "utilization"],
          ["7d Burn", getSevenDayBurnRate(provider), "burn rate"]
        ] as const) {
          const metric = document.createElement("span");
          const tone = String(label).includes("Burn") ? getBurnRateTone(value) : getUsageTone(value);
          metric.className = `twicc-usage-compact-metric ${tone}`;
          metric.title = `${providerKey} ${label} ${title}`;
          metric.textContent = `${label} ${String(label).includes("Burn") ? formatBurnRate(value) : formatPercent(value)}`;
          entry.append(metric);
        }
      } else {
        const showValues = mode === "chartsWithValues";
        entry.append(
          createUsageGauge("5h", provider.five_hour_utilization, formatResetRelative(provider.five_hour_resets_at), {
            compact: true,
            values: showValues
          }),
          createBurnRateGauge("5h Burn", getFiveHourBurnRate(provider), {
            compact: true,
            values: showValues
          }),
          createUsageGauge("7d", provider.seven_day_utilization, formatResetRelative(provider.seven_day_resets_at), {
            compact: true,
            values: showValues
          }),
          createBurnRateGauge("7d Burn", getSevenDayBurnRate(provider), {
            compact: true,
            values: showValues
          })
        );
      }

      return entry;
    }

    function renderCompactEntries() {
      chip.replaceChildren();
      chip.dataset.displayMode = getDisplayMode();
      chip.title = "TwiCC usage";

      if (!currentUsageEntries.length) {
        chip.textContent = "TwiCC --";
        return;
      }

      currentUsageEntries.forEach(([providerKey, usage]) => chip.append(renderCompactProvider(providerKey, usage)));
    }

    function openDisplayMenu(event: MouseEvent) {
      event.preventDefault();
      event.stopPropagation();

      const menu = document.createElement("div");
      menu.className = "webapp-tab-menu twicc-usage-display-menu";
      menu.setAttribute("role", "menu");

      const currentMode = getDisplayMode();
      for (const option of TWICC_TOPBAR_USAGE_DISPLAY_OPTIONS) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "webapp-tab-menu-item";
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", String(option.value === currentMode));
        item.textContent = option.label;
        item.addEventListener("click", async () => {
          props.globalPluginConfig = {
            ...(props.globalPluginConfig || {}),
            twiccTopbarUsageDisplay: option.value
          };
          props.closeContextMenu?.();
          renderCompactEntries();
          try {
            await globalScope.boatyard?.updateGlobalPluginConfig?.("boatyard.twicc", {
              twiccTopbarUsageDisplay: option.value
            });
          } catch (error) {
            console.error("Could not update Twicc usage display mode:", error);
          }
        });
        menu.append(item);
      }

      if (typeof props.openContextMenu === "function") {
        props.openContextMenu(menu, event);
      } else {
        document.body.append(menu);
      }
      menu.querySelector("button")?.focus();
    }

    chip.addEventListener("contextmenu", openDisplayMenu);

    async function load() {
      try {
        const result = await fetchUsage(props.globalPluginConfig || {});
        currentUsageEntries = Object.entries(result || {})
          .sort(([left], [right]) => left.localeCompare(right));

        renderCompactEntries();
      } catch (error) {
        chip.replaceChildren();
        chip.textContent = "TwiCC ?";
        chip.title = error instanceof Error ? error.message : String(error);
      }
    }

    load();
    const refreshInterval = globalScope.setInterval?.(() => {
      if (!chip.isConnected) {
        globalScope.clearInterval?.(refreshInterval);
        return;
      }

      load();
    }, TWICC_USAGE_REFRESH_MS);

    return chip;
  }

  function registerUsageWidget(ctx: TwiccPluginContext) {
    ctx.widgets.register({
      id: "boatyard.twicc.usage",
      name: "TwiCC Usage",
      title: "TwiCC Usage",
      scopes: ["global", "project", "topbar"],
      category: "Usage",
      status: "experimental",
      defaultVisible: false,
      description: "Shows provider quota utilization from the TwiCC usage RPC.",
      layout: {
        default: { columns: 3, rows: 1 },
        min: { columns: 3, rows: 1 }
      },
      createElement: createUsageWidget,
      createCompact: createCompactUsageWidget
    });
    ctx.widgets.registerAlias("boatyard.twicc.projectUsage", "boatyard.twicc.usage");
  }

  function normalizeSessionFlowItem(value: unknown): TwiccSessionFlowItem | null {
    if (!isRecord(value)) {
      return null;
    }
    const id = String(value.id || "").trim();
    const lane = String(value.lane || "").trim();
    if (!id || !TWICC_SESSION_FLOW_LANES.some((candidate) => candidate.id === lane)) {
      return null;
    }
    const order = value.order === null || value.order === undefined || value.order === ""
      ? undefined
      : normalizeOptionalNumber(value.order);
    return {
      branch: String(value.branch || "").trim(),
      contextUsage: normalizeOptionalNumber(value.contextUsage) || 0,
      id,
      lane: lane as TwiccSessionFlowLane,
      lastActivityAt: String(value.lastActivityAt || "").trim(),
      order: Number.isInteger(order) && Number(order) >= 0 ? order : undefined,
      processState: String(value.processState || "").trim(),
      provider: String(value.provider || "").trim(),
      title: String(value.title || "Untitled session").trim() || "Untitled session",
      totalCost: normalizeOptionalNumber(value.totalCost) || 0,
      userMessageCount: normalizeOptionalNumber(value.userMessageCount) || 0
    };
  }

  function normalizeSessionFlow(value: unknown): TwiccSessionFlowItem[] {
    return Array.isArray(value)
      ? value.map(normalizeSessionFlowItem).filter((session): session is TwiccSessionFlowItem => Boolean(session))
      : [];
  }

  function normalizeCreatedSession(value: unknown): TwiccCreatedSession | null {
    if (!isRecord(value)) {
      return null;
    }
    const sessionId = String(value.sessionId || value.session_id || "").trim();
    if (!sessionId) {
      return null;
    }
    return {
      projectId: String(value.projectId || value.project_id || "").trim(),
      provider: String(value.provider || "").trim(),
      sessionId,
      status: String(value.status || "created").trim() || "created",
      title: String(value.title || "Untitled session").trim() || "Untitled session"
    };
  }

  function normalizeSessionCreationOptions(value: unknown): TwiccSessionCreationOptions {
    const source = isRecord(value) ? value : {};
    const branches = Array.isArray(source.branches)
      ? source.branches.flatMap((entry) => {
          if (!isRecord(entry)) {
            return [];
          }
          const name = String(entry.name || "").trim();
          return name ? [{ checkedOut: entry.checkedOut === true, name }] : [];
        })
      : [];
    const worktrees = Array.isArray(source.worktrees)
      ? source.worktrees.flatMap((entry) => {
          if (!isRecord(entry)) {
            return [];
          }
          const worktreePath = String(entry.path || "").trim();
          return worktreePath
            ? [{
                branch: String(entry.branch || "").trim(),
                detached: entry.detached === true,
                path: worktreePath,
                usable: entry.usable !== false
              }]
            : [];
        })
      : [];
    return {
      branches,
      defaultWorktreeBase: String(source.defaultWorktreeBase || "").trim(),
      gitRoot: String(source.gitRoot || "").trim(),
      worktrees
    };
  }

  function getWorktreeFolderName(branch: unknown): string {
    return String(branch || "")
      .trim()
      .replace(/[/\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");
  }

  function joinWorktreePath(base: unknown, branch: unknown): string {
    const normalizedBase = String(base || "").replace(/\/+$/g, "");
    const folder = getWorktreeFolderName(branch);
    return normalizedBase && folder ? `${normalizedBase}/${folder}` : normalizedBase;
  }

  function isSupportedPastedImage(file: File): boolean {
    return /^image\/(gif|jpeg|png|webp)$/i.test(file.type);
  }

  function getPastedImageFiles(clipboardData: DataTransfer | null): File[] {
    if (!clipboardData) {
      return [];
    }
    const files = Array.from(clipboardData.files || []).filter(isSupportedPastedImage);
    if (files.length) {
      return files;
    }
    return Array.from(clipboardData.items || []).flatMap((item) => {
      const file = item.kind === "file" ? item.getAsFile() : null;
      return file && isSupportedPastedImage(file) ? [file] : [];
    });
  }

  function getPastedImageExtension(mimeType: string): string {
    return {
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    }[mimeType.toLowerCase()] || "png";
  }

  function readPastedImage(file: File): Promise<TwiccSessionImageAttachment> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("error", () => reject(reader.error || new Error("Could not read the pasted image.")));
      reader.addEventListener("load", () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl.startsWith("data:image/")) {
          reject(new Error("The pasted clipboard item is not an image."));
          return;
        }
        resolve({
          dataUrl,
          name: file.name || `pasted-image.${getPastedImageExtension(file.type)}`
        });
      });
      reader.readAsDataURL(file);
    });
  }

  function formatSessionFlowContextUsage(value: unknown): string {
    const count = Number(value);
    if (!Number.isFinite(count) || count <= 0) {
      return "";
    }
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}m`;
    }
    if (count >= 1000) {
      return `${Math.round(count / 1000)}k`;
    }
    return String(Math.round(count));
  }

  function formatSessionFlowCost(value: unknown): string {
    const cost = Number(value);
    return Number.isFinite(cost) ? `$${cost.toFixed(2)}` : "$0.00";
  }

  function formatSessionFlowTime(value: unknown): string {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const now = new Date();
    return date.toDateString() === now.toDateString()
      ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function getSessionFlowProjectReference(project: TwiccProject, options: TwiccPluginOptions): string {
    return String(project.sourcePath || "").trim()
      || getProjectIdFromUrl(options.pluginConfig?.twiccProjectUrl);
  }

  function getSessionFlowOrientationStorageKey(project: TwiccProject, paneId: unknown): string {
    const projectId = String(project.id || project.sourcePath || "default").trim() || "default";
    const normalizedPaneId = String(paneId || "default").trim() || "default";
    return [
      TWICC_SESSION_FLOW_ORIENTATION_STORAGE_PREFIX,
      encodeURIComponent(projectId),
      ":",
      encodeURIComponent(normalizedPaneId)
    ].join("");
  }

  function readSessionFlowOrientation(project: TwiccProject, paneId: unknown): TwiccSessionFlowOrientation {
    try {
      return globalScope.localStorage?.getItem(getSessionFlowOrientationStorageKey(project, paneId)) === "horizontal"
        ? "horizontal"
        : "vertical";
    } catch {
      return "vertical";
    }
  }

  function persistSessionFlowOrientation(
    project: TwiccProject,
    paneId: unknown,
    orientation: TwiccSessionFlowOrientation
  ): void {
    try {
      globalScope.localStorage?.setItem(getSessionFlowOrientationStorageKey(project, paneId), orientation);
    } catch {
      // Keep the in-memory layout when browser storage is unavailable.
    }
  }

  function createSessionFlowSurface(
    project: TwiccProject,
    props: TwiccPluginOptions = {},
    initialOrientation: TwiccSessionFlowOrientation = "vertical"
  ): TwiccSessionFlowSurface {
    const widget = document.createElement("article") as TwiccSessionFlowSurface;
    const surfaceId = ++nextSessionFlowSurfaceId;
    widget.className = "widget-card twicc-session-flow-widget";
    widget.dataset.orientation = initialOrientation;
    const board = document.createElement("div");
    board.className = "twicc-session-flow-board";
    const message = document.createElement("p");
    message.className = "twicc-session-flow-message";
    message.textContent = "Loading TwiCC sessions…";
    const archiveDropzone = document.createElement("div");
    archiveDropzone.className = "twicc-session-flow-archive-dropzone";
    archiveDropzone.hidden = true;
    archiveDropzone.setAttribute("role", "region");
    archiveDropzone.setAttribute("aria-label", "Archive session drop zone");
    const archiveIcon = document.createElement("span");
    archiveIcon.className = "twicc-session-flow-archive-icon";
    archiveIcon.textContent = "↓";
    archiveIcon.setAttribute("aria-hidden", "true");
    const archiveCopy = document.createElement("span");
    const archiveTitle = document.createElement("strong");
    archiveTitle.textContent = "Archive session";
    const archiveHint = document.createElement("small");
    archiveHint.textContent = "Stops its agent and removes it from this board";
    archiveCopy.append(archiveTitle, archiveHint);
    archiveDropzone.append(archiveIcon, archiveCopy);
    widget.append(board, message, archiveDropzone);

    const projectReference = getSessionFlowProjectReference(project, props);
    const twiccWebAppState = props.getProjectWebAppState?.("twicc-plugin");
    const twiccWebAppKey = String(twiccWebAppState?.key || "");
    let activeSessionId = getSessionIdFromUrl(twiccWebAppState?.url);
    let sessions: TwiccSessionFlowItem[] = [];
    const pendingCreatedSessions = new Map<string, { createdAt: number; item: TwiccSessionFlowItem }>();
    let draggedSessionId = "";
    let draggedSessionPointerOffsetY = 0;
    let draggedSessionGhostHeight = 0;
    let sessionInsertionTarget: TwiccSessionFlowInsertionTarget | null = null;
    let sessionInsertionPlaceholder: HTMLElement | null = null;
    let archiveAllDialog: HTMLDialogElement | null = null;
    let moveMenu: HTMLElement | null = null;
    let wasConnected = false;
    let editingSessionId = "";
    let editingSessionDraft = "";
    let renamingSessionId = "";
    let composerMode: TwiccSessionComposerMode = "";
    let creationOptions: TwiccSessionCreationOptions | null = null;
    let creationOptionsLoading = false;
    let creationError = "";
    let pierAvailable = false;
    let pierWorktreePattern = "";
    let creationRequestId = 0;
    let creationDraft: TwiccSessionCreationDraft = {
      attachments: [],
      attachmentsLoading: 0,
      branch: "",
      path: "",
      pathEdited: false,
      prompt: "",
      startFrom: "",
      title: "",
      usePier: false,
      worktreeMode: "new"
    };

    function isAlive(): boolean {
      if (widget.isConnected) {
        wasConnected = true;
      }
      return !wasConnected || widget.isConnected;
    }

    function closeMoveMenu(): void {
      moveMenu?.remove();
      moveMenu = null;
    }

    function clearSessionInsertionPlaceholder(): void {
      sessionInsertionTarget = null;
      sessionInsertionPlaceholder?.remove();
      sessionInsertionPlaceholder = null;
      widget.querySelectorAll<HTMLElement>(".twicc-session-flow-empty[hidden]")
        .forEach((element) => {
          element.hidden = false;
        });
    }

    function resetDragState(): void {
      draggedSessionId = "";
      draggedSessionPointerOffsetY = 0;
      draggedSessionGhostHeight = 0;
      clearSessionInsertionPlaceholder();
      delete widget.dataset.dragging;
      archiveDropzone.hidden = true;
      archiveDropzone.classList.remove("drop-target");
      widget.querySelectorAll(".drop-target").forEach((element) => element.classList.remove("drop-target"));
    }

    function beginDrag(sessionId: string, card: HTMLElement, event: DragEvent): void {
      const rect = card.getBoundingClientRect();
      draggedSessionId = sessionId;
      draggedSessionPointerOffsetY = event.clientY - rect.top;
      draggedSessionGhostHeight = rect.height;
      widget.dataset.dragging = "true";
      archiveDropzone.hidden = false;
    }

    function syncActiveSession(url: unknown): void {
      const sessionId = getSessionIdFromUrl(url);
      if (sessionId === activeSessionId) {
        return;
      }
      activeSessionId = sessionId;
      if (editingSessionId || renamingSessionId) {
        return;
      }
      render();
    }

    function handleWebAppUrlChanged(event: Event): void {
      const detail = (event as CustomEvent<{ key?: unknown; url?: unknown }>).detail || {};
      const key = String(detail.key || "");
      if (twiccWebAppKey ? key !== twiccWebAppKey : !key.endsWith(":twicc-plugin")) {
        return;
      }
      syncActiveSession(detail.url);
    }

    function getSessionUrl(sessionId: string): string {
      return resolveSessionUrl(project, sessionId, props);
    }

    function getCreatedSessionUrl(created: TwiccCreatedSession): string {
      return resolveSessionUrlForProjectId(created.projectId, created.sessionId, props)
        || getSessionUrl(created.sessionId);
    }

    function mergePendingCreatedSessions(loadedSessions: TwiccSessionFlowItem[]): TwiccSessionFlowItem[] {
      const loadedIds = new Set(loadedSessions.map((session) => session.id));
      const now = Date.now();
      for (const [sessionId, pending] of pendingCreatedSessions) {
        if (loadedIds.has(sessionId) || now - pending.createdAt >= TWICC_SESSION_FLOW_OPTIMISTIC_TTL_MS) {
          pendingCreatedSessions.delete(sessionId);
        }
      }
      const pending = [...pendingCreatedSessions.values()]
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((entry) => entry.item);
      return [...pending, ...loadedSessions];
    }

    function getOrderedLaneSessions(lane: TwiccSessionFlowLane): TwiccSessionFlowItem[] {
      return sessions
        .filter((session) => session.lane === lane)
        .sort((left, right) => {
          const leftHasOrder = Number.isInteger(left.order);
          const rightHasOrder = Number.isInteger(right.order);
          if (leftHasOrder && rightHasOrder) {
            return Number(left.order) - Number(right.order);
          }
          if (leftHasOrder !== rightHasOrder) {
            return leftHasOrder ? 1 : -1;
          }
          return 0;
        });
    }

    function getSessionInsertionTarget(
      list: HTMLElement,
      clientY: number,
      lane: TwiccSessionFlowLane
    ): TwiccSessionFlowInsertionTarget {
      const cards = [...list.querySelectorAll<HTMLElement>(".twicc-session-flow-card")]
        .filter((card) => card !== sessionInsertionPlaceholder && card.dataset.sessionId !== draggedSessionId);
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (clientY < rect.top + (rect.height / 2)) {
          return {
            beforeNode: card,
            beforeSessionId: card.dataset.sessionId || null,
            lane
          };
        }
      }
      return {
        beforeNode: null,
        beforeSessionId: null,
        lane
      };
    }

    function getSessionDragReferenceY(event: DragEvent): number {
      if (!draggedSessionGhostHeight) {
        return event.clientY;
      }
      return event.clientY - draggedSessionPointerOffsetY + (draggedSessionGhostHeight / 2);
    }

    function dropSessionAtInsertion(event: DragEvent, lane: TwiccSessionFlowLane): void {
      event.preventDefault();
      event.stopPropagation();
      const sessionId = event.dataTransfer?.getData("application/x-twicc-session") || draggedSessionId;
      const beforeSessionId = sessionInsertionTarget?.lane === lane
        ? sessionInsertionTarget.beforeSessionId
        : null;
      resetDragState();
      if (sessionId) {
        void moveSession(sessionId, lane, beforeSessionId);
      }
    }

    function ensureSessionInsertionPlaceholder(): HTMLElement {
      if (sessionInsertionPlaceholder) {
        return sessionInsertionPlaceholder;
      }
      const placeholder = document.createElement("div");
      placeholder.className = "twicc-session-flow-insertion-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      });
      placeholder.addEventListener("drop", (event) => {
        const lane = sessionInsertionTarget?.lane;
        if (lane) {
          dropSessionAtInsertion(event, lane);
        }
      });
      sessionInsertionPlaceholder = placeholder;
      return placeholder;
    }

    function updateSessionInsertionPlaceholder(
      list: HTMLElement,
      event: DragEvent,
      lane: TwiccSessionFlowLane
    ): void {
      sessionInsertionTarget = getSessionInsertionTarget(list, getSessionDragReferenceY(event), lane);
      const placeholder = ensureSessionInsertionPlaceholder();
      placeholder.style.height = `${Math.max(0, Math.round(draggedSessionGhostHeight))}px`;
      widget.querySelectorAll<HTMLElement>(".twicc-session-flow-empty[hidden]")
        .forEach((element) => {
          element.hidden = false;
        });
      const empty = list.querySelector<HTMLElement>(".twicc-session-flow-empty");
      if (empty) {
        empty.hidden = true;
      }
      list.insertBefore(placeholder, sessionInsertionTarget.beforeNode);
    }

    widget.setOrientation = (orientation) => {
      widget.dataset.orientation = orientation;
    };

    function openSession(sessionId: string): void {
      if (sessionId === activeSessionId) {
        return;
      }
      const url = getSessionUrl(sessionId);
      if (!url) {
        return;
      }
      if (typeof props.openProjectWebApp === "function") {
        props.openProjectWebApp("twicc-plugin", url);
      } else {
        globalScope.boatyard?.openExternal?.(url);
      }
    }

    function openCreatedSession(created: TwiccCreatedSession): void {
      const url = getCreatedSessionUrl(created);
      if (!url) {
        return;
      }
      if (typeof props.openProjectWebApp === "function") {
        props.openProjectWebApp("twicc-plugin", url);
      } else {
        globalScope.boatyard?.openExternal?.(url);
      }
    }

    function focusSessionTitleEditor(): void {
      globalScope.queueMicrotask?.(() => {
        const input = widget.querySelector<HTMLInputElement>(".twicc-session-flow-title-input");
        input?.focus();
        input?.select();
      });
    }

    function startSessionTitleEditing(session: TwiccSessionFlowItem): void {
      if (
        renamingSessionId
        || widget.dataset.moving === "true"
        || widget.dataset.archiving === "true"
      ) {
        return;
      }
      editingSessionId = session.id;
      editingSessionDraft = session.title;
      message.hidden = true;
      message.textContent = "";
      render();
      focusSessionTitleEditor();
    }

    function cancelSessionTitleEditing(sessionId: string): void {
      if (editingSessionId !== sessionId || renamingSessionId === sessionId) {
        return;
      }
      editingSessionId = "";
      editingSessionDraft = "";
      render();
    }

    async function saveSessionTitle(session: TwiccSessionFlowItem, input: HTMLInputElement): Promise<void> {
      if (editingSessionId !== session.id || renamingSessionId) {
        return;
      }
      const nextTitle = editingSessionDraft.trim();
      if (!nextTitle) {
        message.hidden = false;
        message.textContent = "Session title is required.";
        input.setAttribute("aria-invalid", "true");
        globalScope.queueMicrotask?.(() => input.focus());
        return;
      }
      if (nextTitle === session.title) {
        cancelSessionTitleEditing(session.id);
        return;
      }

      renamingSessionId = session.id;
      widget.dataset.renaming = "true";
      input.disabled = true;
      input.removeAttribute("aria-invalid");
      try {
        await invokePlugin("renameSession", {
          globalConfig: props.globalPluginConfig || {},
          sessionId: session.id,
          title: nextTitle
        });
        sessions = sessions.map((candidate) => candidate.id === session.id
          ? { ...candidate, title: nextTitle }
          : candidate);
        const pendingSession = pendingCreatedSessions.get(session.id);
        if (pendingSession) {
          pendingSession.item = { ...pendingSession.item, title: nextTitle };
        }
        editingSessionId = "";
        editingSessionDraft = "";
        message.hidden = true;
        message.textContent = "";
        render();
      } catch (error) {
        message.hidden = false;
        message.textContent = error instanceof Error ? error.message : String(error);
        renamingSessionId = "";
        delete widget.dataset.renaming;
        render();
        const currentInput = widget.querySelector<HTMLInputElement>(".twicc-session-flow-title-input");
        currentInput?.setAttribute("aria-invalid", "true");
        focusSessionTitleEditor();
      } finally {
        if (renamingSessionId === session.id) {
          renamingSessionId = "";
          delete widget.dataset.renaming;
        }
      }
    }

    function resetCreationDraft(mode: TwiccSessionComposerMode): void {
      composerMode = mode;
      creationError = "";
      creationDraft = {
        attachments: [],
        attachmentsLoading: 0,
        branch: "",
        path: "",
        pathEdited: false,
        prompt: "",
        startFrom: "",
        title: "",
        usePier: false,
        worktreeMode: "new"
      };
    }

    function focusCreationComposer(): void {
      globalScope.queueMicrotask?.(() => {
        widget.querySelector<HTMLInputElement>(".twicc-session-flow-composer input")?.focus();
      });
    }

    function openDirectComposer(): void {
      resetCreationDraft("direct");
      creationOptions = null;
      creationOptionsLoading = false;
      pierAvailable = false;
      pierWorktreePattern = "";
      creationRequestId += 1;
      render();
      focusCreationComposer();
    }

    async function openWorktreeComposer(): Promise<void> {
      resetCreationDraft("worktree");
      creationOptions = null;
      creationOptionsLoading = true;
      pierAvailable = false;
      pierWorktreePattern = "";
      const requestId = ++creationRequestId;
      render();

      try {
        const pierService = registry.getService<PierSessionFlowService>("boatyard.pier");
        const [rawOptions, pierAvailability] = await Promise.all([
          invokePlugin("sessionCreationOptions", {
            sourcePath: project.sourcePath || ""
          }),
          typeof pierService?.getProjectAvailability === "function"
            ? pierService.getProjectAvailability(project).catch(() => ({ available: false, worktreePattern: "" }))
            : Promise.resolve({ available: false, worktreePattern: "" })
        ]);
        if (requestId !== creationRequestId || composerMode !== "worktree") {
          return;
        }
        creationOptions = normalizeSessionCreationOptions(rawOptions);
        pierAvailable = pierAvailability.available && Boolean(pierService);
        pierWorktreePattern = pierAvailability.worktreePattern;
        creationDraft.usePier = pierAvailable;
        creationDraft.path = joinWorktreePath(creationOptions.defaultWorktreeBase, creationDraft.branch);
      } catch (error) {
        if (requestId === creationRequestId && composerMode === "worktree") {
          creationError = error instanceof Error ? error.message : String(error);
        }
      } finally {
        if (requestId === creationRequestId && composerMode === "worktree") {
          creationOptionsLoading = false;
          render();
          focusCreationComposer();
        }
      }
    }

    function closeCreationComposer(): void {
      creationRequestId += 1;
      composerMode = "";
      creationOptionsLoading = false;
      creationError = "";
      delete widget.dataset.creating;
      render();
    }

    async function moveSession(
      sessionId: string,
      lane: TwiccSessionFlowLane,
      beforeSessionId: string | null = null
    ): Promise<void> {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session || widget.dataset.moving === "true") {
        return;
      }
      const previousSessions = sessions;
      const previousTargetIds = getOrderedLaneSessions(lane).map((candidate) => candidate.id);
      const targetSessions = getOrderedLaneSessions(lane).filter((candidate) => candidate.id !== sessionId);
      const insertionIndex = beforeSessionId
        ? targetSessions.findIndex((candidate) => candidate.id === beforeSessionId)
        : targetSessions.length;
      const normalizedInsertionIndex = insertionIndex >= 0 ? insertionIndex : targetSessions.length;
      targetSessions.splice(normalizedInsertionIndex, 0, {
        ...session,
        lane
      });
      // Freeze the full target lane so later activity updates cannot disturb the chosen order.
      const nextTargetSessions = targetSessions.map((candidate, order) => ({
        ...candidate,
        order
      }));
      const nextTargetIds = nextTargetSessions.map((candidate) => candidate.id);
      if (
        session.lane === lane
        && previousTargetIds.length === nextTargetIds.length
        && previousTargetIds.every((id, index) => id === nextTargetIds[index])
      ) {
        return;
      }
      const pendingSession = pendingCreatedSessions.get(sessionId);
      const previousPendingItem = pendingSession?.item;
      if (pendingSession) {
        pendingSession.item = nextTargetSessions.find((candidate) => candidate.id === sessionId) || session;
      }
      sessions = previousSessions
        .filter((candidate) => candidate.id !== sessionId && candidate.lane !== lane)
        .concat(nextTargetSessions);
      widget.dataset.moving = "true";
      render();
      try {
        await invokePlugin("reorderSessionFlow", {
          globalConfig: props.globalPluginConfig || {},
          lane,
          sessionIds: nextTargetIds
        });
        message.hidden = true;
        message.textContent = "";
      } catch (error) {
        sessions = previousSessions;
        if (pendingSession && previousPendingItem) {
          pendingSession.item = previousPendingItem;
        }
        message.hidden = false;
        message.textContent = error instanceof Error ? error.message : String(error);
        render();
      } finally {
        delete widget.dataset.moving;
      }
    }

    async function archiveSessions(sessionIds: string[]): Promise<TwiccSessionArchiveResult> {
      const requestedIds = [...new Set(sessionIds)];
      const targets = requestedIds
        .map((sessionId) => sessions.find((candidate) => candidate.id === sessionId))
        .filter((session): session is TwiccSessionFlowItem => Boolean(session));
      if (!targets.length) {
        return { archivedCount: 0, failures: [] };
      }
      if (widget.dataset.archiving === "true" || widget.dataset.moving === "true") {
        return { archivedCount: 0, failures: ["Another session update is already in progress."] };
      }

      widget.dataset.archiving = "true";
      resetDragState();
      const failures: string[] = [];
      let archivedCount = 0;
      try {
        for (const session of targets) {
          try {
            await invokePlugin("archiveSession", {
              globalConfig: props.globalPluginConfig || {},
              sessionId: session.id
            });
            sessions = sessions.filter((candidate) => candidate.id !== session.id);
            pendingCreatedSessions.delete(session.id);
            archivedCount += 1;
            render();
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            failures.push(`${session.title}: ${detail}`);
          }
        }
      } finally {
        delete widget.dataset.archiving;
      }
      render();
      message.hidden = failures.length === 0 && sessions.length > 0;
      message.textContent = failures.length
        ? `Could not archive ${failures.length} ${failures.length === 1 ? "session" : "sessions"}.`
        : sessions.length
          ? ""
          : "No current TwiCC sessions.";
      return { archivedCount, failures };
    }

    async function archiveSession(sessionId: string): Promise<void> {
      const result = await archiveSessions([sessionId]);
      if (result.failures.length) {
        message.hidden = false;
        message.textContent = result.failures[0];
      }
    }

    function openArchiveAllDialog(): void {
      if (archiveAllDialog) {
        archiveAllDialog.focus();
        return;
      }

      const dialog = document.createElement("dialog");
      dialog.className = "plugin-settings-dialog twicc-session-flow-archive-dialog";
      archiveAllDialog = dialog;

      const form = document.createElement("form");
      form.className = "plugin-settings-dialog-panel danger-zone";
      const header = document.createElement("header");
      header.className = "plugin-settings-dialog-header";
      const title = document.createElement("h3");
      title.textContent = "Archive all done sessions";
      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = "Close";
      closeButton.setAttribute("aria-label", "Close");
      closeButton.textContent = "X";
      closeButton.addEventListener("click", () => dialog.close());
      header.append(title, closeButton);

      const confirmation = document.createElement("div");
      confirmation.className = "danger-confirmation";
      const copy = document.createElement("p");
      confirmation.append(copy);
      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
      const actions = document.createElement("div");
      actions.className = "form-actions";
      const cancelButton = document.createElement("button");
      cancelButton.className = "secondary-button";
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", () => dialog.close());
      const submitButton = document.createElement("button");
      submitButton.className = "danger-button";
      submitButton.type = "submit";
      submitButton.textContent = "Archive all";
      actions.append(cancelButton, submitButton);

      function updateConfirmation(): string[] {
        const doneSessionIds = getOrderedLaneSessions("testing").map((session) => session.id);
        const count = doneSessionIds.length;
        copy.textContent = count
          ? `Archive all ${count} ${count === 1 ? "session" : "sessions"} in Done? This stops any running agents and removes ${count === 1 ? "it" : "them"} from this board.`
          : "There are no sessions left to archive in Done.";
        submitButton.disabled = count === 0;
        return doneSessionIds;
      }

      form.append(header, confirmation, error, actions);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const sessionIds = updateConfirmation();
        if (!sessionIds.length) {
          dialog.close();
          return;
        }
        error.hidden = true;
        error.textContent = "";
        closeButton.disabled = true;
        cancelButton.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = "Archiving…";
        try {
          const result = await archiveSessions(sessionIds);
          if (!result.failures.length) {
            dialog.close();
            return;
          }
          error.textContent = `${result.archivedCount} archived; ${result.failures.length} failed. ${result.failures[0]}`;
          error.hidden = false;
          updateConfirmation();
        } catch (archiveError) {
          error.textContent = archiveError instanceof Error ? archiveError.message : String(archiveError);
          error.hidden = false;
        } finally {
          closeButton.disabled = false;
          cancelButton.disabled = false;
          submitButton.textContent = "Archive all";
          if (dialog.open) {
            updateConfirmation();
          }
        }
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        if (widget.dataset.archiving !== "true") {
          dialog.close();
        }
      });
      dialog.addEventListener("close", () => {
        if (archiveAllDialog === dialog) {
          archiveAllDialog = null;
        }
        dialog.remove();
      });
      dialog.append(form);
      updateConfirmation();

      if (typeof globalScope.BoatyardOverlayDialog?.show === "function") {
        void globalScope.BoatyardOverlayDialog.show(dialog, {
          freeze: "overlap",
          freezeMargin: 16,
          removeOnClose: true
        }).then((shown) => {
          if (shown) {
            submitButton.focus();
          } else {
            if (archiveAllDialog === dialog) {
              archiveAllDialog = null;
            }
            dialog.remove();
          }
        });
      } else {
        document.body.append(dialog);
        dialog.showModal();
        globalScope.requestAnimationFrame?.(() => submitButton.focus());
      }
    }

    archiveDropzone.addEventListener("dragover", (event) => {
      if (!draggedSessionId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      clearSessionInsertionPlaceholder();
      archiveDropzone.classList.add("drop-target");
    });
    archiveDropzone.addEventListener("dragleave", (event) => {
      if (!archiveDropzone.contains(event.relatedTarget as Node | null)) {
        archiveDropzone.classList.remove("drop-target");
      }
    });
    archiveDropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sessionId = event.dataTransfer?.getData("application/x-twicc-session") || draggedSessionId;
      resetDragState();
      if (sessionId) {
        void archiveSession(sessionId);
      }
    });

    function openMoveMenu(event: MouseEvent, session: TwiccSessionFlowItem): void {
      event.preventDefault();
      event.stopPropagation();
      closeMoveMenu();
      const anchor = event.currentTarget as HTMLElement;
      const menu = document.createElement("div");
      menu.className = "twicc-session-flow-menu";
      menu.setAttribute("role", "menu");
      const label = document.createElement("span");
      label.className = "twicc-session-flow-menu-label";
      label.textContent = "Move session to";
      menu.append(label);

      for (const lane of TWICC_SESSION_FLOW_LANES) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.setAttribute("aria-current", String(session.lane === lane.id));
        const dot = document.createElement("span");
        dot.className = `twicc-session-flow-lane-dot ${lane.id}`;
        const copy = document.createElement("span");
        copy.textContent = `${lane.label}${session.lane === lane.id ? " ✓" : ""}`;
        button.append(dot, copy);
        button.addEventListener("click", () => {
          closeMoveMenu();
          void moveSession(session.id, lane.id);
        });
        menu.append(button);
      }

      document.body.append(menu);
      const anchorRect = anchor.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(globalScope.innerWidth - menuRect.width - 8, anchorRect.right - menuRect.width))}px`;
      menu.style.top = `${Math.max(8, Math.min(globalScope.innerHeight - menuRect.height - 8, anchorRect.bottom + 4))}px`;
      moveMenu = menu;
      menu.querySelector<HTMLButtonElement>("button")?.focus();
      globalScope.setTimeout?.(() => document.addEventListener("click", closeMoveMenu, { once: true }), 0);
    }

    function createComposerField(
      labelText: string,
      control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
      hintText = ""
    ): HTMLElement {
      const label = document.createElement("label");
      label.className = "twicc-session-flow-composer-field";
      const copy = document.createElement("span");
      copy.textContent = labelText;
      label.append(copy, control);
      if (hintText) {
        const hint = document.createElement("small");
        hint.textContent = hintText;
        label.append(hint);
      }
      return label;
    }

    function createSessionFields(): HTMLElement[] {
      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.maxLength = 200;
      titleInput.placeholder = "Derived from the first message when empty";
      titleInput.value = creationDraft.title;
      titleInput.addEventListener("input", () => {
        creationDraft.title = titleInput.value;
      });

      const promptInput = document.createElement("textarea");
      promptInput.required = true;
      promptInput.rows = 4;
      promptInput.placeholder = "What should the agent do?";
      promptInput.value = creationDraft.prompt;
      promptInput.setAttribute("aria-keyshortcuts", "Control+Enter");
      promptInput.addEventListener("input", () => {
        creationDraft.prompt = promptInput.value;
      });
      promptInput.addEventListener("keydown", (event) => {
        if (
          event.key === "Enter"
          && event.ctrlKey
          && !event.repeat
          && !event.isComposing
        ) {
          event.preventDefault();
          promptInput.form?.requestSubmit();
        }
      });

      promptInput.addEventListener("paste", (event) => {
        const imageFiles = getPastedImageFiles(event.clipboardData);
        if (!imageFiles.length) {
          return;
        }
        event.preventDefault();
        const draft = creationDraft;
        draft.attachmentsLoading += imageFiles.length;
        creationError = "";
        render();
        void Promise.all(imageFiles.map(readPastedImage))
          .then((attachments) => {
            if (creationDraft === draft && composerMode) {
              draft.attachments.push(...attachments);
            }
          })
          .catch((error) => {
            if (creationDraft === draft && composerMode) {
              creationError = error instanceof Error ? error.message : String(error);
            }
          })
          .finally(() => {
            draft.attachmentsLoading = Math.max(0, draft.attachmentsLoading - imageFiles.length);
            if (creationDraft === draft && composerMode) {
              render();
              globalScope.queueMicrotask?.(() => {
                widget.querySelector<HTMLTextAreaElement>(".twicc-session-flow-composer textarea")?.focus();
              });
            }
          });
      });

      const fields = [
        createComposerField("Title (optional)", titleInput),
        createComposerField(
          "First message",
          promptInput,
          "Paste PNG, JPEG, GIF, or WebP images here. Ctrl+Enter creates the session."
        )
      ];
      if (creationDraft.attachments.length) {
        const attachmentList = document.createElement("div");
        attachmentList.className = "twicc-session-flow-attachments";
        attachmentList.setAttribute("role", "list");
        creationDraft.attachments.forEach((attachment, index) => {
          const attachmentItem = document.createElement("div");
          attachmentItem.className = "twicc-session-flow-attachment";
          attachmentItem.setAttribute("role", "listitem");
          const preview = document.createElement("img");
          preview.src = attachment.dataUrl;
          preview.alt = attachment.name;
          const removeButton = document.createElement("button");
          removeButton.type = "button";
          removeButton.className = "twicc-session-flow-remove-attachment";
          removeButton.textContent = "×";
          removeButton.title = `Remove ${attachment.name}`;
          removeButton.setAttribute("aria-label", `Remove ${attachment.name}`);
          removeButton.addEventListener("click", () => {
            creationDraft.attachments.splice(index, 1);
            render();
          });
          attachmentItem.append(preview, removeButton);
          attachmentList.append(attachmentItem);
        });
        fields.push(attachmentList);
      }
      if (creationDraft.attachmentsLoading) {
        const loading = document.createElement("small");
        loading.className = "twicc-session-flow-attachment-status";
        loading.setAttribute("role", "status");
        loading.textContent = "Reading pasted images…";
        fields.push(loading);
      }

      return fields;
    }

    function isNewWorktreeBranch(): boolean {
      const branch = creationDraft.branch.trim();
      return Boolean(branch) && !creationOptions?.branches.some((candidate) => candidate.name === branch);
    }

    function getDefaultNewWorktreePath(branch: unknown): string {
      const pierService = registry.getService<PierSessionFlowService>("boatyard.pier");
      if (creationDraft.usePier && typeof pierService?.getDefaultWorktreePath === "function" && String(branch || "").trim()) {
        return pierService.getDefaultWorktreePath(project, branch, {
          globalPluginConfig: pierWorktreePattern ? { pierWorktreePattern } : {}
        });
      }
      return joinWorktreePath(creationOptions?.defaultWorktreeBase, branch);
    }

    function createWorktreeModeTabs(): HTMLElement {
      const tabs = document.createElement("div");
      tabs.className = "twicc-session-flow-composer-tabs";
      tabs.setAttribute("role", "tablist");
      for (const [mode, label] of [["new", "New worktree"], ["existing", "Existing worktree"]] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(creationDraft.worktreeMode === mode));
        button.addEventListener("click", () => {
          creationDraft.worktreeMode = mode;
          creationDraft.pathEdited = false;
          creationDraft.path = mode === "new"
            ? getDefaultNewWorktreePath(creationDraft.branch)
            : "";
          creationError = "";
          render();
        });
        tabs.append(button);
      }
      return tabs;
    }

    function createNewWorktreeFields(): HTMLElement[] {
      const branchInput = document.createElement("input");
      branchInput.type = "text";
      branchInput.required = true;
      branchInput.autocomplete = "off";
      branchInput.placeholder = "feature/my-branch";
      branchInput.value = creationDraft.branch;
      const branchList = document.createElement("datalist");
      branchList.id = `twicc-session-flow-branches-${surfaceId}`;
      for (const branch of creationOptions?.branches || []) {
        const option = document.createElement("option");
        option.value = branch.name;
        option.label = branch.checkedOut ? `${branch.name} (in use)` : branch.name;
        branchList.append(option);
      }
      branchInput.setAttribute("list", branchList.id);

      const pathInput = document.createElement("input");
      pathInput.type = "text";
      pathInput.required = true;
      pathInput.autocomplete = "off";
      pathInput.placeholder = "/workspace/project/worktrees/feature-branch";
      pathInput.value = creationDraft.path;

      branchInput.addEventListener("input", () => {
        creationDraft.branch = branchInput.value;
        if (!creationDraft.pathEdited) {
          creationDraft.path = getDefaultNewWorktreePath(creationDraft.branch);
          pathInput.value = creationDraft.path;
        }
      });
      pathInput.addEventListener("input", () => {
        creationDraft.path = pathInput.value;
        creationDraft.pathEdited = true;
      });

      const fields: HTMLElement[] = [
        createComposerField(
          "New or existing branch",
          branchInput,
          "An existing branch is checked out; an unknown name creates a new branch."
        ),
        branchList,
        createComposerField("Path", pathInput, "Absolute path where the worktree will be created.")
      ];

      const startFrom = document.createElement("select");
      const headOption = document.createElement("option");
      headOption.value = "";
      headOption.textContent = "Current HEAD";
      startFrom.append(headOption);
      for (const branch of creationOptions?.branches || []) {
        const option = document.createElement("option");
        option.value = branch.name;
        option.textContent = branch.name;
        startFrom.append(option);
      }
      startFrom.value = creationDraft.startFrom;
      startFrom.addEventListener("change", () => {
        creationDraft.startFrom = startFrom.value;
      });
      const startField = createComposerField("Start from", startFrom, "Only used when creating a new branch.");
      startField.hidden = !isNewWorktreeBranch();
      branchInput.addEventListener("input", () => {
        startField.hidden = !isNewWorktreeBranch();
      });
      fields.push(startField);

      if (pierAvailable) {
        const pierNotice = document.createElement("div");
        pierNotice.className = "twicc-session-flow-pier-notice";
        const badge = document.createElement("strong");
        badge.textContent = "Pier lifecycle";
        const hint = document.createElement("span");
        hint.textContent = "Pier will create and materialize this worktree before TwiCC opens the session.";
        pierNotice.append(badge, hint);
        fields.push(pierNotice);
      }

      return fields;
    }

    function createExistingWorktreeFields(): HTMLElement[] {
      const select = document.createElement("select");
      select.required = true;
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = creationOptions?.worktrees.length
        ? "Select a worktree…"
        : "No other worktrees found";
      select.append(placeholder);
      for (const worktree of creationOptions?.worktrees || []) {
        const option = document.createElement("option");
        option.value = worktree.path;
        option.disabled = !worktree.usable;
        option.textContent = worktree.branch
          ? `${worktree.branch} — ${worktree.path}`
          : `${worktree.path} (detached)`;
        select.append(option);
      }
      select.value = creationDraft.path;
      select.addEventListener("change", () => {
        creationDraft.path = select.value;
      });
      return [createComposerField(
        "Worktree",
        select,
        "TwiCC adopts the existing Git worktree and starts the session there."
      )];
    }

    async function submitCreation(): Promise<void> {
      if (widget.dataset.creating === "true") {
        return;
      }
      const title = creationDraft.title.trim();
      const prompt = creationDraft.prompt.trim();
      if (creationDraft.attachmentsLoading) {
        creationError = "Wait for the pasted images to finish loading.";
        render();
        return;
      }
      if (!prompt) {
        creationError = "A first message is required.";
        render();
        return;
      }

      const input: Record<string, unknown> = {
        globalConfig: props.globalPluginConfig || {},
        attachments: creationDraft.attachments.map((attachment) => attachment.dataUrl),
        project: projectReference,
        prompt,
        sessionFlowLane: "in_progress",
        title
      };
      let createdPierWorktree = false;
      if (composerMode === "worktree") {
        const worktreePath = creationDraft.path.trim();
        if (!worktreePath) {
          creationError = creationDraft.worktreeMode === "new"
            ? "A worktree path is required."
            : "Select an existing worktree.";
          render();
          return;
        }
        input.worktreePath = worktreePath;

        if (creationDraft.worktreeMode === "new") {
          const branch = creationDraft.branch.trim();
          if (!branch) {
            creationError = "A branch is required.";
            render();
            return;
          }
          const checkedOutBranch = creationOptions?.branches.find((candidate) => candidate.name === branch && candidate.checkedOut);
          if (checkedOutBranch) {
            creationError = `Branch ${branch} is already checked out. Use the Existing worktree tab.`;
            render();
            return;
          }

          const startFrom = isNewWorktreeBranch() ? creationDraft.startFrom.trim() : "";
          if (creationDraft.usePier) {
            const pierService = registry.getService<PierSessionFlowService>("boatyard.pier");
            if (!pierService) {
              creationError = "The Pier plugin is no longer available. Close and reopen this form to use standard worktree creation.";
              render();
              return;
            }
            widget.dataset.creating = "true";
            creationError = "";
            render();
            try {
              await pierService.createWorktree(project, {
                branchName: branch,
                fromRef: startFrom,
                startAfterCreate: false,
                worktreePath
              });
              createdPierWorktree = true;
            } catch (error) {
              creationError = error instanceof Error ? error.message : String(error);
              delete widget.dataset.creating;
              render();
              return;
            }
          } else {
            input.worktreeBranch = branch;
            if (startFrom) {
              input.worktreeStartFrom = startFrom;
            }
          }
        }
      }

      widget.dataset.creating = "true";
      creationError = "";
      render();
      try {
        const created = normalizeCreatedSession(await invokePlugin("createSession", input));
        if (!created) {
          throw new Error("TwiCC did not return the created session.");
        }
        const createdAt = Date.now();
        const createdBranch = composerMode === "worktree"
          ? creationDraft.worktreeMode === "new"
            ? creationDraft.branch.trim()
            : creationOptions?.worktrees.find((worktree) => worktree.path === creationDraft.path.trim())?.branch || ""
          : "";
        const createdItem: TwiccSessionFlowItem = {
          branch: createdBranch,
          contextUsage: 0,
          id: created.sessionId,
          lane: "in_progress",
          lastActivityAt: new Date(createdAt).toISOString(),
          processState: "starting",
          provider: created.provider,
          title: created.title,
          totalCost: 0,
          userMessageCount: 1
        };
        pendingCreatedSessions.set(created.sessionId, { createdAt, item: createdItem });
        sessions = [createdItem, ...sessions.filter((session) => session.id !== created.sessionId)];
        composerMode = "";
        creationRequestId += 1;
        delete widget.dataset.creating;
        render();
        message.hidden = true;
        message.textContent = "";
        openCreatedSession(created);
        void load();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (createdPierWorktree && creationOptions) {
          const worktreePath = creationDraft.path.trim();
          creationOptions.worktrees = [
            {
              branch: creationDraft.branch.trim(),
              detached: false,
              path: worktreePath,
              usable: true
            },
            ...creationOptions.worktrees.filter((entry) => entry.path !== worktreePath)
          ];
          creationDraft.worktreeMode = "existing";
          creationDraft.path = worktreePath;
          creationError = `Pier created the worktree, but TwiCC could not create the session: ${detail}. Retry from Existing worktree.`;
        } else {
          creationError = detail;
        }
        delete widget.dataset.creating;
        render();
      }
    }

    function createCreationActions(): HTMLElement {
      const actions = document.createElement("div");
      actions.className = "twicc-session-flow-create-actions";
      const directButton = document.createElement("button");
      directButton.type = "button";
      directButton.title = "New session";
      directButton.setAttribute("aria-label", "New session");
      directButton.textContent = "+";
      directButton.addEventListener("click", openDirectComposer);
      const worktreeButton = document.createElement("button");
      worktreeButton.type = "button";
      worktreeButton.title = "New session in worktree";
      worktreeButton.setAttribute("aria-label", "New session in worktree");
      const worktreeIcon = document.createElement("span");
      worktreeIcon.className = "twicc-session-flow-worktree-icon";
      worktreeIcon.setAttribute("aria-hidden", "true");
      worktreeButton.append(worktreeIcon);
      worktreeButton.disabled = !String(project.sourcePath || "").trim();
      worktreeButton.addEventListener("click", () => {
        void openWorktreeComposer();
      });
      actions.append(directButton, worktreeButton);
      return actions;
    }

    function createSessionComposer(): HTMLElement {
      const card = document.createElement("form");
      card.className = "twicc-session-flow-composer";
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = composerMode === "worktree" ? "New session in worktree" : "New session";
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.title = "Cancel";
      closeButton.setAttribute("aria-label", "Cancel session creation");
      closeButton.textContent = "×";
      closeButton.addEventListener("click", closeCreationComposer);
      header.append(title, closeButton);
      card.append(header);

      if (composerMode === "worktree") {
        card.append(createWorktreeModeTabs());
        if (creationOptionsLoading) {
          const loading = document.createElement("p");
          loading.className = "twicc-session-flow-composer-status";
          loading.textContent = "Loading branches and worktrees…";
          card.append(loading);
        } else if (creationOptions) {
          card.append(...(
            creationDraft.worktreeMode === "new"
              ? createNewWorktreeFields()
              : createExistingWorktreeFields()
          ));
        }
      }

      if (composerMode === "direct" || creationOptions) {
        card.append(...createSessionFields());
      }
      if (creationError) {
        const error = document.createElement("p");
        error.className = "twicc-session-flow-composer-error";
        error.setAttribute("role", "alert");
        error.textContent = creationError;
        card.append(error);
      }

      const actions = document.createElement("div");
      actions.className = "twicc-session-flow-composer-actions";
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", closeCreationComposer);
      const submitButton = document.createElement("button");
      submitButton.type = "submit";
      submitButton.className = "primary";
      submitButton.disabled = creationOptionsLoading
        || (composerMode === "worktree" && !creationOptions)
        || creationDraft.attachmentsLoading > 0
        || widget.dataset.creating === "true";
      submitButton.textContent = widget.dataset.creating === "true" ? "Creating…" : "Create session";
      actions.append(cancelButton, submitButton);
      card.append(actions);
      card.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitCreation();
      });
      return card;
    }

    function createSessionCard(session: TwiccSessionFlowItem): HTMLElement {
      const card = document.createElement("article");
      card.className = "twicc-session-flow-card";
      const isCurrentSession = session.id === activeSessionId;
      const isEditingTitle = session.id === editingSessionId;
      let dragStarted = false;
      let pendingOpenTimer: number | null = null;
      const cancelPendingOpen = (): void => {
        if (pendingOpenTimer === null) {
          return;
        }
        globalScope.clearTimeout(pendingOpenTimer);
        pendingOpenTimer = null;
      };
      const isInteractiveTarget = (target: EventTarget | null): boolean => {
        return Boolean((target as Element | null)?.closest?.("button, input, select, textarea, a"));
      };
      card.classList.toggle("current-session", isCurrentSession);
      card.classList.toggle("editing-title", isEditingTitle);
      card.draggable = !isEditingTitle;
      card.tabIndex = isEditingTitle ? -1 : 0;
      card.dataset.sessionId = session.id;
      card.dataset.processState = session.processState || "idle";
      card.title = `Open ${session.title}; double-click to rename`;
      card.setAttribute(
        "aria-label",
        `${session.title}. Open in TwiCC; double-click or press F2 to rename.`
      );
      card.setAttribute("aria-keyshortcuts", "F2");
      if (isCurrentSession) {
        card.setAttribute("aria-current", "true");
      }

      const main = document.createElement("div");
      main.className = "twicc-session-flow-card-main";
      const provider = document.createElement("span");
      provider.className = `twicc-session-flow-provider ${session.provider === "claude_code" ? "claude" : "openai"}`;
      provider.setAttribute("aria-label", session.provider || "TwiCC provider");
      if (!session.provider || !["claude_code", "codex"].includes(session.provider)) {
        provider.textContent = String(session.provider || "?").slice(0, 1).toUpperCase();
      }
      let title: HTMLInputElement | HTMLSpanElement;
      if (isEditingTitle) {
        const titleInput = document.createElement("input");
        title = titleInput;
        titleInput.className = "twicc-session-flow-title-input";
        titleInput.type = "text";
        titleInput.maxLength = 200;
        titleInput.value = editingSessionDraft;
        titleInput.disabled = renamingSessionId === session.id;
        titleInput.setAttribute("aria-label", `Rename ${session.title}`);
        titleInput.addEventListener("click", (event) => event.stopPropagation());
        titleInput.addEventListener("input", () => {
          editingSessionDraft = titleInput.value;
          titleInput.removeAttribute("aria-invalid");
        });
        titleInput.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            titleInput.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelSessionTitleEditing(session.id);
          }
        });
        titleInput.addEventListener("blur", () => {
          void saveSessionTitle(session, titleInput);
        });
      } else {
        const titleLabel = document.createElement("span");
        title = titleLabel;
        titleLabel.className = "twicc-session-flow-title";
        titleLabel.textContent = session.title;
      }
      const currentBadge = document.createElement("span");
      currentBadge.className = "twicc-session-flow-current-badge";
      currentBadge.textContent = "Open";
      currentBadge.hidden = !isCurrentSession;
      const move = document.createElement("button");
      move.type = "button";
      move.className = "twicc-session-flow-move";
      move.textContent = "⋮";
      move.title = `Move ${session.title}`;
      move.setAttribute("aria-label", move.title);
      move.addEventListener("click", (event) => openMoveMenu(event, session));
      main.append(provider, title, currentBadge, move);

      const meta = document.createElement("div");
      meta.className = "twicc-session-flow-meta";
      const activity = document.createElement("span");
      activity.className = "twicc-session-flow-activity";
      activity.setAttribute("aria-hidden", "true");
      const branch = document.createElement("span");
      branch.className = "twicc-session-flow-branch";
      branch.textContent = session.branch ? `⌘ ${session.branch}` : "TwiCC";
      meta.append(activity, branch);

      const stats = document.createElement("div");
      stats.className = "twicc-session-flow-stats";
      const statsValues = [
        [`◯ ${session.userMessageCount || 0}`, "Messages"],
        [formatSessionFlowContextUsage(session.contextUsage), "Context usage"],
        [formatSessionFlowCost(session.totalCost), "Cost"],
        [formatSessionFlowTime(session.lastActivityAt), "Last activity"]
      ].filter(([value]) => value);
      for (const [value, label] of statsValues) {
        const stat = document.createElement("span");
        stat.textContent = value;
        stat.title = label;
        stats.append(stat);
      }

      card.append(main, meta, stats);
      card.addEventListener("click", (event) => {
        if (dragStarted || isEditingTitle || isInteractiveTarget(event.target)) {
          return;
        }
        if (event.detail > 1) {
          cancelPendingOpen();
          return;
        }
        cancelPendingOpen();
        pendingOpenTimer = globalScope.setTimeout(() => {
          pendingOpenTimer = null;
          if (card.isConnected) {
            openSession(session.id);
          }
        }, TWICC_SESSION_FLOW_SINGLE_CLICK_DELAY_MS);
      });
      card.addEventListener("dblclick", (event) => {
        if (dragStarted || isEditingTitle || isInteractiveTarget(event.target)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        cancelPendingOpen();
        startSessionTitleEditing(session);
      });
      card.addEventListener("keydown", (event) => {
        if (event.target !== card || isEditingTitle) {
          return;
        }
        if (event.key === "F2") {
          event.preventDefault();
          cancelPendingOpen();
          startSessionTitleEditing(session);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cancelPendingOpen();
          openSession(session.id);
        }
      });
      card.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        cancelPendingOpen();
        dragStarted = true;
        beginDrag(session.id, card, event);
        card.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-twicc-session", session.id);
        }
      });
      card.addEventListener("dragend", (event) => {
        event.stopPropagation();
        resetDragState();
        card.classList.remove("dragging");
        globalScope.setTimeout?.(() => {
          dragStarted = false;
        }, 0);
      });
      return card;
    }

    function createLane(lane: typeof TWICC_SESSION_FLOW_LANES[number]): HTMLElement {
      const section = document.createElement("section");
      section.className = `twicc-session-flow-lane ${lane.id}`;
      section.dataset.lane = lane.id;
      const laneHeader = document.createElement("header");
      laneHeader.className = "twicc-session-flow-lane-header";
      const heading = document.createElement("button");
      heading.type = "button";
      heading.className = "twicc-session-flow-heading";
      heading.setAttribute("aria-expanded", "true");
      const label = document.createElement("span");
      label.className = "twicc-session-flow-heading-label";
      const dot = document.createElement("span");
      dot.className = `twicc-session-flow-lane-dot ${lane.id}`;
      const count = document.createElement("span");
      count.className = "twicc-session-flow-count";
      const laneSessions = getOrderedLaneSessions(lane.id);
      count.textContent = String(laneSessions.length);
      label.append(dot, document.createTextNode(lane.label), count);
      const chevron = document.createElement("span");
      chevron.className = "twicc-session-flow-chevron";
      chevron.textContent = "⌄";
      heading.append(label, chevron);
      laneHeader.append(heading);
      if (lane.id === "in_progress") {
        laneHeader.append(createCreationActions());
      }
      if (lane.id === "testing") {
        const archiveAllButton = document.createElement("button");
        archiveAllButton.type = "button";
        archiveAllButton.className = "twicc-session-flow-archive-all";
        archiveAllButton.textContent = "Archive all";
        archiveAllButton.disabled = laneSessions.length === 0 || widget.dataset.archiving === "true";
        archiveAllButton.addEventListener("click", openArchiveAllDialog);
        laneHeader.append(archiveAllButton);
      }

      const list = document.createElement("div");
      list.className = "twicc-session-flow-list";
      if (lane.id === "in_progress") {
        if (composerMode) {
          list.append(createSessionComposer());
        }
      }
      if (laneSessions.length) {
        list.append(...laneSessions.map(createSessionCard));
      } else {
        const empty = document.createElement("span");
        empty.className = "twicc-session-flow-empty";
        empty.textContent = "Drop sessions here";
        list.append(empty);
      }
      heading.addEventListener("click", () => {
        const collapsed = section.classList.toggle("collapsed");
        heading.setAttribute("aria-expanded", String(!collapsed));
      });
      section.addEventListener("dragover", (event) => {
        if (!draggedSessionId) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        section.classList.add("drop-target");
        updateSessionInsertionPlaceholder(list, event, lane.id);
      });
      section.addEventListener("dragleave", (event) => {
        if (!section.contains(event.relatedTarget as Node | null)) {
          section.classList.remove("drop-target");
          if (sessionInsertionTarget?.lane === lane.id) {
            clearSessionInsertionPlaceholder();
          }
        }
      });
      section.addEventListener("drop", (event) => {
        dropSessionAtInsertion(event, lane.id);
      });
      section.append(laneHeader, list);
      return section;
    }

    function render(): void {
      closeMoveMenu();
      board.replaceChildren(...TWICC_SESSION_FLOW_LANES.map(createLane));
      board.hidden = false;
    }

    async function load(): Promise<void> {
      if (
        !isAlive()
        || widget.dataset.moving === "true"
        || widget.dataset.archiving === "true"
        || Boolean(editingSessionId)
        || widget.dataset.renaming === "true"
      ) {
        return;
      }
      if (!projectReference) {
        board.hidden = true;
        message.hidden = false;
        message.textContent = "Configure this project’s TwiCC URL to load sessions.";
        return;
      }
      try {
        const loadedSessions = normalizeSessionFlow(await invokePlugin("sessionFlow", {
          globalConfig: props.globalPluginConfig || {},
          project: projectReference
        }));
        sessions = mergePendingCreatedSessions(loadedSessions);
        render();
        message.hidden = sessions.length > 0;
        message.textContent = sessions.length ? "" : "No current TwiCC sessions.";
      } catch (error) {
        board.hidden = true;
        message.hidden = false;
        message.textContent = error instanceof Error ? error.message : String(error);
      }
    }

    globalScope.addEventListener?.(WEBAPP_URL_CHANGED_EVENT, handleWebAppUrlChanged);
    void load();
    const refreshInterval = globalScope.setInterval?.(() => {
      if (!isAlive()) {
        globalScope.clearInterval?.(refreshInterval);
        closeMoveMenu();
        return;
      }
      if (
        !composerMode
        && !editingSessionId
        && widget.dataset.moving !== "true"
        && widget.dataset.archiving !== "true"
        && widget.dataset.creating !== "true"
        && widget.dataset.renaming !== "true"
      ) {
        void load();
      }
    }, TWICC_SESSION_FLOW_REFRESH_MS);

    widget.cleanup = () => {
      globalScope.clearInterval?.(refreshInterval);
      globalScope.removeEventListener?.(WEBAPP_URL_CHANGED_EVENT, handleWebAppUrlChanged);
      if (archiveAllDialog?.open) {
        archiveAllDialog.close();
      }
      archiveAllDialog?.remove();
      archiveAllDialog = null;
      closeMoveMenu();
    };

    return widget;
  }

  function createSessionFlowWidget(project: TwiccProject, props: TwiccPluginOptions = {}): HTMLElement {
    return createSessionFlowSurface(project, props);
  }

  function createSessionFlowPane(container: HTMLElement, props: TwiccSessionFlowPaneOptions = {}): () => void {
    const project = props.project || {};
    const surface = createSessionFlowSurface(project, {
      ...props,
      pluginConfig: props.pluginConfig || props.projectConfig
    }, readSessionFlowOrientation(project, props.paneId));
    surface.classList.add("twicc-session-flow-pane");
    container.append(surface);
    const handleOrientation = (event: Event) => {
      const orientation = (event as CustomEvent<{ orientation?: unknown }>).detail?.orientation;
      if (orientation === "horizontal" || orientation === "vertical") {
        surface.setOrientation?.(orientation);
      }
    };
    container.addEventListener(TWICC_SESSION_FLOW_ORIENTATION_EVENT, handleOrientation);
    return () => {
      container.removeEventListener(TWICC_SESSION_FLOW_ORIENTATION_EVENT, handleOrientation);
      surface.cleanup?.();
      surface.remove();
    };
  }

  function renderSessionFlowHeaderActions(
    container: HTMLElement,
    props: TwiccSessionFlowPaneOptions = {}
  ): () => void {
    const project = props.project || {};
    let orientation = readSessionFlowOrientation(project, props.paneId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "webapp-tool-button twicc-session-flow-orientation";
    const icon = document.createElement("span");
    icon.className = "twicc-session-flow-orientation-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    button.append(icon);

    function syncButton(): void {
      const nextOrientation = orientation === "vertical" ? "horizontal" : "vertical";
      const label = `Switch to ${nextOrientation} layout`;
      button.dataset.orientation = orientation;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(orientation === "horizontal"));
    }

    const handleClick = () => {
      orientation = orientation === "vertical" ? "horizontal" : "vertical";
      persistSessionFlowOrientation(project, props.paneId, orientation);
      syncButton();
      props.host?.dispatchEvent(new CustomEvent(TWICC_SESSION_FLOW_ORIENTATION_EVENT, {
        detail: { orientation }
      }));
    };

    syncButton();
    button.addEventListener("click", handleClick);
    container.append(button);
    return () => button.removeEventListener("click", handleClick);
  }

  function registerSessionFlowWidget(ctx: TwiccPluginContext): void {
    ctx.widgets.register({
      id: "boatyard.twicc.sessionFlow",
      name: "TwiCC Session Flow",
      title: "TwiCC Session Flow",
      scope: "project",
      category: "Developer tools",
      status: "experimental",
      defaultVisible: false,
      description: "Organizes current TwiCC sessions into in-progress, backlog, and done lanes.",
      layout: {
        default: { columns: 3, rows: 7 },
        min: { columns: 2, rows: 4 }
      },
      createElement: createSessionFlowWidget
    });
  }

  function syncProjectUrlField(event: TwiccSourcePathInspectedEvent) {
    const fields = event.fields;
    const inspected = event.inspected?.plugins?.["boatyard.twicc"] || {};

    if (!fields) {
      return;
    }

    if (inspected.projectUrl && inspected.matchType === "exact") {
      fields.setActionVisible("twiccProjectUrl", false);
      if (!fields.isEdited("twiccProjectUrl") || !fields.getValue("twiccProjectUrl").trim()) {
        fields.setValue("twiccProjectUrl", inspected.projectUrl);
      }
    } else {
      fields.setActionVisible("twiccProjectUrl", true);
    }
  }

  registry.register(
    {
      id: "boatyard.twicc",
      name: "Twicc",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.twicc.sessionFlow", "boatyard.twicc.usage"],
        panes: ["boatyard.twicc.pane", "boatyard.twicc.sessionFlowPane"],
        projectNavBadges: ["boatyard.twicc.projectStatus"],
        globalSettings: ["boatyard.twicc.global"],
        projectSettings: ["boatyard.twicc.project"],
        services: ["boatyard.twicc.api"]
      },
      permissions: [
        "projectConfig:read",
        "projectConfig:write",
        "pane:wcv",
        "widget:provide",
        "service:provide"
      ]
    },
    {
      activate(ctx) {
        const twiccService = createTwiccService();
        ctx.services.provide("boatyard.twicc.api", twiccService);
        ctx.events.on("boatyard.projectForm.sourcePathInspected", (event: unknown) => {
          syncProjectUrlField(event as TwiccSourcePathInspectedEvent);
        });
        startProjectStatusRefresh();

        ctx.status.set({
          state: "ready",
          summary: "Twicc integration is available"
        });

        ctx.settings.registerGlobalSection({
          id: "boatyard.twicc.global",
          title: "Twicc",
          fields: [
            {
              key: "twiccBaseUrl",
              label: "Twicc base URL",
              type: "text",
              valueType: "url",
              placeholder: DEFAULT_TWICC_URL
            },
            {
              key: "twiccApiToken",
              label: "API token",
              type: "password",
              valueType: "text",
              placeholder: "Optional Bearer token"
            },
            {
              key: "twiccProjectStatusDisplay",
              label: "Project status display",
              type: "select",
              valueType: "text",
              defaultValue: TWICC_PROJECT_STATUS_DISPLAY_DEFAULT,
              options: TWICC_PROJECT_STATUS_DISPLAY_OPTIONS,
              description: "Choose whether project status uses text labels or the colored Twicc icon."
            },
            {
              key: "twiccTopbarUsageDisplay",
              label: "Top bar usage display",
              type: "select",
              valueType: "text",
              defaultValue: TWICC_TOPBAR_USAGE_DISPLAY_DEFAULT,
              options: TWICC_TOPBAR_USAGE_DISPLAY_OPTIONS,
              description: "Choose how the Twicc usage widget renders in the top bar."
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "boatyard.twicc.project",
          title: "Twicc",
          fields: [
            {
              key: "twiccProjectUrl",
              label: "Twicc project URL",
              type: "text",
              valueType: "url",
              placeholder: `${DEFAULT_TWICC_URL}/project/example`,
              action: {
                label: "Create",
                pendingLabel: "Creating...",
                message: "TwiCC project not found. Create it?",
                async run({ coreFields, fields, globalConfig }: TwiccProjectFieldContext) {
                  const sourcePath = String(coreFields.sourcePath || "").trim();
                  if (!sourcePath) {
                    throw new Error("Source path is required to create a TwiCC project.");
                  }

                  const created = asCreatedProject(await invokePlugin("createProject", {
                    globalConfig: globalConfig || latestGlobalConfig,
                    sourcePath
                  }));
                  if (!created?.url) {
                    throw new Error("TwiCC project was created but no URL was returned.");
                  }

                  fields.setValue("twiccProjectUrl", created.url, { markEdited: true });
                  fields.setActionVisible("twiccProjectUrl", false);
                }
              }
            }
          ]
        });

        ctx.panes.register({
          id: "boatyard.twicc.pane",
          webAppId: "twicc-plugin",
          key: "twicc-plugin",
          title: "Twicc",
          iconUrl: twiccIconUrl,
          kind: "wcv",
          scope: "project",
          resolveUrl({ project, projectConfig }: PluginPaneResolveContext) {
            return twiccService.getProjectUrl(project || {}, { pluginConfig: projectConfig });
          }
        });

        ctx.panes.register({
          id: "boatyard.twicc.sessionFlowPane",
          webAppId: "twicc-session-flow",
          key: "twicc-session-flow",
          title: "Session Flow",
          iconUrl: twiccIconUrl,
          kind: "dom",
          parentLabel: "Twicc",
          parentWebAppId: "twicc-plugin",
          scope: "project",
          renderHeaderActions: renderSessionFlowHeaderActions,
          render(container: HTMLElement, paneProps: PluginRegistryRecord = {}) {
            return createSessionFlowPane(
              container,
              paneProps as TwiccPluginOptions & { project?: TwiccProject }
            );
          }
        });

        ctx.projectNavBadges.register({
          id: "boatyard.twicc.projectStatus",
          render({ project, projectConfig, globalConfig, isActiveProject }: PluginProjectNavBadgeRenderContext) {
            latestGlobalConfig = globalConfig || {};
            return createProjectStatusBadge(project || {}, projectConfig, {
              globalPluginConfig: globalConfig,
              isActiveProject
            });
          }
        });

        registerUsageWidget(ctx);
        registerSessionFlowWidget(ctx);
      },
      deactivate() {
        stopProjectStatusRefresh();
      }
    }
  );
})(window);
