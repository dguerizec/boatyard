"use strict";

(function registerTwiccPlugin(globalScope) {
  type TwiccProject = {
    id?: string;
  };

  type TwiccConfig = {
    twiccApiToken?: string;
    twiccBaseUrl?: string;
    twiccProjectUrl?: string;
  };

  type TwiccPluginOptions = {
    globalPluginConfig?: TwiccConfig;
    isActiveProject?: boolean;
    pluginConfig?: TwiccConfig;
  };

  type TwiccProjectSession = {
    state?: string;
    title?: string;
  };

  type TwiccProjectStatus = {
    count?: number;
    sessions?: TwiccProjectSession[];
    state?: string;
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

  type TwiccGlobal = Window & {
    BoatyardPluginRegistry?: PluginRegistryApi;
    boatyard?: {
      invokePlugin?: (pluginId: string, actionName: string, payload: unknown) => Promise<any>;
      openExternal?: (url: string) => unknown;
    };
  };

  const typedGlobalScope = globalScope as unknown as TwiccGlobal;
  const registry = typedGlobalScope.BoatyardPluginRegistry;
  const DEFAULT_TWICC_URL = "http://localhost:3500";
  const TWICC_PROJECT_STATUS_REFRESH_MS = 5000;
  const TWICC_PROJECT_STATUS_LABELS = {
    working: "Working",
    input: "Input",
    done: "Done"
  };
  const TWICC_USAGE_REFRESH_MS = 60000;
  let projectProcessStatuses: Record<string, TwiccProjectStatus> = {};
  const retainedDoneProjectStatuses = new Map();
  let projectStatusRefreshTimer = null;

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function invokePlugin(actionName, payload = {}) {
    return typedGlobalScope.boatyard?.invokePlugin?.("boatyard.twicc", actionName, payload);
  }

  function normalizeBaseUrl(value) {
    return String(value || DEFAULT_TWICC_URL).replace(/\/+$/g, "");
  }

  function resolveProjectUrl(project: TwiccProject, options: TwiccPluginOptions = {}) {
    return options.pluginConfig?.twiccProjectUrl || "";
  }

  function resolveSessionUrl(project: TwiccProject, sessionId, options: TwiccPluginOptions = {}) {
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

  function getProjectIdFromUrl(url) {
    try {
      const parsed = new URL(url);
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
      project.id
    ].filter(Boolean);
  }

  function dispatchProjectBadgeChange() {
    if (typeof globalScope.dispatchEvent === "function" && typeof globalScope.CustomEvent === "function") {
      globalScope.dispatchEvent(new globalScope.CustomEvent("boatyard:project-nav-badges-changed"));
    }
  }

  async function refreshProjectProcessStatuses() {
    if (!typedGlobalScope.boatyard?.invokePlugin) {
      return;
    }

    try {
      const nextStatuses = await invokePlugin("projectProcessStatuses");
      if (JSON.stringify(projectProcessStatuses) !== JSON.stringify(nextStatuses)) {
        projectProcessStatuses = nextStatuses;
      }
      dispatchProjectBadgeChange();
    } catch (error) {
      console.error("Could not refresh Twicc project statuses:", error);
    }
  }

  function startProjectStatusRefresh() {
    if (!typedGlobalScope.boatyard?.invokePlugin) {
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
    dispatchProjectBadgeChange();
  }

  function createProjectStatusBadge(project: TwiccProject, projectConfig: TwiccConfig = {}, options: TwiccPluginOptions = {}) {
    const statusKey = getStatusKeysForProject(project, projectConfig)
      .find((key) => projectProcessStatuses?.[key]);
    const liveStatus = statusKey ? projectProcessStatuses[statusKey] : null;
    const retainKey = project.id || statusKey;

    if (options.isActiveProject && retainKey) {
      retainedDoneProjectStatuses.delete(retainKey);
    }

    if (liveStatus?.state === "done" && retainKey && !options.isActiveProject) {
      retainedDoneProjectStatuses.set(retainKey, liveStatus);
    }

    const status = liveStatus || (retainKey ? retainedDoneProjectStatuses.get(retainKey) : null);
    if (!status?.state) {
      return null;
    }

    const label = TWICC_PROJECT_STATUS_LABELS[status.state] || status.state;
    const badge = document.createElement("span");
    badge.className = `project-nav-badge project-twicc-status ${status.state}`;
    badge.textContent = label;

    const sessionLabel = status.count === 1 ? "session" : "sessions";
    const primarySession = status.sessions?.find((session) => session.state === status.state) || status.sessions?.[0];
    badge.title = primarySession?.title
      ? `Twicc: ${label.toLowerCase()} (${status.count} ${sessionLabel}) - ${primarySession.title}`
      : `Twicc: ${label.toLowerCase()} (${status.count} ${sessionLabel})`;

    return badge;
  }

  function createTwiccService() {
    return Object.freeze({
      version: "0.1.0",
      getBaseUrl(options: TwiccPluginOptions = {}) {
        return normalizeBaseUrl(options.globalPluginConfig?.twiccBaseUrl);
      },
      getProjectUrl: resolveProjectUrl,
      getSessionUrl: resolveSessionUrl,
      openProject(project: TwiccProject, options: TwiccPluginOptions = {}) {
        const url = resolveProjectUrl(project, options);
        return url ? typedGlobalScope.boatyard?.openExternal?.(url) : null;
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

  function formatProviderName(provider) {
    return String(provider || "")
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ") || "Provider";
  }

  function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number)}%` : "--";
  }

  function formatResetRelative(value) {
    if (!value) {
      return "--";
    }

    const date = new Date(value);
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

  function getUsageTone(value) {
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

  function getProviderInitials(provider) {
    const normalized = String(provider || "").toLowerCase();
    return formatProviderName(provider)
      .split(/\s+/)
      .map((part) => part.slice(0, 1))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  }

  function getProviderIconClass(provider) {
    const normalized = String(provider || "").toLowerCase();
    if (normalized === "claude_code" || normalized === "claude" || normalized === "anthropic") {
      return "claude";
    }
    if (normalized === "codex" || normalized === "openai") {
      return "openai";
    }
    return "";
  }

  function createProviderIcon(provider) {
    const iconClass = getProviderIconClass(provider);
    const icon = document.createElement("span");
    icon.className = `twicc-usage-provider-icon${iconClass ? ` ${iconClass}` : ""}`;
    icon.setAttribute("aria-hidden", "true");
    if (!iconClass) {
      icon.textContent = getProviderInitials(provider);
    }
    return icon;
  }

  function getGaugePercent(value) {
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

  function formatBurnRate(value) {
    const percent = normalizeBurnRatePercent(value);
    return Number.isFinite(percent) ? `${Math.round(percent)}%` : "--";
  }

  function normalizeBurnRatePercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return Number.NaN;
    }

    return Math.abs(number) <= 2 ? number * 100 : number;
  }

  function getBurnRateArcSegments(value) {
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

  function getBurnRateTone(value) {
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

  function createUsageGauge(label, percentValue, detail) {
    const gauge = document.createElement("div");
    gauge.className = `twicc-usage-gauge ${getUsageTone(percentValue)}`;
    gauge.style.setProperty("--twicc-usage-percent", `${getGaugePercent(percentValue)}%`);

    const ring = document.createElement("span");
    ring.className = "twicc-usage-ring";
    ring.textContent = formatPercent(percentValue);

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

  function createBurnRateGauge(label, value) {
    const arcs = getBurnRateArcSegments(value);
    const gauge = document.createElement("div");
    gauge.className = `twicc-usage-burn-gauge ${getBurnRateTone(value)}`;
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

  function normalizeUsageResult(payload) {
    if (!payload || typeof payload !== "object") {
      return {};
    }

    if ("result" in payload || "exit_code" in payload || "error" in payload) {
      if (payload.exit_code && payload.exit_code !== 0) {
        throw new Error(payload.error || "TwiCC usage request failed.");
      }
      if (payload.error) {
        throw new Error(String(payload.error));
      }
      return payload.result && typeof payload.result === "object" ? payload.result : {};
    }

    return payload;
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

  function renderProviderUsage(providerKey, usage) {
    const provider = usage && typeof usage === "object" ? usage : {};
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

  function createUsageWidget(project: TwiccProject, props: TwiccPluginOptions = {}) {
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
        footer.textContent = error.message;
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

  function registerUsageWidget(ctx) {
    ctx.widgets.register({
      id: "boatyard.twicc.usage",
      name: "TwiCC Usage",
      title: "TwiCC Usage",
      scopes: ["global", "project"],
      category: "Usage",
      status: "experimental",
      defaultVisible: false,
      description: "Shows provider quota utilization from the TwiCC usage RPC.",
      layout: {
        default: { columns: 3, rows: 1 },
        min: { columns: 3, rows: 1 }
      },
      createElement: createUsageWidget
    });
    ctx.widgets.registerAlias("boatyard.twicc.projectUsage", "boatyard.twicc.usage");
  }

  function syncProjectUrlField(event) {
    const fields = event.fields;
    const inspected = event.inspected?.plugins?.["boatyard.twicc"] || {};
    const currentValue = fields?.getValue("twiccProjectUrl") || "";
    const canReplace = !fields?.isEdited("twiccProjectUrl") || !currentValue.trim();

    if (!fields) {
      return;
    }

    fields.setActionVisible("twiccProjectUrl", false);

    if (!canReplace) {
      return;
    }

    if (inspected.projectUrl && inspected.matchType === "exact") {
      fields.setValue("twiccProjectUrl", inspected.projectUrl);
    } else if (inspected.matchType === "parent") {
      fields.setValue("twiccProjectUrl", "");
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
        widgets: ["boatyard.twicc.usage"],
        panes: ["boatyard.twicc.pane"],
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
        ctx.events.on("boatyard.projectForm.sourcePathInspected", syncProjectUrlField);
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
                async run({ coreFields, fields }) {
                  const sourcePath = String(coreFields.sourcePath || "").trim();
                  if (!sourcePath) {
                    throw new Error("Source path is required to create a TwiCC project.");
                  }

                  const created = await invokePlugin("createProject", { sourcePath });
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
          kind: "wcv",
          scope: "project",
          resolveUrl({ project, projectConfig }) {
            return twiccService.getProjectUrl(project, { pluginConfig: projectConfig });
          }
        });

        ctx.projectNavBadges.register({
          id: "boatyard.twicc.projectStatus",
          render({ project, projectConfig, isActiveProject }) {
            return createProjectStatusBadge(project, projectConfig, { isActiveProject });
          }
        });

        registerUsageWidget(ctx);
      },
      deactivate() {
        stopProjectStatusRefresh();
      }
    }
  );
})(window);
