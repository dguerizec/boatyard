"use strict";

(function registerPierPlugin(globalScope: BoatyardPluginRendererGlobal) {
  type PierProject = PluginRegistryRecord & {
    id?: unknown;
    name?: unknown;
    slug?: unknown;
    sourcePath?: unknown;
  };

  type PierConfig = {
    pierApiUrl?: string;
    pierPreviewUrl?: string;
    pierProjectName?: string;
    pierUrl?: string;
    pierWorktreeDirectory?: string;
    pierWorktreePattern?: string;
  };

  type PierOptions = {
    globalPluginConfig?: PierConfig;
    openProjectWebApp?: (webAppId: string, url: string) => boolean;
    pluginConfig?: PierConfig;
  };

  type PierWorkload = {
    project?: string;
    running?: boolean;
    slug?: string;
    status?: string;
    url?: string;
    urls?: Array<{ default?: boolean; url?: string }>;
    worktreePath?: string;
  };

  type PierProjectEntry = {
    name?: string;
    repo_path?: string;
  };

  type PierWorktreePayload = {
    branchName?: string;
    force?: boolean;
    fromRef?: string;
    purge?: boolean;
    skipDown?: boolean;
    startAfterCreate?: boolean;
    worktreePath?: string;
  };

  type PierUrlRow = HTMLDivElement & {
    pierActionButton: HTMLButtonElement;
    pierEntry: PierWorkload;
    pierLink: HTMLAnchorElement;
    pierPathButton: HTMLButtonElement;
    pierPathText: HTMLSpanElement;
    pierProject: PierProject;
    pierRemoveButton: HTMLButtonElement;
  };
  type PierService = {
    createWorktree(project: PierProject, payload?: PierWorktreePayload): Promise<unknown> | undefined;
    down(workload: PierWorkload, options?: PierOptions): Promise<unknown>;
    listProjectWorkloads(project: PierProject, options?: PierOptions): Promise<PierWorkload[]>;
    openUrl(entry: PierWorkload | string, options?: PierOptions): unknown;
    removeWorktree(project: PierProject, payload?: PierWorktreePayload): Promise<unknown> | undefined;
    up(workload: PierWorkload, options?: PierOptions): Promise<unknown>;
  };
  type PierFieldContext = {
    project: PierProject;
  };
  type PierCoreFieldChangedEvent = {
    coreFields: PierProject;
    field: string;
    fields?: {
      setDefaultValue(key: string, value: string): void;
    };
  };
  type PierPluginContext = PluginRegistryRecord & {
    events: {
      on(eventName: string, callback: (event: unknown) => void): void;
    };
    panes: {
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
  const DEFAULT_PIER_URL = "http://pier.test";
  const DEFAULT_PIER_WORKTREE_PATTERN = "<repo>/worktrees/<worktree>";
  const workloadCacheByProject = new Map<string, PierWorkload[]>();

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

  function normalizePierWorkloadUrl(value: unknown): { default?: boolean; url?: string } {
    const source = isRecord(value) ? value : {};
    return {
      default: source.default === true,
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

  function isWorkloadRunning(workload: PierWorkload) {
    return ["running", "started"].includes(String(workload.status || "").toLowerCase());
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
    return pattern.replace(/\{(repo|project|worktree)\}|<(repo|project|worktree)>/g, (_match, bracedToken: keyof typeof tokens | undefined, angledToken: keyof typeof tokens | undefined) => (
      tokens[bracedToken || angledToken]
    ));
  }

  function isCurrentProjectWorktree(project: PierProject, entry: PierWorkload) {
    return entry?.slug === "main" || normalizePath(project?.sourcePath) === normalizePath(entry?.worktreePath);
  }

  function getDefaultPierProjectName(project: PierProject = {}) {
    return normalizeHostnameLabel(project.slug);
  }

  function getPierUrl(options: PierOptions = {}) {
    return normalizeApiUrl(options.globalPluginConfig?.pierUrl || options.globalPluginConfig?.pierApiUrl);
  }

  function getDefaultPreviewUrl(project: PierProject = {}) {
    const projectName = getDefaultPierProjectName(project);
    return projectName ? `${getPierUrl()}/#/projects/${encodeURIComponent(projectName)}` : "";
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

    if (
      previous !== JSON.stringify(next) &&
      typeof globalScope.dispatchEvent === "function" &&
      typeof globalScope.CustomEvent === "function"
    ) {
      globalScope.dispatchEvent(new globalScope.CustomEvent("boatyard:pier-workloads-changed", {
        detail: {
          projectId: project?.id || "",
          pierProjectName: next[0]?.project || ""
        }
      }));
    }
  }

  async function fetchPierJson(path: string, options: PierOptions = {}, fetchOptions: RequestInit = {}) {
    const response = await fetch(`${getPierApiUrl(options)}${path}`, fetchOptions);

    if (!response.ok) {
      throw new Error(`Pier API returned ${response.status}.`);
    }

    return response.json();
  }

  function normalizeWorktreeEntry(pierProjectName: string, worktree: unknown): PierWorkload {
    const source = isRecord(worktree) ? worktree : {};
    const workload = normalizePierWorkload(source.workload);
    return {
      project: workload.project || pierProjectName,
      slug: workload.slug || String(source.slug || source.branch || "main"),
      url: getDefaultWorkloadUrl(workload),
      worktreePath: String(source.path || workload.worktreePath || ""),
      status: workload.status || (source.has_workload ? "" : "stopped"),
      running: source.has_workload === true && isWorkloadRunning(workload)
    };
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

    if (!pierProjectName) {
      setCachedWorkloads(project, options, []);
      return [];
    }

    const worktreesResponse = await fetch(`${apiUrl}/api/v1/projects/${encodeURIComponent(pierProjectName)}/worktrees`);

    if (!worktreesResponse.ok) {
      throw new Error(`Pier worktrees API returned ${worktreesResponse.status}.`);
    }

    const worktrees = await worktreesResponse.json();
    const entries = (Array.isArray(worktrees) ? worktrees : [])
      .map((worktree) => normalizeWorktreeEntry(pierProjectName, worktree))
      .filter((entry): entry is PierWorkload => Boolean(entry.slug && entry.worktreePath));

    setCachedWorkloads(project, options, entries);
    return entries;
  }

  function listCachedProjectWorkloadWebApps(project: PierProject, options: PierOptions = {}) {
    return (workloadCacheByProject.get(getWorkloadCacheKey(project, options)) || [])
      .filter((entry: PierWorkload) => entry.running && entry.url)
      .map((entry) => ({
        id: `pier:${entry.slug}`,
        key: entry.slug,
        label: `Pier: ${entry.slug}`,
        url: entry.url,
        restoreUrl: false
      }));
  }

  function createPierService() {
    return Object.freeze({
      listProjectWorkloads,
      down(workload: PierWorkload, options: PierOptions = {}) {
        return fetchPierJson(
          `/api/v1/workloads/${encodeURIComponent(workload.project)}/${encodeURIComponent(workload.slug)}/down`,
          options,
          { method: "POST" }
        );
      },
      up(workload: PierWorkload, options: PierOptions = {}) {
        return fetchPierJson(
          `/api/v1/workloads/${encodeURIComponent(workload.project)}/${encodeURIComponent(workload.slug)}/up`,
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
      openUrl(entry: PierWorkload | string, options: PierOptions = {}) {
        const url = typeof entry === "string" ? entry : entry?.url;
        const slug = typeof entry === "string" ? "" : entry?.slug;
        const webAppId = slug ? `pier:${slug}` : "pier";

        if (typeof options.openProjectWebApp === "function" && options.openProjectWebApp(webAppId, url)) {
          return true;
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
    row.classList.toggle("stopped", !entry.running);
    row.pierLink.href = entry.url || "#";
    row.pierLink.textContent = entry.url || entry.slug;
    row.pierLink.title = entry.url || entry.slug;
    row.pierPathText.textContent = entry.worktreePath || "No worktree path";
    row.pierPathButton.title = entry.worktreePath ? `Copy ${entry.worktreePath}` : "";
    row.pierPathButton.disabled = !entry.worktreePath;
    row.pierActionButton.textContent = entry.running ? "Stop" : "Start";
    row.pierActionButton.classList.toggle("stop", entry.running);
    row.pierActionButton.classList.toggle("start", !entry.running);
    row.pierActionButton.disabled = false;
    row.pierRemoveButton.disabled = isCurrentProjectWorktree(row.pierProject, entry);
    row.pierRemoveButton.title = row.pierRemoveButton.disabled
      ? "The current project worktree cannot be removed from here."
      : `Remove ${entry.slug}`;
  }

  function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
  }

  function createPierUrlRow(props: PierOptions, service: PierService, onRefresh: () => Promise<unknown>, onError: (error: Error) => void): PierUrlRow {
    const link = document.createElement("a");
    link.className = "pier-url-link";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const entry = getClosestPierUrlRow(link)?.pierEntry || {};
      if (entry.url) {
        service.openUrl(entry, props);
      }
    });

    const pathButton = document.createElement("button");
    pathButton.className = "pier-path-button";
    pathButton.type = "button";
    const pathText = document.createElement("span");
    pathText.className = "pier-path-text";
    pathButton.append(pathText);
    pathButton.addEventListener("click", async () => {
      try {
        await copyText(getClosestPierUrlRow(pathButton)?.pierEntry.worktreePath || "");
      } catch (error) {
        onError(asError(error));
      }
    });

    const actionButton = document.createElement("button");
    actionButton.className = "pier-action-button";
    actionButton.type = "button";
    actionButton.addEventListener("click", async () => {
      const entry = getClosestPierUrlRow(actionButton)?.pierEntry || {};
      actionButton.disabled = true;
      actionButton.textContent = entry.running ? "Stopping" : "Starting";
      try {
        if (entry.running) {
          await service.down(entry, props);
        } else {
          await service.up(entry, props);
        }
        await onRefresh();
      } catch (error) {
        actionButton.disabled = false;
        actionButton.textContent = entry.running ? "Stop" : "Start";
        onError(asError(error));
      }
    });

    const removeButton = document.createElement("button");
    removeButton.className = "pier-remove-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      const row = getClosestPierUrlRow(removeButton);
      const entry = row?.pierEntry || {};
      if (!entry.worktreePath || removeButton.disabled) {
        return;
      }

      openPierRemoveWorktreeDialog(row.pierProject, entry, service, onRefresh, onError);
    });

    const row = Object.assign(document.createElement("div"), {
      pierActionButton: actionButton,
      pierEntry: {},
      pierLink: link,
      pierPathButton: pathButton,
      pierPathText: pathText,
      pierProject: {},
      pierRemoveButton: removeButton
    });
    row.className = "pier-url-row";
    row.append(link, pathButton, actionButton, removeButton);
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
      .map((row) => [row.dataset.key, row]));
    const nextKeys = new Set<string>();

    for (const entry of urls) {
      const key = getPierUrlRowKey(entry);
      nextKeys.add(key);
      const row = existingRows.get(key) || createPierUrlRow(props, service, onRefresh, onError);
      row.dataset.key = key;
      row.pierProject = project;
      updatePierUrlRow(row, entry);
      list.append(row);
    }

    for (const [key, row] of existingRows) {
      if (!nextKeys.has(key)) {
        row.remove();
      }
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
    pathCopy.textContent = entry.worktreePath;
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
    title.append(heading);

    const refreshButton = document.createElement("button");
    refreshButton.className = "pier-refresh-button";
    refreshButton.type = "button";
    refreshButton.textContent = "Refresh";

    const newButton = document.createElement("button");
    newButton.className = "pier-refresh-button";
    newButton.type = "button";
    newButton.textContent = "New";

    const headerActions = document.createElement("div");
    headerActions.className = "pier-widget-actions";
    headerActions.append(newButton, refreshButton);

    header.append(title, headerActions);

    const body = document.createElement("p");
    body.className = "pier-widget-status";
    body.textContent = "Loading.";

    content.append(header, body);

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
        body.hidden = urls.length > 0;
        body.textContent = urls.length ? "" : "No Pier worktree.";
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

  function syncProjectDefaults(event: PierCoreFieldChangedEvent) {
    if (!["slug", "devBranch"].includes(event.field)) {
      return;
    }

    const fields = event.fields;
    fields?.setDefaultValue("pierProjectName", getDefaultPierProjectName(event.coreFields));
    fields?.setDefaultValue("pierPreviewUrl", getDefaultPreviewUrl(event.coreFields));
  }

  registry.register(
    {
      id: "boatyard.pier",
      name: "Pier",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.pier.urls"],
        panes: ["boatyard.pier.preview"],
        globalSettings: ["boatyard.pier.global"],
        projectSettings: ["boatyard.pier.project"],
        services: ["boatyard.pier"]
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
      activate(ctx: PierPluginContext) {
        ctx.status.set({
          state: "ready",
          summary: "Pier integration is available"
        });
        const pierService = createPierService();
        ctx.services.provide("boatyard.pier", pierService);
        ctx.events.on("boatyard.projectForm.coreFieldChanged", syncProjectDefaults);

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
              placeholder: "http://pier.test/#/projects/project",
              defaultValue({ project }: PierFieldContext) {
                return getDefaultPreviewUrl(project);
              }
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
          name: "Pier URLs",
          title: "Pier URLs",
          scope: "project",
          category: "Project",
          status: "stable",
          defaultVisible: false,
          description: "Lists running Pier worktree URLs for the project.",
          layout: {
            default: { columns: 3, rows: 2 },
            min: { columns: 3, rows: 2 }
          },
          createElement: (project: PierProject, props: PierOptions) => createPierWidget(project, props, pierService)
        });
        ctx.widgets.registerAlias("project-preview", "boatyard.pier.urls");
        ctx.widgets.registerAlias("pier-urls", "boatyard.pier.urls");
      }
    }
  );
})(window);
