"use strict";

(function registerSystemResourcesPlugin(globalScope: BoatyardPluginRendererGlobal) {
  type MemoryGroup = {
    processCount?: number;
    pssBytes?: number;
    rssBytes?: number;
    swapPssBytes?: number;
  };
  type ResourceSection = "overview" | "wcv" | "tmux";
  type WebContentsViewEntry = MemoryGroup & {
    key?: string;
    label?: string;
    pid?: number;
    projectId?: string;
    projectName?: string;
    sharedProcessViews?: number;
    url?: string;
    windowId?: string;
  };
  type TmuxGroup = MemoryGroup & {
    panes?: Array<MemoryGroup & { id?: string; pid?: number }>;
    projectId?: string;
    projectName?: string;
    sessions?: Array<{
      clientCount?: number;
      createdAt?: number;
      linked?: boolean;
      name?: string;
      state?: "active" | "linked" | "primary" | "stale" | "starting";
    }>;
  };
  type TmuxCleanupReport = {
    completedAt?: string;
    error?: string;
    failed?: Array<{ message?: string; sessionName?: string }>;
    mode?: "automatic" | "manual";
    removedSessionNames?: string[];
  };
  type ResourceSnapshot = {
    sampledAt?: string;
    supported?: boolean;
    error?: string;
    accounting?: { note?: string };
    total?: { estimatedBytes?: number };
    boatyard?: MemoryGroup;
    wcv?: MemoryGroup & { count?: number; entries?: WebContentsViewEntry[] };
    tmux?: MemoryGroup & {
      activeClientSessionCount?: number;
      available?: boolean;
      cleanup?: TmuxCleanupReport | null;
      error?: string;
      exclusivePssBytes?: number;
      groupCount?: number;
      groups?: TmuxGroup[];
      linkedSessionCount?: number;
      paneCount?: number;
      serverShared?: boolean;
      sessionCount?: number;
      sharedServerPssBytes?: number;
      staleSessionCount?: number;
    };
    providers?: PluginManagedResourceSnapshot[];
  };

  const registry = globalScope.BoatyardPluginRegistry;
  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  const PANE_IDS: Record<ResourceSection, string> = {
    overview: "boatyard.systemResources.pane",
    wcv: "boatyard.systemResources.wcv",
    tmux: "boatyard.systemResources.tmux"
  };
  const NAVIGATION_ITEMS: PluginPaneNavigationItem[] = [
    { id: "overview", label: "Overview", webAppId: PANE_IDS.overview },
    { id: "wcv", label: "Web apps", webAppId: PANE_IDS.wcv },
    { id: "tmux", label: "tmux", webAppId: PANE_IDS.tmux }
  ];
  const SECTION_COPY: Record<ResourceSection, { title: string; subtitle: string }> = {
    overview: { title: "System resources", subtitle: "Memory managed by this Boatyard instance" },
    wcv: { title: "Web apps", subtitle: "Embedded web apps grouped by Boatyard project" },
    tmux: { title: "tmux", subtitle: "Managed session groups and unique panes by project" }
  };
  const RESOURCE_PROVIDER_KIND = "boatyard.resourceProvider";
  const SYSTEM_RESOURCES_SERVICE_ID = "boatyard.systemResources";
  const SNAPSHOT_CACHE_MS = 15000;
  let cachedSnapshot: ResourceSnapshot | null = null;
  let cachedSnapshotAt = 0;
  let snapshotRequest: Promise<ResourceSnapshot> | null = null;
  const resourceGroupOpenState = new Map<string, boolean>();

  function element<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className = "",
    text = ""
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tagName);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function formatCount(value: unknown): string {
    return Math.max(0, Number(value) || 0).toLocaleString();
  }

  function formatMemory(value: unknown): string {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) {
      return `${Math.round(bytes)} B`;
    }
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let amount = bytes / 1024;
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024;
      unitIndex += 1;
    }
    const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toFixed(digits)} ${units[unitIndex]}`;
  }

  function formatProcessId(value: unknown): string {
    const pid = Number(value);
    return Number.isInteger(pid) && pid > 0 ? String(pid) : "Unknown";
  }

  function formatHost(value: unknown): string {
    try {
      return new URL(String(value || "")).hostname || "No URL";
    } catch {
      return "No URL";
    }
  }

  function sum(items: unknown[] | undefined, field: string): number {
    let total = 0;
    for (const item of items || []) {
      const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
      total += Number(source[field]) || 0;
    }
    return total;
  }

  function createShareBar(shareOptions: PluginResourceShare) {
    const memory = Math.max(0, Number(shareOptions.value) || 0);
    const total = Math.max(0, Number(shareOptions.total) || 0);
    const share = total > 0 ? Math.min(100, (memory / total) * 100) : 0;
    const indicator = element("div", "system-resources-share");
    const track = element("div", "system-resources-share-track");
    const fill = element("span", "system-resources-share-fill");
    fill.setAttribute("style", `width: ${share.toFixed(1)}%`);
    if (share > 0) {
      fill.className += " has-value";
    }
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", shareOptions.label);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", share.toFixed(1));
    track.append(fill);
    indicator.append(
      track,
      element("small", "system-resources-share-value", `${Math.round(share)}% ${shareOptions.unitLabel}`)
    );
    return indicator;
  }

  function createResourceMetrics(metrics: PluginResourceMetric[] = []) {
    const values = element("div", "system-resources-resource-metrics");
    for (const metric of metrics) {
      const value = element("span", `system-resources-resource-metric is-${metric.tone || "default"}`);
      value.append(
        element("small", "", metric.label),
        element("strong", "", metric.value)
      );
      values.append(value);
    }
    return values;
  }

  function createResourceIdentity(
    title: string,
    subtitle = "",
    metadata: string[] = [],
    badges: PluginResourceBadge[] = []
  ) {
    const identity = element("div", "system-resources-resource-identity");
    identity.append(element("strong", "", title));
    if (subtitle) {
      identity.append(element("small", "system-resources-resource-subtitle", subtitle));
    }
    if (metadata.length || badges.length) {
      const details = element("div", "system-resources-resource-metadata");
      for (const value of metadata) {
        details.append(element("small", "", value));
      }
      for (const badge of badges) {
        details.append(element(
          "small",
          `system-resources-resource-badge is-${badge.tone || "default"}`,
          badge.label
        ));
      }
      identity.append(details);
    }
    return identity;
  }

  function createResourceGroup(options: PluginResourceGroupOptions) {
    const group = element("details", "system-resources-resource-group");
    group.open = resourceGroupOpenState.get(options.stateKey) ?? false;
    group.addEventListener("toggle", () => {
      resourceGroupOpenState.set(options.stateKey, group.open);
    });
    const summary = element("summary", "system-resources-resource-group-summary");
    summary.append(
      createResourceIdentity(options.title, options.subtitle),
      createShareBar(options.share),
      createResourceMetrics(options.metrics)
    );
    const rows = element("div", "system-resources-resource-rows");
    group.append(summary, rows);
    return { group, rows };
  }

  function createResourceItem(options: PluginResourceItemOptions) {
    const row = element("div", "system-resources-resource-item");
    row.append(
      createResourceIdentity(options.title, "", options.metadata, options.badges),
      createShareBar(options.share),
      createResourceMetrics(options.metrics)
    );
    return row;
  }

  function createResourceList() {
    return element("div", "system-resources-resource-list");
  }

  function createStat(label: string, value: string, detail = "") {
    const stat = element("div", "system-resources-stat");
    stat.append(
      element("span", "system-resources-stat-label", label),
      element("strong", "system-resources-stat-value", value)
    );
    if (detail) {
      stat.append(element("small", "system-resources-stat-detail", detail));
    }
    return stat;
  }

  function createCard(title: string, count: string, countLabel: string) {
    const card = element("section", "system-resources-card");
    const header = element("header", "system-resources-card-header");
    const heading = element("div", "system-resources-card-heading");
    heading.append(
      element("h3", "", title),
      element("p", "", `${count} ${countLabel}`)
    );
    header.append(heading);
    const stats = element("div", "system-resources-card-stats");
    card.append(header, stats);
    return { card, header, stats };
  }

  function createDetailGroup(title: string, subtitle: string, stats: HTMLElement[]) {
    const group = element("section", "system-resources-detail-group");
    const header = element("header", "system-resources-detail-group-header");
    const heading = element("div", "system-resources-card-heading");
    heading.append(element("h3", "", title), element("p", "", subtitle));
    const metrics = element("div", "system-resources-detail-group-metrics");
    metrics.append(...stats);
    header.append(heading, metrics);
    const rows = element("div", "system-resources-detail-rows");
    group.append(header, rows);
    return { group, rows };
  }

  function createDetailRow(
    title: string,
    subtitle: string,
    metrics: Array<{ label: string; value: string }>
  ) {
    const row = element("div", "system-resources-detail-row");
    const identity = element("div", "system-resources-detail-identity");
    identity.append(element("strong", "", title), element("small", "", subtitle));
    const values = element("div", "system-resources-detail-values");
    for (const metric of metrics) {
      const value = element("span", "system-resources-detail-value");
      value.append(element("small", "", metric.label), element("strong", "", metric.value));
      values.append(value);
    }
    row.append(identity);
    if (metrics.length) {
      row.append(values);
    }
    return row;
  }

  function addError(container: HTMLElement, message: unknown) {
    const text = String(message || "").trim();
    if (text) {
      container.append(element("p", "system-resources-error", text));
    }
  }

  const rendererUi: PluginResourceRendererUi = Object.freeze({
    addError,
    createCard,
    createDetailGroup,
    createDetailRow,
    createResourceGroup,
    createResourceItem,
    createResourceList,
    createShareBar,
    createStat,
    element,
    formatCount,
    formatMemory
  });

  function listResourceProviders(): PluginResourceRendererProvider[] {
    return registry.listServices().flatMap(({ id }) => {
      const provider = registry.getService<PluginResourceRendererProvider>(id);
      if (
        provider?.kind !== RESOURCE_PROVIDER_KIND ||
        !provider.id ||
        !provider.label ||
        !provider.paneId ||
        typeof provider.renderDetails !== "function" ||
        typeof provider.renderOverview !== "function"
      ) {
        return [];
      }
      return [provider];
    }).sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }

  function getProviderSnapshot(snapshot: ResourceSnapshot, providerId: string) {
    return (snapshot.providers || []).find((provider) => provider.id === providerId);
  }

  function renderOverview(content: HTMLElement, snapshot: ResourceSnapshot) {
    const overview = element("section", "system-resources-overview");
    const total = element("div", "system-resources-total");
    total.append(
      element("span", "", "Estimated managed memory"),
      element("strong", "", formatMemory(snapshot.total?.estimatedBytes)),
      element("small", "", "Host PSS + external managed memory")
    );
    const app = element("div", "system-resources-app-summary");
    app.append(
      createStat("Boatyard PSS", formatMemory(snapshot.boatyard?.pssBytes)),
      createStat("Boatyard RSS", formatMemory(snapshot.boatyard?.rssBytes)),
      createStat("Processes", formatCount(snapshot.boatyard?.processCount))
    );
    overview.append(total, app);

    const cards = element("div", "system-resources-cards");
    const wcv = createCard("Web apps", formatCount(snapshot.wcv?.count), "apps");
    wcv.stats.append(
      createStat("PSS", formatMemory(snapshot.wcv?.pssBytes), "Included in Boatyard"),
      createStat("RSS", formatMemory(snapshot.wcv?.rssBytes)),
      createStat("Processes", formatCount(snapshot.wcv?.processCount))
    );
    cards.append(wcv.card);

    const tmux = createCard("tmux", formatCount(snapshot.tmux?.groupCount), "project sessions");
    tmux.stats.append(
      createStat("PSS", formatMemory(snapshot.tmux?.pssBytes)),
      createStat("RSS", formatMemory(snapshot.tmux?.rssBytes)),
      createStat("Unique panes", formatCount(snapshot.tmux?.paneCount)),
      createStat("Linked clients", formatCount(snapshot.tmux?.linkedSessionCount)),
      createStat("tmux sessions", formatCount(snapshot.tmux?.sessionCount))
    );
    if (snapshot.tmux?.serverShared) {
      tmux.card.append(element(
        "p",
        "system-resources-note",
        `Shared server: ${formatMemory(snapshot.tmux.sharedServerPssBytes)} PSS, excluded from the total.`
      ));
    }
    addError(tmux.card, snapshot.tmux?.error);
    cards.append(tmux.card);

    for (const provider of listResourceProviders()) {
      try {
        const card = provider.renderOverview(getProviderSnapshot(snapshot, provider.id), rendererUi);
        if (card) {
          cards.append(card);
        }
      } catch (error) {
        console.error(`Could not render resource provider ${provider.id}:`, error);
      }
    }

    const note = element("p", "system-resources-accounting-note", snapshot.accounting?.note || "");
    content.append(overview, cards, note);
  }

  function renderWcvDetails(content: HTMLElement, snapshot: ResourceSnapshot) {
    const entries = snapshot.wcv?.entries || [];
    const summary = element("div", "system-resources-detail-summary");
    summary.append(
      createStat("Web apps", formatCount(snapshot.wcv?.count)),
      createStat("Processes", formatCount(snapshot.wcv?.processCount)),
      createStat("PSS", formatMemory(snapshot.wcv?.pssBytes)),
      createStat("RSS", formatMemory(snapshot.wcv?.rssBytes))
    );
    content.append(summary);
    const projects = [...new Set(entries.map((entry) => entry.projectName || "Unassigned"))].map((projectName) => ({
      entries: entries
        .filter((entry) => (entry.projectName || "Unassigned") === projectName)
        .sort((left, right) => (
          (Number(right.pssBytes) || 0) - (Number(left.pssBytes) || 0) ||
          String(left.label || "").localeCompare(String(right.label || ""))
        )),
      projectName
    })).sort((left, right) => (
      sum(right.entries, "pssBytes") - sum(left.entries, "pssBytes") ||
      left.projectName.localeCompare(right.projectName)
    ));
    const groupedPssBytes = projects.reduce((total, project) => total + sum(project.entries, "pssBytes"), 0);
    const list = createResourceList();
    for (const project of projects) {
      const projectEntries = project.entries;
      const projectPssBytes = sum(projectEntries, "pssBytes");
      const detail = createResourceGroup({
        metrics: [
          { label: "PSS", value: formatMemory(projectPssBytes) },
          { label: "RSS", value: formatMemory(sum(projectEntries, "rssBytes")) },
          { label: "Apps", tone: "count", value: formatCount(projectEntries.length) }
        ],
        share: {
          label: `${project.projectName} share of web app PSS`,
          total: groupedPssBytes,
          unitLabel: "PSS",
          value: projectPssBytes
        },
        stateKey: `web-apps:${project.projectName}`,
        subtitle: `${formatCount(projectEntries.length)} web ${projectEntries.length === 1 ? "app" : "apps"}`,
        title: project.projectName
      });
      for (const entry of projectEntries) {
        const appName = entry.label || "Web app";
        detail.rows.append(createResourceItem({
          badges: Number(entry.sharedProcessViews) > 1
            ? [{ label: `Shared ×${formatCount(entry.sharedProcessViews)}`, tone: "accent" }]
            : [],
          metadata: [formatHost(entry.url), `PID ${formatProcessId(entry.pid)}`],
          metrics: [
            { label: "PSS", value: formatMemory(entry.pssBytes) },
            { label: "RSS", value: formatMemory(entry.rssBytes) }
          ],
          share: {
            label: `${appName} PSS share within ${project.projectName}`,
            total: projectPssBytes,
            unitLabel: "PSS",
            value: entry.pssBytes
          },
          title: appName
        }));
      }
      list.append(detail.group);
    }
    if (projects.length) {
      content.append(list);
    }
    if (!entries.length) {
      content.append(element("p", "system-resources-empty", "No web apps are currently managed by this instance."));
    }
  }

  function renderTmuxDetails(content: HTMLElement, snapshot: ResourceSnapshot) {
    const groups = snapshot.tmux?.groups || [];
    const staleSessionCount = Math.max(0, Number(snapshot.tmux?.staleSessionCount) || 0);
    const summary = element("div", "system-resources-detail-summary");
    const staleStat = createStat(
      "Stale sessions",
      formatCount(staleSessionCount),
      staleSessionCount ? "Detached client sessions safe to clean" : "No orphaned client sessions"
    );
    if (staleSessionCount > 0) {
      staleStat.className += " is-warning";
    }
    summary.append(
      createStat("Projects", formatCount(snapshot.tmux?.groupCount)),
      createStat(
        "Sessions",
        formatCount(snapshot.tmux?.sessionCount),
        `${formatCount(snapshot.tmux?.activeClientSessionCount)} active client sessions`
      ),
      createStat("Unique panes", formatCount(snapshot.tmux?.paneCount)),
      createStat("PSS", formatMemory(snapshot.tmux?.pssBytes)),
      createStat("RSS", formatMemory(snapshot.tmux?.rssBytes)),
      staleStat
    );
    content.append(summary);
    const cleanup = snapshot.tmux?.cleanup;
    const removedSessionNames = cleanup?.removedSessionNames || [];
    const cleanupFailures = cleanup?.failed || [];
    if (removedSessionNames.length || cleanupFailures.length || cleanup?.error) {
      const report = element("details", "system-resources-cleanup-report");
      const mode = cleanup?.mode === "manual" ? "Manual" : "Automatic";
      const reportSummary = element(
        "summary",
        "",
        `${mode} cleanup removed ${formatCount(removedSessionNames.length)} stale ${removedSessionNames.length === 1 ? "session" : "sessions"}${cleanupFailures.length ? ` · ${formatCount(cleanupFailures.length)} failed` : ""}`
      );
      const reportRows = element("div", "system-resources-cleanup-report-rows");
      for (const sessionName of removedSessionNames) {
        reportRows.append(createDetailRow(sessionName, "Removed stale client session", []));
      }
      for (const failure of cleanupFailures) {
        reportRows.append(createDetailRow(
          failure.sessionName || "tmux session",
          failure.message || "Cleanup failed.",
          [{ label: "State", value: "Failed" }]
        ));
      }
      addError(reportRows, cleanup?.error);
      report.append(reportSummary, reportRows);
      content.append(report);
    }
    const sortedGroups = [...groups].sort((left, right) => (
      (Number(right.pssBytes) || 0) - (Number(left.pssBytes) || 0) ||
      String(left.projectName || "").localeCompare(String(right.projectName || ""))
    ));
    const groupedPssBytes = sum(sortedGroups, "pssBytes");
    const list = createResourceList();
    for (const [groupIndex, group] of sortedGroups.entries()) {
      const sessions = group.sessions || [];
      const panes = group.panes || [];
      const groupPssBytes = Math.max(0, Number(group.pssBytes) || 0);
      const groupStaleSessionCount = sessions.filter((session) => session.state === "stale").length;
      const metrics: PluginResourceMetric[] = [
        { label: "PSS", value: formatMemory(group.pssBytes) },
        { label: "RSS", value: formatMemory(group.rssBytes) },
        { label: "Panes", tone: "count", value: formatCount(panes.length) },
        { label: "Sessions", tone: "count", value: formatCount(sessions.length) }
      ];
      if (groupStaleSessionCount) {
        metrics.push({ label: "Stale", tone: "warning", value: formatCount(groupStaleSessionCount) });
      }
      const project = createResourceGroup({
        metrics,
        share: {
          label: `${group.projectName || "Project"} share of tmux PSS`,
          total: groupedPssBytes,
          unitLabel: "PSS",
          value: groupPssBytes
        },
        stateKey: `tmux:${group.projectId || group.projectName || groupIndex}`,
        title: group.projectName || "Project"
      });
      for (const session of sessions) {
        const state = session.state || (session.linked ? "linked" : "primary");
        if (state !== "stale") {
          continue;
        }
        const row = createDetailRow(
          session.name || "tmux session",
          "Stale client session",
          [{ label: "State", value: "Stale" }]
        );
        row.className += " system-resources-resource-alert is-stale";
        project.rows.append(row);
      }
      if (panes.length) {
        const termPssBytes = sum(panes, "pssBytes");
        const sortedPanes = [...panes].sort((left, right) => (
          (Number(right.pssBytes) || 0) - (Number(left.pssBytes) || 0) ||
          String(left.id || "").localeCompare(String(right.id || ""))
        ));
        for (const pane of sortedPanes) {
          const paneName = `Term ${pane.id || "pane"}`;
          project.rows.append(createResourceItem({
            metadata: [
              `PID ${formatProcessId(pane.pid)}`,
              `${formatCount(pane.processCount)} ${Number(pane.processCount) === 1 ? "process" : "processes"}`
            ],
            metrics: [
              { label: "PSS", value: formatMemory(pane.pssBytes) },
              { label: "RSS", value: formatMemory(pane.rssBytes) }
            ],
            share: {
              label: `${paneName} PSS share within ${group.projectName || "project"}`,
              total: termPssBytes,
              unitLabel: "PSS",
              value: pane.pssBytes
            },
            title: paneName
          }));
        }
      }
      list.append(project.group);
    }
    if (sortedGroups.length) {
      content.append(list);
    }
    if (!groups.length) {
      content.append(element("p", "system-resources-empty", "No tmux sessions are currently managed by this instance."));
    }
    addError(content, snapshot.tmux?.error);
  }

  function renderSection(content: HTMLElement, snapshot: ResourceSnapshot, section: ResourceSection) {
    content.replaceChildren();
    if (snapshot.supported === false) {
      content.append(element("p", "system-resources-empty", snapshot.error || "Resource accounting is unavailable."));
      return;
    }
    if (section === "wcv") {
      renderWcvDetails(content, snapshot);
    } else if (section === "tmux") {
      renderTmuxDetails(content, snapshot);
    } else {
      renderOverview(content, snapshot);
    }
  }

  async function loadSnapshot(force = false): Promise<ResourceSnapshot> {
    if (!force && cachedSnapshot && Date.now() - cachedSnapshotAt < SNAPSHOT_CACHE_MS) {
      return cachedSnapshot;
    }
    if (snapshotRequest) {
      return snapshotRequest;
    }
    snapshotRequest = (async () => {
      const snapshot = await globalScope.boatyard?.invokePlugin?.(
        "boatyard.systemResources",
        "snapshot",
        {}
      ) as ResourceSnapshot | undefined;
      if (!snapshot) {
        throw new Error("Resource snapshot is unavailable.");
      }
      cachedSnapshot = snapshot;
      cachedSnapshotAt = Date.now();
      return snapshot;
    })();
    try {
      return await snapshotRequest;
    } finally {
      snapshotRequest = null;
    }
  }

  type ResourcePaneRenderOptions = {
    allowTmuxCleanup?: boolean;
    renderContent(content: HTMLElement, snapshot: ResourceSnapshot): void;
    sectionId: string;
    subtitle: string;
    title: string;
  };

  function renderResourcePane(container: HTMLElement, options: ResourcePaneRenderOptions) {
    const root = element("div", "system-resources-pane");
    root.dataset.section = options.sectionId;
    const toolbar = element("header", "system-resources-toolbar");
    const heading = element("div", "system-resources-heading");
    heading.append(
      element("h2", "", options.title),
      element("p", "", options.subtitle)
    );
    const actions = element("div", "system-resources-actions");
    const sampledAt = element("span", "system-resources-sampled-at", "Not sampled yet");
    const cleanupButton = options.allowTmuxCleanup
      ? element("button", "system-resources-cleanup", "Clean stale")
      : null;
    if (cleanupButton) {
      cleanupButton.type = "button";
      cleanupButton.disabled = true;
    }
    const refreshButton = element("button", "system-resources-refresh", "Refresh");
    refreshButton.type = "button";
    actions.append(sampledAt);
    if (cleanupButton) {
      actions.append(cleanupButton);
    }
    actions.append(refreshButton);
    toolbar.append(heading, actions);
    const content = element("div", "system-resources-content");
    content.append(element("p", "system-resources-empty", "Measuring resources…"));
    root.append(toolbar, content);
    container.replaceChildren(root);

    let disposed = false;
    let loading = false;
    let cleaning = false;
    let hasRenderedSnapshot = false;
    let staleSessionCount = 0;

    function updateCleanupButton() {
      if (!cleanupButton) {
        return;
      }
      cleanupButton.disabled = loading || cleaning || staleSessionCount === 0;
      cleanupButton.textContent = cleaning
        ? "Cleaning…"
        : staleSessionCount > 0
          ? `Clean ${formatCount(staleSessionCount)} stale`
          : "No stale sessions";
      cleanupButton.className = staleSessionCount > 0
        ? "system-resources-cleanup is-warning"
        : "system-resources-cleanup";
    }

    function renderSnapshot(snapshot: ResourceSnapshot) {
      options.renderContent(content, snapshot);
      staleSessionCount = Math.max(0, Number(snapshot.tmux?.staleSessionCount) || 0);
      updateCleanupButton();
      const date = new Date(snapshot.sampledAt || Date.now());
      sampledAt.textContent = `Updated ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      sampledAt.title = "";
      hasRenderedSnapshot = true;
    }

    async function refresh(force = false) {
      if (loading || disposed) {
        return;
      }
      loading = true;
      refreshButton.disabled = true;
      updateCleanupButton();
      refreshButton.textContent = hasRenderedSnapshot ? "Refreshing…" : "Measuring…";
      try {
        const snapshot = await loadSnapshot(force);
        if (disposed) {
          return;
        }
        renderSnapshot(snapshot);
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error);
          if (hasRenderedSnapshot) {
            sampledAt.title = message;
            sampledAt.textContent = `${sampledAt.textContent.replace(/ · Refresh failed$/, "")} · Refresh failed`;
          } else {
            content.replaceChildren(element(
              "p",
              "system-resources-empty system-resources-error",
              message
            ));
          }
        }
      } finally {
        loading = false;
        if (!disposed) {
          refreshButton.disabled = false;
          refreshButton.textContent = "Refresh";
          updateCleanupButton();
        }
      }
    }

    async function cleanupStaleSessions() {
      if (!cleanupButton || cleaning || loading || staleSessionCount === 0 || disposed) {
        return;
      }
      cleaning = true;
      updateCleanupButton();
      try {
        await globalScope.boatyard?.invokePlugin?.(
          "boatyard.systemResources",
          "cleanupStaleTmuxSessions",
          {}
        );
        cachedSnapshotAt = 0;
        await refresh(true);
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error);
          sampledAt.title = message;
          sampledAt.textContent = `${sampledAt.textContent.replace(/ · Cleanup failed$/, "")} · Cleanup failed`;
        }
      } finally {
        cleaning = false;
        updateCleanupButton();
      }
    }

    refreshButton.addEventListener("click", () => void refresh(true));
    cleanupButton?.addEventListener("click", () => void cleanupStaleSessions());
    const refreshInterval = globalScope.setInterval(() => void refresh(true), 60000);
    if (cachedSnapshot) {
      renderSnapshot(cachedSnapshot);
      if (Date.now() - cachedSnapshotAt >= SNAPSHOT_CACHE_MS) {
        void refresh(true);
      }
    } else {
      void refresh();
    }
    return () => {
      disposed = true;
      globalScope.clearInterval(refreshInterval);
    };
  }

  function renderSystemResources(container: HTMLElement, section: ResourceSection) {
    return renderResourcePane(container, {
      renderContent(content, snapshot) {
        renderSection(content, snapshot, section);
      },
      allowTmuxCleanup: section === "tmux",
      sectionId: section,
      ...SECTION_COPY[section]
    });
  }

  function renderProviderPane(container: HTMLElement, providerId: string) {
    const provider = listResourceProviders().find((candidate) => candidate.id === providerId);
    if (!provider) {
      container.replaceChildren(element(
        "p",
        "system-resources-empty system-resources-error",
        "Resource provider is unavailable."
      ));
      return;
    }

    return renderResourcePane(container, {
      renderContent(content, snapshot) {
        content.replaceChildren();
        if (snapshot.supported === false) {
          content.append(element("p", "system-resources-empty", snapshot.error || "Resource accounting is unavailable."));
          return;
        }
        provider.renderDetails(content, getProviderSnapshot(snapshot, provider.id), rendererUi);
      },
      sectionId: provider.sectionId,
      subtitle: provider.subtitle,
      title: provider.title
    });
  }

  function resolveNavigation() {
    return {
      items: [
        ...NAVIGATION_ITEMS.map((item) => ({ ...item })),
        ...listResourceProviders().map((provider) => ({
          id: provider.id,
          label: provider.label,
          webAppId: provider.paneId
        }))
      ],
      showAddressBar: false,
      showHomeButton: false
    };
  }

  registry.register(
    {
      id: "boatyard.systemResources",
      name: "System resources",
      version: "0.1.0"
    },
    {
      activate(ctx: PluginRegistryContext) {
        ctx.services.provide(SYSTEM_RESOURCES_SERVICE_ID, Object.freeze({
          renderProviderPane,
          resolveNavigation,
          version: "0.1.0"
        }) as PluginResourceRendererHost);

        for (const section of ["overview", "wcv", "tmux"] as ResourceSection[]) {
          ctx.panes.register({
            id: PANE_IDS[section],
            webAppId: PANE_IDS[section],
            key: section === "overview" ? "system-resources" : `system-resources-${section}`,
            title: "Resources",
            icon: "info",
            kind: "dom",
            parentLabel: section === "overview" ? "" : "Resources",
            parentWebAppId: section === "overview" ? "" : PANE_IDS.overview,
            resolveNavigation,
            scope: "global",
            showInMenu: section === "overview",
            render(container: HTMLElement) {
              return renderSystemResources(container, section);
            }
          });
        }

        globalScope.setTimeout?.(() => {
          void loadSnapshot().catch(() => undefined);
        }, 0);
      }
    }
  );
})(window);
