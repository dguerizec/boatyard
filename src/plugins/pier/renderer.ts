"use strict";

(function registerPierPlugin(globalScope: BoatyardPluginRendererGlobal) {
  const registry = globalScope.BoatyardPluginRegistry;
  const DEFAULT_PIER_URL = "http://pier.test";
  const DEFAULT_PIER_WORKTREE_PATTERN = "<repo>/worktrees/<worktree>";
  const ENABLED_ENTRY_POINTS_CONFIG_KEY = "pierEnabledEntryPoints";
  const PIER_RESOURCE_PANE_ID = "boatyard.pier.systemResources.pane";
  const PIER_RESOURCE_PROVIDER_ID = "boatyard.pier.systemResources";
  const SYSTEM_RESOURCES_PANE_ID = "boatyard.systemResources.pane";
  const SYSTEM_RESOURCES_SERVICE_ID = "boatyard.systemResources";
  const workloadCacheByProject = new Map<string, PierWorkload[]>();
  const selectedEntryPointsByProject = new Map<string, Set<string>>();

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function invokePlugin(actionName: string, payload: Record<string, unknown> = {}) {
    return globalScope.boatyard?.invokePlugin?.("boatyard.pier", actionName, payload);
  }

  function normalizePath(value: unknown) {
    return String(value || "").replace(/[/\\]+$/g, "");
  }

  function normalizeApiUrl(value: unknown) {
    return String(value || DEFAULT_PIER_URL).replace(/\/+$/g, "");
  }

  function pathsOverlap(left: string, right: string) {
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function normalizePierProjectEntry(value: unknown): PierProjectEntry {
    const source = isRecord(value) ? value : {};
    return {
      name: String(source.name || "").trim() || undefined,
      repo_path: String(source.repo_path || "").trim() || undefined
    };
  }

  function normalizePierWorkloadUrl(value: unknown): PierWorkloadUrl {
    const source = isRecord(value) ? value : {};
    return {
      default: source.default === true,
      label: String(source.label || "").trim() || undefined,
      url: String(source.url || "").trim() || undefined
    };
  }

  function normalizePierWorkload(value: unknown): PierWorkload {
    const source = isRecord(value) ? value : {};
    return {
      project: String(source.project || "").trim() || undefined,
      running: source.running === true,
      slug: String(source.slug || "").trim() || undefined,
      status: String(source.status || "").trim() || undefined,
      url: String(source.url || "").trim() || undefined,
      urls: Array.isArray(source.urls) ? source.urls.map(normalizePierWorkloadUrl) : undefined,
      worktreePath: String(source.worktreePath || source.worktree_path || "").trim() || undefined
    };
  }

  function findPierProject(project: PierProject, pierProjects: PierProjectEntry[], config: PierConfig = {}) {
    const configuredName = String(config.pierProjectName || "").trim();
    if (configuredName) {
      return pierProjects.find((candidate) => candidate.name === configuredName) || { name: configuredName };
    }

    const sourcePath = normalizePath(project.sourcePath);
    if (!sourcePath) {
      return null;
    }

    return pierProjects
      .filter((candidate) => {
        const repoPath = normalizePath(candidate.repo_path);
        return repoPath && pathsOverlap(sourcePath, repoPath);
      })
      .sort((left, right) => normalizePath(right.repo_path).length - normalizePath(left.repo_path).length)[0] || null;
  }

  function getDefaultWorkloadUrl(workload: PierWorkload) {
    const urls = Array.isArray(workload.urls) ? workload.urls : [];
    return urls.find((entry) => entry.default)?.url || urls[0]?.url || workload.url || "";
  }

  function getWorkloadUrlHostname(entry: PierWorkloadUrl = {}) {
    try {
      return new URL(entry.url || "").hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function normalizeEntryPointKey(value: unknown) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getWorkloadEntryPointKey(workload: PierWorkload, entry: PierWorkloadUrl) {
    if (entry.default) {
      return "default";
    }

    const hostname = getWorkloadUrlHostname(entry);
    const defaultHostname = getWorkloadUrlHostname(
      (workload.urls || []).find((candidate) => candidate.default)
    );
    if (hostname && defaultHostname && hostname.endsWith(`.${defaultHostname}`)) {
      return normalizeEntryPointKey(hostname.slice(0, -(defaultHostname.length + 1)));
    }

    const slug = normalizeHostnameLabel(workload.slug);
    const slugMarker = slug ? `.${slug}.` : "";
    const slugIndex = slugMarker ? hostname.indexOf(slugMarker) : -1;
    if (slugIndex > 0) {
      return normalizeEntryPointKey(hostname.slice(0, slugIndex));
    }

    return normalizeEntryPointKey(entry.label || hostname || entry.url);
  }

  function formatEntryPointLabel(key: string) {
    if (key === "default") {
      return "Default";
    }
    if (key === "api") {
      return "API";
    }
    if (key === "oauth-relay") {
      return "OAuth relay";
    }
    return key
      .replace(/[-_]+/g, " ")
      .replace(/^./, (character) => character.toUpperCase());
  }

  function listPierEntryPoints(workloads: PierWorkload[]) {
    const entryPoints = new Map<string, PierEntryPoint>();
    for (const workload of workloads) {
      for (const entry of workload.urls || []) {
        const key = getWorkloadEntryPointKey(workload, entry);
        if (!key || entryPoints.has(key)) {
          continue;
        }
        entryPoints.set(key, {
          default: entry.default === true,
          key,
          label: formatEntryPointLabel(key),
          title: entry.label || getWorkloadUrlHostname(entry) || entry.url || key
        });
      }
    }
    return [...entryPoints.values()];
  }

  function parseConfiguredEntryPoints(value: unknown): Set<string> | null {
    const serialized = String(value || "").trim();
    if (!serialized) {
      return null;
    }
    try {
      const parsed = JSON.parse(serialized);
      if (!Array.isArray(parsed)) {
        return null;
      }
      return new Set(parsed.map(normalizeEntryPointKey).filter(Boolean));
    } catch {
      return null;
    }
  }

  function getSelectedEntryPoints(project: PierProject, options: PierOptions, workloads: PierWorkload[]) {
    const cacheKey = getWorkloadCacheKey(project, options);
    const runtimeSelection = selectedEntryPointsByProject.get(cacheKey);
    if (runtimeSelection) {
      return new Set(runtimeSelection);
    }

    const configuredSelection = parseConfiguredEntryPoints(options.pluginConfig?.[ENABLED_ENTRY_POINTS_CONFIG_KEY]);
    if (configuredSelection) {
      selectedEntryPointsByProject.set(cacheKey, configuredSelection);
      return new Set(configuredSelection);
    }

    const entryPoints = listPierEntryPoints(workloads);
    const initialEntryPoint = entryPoints.find((entryPoint) => entryPoint.default) || entryPoints[0];
    return new Set(initialEntryPoint ? [initialEntryPoint.key] : []);
  }

  function isWorkloadRunning(workload: PierWorkload) {
    return ["running", "started"].includes(String(workload.status || "").toLowerCase());
  }

  function getContainerRuntimeState(value: unknown) {
    const source = isRecord(value) ? value : {};
    return {
      exitCode: typeof source.exit_code === "number" ? source.exit_code : undefined,
      health: String(source.health || "").trim().toLowerCase(),
      status: String(source.status || "").trim().toLowerCase()
    };
  }

  function getWorkloadIndicatorStatus(
    hasWorkload: boolean,
    workload: PierWorkload,
    source: Record<string, unknown>
  ): NonNullable<PierWorkload["indicatorStatus"]> {
    if (!hasWorkload) {
      return "stopped";
    }

    const containers = Array.isArray(source.containers)
      ? source.containers.map(getContainerRuntimeState)
      : [];
    const hasError = Boolean(String(source.error || "").trim()) ||
      source.worktree_missing === true ||
      containers.some((container) =>
        container.health === "unhealthy" ||
        container.status === "dead" ||
        (container.status === "exited" && container.exitCode !== 0)
      );
    if (hasError) {
      return "error";
    }

    const hasPendingContainer = containers.some((container) =>
      container.health === "starting" ||
      Boolean(container.status && !["running", "exited"].includes(container.status))
    );
    if (hasPendingContainer) {
      return "pending";
    }

    return isWorkloadRunning(workload) ? "running" : "stopped";
  }

  function normalizeHostnameLabel(value: unknown) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getPierWorktreePattern(options: PierOptions = {}) {
    const configuredPattern = String(options.globalPluginConfig?.pierWorktreePattern || "").trim();
    const legacyDirectory = String(options.globalPluginConfig?.pierWorktreeDirectory || "").trim();
    if (configuredPattern) {
      return configuredPattern;
    }
    if (legacyDirectory) {
      return `<repo>/${legacyDirectory.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/<worktree>`;
    }
    return DEFAULT_PIER_WORKTREE_PATTERN;
  }

  function getDefaultWorktreePath(project: PierProject = {}, branchName: unknown = "", options: PierOptions = {}) {
    const sourcePath = normalizePath(project.sourcePath);
    const branchSlug = normalizeHostnameLabel(branchName);
    if (!sourcePath || !branchSlug) {
      return "";
    }

    const projectSlug = normalizeHostnameLabel(project.slug) || normalizeHostnameLabel(project.name) || "project";
    const tokens = {
      repo: sourcePath,
      project: projectSlug,
      worktree: branchSlug
    };
    const pattern = getPierWorktreePattern(options);
    return pattern.replace(/\{(repo|project|worktree)\}|<(repo|project|worktree)>/g, (_match, bracedToken: keyof typeof tokens | undefined, angledToken: keyof typeof tokens | undefined) => {
      const token = bracedToken || angledToken;
      return token ? tokens[token] : "";
    });
  }

  function isProtectedProjectWorktree(project: PierProject, entry: PierWorkload) {
    return entry.primary === true || normalizePath(project?.sourcePath) === normalizePath(entry?.worktreePath);
  }

  function getDefaultPierProjectName(project: PierProject = {}) {
    return normalizeHostnameLabel(project.slug);
  }

  function getPierUrl(options: PierOptions = {}) {
    return normalizeApiUrl(options.globalPluginConfig?.pierUrl || options.globalPluginConfig?.pierApiUrl);
  }

  function getPierPaneUrl(project: PierProject = {}, options: PierOptions = {}) {
    const configuredUrl = String(options.pluginConfig?.pierPreviewUrl || "").trim();
    if (configuredUrl) {
      return configuredUrl;
    }

    const projectName = String(options.pluginConfig?.pierProjectName || "").trim() || getDefaultPierProjectName(project);
    return projectName ? `${getPierUrl(options)}/#/projects/${encodeURIComponent(projectName)}` : "";
  }

  function getPierApiUrl(options: PierOptions = {}) {
    return normalizeApiUrl(options.globalPluginConfig?.pierUrl || options.globalPluginConfig?.pierApiUrl);
  }

  function getWorkloadCacheKey(project: PierProject, options: PierOptions = {}) {
    return `${String(project?.id || project?.slug || "")}\u0000${String(options.pluginConfig?.pierProjectName || "")}`;
  }

  function setCachedWorkloads(project: PierProject, options: PierOptions, workloads: PierWorkload[]) {
    const key = getWorkloadCacheKey(project, options);
    const previous = JSON.stringify(workloadCacheByProject.get(key) || []);
    const next = Array.isArray(workloads) ? workloads : [];
    workloadCacheByProject.set(key, next);

    if (previous !== JSON.stringify(next)) {
      notifyPaneContributionsChanged(project, next);
    }
  }

  function notifyPaneContributionsChanged(project: PierProject, workloads: PierWorkload[]) {
    if (typeof globalScope.dispatchEvent !== "function" || typeof globalScope.CustomEvent !== "function") {
      return;
    }
    globalScope.dispatchEvent(new globalScope.CustomEvent("boatyard:pane-contributions-changed", {
      detail: {
        pluginId: "boatyard.pier",
        projectId: project?.id || "",
        pierProjectName: workloads[0]?.project || ""
      }
    }));
  }

  async function fetchPierJson(path: string, options: PierOptions = {}, fetchOptions: RequestInit = {}) {
    const response = await fetch(`${getPierApiUrl(options)}${path}`, fetchOptions);

    if (!response.ok) {
      throw new Error(`Pier API returned ${response.status}.`);
    }

    return response.json();
  }

  function normalizeWorktreeEntry(
    pierProjectName: string,
    pierProjectPath: string,
    worktree: unknown
  ): PierWorkload {
    const source = isRecord(worktree) ? worktree : {};
    const workloadSource = isRecord(source.workload) ? source.workload : {};
    const workload = normalizePierWorkload(workloadSource);
    const hasWorkload = source.has_workload === true;
    const defaultUrl = getDefaultWorkloadUrl(workload);
    const worktreePath = String(source.path || workload.worktreePath || "");
    const urls = workload.urls?.length
      ? workload.urls
      : defaultUrl ? [{ default: true, url: defaultUrl }] : undefined;
    return {
      hasWorkload,
      project: workload.project || pierProjectName,
      primary: Boolean(
        normalizePath(pierProjectPath) &&
        normalizePath(pierProjectPath) === normalizePath(worktreePath)
      ),
      slug: workload.slug || String(source.slug || source.branch || "main"),
      url: defaultUrl,
      worktreePath,
      status: workload.status || (source.has_workload ? "" : "stopped"),
      running: hasWorkload && isWorkloadRunning(workload),
      indicatorStatus: getWorkloadIndicatorStatus(hasWorkload, workload, workloadSource),
      urls
    };
  }

  function sortProjectWorkloads(workloads: PierWorkload[]) {
    return [...workloads].sort((left, right) => {
      if (left.primary !== right.primary) {
        return left.primary ? -1 : 1;
      }
      return String(left.slug || "").localeCompare(String(right.slug || ""), "en", {
        numeric: true,
        sensitivity: "base"
      });
    });
  }

  async function listProjectWorkloads(project: PierProject, options: PierOptions = {}) {
    const apiUrl = getPierApiUrl(options);
    const projectsResponse = await fetch(`${apiUrl}/api/v1/projects`);

    if (!projectsResponse.ok) {
      throw new Error(`Pier projects API returned ${projectsResponse.status}.`);
    }

    const pierProjects = await projectsResponse.json();
    const pierProjectEntries = Array.isArray(pierProjects) ? pierProjects.map(normalizePierProjectEntry) : [];
    const pierProject = findPierProject(project, pierProjectEntries, options.pluginConfig);
    const pierProjectName = pierProject?.name || "";
    const pierProjectPath = pierProject?.repo_path || "";

    if (!pierProjectName) {
      setCachedWorkloads(project, options, []);
      return [];
    }

    const worktreesResponse = await fetch(`${apiUrl}/api/v1/projects/${encodeURIComponent(pierProjectName)}/worktrees`);

    if (!worktreesResponse.ok) {
      throw new Error(`Pier worktrees API returned ${worktreesResponse.status}.`);
    }

    const worktrees = await worktreesResponse.json();
    const entries = sortProjectWorkloads((Array.isArray(worktrees) ? worktrees : [])
      .map((worktree) => normalizeWorktreeEntry(pierProjectName, pierProjectPath, worktree))
      .filter((entry): entry is PierWorkload => Boolean(entry.slug && entry.worktreePath)));

    setCachedWorkloads(project, options, entries);
    return entries;
  }

  function listCachedProjectWorkloadWebApps(project: PierProject, options: PierOptions = {}) {
    const workloads = workloadCacheByProject.get(getWorkloadCacheKey(project, options)) || [];
    const selectedEntryPoints = getSelectedEntryPoints(project, options, workloads);
    return workloads
      .filter((workload) => workload.running)
      .flatMap((workload) => {
        const seenEntryPoints = new Set<string>();
        return (workload.urls || [])
          .map((entry) => ({ entry, entryPointKey: getWorkloadEntryPointKey(workload, entry) }))
          .filter(({ entry, entryPointKey }) => {
            if (!entry.url || !selectedEntryPoints.has(entryPointKey) || seenEntryPoints.has(entryPointKey)) {
              return false;
            }
            seenEntryPoints.add(entryPointKey);
            return true;
          })
          .map(({ entry, entryPointKey }) => {
            const isDefault = entryPointKey === "default";
            return {
              id: isDefault ? `pier:${workload.slug}` : `pier:${workload.slug}:${entryPointKey}`,
              key: isDefault ? workload.slug : `${workload.slug}:${entryPointKey}`,
              label: isDefault
                ? `Pier: ${workload.slug}`
                : `Pier: ${workload.slug} · ${formatEntryPointLabel(entryPointKey)}`,
              url: entry.url,
              mobileDev: true,
              restoreUrl: false
            };
          });
      });
  }

  function createPierService() {
    async function getProjectAvailability(project: PierProject) {
      if (typeof globalScope.boatyard?.invokePlugin !== "function") {
        return { available: false, worktreePattern: "" };
      }
      try {
        const result = await invokePlugin("projectAvailability", {
          cwd: project?.sourcePath || ""
        });
        return {
          available: isRecord(result) && result.available === true,
          worktreePattern: isRecord(result) ? String(result.worktreePattern || "").trim() : ""
        };
      } catch {
        return { available: false, worktreePattern: "" };
      }
    }

    return Object.freeze({
      listProjectWorkloads,
      getDefaultWorktreePath,
      getProjectAvailability,
      async isProjectEnabled(project: PierProject) {
        return (await getProjectAvailability(project)).available;
      },
      down(workload: PierWorkload, options: PierOptions = {}) {
        return fetchPierJson(
          `/api/v1/workloads/${encodeURIComponent(workload.project || "")}/${encodeURIComponent(workload.slug || "")}/down`,
          options,
          { method: "POST" }
        );
      },
      up(workload: PierWorkload, options: PierOptions = {}) {
        return fetchPierJson(
          `/api/v1/workloads/${encodeURIComponent(workload.project || "")}/${encodeURIComponent(workload.slug || "")}/up`,
          options,
          {
            method: "POST",
            body: workload.worktreePath ? JSON.stringify({ worktree_path: workload.worktreePath }) : undefined,
            headers: workload.worktreePath ? { "Content-Type": "application/json" } : undefined
          }
        );
      },
      createWorktree(project: PierProject, payload: PierWorktreePayload = {}) {
        if (typeof globalScope.boatyard?.invokePlugin !== "function") {
          throw new Error("Plugin actions are unavailable.");
        }

        return invokePlugin("createWorktree", {
          cwd: project?.sourcePath || "",
          worktreePath: payload.worktreePath,
          branchName: payload.branchName,
          fromRef: payload.fromRef,
          startAfterCreate: payload.startAfterCreate
        });
      },
      removeWorktree(project: PierProject, payload: PierWorktreePayload = {}) {
        if (typeof globalScope.boatyard?.invokePlugin !== "function") {
          throw new Error("Plugin actions are unavailable.");
        }

        return invokePlugin("removeWorktree", {
          cwd: project?.sourcePath || "",
          worktreePath: payload.worktreePath,
          force: payload.force,
          purge: payload.purge,
          skipDown: payload.skipDown
        });
      },
      openUrl(entry: PierWorkload | string, options: PierOptions = {}, sourceElement?: Element) {
        const url = typeof entry === "string" ? entry : entry?.url;
        if (!url) {
          return false;
        }

        if (typeof options.openUrl === "function") {
          return options.openUrl(url, { sourceElement });
        }

        return globalScope.boatyard?.openExternal?.(url);
      }
    });
  }

  async function copyText(value: string) {
    if (globalScope.boatyard?.writeClipboardText) {
      await globalScope.boatyard.writeClipboardText(value);
      return;
    }

    await navigator.clipboard.writeText(value);
  }

  function getPierUrlRowKey(entry: PierWorkload) {
    return `${entry.project || ""}\u0000${entry.slug || ""}`;
  }

  function isPierUrlRow(element: Element | null): element is PierUrlRow {
    return Boolean(
      element instanceof HTMLDivElement &&
      element.classList.contains("pier-url-row") &&
      "pierEntry" in element
    );
  }

  function getClosestPierUrlRow(element: Element): PierUrlRow | null {
    const row = element.closest(".pier-url-row");
    return isPierUrlRow(row) ? row : null;
  }

  function updatePierUrlRow(row: PierUrlRow, entry: PierWorkload) {
    row.pierEntry = entry;
    const canOpenUrl = Boolean(entry.running && entry.url);
    const indicatorStatus = entry.indicatorStatus || (entry.running ? "running" : "stopped");
    row.classList.toggle("stopped", indicatorStatus === "stopped");
    row.classList.toggle("running", indicatorStatus === "running");
    row.classList.toggle("pending", indicatorStatus === "pending");
    row.classList.toggle("failed", indicatorStatus === "error");
    row.pierStatusDot.title = {
      error: "Error",
      pending: "Containers pending",
      running: "Running",
      stopped: "Stopped"
    }[indicatorStatus];
    row.pierStatusDot.setAttribute("aria-label", row.pierStatusDot.title);
    row.pierLink.textContent = entry.slug || entry.url || "";
    row.pierLink.title = canOpenUrl ? `Open ${entry.url}` : entry.slug || "";
    row.pierLink.disabled = !canOpenUrl;
    row.pierOpenUrlButton.disabled = !canOpenUrl;
    row.pierCopyUrlButton.disabled = !entry.url;
    row.pierCopyPathButton.disabled = !entry.worktreePath;
    row.pierMenuButton.title = `Actions for ${entry.slug || "worktree"}`;
    row.pierMenuButton.setAttribute("aria-label", row.pierMenuButton.title);
    const busy = row.dataset.busy === "true";
    const busyAction = row.dataset.busyAction;
    row.pierActionButton.textContent = busy
      ? busyAction === "down" ? "Stopping" : "Starting"
      : entry.running ? "Stop" : "Start";
    row.pierActionButton.classList.toggle("stop", entry.running);
    row.pierActionButton.classList.toggle("start", !entry.running);
    row.pierActionButton.disabled = busy;
    const canStopTrackedWorkload = entry.hasWorkload === true && !entry.running;
    row.pierStopButton.hidden = !canStopTrackedWorkload;
    row.pierStopButton.disabled = busy;
    row.pierStopButton.textContent = busy && busyAction === "down" ? "Stopping…" : "Stop workload";
    const protectedWorktree = isProtectedProjectWorktree(row.pierProject, entry);
    row.pierRemoveButton.hidden = protectedWorktree;
    row.pierMenuSeparator.hidden = protectedWorktree && !canStopTrackedWorkload;
    row.pierRemoveButton.title = protectedWorktree ? "" : `Remove ${entry.slug}`;
  }

  function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
  }

  function closePierRowMenu(menu: HTMLDivElement) {
    if (menu.matches(":popover-open")) {
      menu.hidePopover();
    }
  }

  async function runPierLifecycleAction(
    row: PierUrlRow,
    action: "down" | "up",
    props: PierOptions,
    service: PierService,
    onRefresh: () => Promise<unknown>,
    onError: (error: Error) => void
  ) {
    if (row.dataset.busy === "true") {
      return;
    }

    row.dataset.busy = "true";
    row.dataset.busyAction = action;
    updatePierUrlRow(row, row.pierEntry);
    try {
      if (action === "down") {
        await service.down(row.pierEntry, props);
      } else {
        await service.up(row.pierEntry, props);
      }
      delete row.dataset.busy;
      delete row.dataset.busyAction;
      await onRefresh();
    } catch (error) {
      delete row.dataset.busy;
      delete row.dataset.busyAction;
      updatePierUrlRow(row, row.pierEntry);
      onError(asError(error));
    }
  }

  function createPierUrlRow(props: PierOptions, service: PierService, onRefresh: () => Promise<unknown>, onError: (error: Error) => void): PierUrlRow {
    const statusDot = document.createElement("span");
    statusDot.className = "pier-status-dot";

    const link = document.createElement("button");
    link.className = "pier-url-link";
    link.type = "button";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const entry = getClosestPierUrlRow(link)?.pierEntry || {};
      if (entry.running && entry.url) {
        service.openUrl(entry, props, link);
      }
    });

    const identity = document.createElement("div");
    identity.className = "pier-worktree-identity";
    identity.append(statusDot, link);

    const actionButton = document.createElement("button");
    actionButton.className = "pier-action-button";
    actionButton.type = "button";
    actionButton.addEventListener("click", async () => {
      const row = getClosestPierUrlRow(actionButton);
      if (!row) {
        return;
      }
      await runPierLifecycleAction(
        row,
        row.pierEntry.running ? "down" : "up",
        props,
        service,
        onRefresh,
        onError
      );
    });

    const menu = document.createElement("div");
    menu.className = "pier-row-menu";
    menu.popover = "auto";
    menu.setAttribute("role", "menu");

    const openUrlButton = document.createElement("button");
    openUrlButton.className = "pier-row-menu-item";
    openUrlButton.type = "button";
    openUrlButton.setAttribute("role", "menuitem");
    openUrlButton.textContent = "Open URL";
    openUrlButton.addEventListener("click", () => {
      const entry = getClosestPierUrlRow(openUrlButton)?.pierEntry || {};
      closePierRowMenu(menu);
      if (entry.running && entry.url) {
        service.openUrl(entry, props, openUrlButton);
      }
    });

    const copyUrlButton = document.createElement("button");
    copyUrlButton.className = "pier-row-menu-item";
    copyUrlButton.type = "button";
    copyUrlButton.setAttribute("role", "menuitem");
    copyUrlButton.textContent = "Copy URL";
    copyUrlButton.addEventListener("click", async () => {
      closePierRowMenu(menu);
      try {
        await copyText(getClosestPierUrlRow(copyUrlButton)?.pierEntry.url || "");
      } catch (error) {
        onError(asError(error));
      }
    });

    const copyPathButton = document.createElement("button");
    copyPathButton.className = "pier-row-menu-item";
    copyPathButton.type = "button";
    copyPathButton.setAttribute("role", "menuitem");
    copyPathButton.textContent = "Copy worktree path";
    copyPathButton.addEventListener("click", async () => {
      closePierRowMenu(menu);
      try {
        await copyText(getClosestPierUrlRow(copyPathButton)?.pierEntry.worktreePath || "");
      } catch (error) {
        onError(asError(error));
      }
    });

    const menuSeparator = document.createElement("div");
    menuSeparator.className = "pier-row-menu-separator";
    menuSeparator.setAttribute("role", "separator");

    const stopButton = document.createElement("button");
    stopButton.className = "pier-row-menu-item danger";
    stopButton.type = "button";
    stopButton.setAttribute("role", "menuitem");
    stopButton.textContent = "Stop workload";
    stopButton.addEventListener("click", async () => {
      const row = getClosestPierUrlRow(stopButton);
      closePierRowMenu(menu);
      if (!row || row.pierEntry.hasWorkload !== true || row.pierEntry.running) {
        return;
      }
      await runPierLifecycleAction(row, "down", props, service, onRefresh, onError);
    });

    const removeButton = document.createElement("button");
    removeButton.className = "pier-row-menu-item danger";
    removeButton.type = "button";
    removeButton.setAttribute("role", "menuitem");
    removeButton.textContent = "Remove worktree…";
    removeButton.addEventListener("click", () => {
      const row = getClosestPierUrlRow(removeButton);
      const entry = row?.pierEntry || {};
      closePierRowMenu(menu);
      if (!row || !entry.worktreePath || removeButton.hidden) {
        return;
      }

      openPierRemoveWorktreeDialog(row.pierProject, entry, service, onRefresh, onError);
    });

    menu.append(openUrlButton, copyUrlButton, copyPathButton, menuSeparator, stopButton, removeButton);

    const menuButton = document.createElement("button");
    menuButton.className = "pier-menu-button";
    menuButton.type = "button";
    menuButton.textContent = "⋯";
    menuButton.setAttribute("aria-haspopup", "menu");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.popoverTargetElement = menu;
    menuButton.addEventListener("click", () => {
      if (menu.matches(":popover-open")) {
        return;
      }

      const rect = menuButton.getBoundingClientRect();
      const menuWidth = 210;
      menu.style.visibility = "hidden";
      menu.style.left = `${Math.round(Math.max(12, Math.min(rect.right - menuWidth, globalScope.innerWidth - menuWidth - 12)))}px`;
      menu.style.top = `${Math.round(Math.max(12, Math.min(rect.bottom + 6, globalScope.innerHeight - 190)))}px`;
    });
    let overlayRequest = 0;
    menu.addEventListener("toggle", () => {
      const request = ++overlayRequest;
      const isOpen = menu.matches(":popover-open");
      menuButton.setAttribute("aria-expanded", String(isOpen));

      if (!isOpen) {
        menu.style.visibility = "";
        void props.overlay?.restore().catch((error) => {
          console.error("Could not restore webapps after closing the Pier menu:", error);
        });
        return;
      }

      const revealMenu = () => {
        if (request !== overlayRequest || !menu.matches(":popover-open")) {
          return;
        }
        menu.style.visibility = "";
        menu.querySelector<HTMLButtonElement>("button:not([hidden]):not(:disabled)")?.focus();
      };
      if (!props.overlay) {
        revealMenu();
        return;
      }

      void props.overlay.freeze(menu, { margin: 8 }).then(revealMenu).catch((error) => {
        console.error("Could not freeze webapps below the Pier menu:", error);
        revealMenu();
      });
    });

    const row = Object.assign(document.createElement("div"), {
      pierActionButton: actionButton,
      pierCopyPathButton: copyPathButton,
      pierCopyUrlButton: copyUrlButton,
      pierEntry: {},
      pierLink: link,
      pierMenu: menu,
      pierMenuButton: menuButton,
      pierMenuSeparator: menuSeparator,
      pierOpenUrlButton: openUrlButton,
      pierProject: {},
      pierRemoveButton: removeButton,
      pierStatusDot: statusDot,
      pierStopButton: stopButton
    });
    row.className = "pier-url-row";
    row.append(identity, actionButton, menuButton, menu);
    return row;
  }

  function renderPierUrlRows(
    list: HTMLElement,
    urls: PierWorkload[],
    project: PierProject,
    props: PierOptions,
    service: PierService,
    onRefresh: () => Promise<unknown>,
    onError: (error: Error) => void
  ) {
    const existingRows = new Map([...list.querySelectorAll(".pier-url-row")]
      .filter(isPierUrlRow)
      .flatMap((row) => row.dataset.key ? [[row.dataset.key, row] as const] : []));
    const nextKeys = new Set<string>();
    const nextRows: PierUrlRow[] = [];

    for (const entry of urls) {
      const key = getPierUrlRowKey(entry);
      nextKeys.add(key);
      const row = existingRows.get(key) || createPierUrlRow(props, service, onRefresh, onError);
      row.dataset.key = key;
      row.pierProject = project;
      updatePierUrlRow(row, entry);
      nextRows.push(row);
    }

    const rowsAlreadyMountedInOrder = nextRows.length === list.children.length &&
      nextRows.every((row, index) => list.children[index] === row);
    if (!rowsAlreadyMountedInOrder) {
      list.append(...nextRows);
    }

    for (const [key, row] of existingRows) {
      if (!nextKeys.has(key)) {
        row.remove();
      }
    }
  }

  function serializeSelectedEntryPoints(selectedEntryPoints: Set<string>, workloads: PierWorkload[]) {
    const availableKeys = listPierEntryPoints(workloads).map((entryPoint) => entryPoint.key);
    const orderedSelection = [
      ...availableKeys.filter((key) => selectedEntryPoints.has(key)),
      ...[...selectedEntryPoints].filter((key) => !availableKeys.includes(key)).sort()
    ];
    return JSON.stringify(orderedSelection);
  }

  function renderPierEntryPointButtons(
    selector: HTMLElement,
    workloads: PierWorkload[],
    project: PierProject,
    props: PierOptions,
    onError: (error: Error) => void
  ) {
    const entryPoints = listPierEntryPoints(workloads);
    const selectedEntryPoints = getSelectedEntryPoints(project, props, workloads);
    selector.replaceChildren();
    selector.hidden = entryPoints.length === 0;

    const label = document.createElement("span");
    label.className = "pier-entry-point-label";
    label.textContent = "Tabs";
    selector.append(label);

    for (const entryPoint of entryPoints) {
      const button = document.createElement("button");
      const isSelected = selectedEntryPoints.has(entryPoint.key);
      button.className = "pier-entry-point-button";
      button.type = "button";
      button.textContent = entryPoint.label;
      button.title = `${isSelected ? "Hide" : "Show"} ${entryPoint.title} in pane tabs`;
      button.setAttribute("aria-pressed", String(isSelected));
      button.addEventListener("click", async () => {
        const previousSelection = getSelectedEntryPoints(project, props, workloads);
        const nextSelection = new Set(previousSelection);
        if (nextSelection.has(entryPoint.key)) {
          nextSelection.delete(entryPoint.key);
        } else {
          nextSelection.add(entryPoint.key);
        }

        const cacheKey = getWorkloadCacheKey(project, props);
        const serializedSelection = serializeSelectedEntryPoints(nextSelection, workloads);
        const previousSerializedSelection = props.pluginConfig?.[ENABLED_ENTRY_POINTS_CONFIG_KEY];
        selectedEntryPointsByProject.set(cacheKey, nextSelection);
        selector.querySelectorAll<HTMLButtonElement>(".pier-entry-point-button")
          .forEach((candidate) => { candidate.disabled = true; });
        notifyPaneContributionsChanged(project, workloads);

        try {
          const projectId = String(project.id || "").trim();
          if (projectId && typeof globalScope.boatyard?.updateProjectPluginConfig === "function") {
            await globalScope.boatyard.updateProjectPluginConfig(projectId, "boatyard.pier", {
              [ENABLED_ENTRY_POINTS_CONFIG_KEY]: serializedSelection
            });
          }
          props.pluginConfig = {
            ...props.pluginConfig,
            [ENABLED_ENTRY_POINTS_CONFIG_KEY]: serializedSelection
          };
        } catch (error) {
          selectedEntryPointsByProject.set(cacheKey, previousSelection);
          props.pluginConfig = {
            ...props.pluginConfig,
            [ENABLED_ENTRY_POINTS_CONFIG_KEY]: previousSerializedSelection
          };
          notifyPaneContributionsChanged(project, workloads);
          onError(asError(error));
        } finally {
          renderPierEntryPointButtons(selector, workloads, project, props, onError);
        }
      });
      selector.append(button);
    }
  }

  function createPierDialog(titleText: string) {
    const dialog = document.createElement("dialog");
    dialog.className = "plugin-settings-dialog pier-worktree-dialog";

    const form = document.createElement("form");
    form.className = "plugin-settings-dialog-panel";

    const header = document.createElement("header");
    header.className = "plugin-settings-dialog-header";

    const title = document.createElement("h3");
    title.textContent = titleText;

    const closeButton = document.createElement("button");
    closeButton.className = "icon-button";
    closeButton.type = "button";
    closeButton.title = "Close";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.textContent = "X";
    closeButton.addEventListener("click", () => dialog.close());

    header.append(title, closeButton);
    form.append(header);
    dialog.append(form);
    dialog.addEventListener("close", () => dialog.remove());
    return { dialog, form };
  }

  function createField(labelText: string, input: HTMLInputElement) {
    const label = document.createElement("label");
    label.className = "field";
    const labelCopy = document.createElement("span");
    labelCopy.textContent = labelText;
    label.append(labelCopy, input);
    return label;
  }

  function createCheckbox(labelText: string, input: HTMLInputElement) {
    const label = document.createElement("label");
    label.className = "pier-checkbox-field";
    const copy = document.createElement("span");
    copy.textContent = labelText;
    label.append(input, copy);
    return label;
  }

  function createSwitch(labelText: string, input: HTMLInputElement) {
    const label = document.createElement("label");
    label.className = "switch-row pier-switch-row";

    const copy = document.createElement("span");
    copy.className = "switch-copy";
    const title = document.createElement("strong");
    title.textContent = labelText;
    copy.append(title);

    const switchTrack = document.createElement("span");
    switchTrack.className = "switch-track";
    switchTrack.setAttribute("aria-hidden", "true");

    label.append(copy, input, switchTrack);
    return label;
  }

  function createDialogError() {
    const error = document.createElement("p");
    error.className = "form-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    return error;
  }

  function setDialogError(error: HTMLElement, message: string) {
    error.textContent = message || "";
    error.hidden = !message;
  }

  function showPierDialog(dialog: HTMLDialogElement, focusTarget?: HTMLElement) {
    if (typeof globalScope.BoatyardOverlayDialog?.show === "function") {
      void globalScope.BoatyardOverlayDialog.show(dialog, {
        freeze: "overlap",
        freezeMargin: 16
      }).then((shown) => {
        if (shown) {
          focusTarget?.focus();
        }
      });
      return;
    }

    document.body.append(dialog);
    dialog.showModal();
    requestAnimationFrame(() => focusTarget?.focus());
  }

  function openPierCreateWorktreeDialog(
    project: PierProject,
    props: PierOptions,
    service: PierService,
    onRefresh: () => Promise<unknown>,
    onError: (error: Error) => void
  ) {
    const { dialog, form } = createPierDialog("New Pier worktree");

    const branchInput = document.createElement("input");
    branchInput.name = "branchName";
    branchInput.type = "text";
    branchInput.autocomplete = "off";
    branchInput.required = true;
    branchInput.placeholder = "feature-branch";

    const pathInput = document.createElement("input");
    pathInput.name = "worktreePath";
    pathInput.type = "text";
    pathInput.autocomplete = "off";
    pathInput.required = true;
    pathInput.placeholder = "/workspace/project/worktrees/feature-branch";

    const fromInput = document.createElement("input");
    fromInput.name = "fromRef";
    fromInput.type = "text";
    fromInput.autocomplete = "off";
    fromInput.placeholder = "main";

    const startInput = document.createElement("input");
    startInput.name = "startAfterCreate";
    startInput.type = "checkbox";
    startInput.checked = true;

    const error = createDialogError();

    const actions = document.createElement("div");
    actions.className = "form-actions";

    const cancelButton = document.createElement("button");
    cancelButton.className = "secondary-button";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => dialog.close());

    const submitButton = document.createElement("button");
    submitButton.className = "primary-button";
    submitButton.type = "submit";
    submitButton.textContent = "Create worktree";

    let pathEdited = false;
    branchInput.addEventListener("input", () => {
      if (!pathEdited) {
        pathInput.value = getDefaultWorktreePath(project, branchInput.value, props);
      }
    });
    pathInput.addEventListener("input", () => {
      pathEdited = true;
    });

    actions.append(cancelButton, submitButton);
    form.append(
      createField("Branch name", branchInput),
      createField("Worktree path", pathInput),
      createField("From ref", fromInput),
      createSwitch("Start after creation", startInput),
      error,
      actions
    );
    form.addEventListener("submit", async (event: SubmitEvent) => {
      event.preventDefault();
      setDialogError(error, "");
      submitButton.disabled = true;
      submitButton.textContent = "Creating";
      try {
        await service.createWorktree(project, {
          branchName: branchInput.value,
          worktreePath: pathInput.value,
          fromRef: fromInput.value,
          startAfterCreate: startInput.checked
        });
        dialog.close();
        await onRefresh();
      } catch (createError) {
        const normalizedError = asError(createError);
        setDialogError(error, normalizedError.message);
        onError(normalizedError);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Create worktree";
      }
    });

    showPierDialog(dialog, branchInput);
  }

  function openPierRemoveWorktreeDialog(
    project: PierProject,
    entry: PierWorkload,
    service: PierService,
    onRefresh: () => Promise<unknown>,
    onError: (error: Error) => void
  ) {
    const { dialog, form } = createPierDialog("Remove Pier worktree");

    const confirmation = document.createElement("div");
    confirmation.className = "danger-confirmation";
    const copy = document.createElement("p");
    copy.textContent = `This stops the workload and removes the "${entry.slug}" worktree directory. The Boatyard project entry is not removed.`;
    const pathCopy = document.createElement("code");
    pathCopy.textContent = entry.worktreePath || "";
    confirmation.append(copy, pathCopy);

    const purgeInput = document.createElement("input");
    purgeInput.name = "purge";
    purgeInput.type = "checkbox";

    const forceInput = document.createElement("input");
    forceInput.name = "force";
    forceInput.type = "checkbox";

    const error = createDialogError();

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
    submitButton.textContent = "Remove worktree";

    actions.append(cancelButton, submitButton);
    form.append(
      confirmation,
      createCheckbox("Purge snapshots", purgeInput),
      createCheckbox("Force removal", forceInput),
      error,
      actions
    );
    form.addEventListener("submit", async (event: SubmitEvent) => {
      event.preventDefault();
      setDialogError(error, "");
      submitButton.disabled = true;
      submitButton.textContent = "Removing";
      try {
        await service.removeWorktree(project, {
          worktreePath: entry.worktreePath,
          purge: purgeInput.checked,
          force: forceInput.checked
        });
        dialog.close();
        await onRefresh();
      } catch (removeError) {
        const normalizedError = asError(removeError);
        setDialogError(error, normalizedError.message);
        onError(normalizedError);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Remove worktree";
      }
    });

    showPierDialog(dialog, submitButton);
  }

  function createPierWidget(project: PierProject, props: PierOptions = {}, service: PierService) {
    const card = document.createElement("article");
    card.className = "widget-card pier-widget-card";

    const content = document.createElement("div");
    content.className = "widget-content pier-widget-content";

    const header = document.createElement("div");
    header.className = "pier-widget-header";

    const title = document.createElement("div");
    title.className = "pier-widget-title";
    const heading = document.createElement("h3");
    heading.textContent = "Pier";
    const workloadCount = document.createElement("span");
    workloadCount.className = "pier-workload-count";
    workloadCount.textContent = "0";
    workloadCount.setAttribute("aria-label", "0 worktrees");
    title.append(heading, workloadCount);

    const refreshButton = document.createElement("button");
    refreshButton.className = "pier-icon-button pier-refresh-button";
    refreshButton.type = "button";
    refreshButton.textContent = "↻";
    refreshButton.title = "Refresh now";
    refreshButton.setAttribute("aria-label", "Refresh now");

    const newButton = document.createElement("button");
    newButton.className = "pier-icon-button";
    newButton.type = "button";
    newButton.textContent = "+";
    newButton.title = "Create a worktree";
    newButton.setAttribute("aria-label", "Create a worktree");

    const headerActions = document.createElement("div");
    headerActions.className = "pier-widget-actions";
    headerActions.append(newButton, refreshButton);

    header.append(title, headerActions);

    const body = document.createElement("p");
    body.className = "pier-widget-status";
    body.textContent = "Loading.";

    const entryPointSelector = document.createElement("div");
    entryPointSelector.className = "pier-entry-point-selector";
    entryPointSelector.setAttribute("role", "group");
    entryPointSelector.setAttribute("aria-label", "Pier pane entry points");
    entryPointSelector.hidden = true;

    content.append(header, entryPointSelector, body);

    const list = document.createElement("div");
    list.className = "pier-url-list";
    content.append(list);

    async function load() {
      if (!card.isConnected && card.parentElement) {
        return;
      }

      refreshButton.disabled = true;
      if (!list.children.length) {
        body.hidden = false;
        body.textContent = "Loading.";
      }

      try {
        const urls = await service.listProjectWorkloads(project, props);
        workloadCount.textContent = String(urls.length);
        workloadCount.setAttribute("aria-label", `${urls.length} worktree${urls.length === 1 ? "" : "s"}`);
        body.hidden = urls.length > 0;
        body.textContent = urls.length ? "" : "No Pier worktree.";
        renderPierEntryPointButtons(entryPointSelector, urls, project, props, (error: Error) => {
          body.hidden = false;
          body.textContent = error.message;
        });
        renderPierUrlRows(list, urls, project, props, service, load, (error: Error) => {
          body.hidden = false;
          body.textContent = error.message;
        });
      } catch (error) {
        body.hidden = false;
        body.textContent = asError(error).message;
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", () => {
      load();
    });
    newButton.addEventListener("click", () => {
      openPierCreateWorktreeDialog(project, props, service, load, (error: Error) => {
        body.hidden = false;
        body.textContent = error.message;
      });
    });

    load();
    const refreshInterval = globalScope.setInterval(() => {
      if (!card.isConnected) {
        globalScope.clearInterval(refreshInterval);
        return;
      }

      load();
    }, 10000);

    card.append(content);
    return card;
  }

  function getPierResourceSnapshot(providerSnapshot: PluginManagedResourceSnapshot | undefined): PierResourceSnapshot {
    return isRecord(providerSnapshot?.data) ? providerSnapshot.data as PierResourceSnapshot : {};
  }

  function createPierResourceWorkloadRow(
    ui: PluginResourceRendererUi,
    workload: PierResourceWorkload,
    project: PierResourceProject
  ) {
    const projectName = project.projectName || project.pierProject || "Project";
    const workloadName = workload.slug || "main";
    return ui.createResourceItem({
      badges: [{
        label: `${ui.formatCount(workload.containerCount)} ${Number(workload.containerCount) === 1 ? "container" : "containers"}`,
        tone: "success"
      }],
      metrics: [{ label: "Memory", value: ui.formatMemory(workload.memoryBytes) }],
      share: {
        label: `${workloadName} memory share within ${projectName}`,
        total: project.memoryBytes,
        unitLabel: "memory",
        value: workload.memoryBytes
      },
      title: workloadName
    });
  }

  function renderPierResourceOverview(
    providerSnapshot: PluginManagedResourceSnapshot | undefined,
    ui: PluginResourceRendererUi
  ) {
    const snapshot = getPierResourceSnapshot(providerSnapshot);
    const card = ui.createCard("Pier", ui.formatCount(snapshot.workloads?.length), "running workloads");
    card.stats.append(
      ui.createStat("Container memory", ui.formatMemory(snapshot.memoryBytes), "Docker cgroup usage"),
      ui.createStat("Containers", ui.formatCount(snapshot.containerCount))
    );
    if (snapshot.workloads?.length) {
      const list = ui.element("div", "system-resources-workloads");
      for (const workload of snapshot.workloads) {
        const row = ui.element("div", "system-resources-workload");
        const identity = ui.element("div", "system-resources-workload-identity");
        identity.append(
          ui.element("strong", "", `${workload.project || "Pier"} / ${workload.slug || "main"}`),
          ui.element("small", "", `${ui.formatCount(workload.containerCount)} containers`)
        );
        row.append(
          identity,
          ui.element("strong", "system-resources-workload-memory", ui.formatMemory(workload.memoryBytes))
        );
        list.append(row);
      }
      card.card.append(list);
    }
    if (snapshot.errors?.length) {
      card.card.append(ui.element(
        "p",
        "system-resources-note",
        `${ui.formatCount(snapshot.errors.length)} project lookups unavailable. Open the Pier tab for details.`
      ));
    }
    ui.addError(card.card, providerSnapshot?.error || snapshot.error);
    return card.card;
  }

  function renderPierResourceDetails(
    content: HTMLElement,
    providerSnapshot: PluginManagedResourceSnapshot | undefined,
    ui: PluginResourceRendererUi
  ) {
    const snapshot = getPierResourceSnapshot(providerSnapshot);
    const projects = (snapshot.projects || [])
      .filter((project) => (project.workloads || []).length > 0)
      .sort((left, right) => (
        (Number(right.memoryBytes) || 0) - (Number(left.memoryBytes) || 0) ||
        String(left.projectName || "").localeCompare(String(right.projectName || ""))
      ));
    const summary = ui.element("div", "system-resources-detail-summary");
    summary.append(
      ui.createStat("Running workloads", ui.formatCount(snapshot.workloads?.length)),
      ui.createStat("Containers", ui.formatCount(snapshot.containerCount)),
      ui.createStat("Container memory", ui.formatMemory(snapshot.memoryBytes), "Docker cgroup usage")
    );
    content.append(summary);
    const list = ui.createResourceList();
    for (const [projectIndex, project] of projects.entries()) {
      const workloads = [...(project.workloads || [])].sort((left, right) => (
        (Number(right.memoryBytes) || 0) - (Number(left.memoryBytes) || 0) ||
        String(left.slug || "").localeCompare(String(right.slug || ""))
      ));
      const detail = ui.createResourceGroup({
        metrics: [
          { label: "Memory", value: ui.formatMemory(project.memoryBytes) },
          { label: "Workloads", tone: "count", value: ui.formatCount(workloads.length) },
          { label: "Containers", tone: "count", value: ui.formatCount(project.containerCount) }
        ],
        share: {
          label: `${project.projectName || "Project"} share of Pier container memory`,
          total: snapshot.memoryBytes,
          unitLabel: "memory",
          value: project.memoryBytes
        },
        stateKey: `pier:${project.pierProject || project.projectName || projectIndex}`,
        subtitle: `Pier project: ${project.pierProject || "unassigned"}`,
        title: project.projectName || "Project"
      });
      for (const workload of workloads) {
        detail.rows.append(createPierResourceWorkloadRow(ui, workload, project));
      }
      ui.addError(detail.rows, project.error);
      list.append(detail.group);
    }
    if (projects.length) {
      content.append(list);
    }
    for (const error of snapshot.errors || []) {
      const prefix = error.projectName ? `${error.projectName}: ` : "";
      ui.addError(content, `${prefix}${error.message || "Could not inspect this Pier project."}`);
    }
    if (!projects.length) {
      content.append(ui.element("p", "system-resources-empty", "No Pier workload is currently running."));
    }
    ui.addError(content, providerSnapshot?.error || snapshot.error);
  }

  function createPierResourceRendererProvider() {
    return Object.freeze({
      id: PIER_RESOURCE_PROVIDER_ID,
      kind: "boatyard.resourceProvider",
      label: "Pier",
      order: 300,
      paneId: PIER_RESOURCE_PANE_ID,
      renderDetails: renderPierResourceDetails,
      renderOverview: renderPierResourceOverview,
      sectionId: "pier",
      subtitle: "Running workloads and container memory by project",
      title: "Pier"
    });
  }

  function getSystemResourcesService(): PluginResourceRendererHost | null {
    return registry.getService<PluginResourceRendererHost>(SYSTEM_RESOURCES_SERVICE_ID);
  }

  function renderPierResourcePane(container: HTMLElement) {
    const service = getSystemResourcesService();
    if (!service) {
      const message = document.createElement("p");
      message.className = "system-resources-empty system-resources-error";
      message.textContent = "System resources are unavailable.";
      container.replaceChildren(message);
      return;
    }
    return service.renderProviderPane(container, PIER_RESOURCE_PROVIDER_ID);
  }

  function resolveSystemResourcesNavigation() {
    return getSystemResourcesService()?.resolveNavigation() || null;
  }

  function syncProjectDefaults(event: PierCoreFieldChangedEvent) {
    if (!["slug", "devBranch"].includes(event.field)) {
      return;
    }

    const fields = event.fields;
    fields?.setDefaultValue("pierProjectName", getDefaultPierProjectName(event.coreFields));
  }

  registry.register(
    {
      id: "boatyard.pier",
      name: "Pier",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.pier.urls"],
        panes: ["boatyard.pier.preview", PIER_RESOURCE_PANE_ID],
        globalSettings: ["boatyard.pier.global"],
        projectSettings: ["boatyard.pier.project"],
        services: ["boatyard.pier", PIER_RESOURCE_PROVIDER_ID]
      },
      permissions: [
        "projectConfig:read",
        "projectConfig:write",
        "pane:dom",
        "pane:wcv",
        "widget:provide",
        "service:provide"
      ]
    },
    {
      activate(ctx: PierPluginContext) {
        ctx.status.set({
          state: "ready",
          summary: "Pier integration is available"
        });
        const pierService = createPierService();
        ctx.services.provide("boatyard.pier", pierService);
        ctx.services.provide(PIER_RESOURCE_PROVIDER_ID, createPierResourceRendererProvider());
        ctx.events.on("boatyard.projectForm.coreFieldChanged", syncProjectDefaults);

        ctx.panes.register({
          id: PIER_RESOURCE_PANE_ID,
          webAppId: PIER_RESOURCE_PANE_ID,
          key: "pier-system-resources",
          title: "Resources",
          icon: "info",
          kind: "dom",
          parentLabel: "Resources",
          parentWebAppId: SYSTEM_RESOURCES_PANE_ID,
          resolveNavigation: resolveSystemResourcesNavigation,
          scope: "global",
          showInMenu: false,
          render: renderPierResourcePane
        });

        ctx.settings.registerGlobalSection({
          id: "boatyard.pier.global",
          title: "Pier",
          fields: [
            {
              key: "pierUrl",
              label: "Pier URL",
              type: "text",
              valueType: "url",
              placeholder: DEFAULT_PIER_URL
            },
            {
              key: "pierWorktreePattern",
              label: "Worktree path pattern",
              type: "text",
              placeholder: DEFAULT_PIER_WORKTREE_PATTERN,
              description: "Tokens: <repo> is the project source path, <project> is the project slug, and <worktree> is the worktree slug. Example: <repo>/../<project>-<worktree>."
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "boatyard.pier.project",
          title: "Pier",
          fields: [
            {
              key: "pierPreviewUrl",
              label: "Pier pane URL override",
              type: "text",
              valueType: "url",
              placeholder: "Optional custom Pier pane URL"
            },
            {
              key: "pierProjectName",
              label: "Pier project",
              type: "text",
              placeholder: "project",
              defaultValue({ project }: PierFieldContext) {
                return getDefaultPierProjectName(project);
              }
            }
          ]
        });

        ctx.panes.register({
          id: "boatyard.pier.preview",
          webAppId: "pier",
          key: "pier",
          title: "Pier",
          kind: "wcv",
          scope: "project",
          resolveUrl({ project, projectConfig, globalPluginConfig }: PluginPaneResolveContext) {
            return getPierPaneUrl(project || {}, {
              pluginConfig: projectConfig,
              globalPluginConfig
            });
          },
          resolveWebApps({ project, projectConfig, globalPluginConfig }: PluginPaneResolveContext) {
            return [
              {
                id: "pier",
                key: "dashboard",
                label: "Pier",
                url: getPierPaneUrl(project || {}, {
                  pluginConfig: projectConfig,
                  globalPluginConfig
                }),
                restoreUrl: false
              },
              ...listCachedProjectWorkloadWebApps(project || {}, {
                pluginConfig: projectConfig,
                globalPluginConfig
              })
            ];
          }
        });

        ctx.widgets.register({
          id: "boatyard.pier.urls",
          name: "Pier",
          title: "Pier",
          scope: "project",
          category: "Project",
          status: "stable",
          defaultVisible: false,
          description: "Manages Pier worktree URLs and lifecycle actions.",
          layout: {
            default: { columns: 4, rows: 4 },
            min: { columns: 3, rows: 3 }
          },
          createElement: (project: PierProject, props: PierOptions) => createPierWidget(project, props, pierService)
        });
        ctx.widgets.registerAlias("project-preview", "boatyard.pier.urls");
        ctx.widgets.registerAlias("pier-urls", "boatyard.pier.urls");
      }
    }
  );
})(window);
