"use strict";

(function registerGitWorktreesPlugin(globalScope: BoatyardPluginRendererGlobal) {
  type GitWorktreeProject = PluginRegistryRecord & {
    id?: unknown;
    sourcePath?: unknown;
  };

  type ProjectGitWorktree = {
    branch?: string;
    current?: boolean;
    detached?: boolean;
    name?: string;
    path?: string;
    primary?: boolean;
    usable?: boolean;
  };

  type ProjectGitWorktrees = {
    linkedCount?: number;
    worktrees?: ProjectGitWorktree[];
  };

  type GitWorktreesPluginContext = PluginRegistryRecord & {
    status: {
      set(status: unknown): void;
    };
    widgets: {
      register(definition: Record<string, unknown>): void;
    };
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

  function createWorktreeRow(worktree: ProjectGitWorktree): HTMLDivElement {
    const row = element("div", "git-worktrees-row");
    row.classList.toggle("is-unavailable", worktree.usable === false);

    const identity = element("div", "git-worktrees-identity");
    const heading = element("div", "git-worktrees-row-heading");
    heading.append(
      element("strong", "git-worktrees-name", worktree.name || "worktree"),
      element(
        "code",
        "git-worktrees-branch",
        worktree.branch || (worktree.detached ? "Detached HEAD" : "No branch")
      )
    );
    const badges = element("div", "git-worktrees-badges");
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

    const pathValue = String(worktree.path || "");
    const pathButton = element("button", "git-worktrees-path", pathValue);
    pathButton.type = "button";
    pathButton.disabled = !pathValue;
    pathButton.title = pathValue ? `Copy ${pathValue}` : "No worktree path";
    pathButton.setAttribute("aria-label", pathValue ? `Copy worktree path ${pathValue}` : "No worktree path");
    pathButton.addEventListener("click", () => {
      if (pathValue) {
        void globalScope.boatyard?.writeClipboardText?.(pathValue);
      }
    });
    identity.append(heading, pathButton);
    row.append(identity);
    return row;
  }

  function createGitWorktreesWidget(project: GitWorktreeProject): HTMLElement {
    const card = element("article", "widget-card git-worktrees-widget");
    const content = element("div", "widget-content git-worktrees-content");
    const header = element("header", "git-worktrees-header");
    const title = element("div", "git-worktrees-title");
    title.append(
      element("h3", "", "Git worktrees"),
      element("span", "git-worktrees-count", "0")
    );

    const refreshButton = element("button", "git-worktrees-refresh", "↻");
    refreshButton.type = "button";
    refreshButton.title = "Refresh worktrees";
    refreshButton.setAttribute("aria-label", "Refresh worktrees");
    header.append(title, refreshButton);

    const summary = element("p", "git-worktrees-summary", "Loading.");
    const list = element("div", "git-worktrees-list");
    content.append(header, summary, list);
    card.append(content);

    async function load(): Promise<void> {
      if (!card.isConnected && card.parentElement) {
        return;
      }

      refreshButton.disabled = true;
      if (!list.children.length) {
        summary.hidden = false;
        summary.classList.remove("is-error");
        summary.textContent = "Loading.";
      }

      try {
        const snapshot = await invokePlugin("listForProject", {
          sourcePath: project.sourcePath || ""
        }) as ProjectGitWorktrees | undefined;
        const worktrees = Array.isArray(snapshot?.worktrees) ? snapshot.worktrees : [];
        const count = title.querySelector<HTMLElement>(".git-worktrees-count");
        if (count) {
          count.textContent = String(worktrees.length);
          count.setAttribute("aria-label", `${worktrees.length} Git worktree${worktrees.length === 1 ? "" : "s"}`);
        }
        list.replaceChildren(...worktrees.map(createWorktreeRow));
        summary.classList.remove("is-error");
        summary.hidden = worktrees.length > 0;
        summary.textContent = worktrees.length
          ? ""
          : "No Git worktree found.";
        const linkedCount = Number(snapshot?.linkedCount) || 0;
        list.setAttribute(
          "aria-label",
          `${worktrees.length} Git worktree${worktrees.length === 1 ? "" : "s"}, ${linkedCount} linked`
        );
      } catch (error) {
        list.replaceChildren();
        summary.hidden = false;
        summary.classList.add("is-error");
        summary.textContent = getErrorMessage(error);
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", () => {
      void load();
    });
    void load();
    const refreshInterval = globalScope.setInterval(() => {
      if (!card.isConnected) {
        globalScope.clearInterval(refreshInterval);
        return;
      }
      void load();
    }, 10000);

    return card;
  }

  registry.register(
    {
      id: "boatyard.gitWorktrees",
      name: "Git worktrees",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.gitWorktrees.list"]
      },
      permissions: [
        "projectConfig:read",
        "widget:provide"
      ]
    },
    {
      activate(ctx: GitWorktreesPluginContext) {
        ctx.status.set({
          state: "ready",
          summary: "Git worktree inspection is available"
        });
        ctx.widgets.register({
          id: "boatyard.gitWorktrees.list",
          name: "Git worktrees",
          title: "Git worktrees",
          scope: "project",
          category: "Developer tools",
          status: "stable",
          defaultVisible: false,
          description: "Lists the project's worktrees directly from Git.",
          layout: {
            default: { columns: 4, rows: 3 },
            min: { columns: 3, rows: 2 }
          },
          createElement: createGitWorktreesWidget
        });
      }
    }
  );
})(window);
