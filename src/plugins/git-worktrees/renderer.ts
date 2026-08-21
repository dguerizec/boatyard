"use strict";

(function registerGitWorktreesPlugin(globalScope: BoatyardPluginRendererGlobal) {
  type GitWorktreeProject = PluginRegistryRecord & {
    id?: unknown;
    sourcePath?: unknown;
  };

  type GitChange = {
    indexStatus?: string;
    kind?: "conflict" | "modified" | "staged" | "untracked";
    originalPath?: string;
    path?: string;
    staged?: boolean;
    workingTreeStatus?: string;
  };

  type ProjectGitStatus = {
    ahead?: number;
    behind?: number;
    branch?: string;
    changes?: GitChange[];
  };

  type GitPotentialConflict = {
    path?: string;
    peers?: string[];
  };

  type GitPotentialConflictError = {
    message?: string;
    peer?: string;
  };

  type ProjectGitWorktree = {
    branch?: string;
    current?: boolean;
    detached?: boolean;
    displayPath?: string;
    name?: string;
    path?: string;
    potentialConflictErrors?: GitPotentialConflictError[];
    potentialConflicts?: GitPotentialConflict[];
    primary?: boolean;
    status?: ProjectGitStatus | null;
    statusError?: string;
    usable?: boolean;
  };

  type ProjectGitWorkspace = {
    linkedCount?: number;
    totalChangeCount?: number;
    totalPotentialConflictCount?: number;
    worktrees?: ProjectGitWorktree[];
  };

  type GitWorktreesPluginContext = PluginRegistryRecord & {
    panes: {
      register(definition: Record<string, unknown>): void;
    };
    status: {
      set(status: unknown): void;
    };
    widgets: {
      register(definition: Record<string, unknown>): void;
    };
  };

  type GitSurfaceMode = "pane" | "widget";

  type GitSurfaceView = "conflicts" | "status";

  type GitSurface = {
    cleanup(): void;
    element: HTMLElement;
  };

  type GitWorkspacePaneProps = PluginRegistryRecord & {
    project?: GitWorktreeProject;
  };

  const registry = globalScope.BoatyardPluginRegistry;
  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || "Unknown error");
  }

  function invokePlugin(actionName: string, payload: Record<string, unknown> = {}) {
    return globalScope.boatyard?.invokePlugin?.("boatyard.gitWorktrees", actionName, payload);
  }

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

  function createBadge(label: string, tone = "default"): HTMLSpanElement {
    return element("span", `git-worktrees-badge is-${tone}`, label);
  }

  function getChangeCode(change: GitChange): string {
    if (change.kind === "untracked") {
      return "?";
    }
    const indexStatus = String(change.indexStatus || ".");
    const workingTreeStatus = String(change.workingTreeStatus || ".");
    return `${indexStatus === "." ? "" : indexStatus}${workingTreeStatus === "." ? "" : workingTreeStatus}` || "M";
  }

  function getChangeDescription(change: GitChange): string {
    if (change.kind === "conflict") {
      return "Merge conflict";
    }
    if (change.kind === "untracked") {
      return "Untracked";
    }
    if (change.kind === "staged") {
      return "Staged";
    }
    return change.staged ? "Staged and modified" : "Modified";
  }

  function createChangePath(pathValue: string): HTMLSpanElement {
    const pathElement = element("span", "git-changes-path");
    pathElement.setAttribute("aria-label", pathValue || "Unknown file");
    const separatorIndex = Math.max(pathValue.lastIndexOf("/"), pathValue.lastIndexOf("\\"));
    if (separatorIndex > 0) {
      pathElement.append(
        element("span", "git-changes-path-prefix", pathValue.slice(0, separatorIndex)),
        element("span", "git-changes-path-suffix", pathValue.slice(separatorIndex))
      );
    } else {
      pathElement.append(element(
        "span",
        "git-changes-path-suffix",
        pathValue || "Unknown file"
      ));
    }
    return pathElement;
  }

  function createChangeRow(
    change: GitChange,
    detail = "",
    description = getChangeDescription(change)
  ): HTMLButtonElement {
    const pathValue = String(change.path || "");
    const row = element("button", `git-changes-row is-${change.kind || "modified"}`);
    row.type = "button";
    row.title = pathValue ? `Copy ${pathValue}` : "No file path";
    row.disabled = !pathValue;

    const status = element("span", "git-changes-status", getChangeCode(change));
    status.title = description;
    status.setAttribute("aria-label", description);

    const identity = element("span", "git-changes-identity");
    identity.append(createChangePath(pathValue));
    if (change.originalPath) {
      identity.append(element("span", "git-changes-original-path", `from ${change.originalPath}`));
    }
    if (detail) {
      identity.append(element("span", "git-changes-original-path", detail));
    }

    row.append(status, identity);
    row.addEventListener("click", () => {
      if (pathValue) {
        void globalScope.boatyard?.writeClipboardText?.(pathValue);
      }
    });
    return row;
  }

  function createPotentialConflictRow(conflict: GitPotentialConflict): HTMLButtonElement {
    const peers = Array.isArray(conflict.peers)
      ? conflict.peers.map((peer) => String(peer)).filter(Boolean)
      : [];
    return createChangeRow(
      {
        indexStatus: "U",
        kind: "conflict",
        path: String(conflict.path || ""),
        staged: false,
        workingTreeStatus: "U"
      },
      peers.length ? `with ${peers.join(", ")}` : "",
      "Potential merge conflict"
    );
  }

  function getTrackingLabel(status: ProjectGitStatus | null | undefined): string {
    const ahead = Number(status?.ahead) || 0;
    const behind = Number(status?.behind) || 0;
    return [ahead ? `↑${ahead}` : "", behind ? `↓${behind}` : ""]
      .filter(Boolean)
      .join(" ");
  }

  function getExpansionStorageKey(project: GitWorktreeProject): string {
    return `boatyard:git-worktrees:expanded:${String(project.id || project.sourcePath || "project")}`;
  }

  function loadExpandedPaths(project: GitWorktreeProject): string[] | null {
    try {
      const stored = globalScope.localStorage?.getItem(getExpansionStorageKey(project));
      if (stored === null || stored === undefined) {
        return null;
      }
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.map((value) => String(value)).filter(Boolean) : null;
    } catch {
      return null;
    }
  }

  function saveExpandedPaths(project: GitWorktreeProject, paths: Set<string>): void {
    try {
      globalScope.localStorage?.setItem(getExpansionStorageKey(project), JSON.stringify([...paths]));
    } catch {
      // Keep the current surface usable when storage is unavailable.
    }
  }

  function createWorktreeRow(
    worktree: ProjectGitWorktree,
    expanded: boolean,
    view: GitSurfaceView,
    onExpandedChange: (path: string, expanded: boolean) => void
  ): HTMLElement {
    const pathValue = String(worktree.path || "");
    const changes = Array.isArray(worktree.status?.changes) ? worktree.status.changes : [];
    const potentialConflicts = Array.isArray(worktree.potentialConflicts)
      ? worktree.potentialConflicts
      : [];
    const potentialConflictErrors = Array.isArray(worktree.potentialConflictErrors)
      ? worktree.potentialConflictErrors
      : [];
    const displayedCount = view === "conflicts" ? potentialConflicts.length : changes.length;
    const row = element("section", "git-worktrees-row");
    row.classList.toggle("is-expanded", expanded);
    row.classList.toggle("is-unavailable", worktree.usable === false);

    const toggle = element("button", "git-worktrees-toggle");
    toggle.type = "button";
    toggle.disabled = !pathValue;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${worktree.name || "worktree"}`);

    const chevron = element("span", "git-worktrees-chevron", "›");
    chevron.setAttribute("aria-hidden", "true");
    const identity = element("span", "git-worktrees-identity");
    const heading = element("span", "git-worktrees-row-heading");
    heading.append(
      element("strong", "git-worktrees-name", worktree.name || "worktree"),
      element(
        "code",
        "git-worktrees-branch",
        worktree.status?.branch || worktree.branch || (worktree.detached ? "Detached HEAD" : "No branch")
      )
    );

    const badges = element("span", "git-worktrees-badges");
    if (worktree.current) {
      badges.append(createBadge("Current", "accent"));
    } else if (worktree.primary) {
      badges.append(createBadge("Primary"));
    }
    if (worktree.detached) {
      badges.append(createBadge("Detached", "warning"));
    }
    if (worktree.usable === false) {
      badges.append(createBadge("Prunable", "danger"));
    }
    heading.append(badges);
    identity.append(heading);

    const metrics = element("span", "git-worktrees-metrics");
    const tracking = getTrackingLabel(worktree.status);
    if (tracking) {
      metrics.append(element("span", "git-worktrees-tracking", tracking));
    }
    const countClass = view === "conflicts" && displayedCount
      ? " has-conflicts"
      : displayedCount ? " has-changes" : "";
    const changeCount = element(
      "span",
      `git-worktrees-change-count${countClass}`,
      String(displayedCount)
    );
    changeCount.setAttribute(
      "aria-label",
      view === "conflicts"
        ? `${displayedCount} potentially conflicting file${displayedCount === 1 ? "" : "s"}`
        : `${displayedCount} changed file${displayedCount === 1 ? "" : "s"}`
    );
    metrics.append(changeCount);
    toggle.append(chevron, identity, metrics);

    const details = element("div", "git-worktrees-details");
    details.hidden = !expanded;
    const displayPathValue = String(worktree.displayPath || "").trim() || pathValue;
    const pathButton = element("button", "git-worktrees-path", displayPathValue);
    pathButton.type = "button";
    pathButton.disabled = !pathValue;
    pathButton.title = pathValue ? `Copy ${pathValue}` : "No worktree path";
    pathButton.setAttribute("aria-label", pathValue ? `Copy worktree path ${pathValue}` : "No worktree path");
    pathButton.addEventListener("click", () => {
      if (pathValue) {
        void globalScope.boatyard?.writeClipboardText?.(pathValue);
      }
    });
    details.append(pathButton);

    if (view === "conflicts") {
      if (worktree.usable === false) {
        details.append(element(
          "p",
          "git-worktrees-state is-error",
          worktree.statusError || "Worktree is unavailable."
        ));
      } else if (worktree.detached || !worktree.branch) {
        details.append(element("p", "git-worktrees-state", "Detached HEAD is not compared."));
      } else if (!potentialConflicts.length && !potentialConflictErrors.length) {
        details.append(element(
          "p",
          "git-worktrees-state",
          "No potential conflicts with checked-out branches."
        ));
      } else {
        if (potentialConflicts.length) {
          const conflictList = element("div", "git-changes-list");
          conflictList.setAttribute(
            "aria-label",
            `${potentialConflicts.length} potentially conflicting file${potentialConflicts.length === 1 ? "" : "s"}`
          );
          conflictList.append(...potentialConflicts.map(createPotentialConflictRow));
          details.append(conflictList);
        }
        for (const error of potentialConflictErrors) {
          const peer = String(error.peer || "another checked-out branch");
          const message = String(error.message || "Potential conflict inspection failed.");
          details.append(element(
            "p",
            "git-worktrees-state is-error",
            `${peer}: ${message}`
          ));
        }
      }
    } else if (worktree.statusError) {
      details.append(element("p", "git-worktrees-state is-error", worktree.statusError));
    } else if (!changes.length) {
      details.append(element("p", "git-worktrees-state", "Working tree clean."));
    } else {
      const changeList = element("div", "git-changes-list");
      changeList.setAttribute("aria-label", `${changes.length} changed file${changes.length === 1 ? "" : "s"}`);
      changeList.append(...changes.map((change) => createChangeRow(change)));
      details.append(changeList);
    }

    toggle.addEventListener("click", () => {
      const nextExpanded = details.hidden === true;
      details.hidden = !nextExpanded;
      row.classList.toggle("is-expanded", nextExpanded);
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      toggle.setAttribute("aria-label", `${nextExpanded ? "Collapse" : "Expand"} ${worktree.name || "worktree"}`);
      onExpandedChange(pathValue, nextExpanded);
    });

    row.append(toggle, details);
    return row;
  }

  function createGitWorkspaceSurface(project: GitWorktreeProject, mode: GitSurfaceMode): GitSurface {
    const root = mode === "widget"
      ? element("article", "widget-card git-worktrees-widget")
      : element("div", "git-worktrees-pane");
    const content = element(
      "div",
      `${mode === "widget" ? "widget-content " : ""}git-worktrees-content is-${mode}`
    );
    const header = element("header", "git-worktrees-header");
    const title = element("div", "git-worktrees-title");
    title.append(
      element("h3", "", "Git"),
      element("span", "git-worktrees-count", "0"),
      element("span", "git-worktrees-total-changes", "0 changes")
    );

    const actions = element("div", "git-worktrees-actions");
    const conflictsButton = mode === "pane"
      ? element("button", "git-worktrees-conflicts-toggle", "Conflicts")
      : null;
    if (conflictsButton) {
      conflictsButton.type = "button";
      conflictsButton.title = "Show potential conflicts between checked-out branches";
      conflictsButton.setAttribute("aria-label", "Show potential conflicts between checked-out branches");
      conflictsButton.setAttribute("aria-pressed", "false");
      actions.append(conflictsButton);
    }

    const refreshButton = element("button", "git-worktrees-refresh", "↻");
    refreshButton.type = "button";
    refreshButton.title = "Refresh Git worktrees";
    refreshButton.setAttribute("aria-label", "Refresh Git worktrees");
    actions.append(refreshButton);
    header.append(title, actions);

    const summary = element("p", "git-worktrees-summary", "Loading Git worktrees.");
    const list = element("div", "git-worktrees-list");
    list.setAttribute("aria-live", "polite");
    content.append(header, summary, list);
    root.append(content);

    const storedExpandedPaths = loadExpandedPaths(project);
    const expandedPaths = new Set(storedExpandedPaths || []);
    let expansionInitialized = storedExpandedPaths !== null;
    let disposed = false;
    let loading = false;
    let loadQueued = false;
    let lastSnapshot = "";
    let hasConnected = root.isConnected;
    let view: GitSurfaceView = "status";

    function setExpanded(path: string, expanded: boolean): void {
      if (!path) {
        return;
      }
      if (expanded) {
        expandedPaths.add(path);
      } else {
        expandedPaths.delete(path);
      }
      saveExpandedPaths(project, expandedPaths);
    }

    async function load(queueIfBusy = false): Promise<void> {
      if (disposed) {
        return;
      }
      if (loading) {
        loadQueued = loadQueued || queueIfBusy;
        return;
      }
      loading = true;
      const requestedView = view;
      if (!list.children.length) {
        summary.hidden = false;
        summary.classList.remove("is-error");
        summary.textContent = "Loading Git worktrees.";
      }

      try {
        const payload: Record<string, unknown> = {
          sourcePath: project.sourcePath || ""
        };
        if (requestedView === "conflicts") {
          payload.includePotentialConflicts = true;
        }
        const snapshot = await invokePlugin(
          "snapshotForProject",
          payload
        ) as ProjectGitWorkspace | undefined;
        if (disposed || requestedView !== view) {
          return;
        }

        const signature = JSON.stringify(snapshot || {});
        if (signature === lastSnapshot) {
          return;
        }
        lastSnapshot = signature;

        const worktrees = Array.isArray(snapshot?.worktrees) ? snapshot.worktrees : [];
        if (!expansionInitialized) {
          const defaultWorktree = worktrees.find((worktree) => worktree.current) || worktrees[0];
          if (defaultWorktree?.path) {
            expandedPaths.add(defaultWorktree.path);
          }
          expansionInitialized = true;
          saveExpandedPaths(project, expandedPaths);
        }

        const worktreeCount = title.querySelector<HTMLElement>(".git-worktrees-count");
        if (worktreeCount) {
          worktreeCount.textContent = String(worktrees.length);
          worktreeCount.setAttribute("aria-label", `${worktrees.length} Git worktree${worktrees.length === 1 ? "" : "s"}`);
        }
        const totalChangeCount = requestedView === "conflicts"
          ? Number(snapshot?.totalPotentialConflictCount) || 0
          : Number(snapshot?.totalChangeCount) || 0;
        const totalChanges = title.querySelector<HTMLElement>(".git-worktrees-total-changes");
        if (totalChanges) {
          totalChanges.textContent = requestedView === "conflicts"
            ? `${totalChangeCount} potential conflict${totalChangeCount === 1 ? "" : "s"}`
            : `${totalChangeCount} change${totalChangeCount === 1 ? "" : "s"}`;
          totalChanges.classList.toggle("has-changes", requestedView === "status" && totalChangeCount > 0);
          totalChanges.classList.toggle("has-conflicts", requestedView === "conflicts" && totalChangeCount > 0);
        }

        list.replaceChildren(...worktrees.map((worktree) => createWorktreeRow(
          worktree,
          expandedPaths.has(String(worktree.path || "")),
          requestedView,
          setExpanded
        )));
        summary.classList.remove("is-error");
        summary.hidden = worktrees.length > 0;
        summary.textContent = worktrees.length ? "" : "No Git worktree found.";
        const linkedCount = Number(snapshot?.linkedCount) || 0;
        list.setAttribute(
          "aria-label",
          requestedView === "conflicts"
            ? `${worktrees.length} Git worktree${worktrees.length === 1 ? "" : "s"}, ${linkedCount} linked, ${totalChangeCount} potential conflict${totalChangeCount === 1 ? "" : "s"}`
            : `${worktrees.length} Git worktree${worktrees.length === 1 ? "" : "s"}, ${linkedCount} linked, ${totalChangeCount} changed file${totalChangeCount === 1 ? "" : "s"}`
        );
      } catch (error) {
        if (disposed || requestedView !== view) {
          return;
        }
        lastSnapshot = "";
        list.replaceChildren();
        summary.hidden = false;
        summary.classList.add("is-error");
        summary.textContent = getErrorMessage(error);
      } finally {
        loading = false;
        if (loadQueued && !disposed) {
          loadQueued = false;
          void load();
        }
      }
    }

    function cleanup(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      globalScope.clearInterval(refreshInterval);
    }

    refreshButton.addEventListener("click", () => {
      lastSnapshot = "";
      void load(true);
    });
    conflictsButton?.addEventListener("click", () => {
      view = view === "status" ? "conflicts" : "status";
      const showingConflicts = view === "conflicts";
      conflictsButton.setAttribute("aria-pressed", String(showingConflicts));
      conflictsButton.title = showingConflicts
        ? "Show Git status"
        : "Show potential conflicts between checked-out branches";
      conflictsButton.setAttribute(
        "aria-label",
        showingConflicts
          ? "Show Git status"
          : "Show potential conflicts between checked-out branches"
      );
      lastSnapshot = "";
      void load(true);
    });
    void load();
    const refreshInterval = globalScope.setInterval(() => {
      hasConnected = hasConnected || root.isConnected;
      if (hasConnected && !root.isConnected) {
        cleanup();
        return;
      }
      void load();
    }, mode === "pane" ? 2000 : 5000);

    return { cleanup, element: root };
  }

  function createGitWidget(project: GitWorktreeProject): HTMLElement {
    return createGitWorkspaceSurface(project, "widget").element;
  }

  function renderGitPane(container: HTMLElement, props: GitWorkspacePaneProps = {}): () => void {
    const surface = createGitWorkspaceSurface(props.project || {}, "pane");
    container.replaceChildren(surface.element);
    return surface.cleanup;
  }

  registry.register(
    {
      id: "boatyard.gitWorktrees",
      name: "Git",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        panes: ["boatyard.gitWorktrees.changes"],
        widgets: ["boatyard.gitWorktrees.list"]
      },
      permissions: [
        "pane:dom",
        "projectConfig:read",
        "widget:provide"
      ]
    },
    {
      activate(ctx: GitWorktreesPluginContext) {
        ctx.status.set({
          state: "ready",
          summary: "Git worktree and change inspection is available"
        });
        ctx.panes.register({
          id: "boatyard.gitWorktrees.changes",
          webAppId: "boatyard.gitWorktrees.changes",
          key: "git-changes",
          title: "Git",
          icon: "git",
          kind: "dom",
          scope: "project",
          isAvailable({ project }: { project?: GitWorktreeProject } = {}) {
            return Boolean(project?.sourcePath);
          },
          render: renderGitPane
        });
        ctx.widgets.register({
          id: "boatyard.gitWorktrees.list",
          name: "Git",
          title: "Git",
          scope: "project",
          category: "Developer tools",
          status: "stable",
          defaultVisible: false,
          description: "Lists the project's worktrees and their changed files directly from Git.",
          layout: {
            default: { columns: 4, rows: 3 },
            min: { columns: 3, rows: 2 }
          },
          createElement: createGitWidget
        });
      }
    }
  );
})(window);
