"use strict";

(function registerGitHubPlugin(globalScope: BoatyardPluginRendererGlobal) {
  type GitHubProject = PluginRegistryRecord & {
    gitUrl?: string;
    id?: string;
    name?: string;
    repoUrl?: string;
    slug?: string;
  };

  type GitHubStatus = {
    state: string;
    summary: string;
    details?: {
      authenticated?: boolean;
      host?: string;
      owner?: string;
      repo?: string;
    };
  };

  type GitHubWorkflowStep = {
    completedAt: string;
    conclusion: string;
    name: string;
    number: number;
    startedAt: string;
    status: string;
  };

  type GitHubWorkflowJob = {
    completedAt: string;
    conclusion: string;
    htmlUrl: string;
    id: number;
    labels: string[];
    name: string;
    runnerName: string;
    startedAt: string;
    status: string;
    steps: GitHubWorkflowStep[];
  };

  type GitHubWorkflowRun = {
    actorLogin: string;
    conclusion: string;
    createdAt: string;
    displayTitle: string;
    event: string;
    headBranch: string;
    headSha: string;
    htmlUrl: string;
    id: number;
    jobs: GitHubWorkflowJob[];
    name: string;
    runAttempt: number;
    startedAt: string;
    status: string;
    updatedAt: string;
  };

  type GitHubActionsSnapshot = {
    activeRunCount: number;
    refreshedAt: string;
    repository: {
      host: string;
      owner: string;
      repo: string;
    } | null;
    runs: GitHubWorkflowRun[];
    status: GitHubStatus;
  };

  type GitHubPullRequestCiState = "blocked" | "failed" | "none" | "passed" | "running";
  type GitHubPullRequestMergeState = "blocked" | "clean" | "conflicting" | "unknown";
  type GitHubPullRequestReviewState = "approved" | "changesRequested" | "none" | "required";
  type GitHubPullRequestFilter = "all" | "authored" | "changesRequested" | "ready" | "reviewRequested";

  type GitHubPullRequest = {
    authorLogin: string;
    baseRefName: string;
    checks: Array<{
      conclusion: string;
      name: string;
      status: string;
      url: string;
    }>;
    ciState: GitHubPullRequestCiState;
    headRefName: string;
    isAuthoredByViewer: boolean;
    isDraft: boolean;
    isReadyToMerge: boolean;
    isReviewRequestedFromViewer: boolean;
    mergeState: GitHubPullRequestMergeState;
    number: number;
    reviewState: GitHubPullRequestReviewState;
    title: string;
    updatedAt: string;
    url: string;
  };

  type GitHubPullRequestsSnapshot = {
    pullRequests: GitHubPullRequest[];
    refreshedAt: string;
    repository: GitHubActionsSnapshot["repository"];
    status: GitHubStatus;
    viewerLogin: string;
  };

  type GitHubConfig = {
    githubProjectStatusPriority?: string;
  };

  type GitHubProjectStatusCategory = "workflowRunning" | "pullRequest" | "workflowResult";

  type GitHubProjectStatusSignal = {
    category: GitHubProjectStatusCategory;
    className: string;
    label: string;
    url: string;
  };

  type GitHubWorkflowNotificationState = {
    displayedRunningRuns: Set<string>;
    pendingResult: GitHubProjectStatusSignal | null;
  };

  type RefreshState<TSnapshot> = {
    error: string;
    loading: boolean;
    snapshot: TSnapshot | null;
    stale: boolean;
  };

  type RefreshSubscriber<TSnapshot> = {
    isAlive: () => boolean;
    listener: (state: RefreshState<TSnapshot>) => void;
  };

  type RefreshEntry<TSnapshot> = {
    error: string;
    failureCount: number;
    inFlight: Promise<void> | null;
    loading: boolean;
    project: GitHubProject;
    rerunForced: boolean;
    snapshot: TSnapshot | null;
    stale: boolean;
    subscribers: Set<RefreshSubscriber<TSnapshot>>;
    timer: number | null;
  };

  type RefreshCoordinator<TSnapshot> = {
    subscribe(
      project: GitHubProject,
      listener: RefreshSubscriber<TSnapshot>["listener"],
      isAlive: RefreshSubscriber<TSnapshot>["isAlive"]
    ): {
      refresh(force?: boolean): Promise<void>;
      unsubscribe(): void;
    };
  };

  type StatusPresentation = {
    icon: string;
    label: string;
    tone: string;
  };

  const registry = globalScope.BoatyardPluginRegistry;
  const ACTIONS_ACTIVE_REFRESH_MS = 5000;
  const ACTIONS_IDLE_REFRESH_MS = 30000;
  const PULL_REQUESTS_REFRESH_MS = 30000;
  const MAX_BACKOFF_MS = 5 * 60 * 1000;
  const GITHUB_PROJECT_STATUS_PRIORITY_DEFAULT = "workflowRunning,pullRequest,workflowResult";
  const GITHUB_PROJECT_STATUS_PRIORITY_OPTIONS = [
    {
      value: "workflowRunning,pullRequest,workflowResult",
      label: "Running workflow > Pull request > Workflow result"
    },
    {
      value: "workflowRunning,workflowResult,pullRequest",
      label: "Running workflow > Workflow result > Pull request"
    },
    {
      value: "pullRequest,workflowRunning,workflowResult",
      label: "Pull request > Running workflow > Workflow result"
    },
    {
      value: "pullRequest,workflowResult,workflowRunning",
      label: "Pull request > Workflow result > Running workflow"
    },
    {
      value: "workflowResult,workflowRunning,pullRequest",
      label: "Workflow result > Running workflow > Pull request"
    },
    {
      value: "workflowResult,pullRequest,workflowRunning",
      label: "Workflow result > Pull request > Running workflow"
    }
  ];
  const workflowNotificationStates = new Map<string, GitHubWorkflowNotificationState>();
  let selectedProjectKey: string | null = null;

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function invokePlugin(actionName: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (!globalScope.boatyard?.invokePlugin) {
      return Promise.reject(new Error("Plugin action bridge is unavailable."));
    }
    return globalScope.boatyard.invokePlugin("boatyard.github", actionName, payload);
  }

  function getErrorMessage(error: unknown): string {
    if (
      error
      && typeof error === "object"
      && "message" in error
      && typeof error.message === "string"
    ) {
      return error.message;
    }
    return String(error || "GitHub request failed.");
  }

  function isRecord(value: unknown): value is PluginRegistryRecord {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function asActionsSnapshot(value: unknown): GitHubActionsSnapshot {
    if (!isRecord(value) || !isRecord(value.status) || !Array.isArray(value.runs)) {
      throw new Error("GitHub returned an invalid Actions snapshot.");
    }
    return value as GitHubActionsSnapshot;
  }

  function asPullRequestsSnapshot(value: unknown): GitHubPullRequestsSnapshot {
    if (!isRecord(value) || !isRecord(value.status) || !Array.isArray(value.pullRequests)) {
      throw new Error("GitHub returned an invalid pull request snapshot.");
    }
    return value as GitHubPullRequestsSnapshot;
  }

  function getProjectKey(project: GitHubProject): string {
    return [
      project.id,
      project.repoUrl,
      project.gitUrl,
      project.slug
    ].map((value) => String(value || "").trim()).join("\u0000");
  }

  function createProjectRefreshCoordinator<TSnapshot>({
    actionName,
    getRefreshInterval,
    normalize
  }: {
    actionName: string;
    getRefreshInterval: (snapshot: TSnapshot | null) => number;
    normalize: (value: unknown) => TSnapshot;
  }): RefreshCoordinator<TSnapshot> {
    const entries = new Map<string, RefreshEntry<TSnapshot>>();

    function stateFor(entry: RefreshEntry<TSnapshot>): RefreshState<TSnapshot> {
      return {
        error: entry.error,
        loading: entry.loading,
        snapshot: entry.snapshot,
        stale: entry.stale
      };
    }

    function prune(entry: RefreshEntry<TSnapshot>): void {
      for (const subscriber of entry.subscribers) {
        if (!subscriber.isAlive()) {
          entry.subscribers.delete(subscriber);
        }
      }
    }

    function notify(entry: RefreshEntry<TSnapshot>): void {
      prune(entry);
      const state = stateFor(entry);
      for (const subscriber of entry.subscribers) {
        subscriber.listener(state);
      }
    }

    function clearTimer(entry: RefreshEntry<TSnapshot>): void {
      if (entry.timer !== null) {
        globalScope.clearTimeout(entry.timer);
        entry.timer = null;
      }
    }

    function removeIfUnused(key: string, entry: RefreshEntry<TSnapshot>): void {
      prune(entry);
      if (!entry.subscribers.size && !entry.inFlight) {
        clearTimer(entry);
        entries.delete(key);
      }
    }

    function schedule(key: string, entry: RefreshEntry<TSnapshot>): void {
      clearTimer(entry);
      prune(entry);
      if (!entry.subscribers.size) {
        removeIfUnused(key, entry);
        return;
      }

      const baseInterval = getRefreshInterval(entry.snapshot);
      const backoffMultiplier = entry.failureCount
        ? Math.min(16, 2 ** entry.failureCount)
        : 1;
      const interval = Math.min(MAX_BACKOFF_MS, baseInterval * backoffMultiplier);
      entry.timer = globalScope.setTimeout(() => {
        entry.timer = null;
        void refresh(key, entry);
      }, interval);
    }

    async function refresh(
      key: string,
      entry: RefreshEntry<TSnapshot>,
      force = false
    ): Promise<void> {
      prune(entry);
      if (!entry.subscribers.size) {
        removeIfUnused(key, entry);
        return;
      }
      if (entry.inFlight) {
        entry.rerunForced ||= force;
        return entry.inFlight;
      }

      clearTimer(entry);
      entry.loading = true;
      notify(entry);

      const request = (async () => {
        try {
          const result = await invokePlugin(actionName, {
            force,
            project: entry.project
          });
          entry.snapshot = normalize(result);
          entry.error = "";
          entry.failureCount = 0;
          entry.stale = false;
        } catch (error) {
          entry.error = getErrorMessage(error);
          entry.failureCount += 1;
          entry.stale = !!entry.snapshot;
        } finally {
          entry.loading = false;
        }
      })();
      entry.inFlight = request;
      await request;
      entry.inFlight = null;
      notify(entry);

      if (entry.rerunForced && entry.subscribers.size) {
        entry.rerunForced = false;
        await refresh(key, entry, true);
        return;
      }
      schedule(key, entry);
    }

    function subscribe(
      project: GitHubProject,
      listener: RefreshSubscriber<TSnapshot>["listener"],
      isAlive: RefreshSubscriber<TSnapshot>["isAlive"]
    ) {
      const key = getProjectKey(project);
      let entry = entries.get(key);
      if (!entry) {
        entry = {
          error: "",
          failureCount: 0,
          inFlight: null,
          loading: false,
          project,
          rerunForced: false,
          snapshot: null,
          stale: false,
          subscribers: new Set(),
          timer: null
        };
        entries.set(key, entry);
      } else {
        entry.project = project;
      }

      const subscriber = { isAlive, listener };
      entry.subscribers.add(subscriber);
      listener(stateFor(entry));
      if (!entry.inFlight && entry.timer === null) {
        queueMicrotask(() => {
          if (entry) {
            void refresh(key, entry);
          }
        });
      }

      return {
        refresh(force = false) {
          return entry ? refresh(key, entry, force) : Promise.resolve();
        },
        unsubscribe() {
          if (!entry) {
            return;
          }
          entry.subscribers.delete(subscriber);
          removeIfUnused(key, entry);
        }
      };
    }

    return Object.freeze({ subscribe });
  }

  function isActiveWorkflowStatus(status: string): boolean {
    return ["in_progress", "pending", "queued", "requested", "waiting"].includes(status);
  }

  function getWorkflowRunKey(run: GitHubWorkflowRun): string {
    return `${run.id}:${run.runAttempt}`;
  }

  function getWorkflowNotificationState(projectKey: string): GitHubWorkflowNotificationState {
    let state = workflowNotificationStates.get(projectKey);
    if (!state) {
      state = {
        displayedRunningRuns: new Set(),
        pendingResult: null
      };
      workflowNotificationStates.set(projectKey, state);
    }
    return state;
  }

  function createWorkflowResultSignal(run: GitHubWorkflowRun): GitHubProjectStatusSignal | null {
    const failedConclusions = ["action_required", "failure", "startup_failure", "timed_out"];
    const className = run.conclusion === "success"
      ? "workflow-success"
      : failedConclusions.includes(run.conclusion)
        ? "workflow-failure"
        : "";
    if (!className) {
      return null;
    }
    return {
      category: "workflowResult",
      className,
      label: className === "workflow-success"
        ? `Workflow passed: ${run.name}`
        : `Workflow failed: ${run.name}`,
      url: run.htmlUrl
    };
  }

  function observeWorkflowTransitions(
    projectKey: string,
    snapshot: GitHubActionsSnapshot | null
  ): GitHubWorkflowNotificationState {
    const state = getWorkflowNotificationState(projectKey);
    if (snapshot?.status.state !== "ready") {
      return state;
    }

    const runsByKey = new Map(snapshot.runs.map((run) => [getWorkflowRunKey(run), run]));
    const completedRun = snapshot.runs.find((run) => (
      state.displayedRunningRuns.has(getWorkflowRunKey(run))
      && !isActiveWorkflowStatus(run.status)
    ));
    const result = completedRun ? createWorkflowResultSignal(completedRun) : null;
    if (result) {
      state.pendingResult = result;
    }

    for (const runKey of state.displayedRunningRuns) {
      const run = runsByKey.get(runKey);
      if (!run || !isActiveWorkflowStatus(run.status)) {
        state.displayedRunningRuns.delete(runKey);
      }
    }
    return state;
  }

  function rememberDisplayedRunningWorkflows(
    state: GitHubWorkflowNotificationState,
    snapshot: GitHubActionsSnapshot | null
  ): void {
    if (snapshot?.status.state !== "ready") {
      return;
    }
    for (const run of snapshot.runs) {
      if (isActiveWorkflowStatus(run.status)) {
        state.displayedRunningRuns.add(getWorkflowRunKey(run));
      }
    }
  }

  function observeProjectSelection(
    projectKey: string,
    isActiveProject = false,
    currentView = ""
  ): void {
    if (currentView !== "project" && currentView !== "project-edit") {
      selectedProjectKey = null;
      return;
    }
    if (!isActiveProject || selectedProjectKey === projectKey) {
      return;
    }
    selectedProjectKey = projectKey;
    const state = workflowNotificationStates.get(projectKey);
    if (state) {
      state.pendingResult = null;
    }
  }

  const actionsCoordinator = createProjectRefreshCoordinator<GitHubActionsSnapshot>({
    actionName: "actionsSnapshotForProject",
    normalize: asActionsSnapshot,
    getRefreshInterval(snapshot) {
      return snapshot?.activeRunCount
        ? ACTIONS_ACTIVE_REFRESH_MS
        : ACTIONS_IDLE_REFRESH_MS;
    }
  });

  const pullRequestsCoordinator = createProjectRefreshCoordinator<GitHubPullRequestsSnapshot>({
    actionName: "pullRequestsSnapshotForProject",
    normalize: asPullRequestsSnapshot,
    getRefreshInterval() {
      return PULL_REQUESTS_REFRESH_MS;
    }
  });

  function getProjectStatusPriority(value: unknown): GitHubProjectStatusCategory[] {
    const categories: GitHubProjectStatusCategory[] = [
      "workflowRunning",
      "pullRequest",
      "workflowResult"
    ];
    const requested = String(value || "")
      .split(",")
      .map((category) => category.trim())
      .filter((category): category is GitHubProjectStatusCategory => (
        categories.includes(category as GitHubProjectStatusCategory)
      ));

    return requested.length === categories.length && new Set(requested).size === categories.length
      ? requested
      : GITHUB_PROJECT_STATUS_PRIORITY_DEFAULT.split(",") as GitHubProjectStatusCategory[];
  }

  function getPullRequestsUrl(snapshot: GitHubPullRequestsSnapshot): string {
    const repository = snapshot.repository;
    return repository
      ? `https://${repository.host}/${repository.owner}/${repository.repo}/pulls`
      : "";
  }

  function getProjectStatusSignals(
    actionsSnapshot: GitHubActionsSnapshot | null,
    pullRequestsSnapshot: GitHubPullRequestsSnapshot | null,
    workflowResult: GitHubProjectStatusSignal | null = null
  ): Map<GitHubProjectStatusCategory, GitHubProjectStatusSignal> {
    const signals = new Map<GitHubProjectStatusCategory, GitHubProjectStatusSignal>();
    const activeRuns = actionsSnapshot?.status.state === "ready"
      ? actionsSnapshot.runs.filter((run) => isActiveWorkflowStatus(run.status))
      : [];
    if (activeRuns.length) {
      signals.set("workflowRunning", {
        category: "workflowRunning",
        className: "workflow-running",
        label: activeRuns.length === 1
          ? `Workflow running: ${activeRuns[0].name}`
          : `${activeRuns.length} workflows running`,
        url: activeRuns[0].htmlUrl
      });
    }

    const pullRequests = pullRequestsSnapshot?.status.state === "ready"
      ? pullRequestsSnapshot.pullRequests
      : [];
    const nonDraftPullRequests = pullRequests.filter((pullRequest) => !pullRequest.isDraft);
    const displayedPullRequests = nonDraftPullRequests.length ? nonDraftPullRequests : pullRequests;
    if (displayedPullRequests.length) {
      const draftsOnly = !nonDraftPullRequests.length;
      const directUrl = displayedPullRequests.length === 1
        ? displayedPullRequests[0].url
        : getPullRequestsUrl(pullRequestsSnapshot as GitHubPullRequestsSnapshot);
      signals.set("pullRequest", {
        category: "pullRequest",
        className: draftsOnly ? "pull-request-draft" : "pull-request",
        label: displayedPullRequests.length === 1
          ? `${draftsOnly ? "Draft pull request" : "Pull request"}: ${displayedPullRequests[0].title}`
          : `${displayedPullRequests.length} ${draftsOnly ? "draft " : ""}pull requests`,
        url: directUrl
      });
    }

    if (workflowResult) {
      signals.set("workflowResult", workflowResult);
    }

    return signals;
  }

  function createProjectStatusBadge(
    project: GitHubProject,
    globalConfig: GitHubConfig = {},
    options: Pick<PluginProjectNavBadgeRenderContext, "currentView" | "isActiveProject"> = {}
  ): HTMLElement {
    const projectKey = getProjectKey(project);
    observeProjectSelection(
      projectKey,
      options.isActiveProject === true,
      String(options.currentView || "")
    );
    const badge = document.createElement("span");
    badge.className = "project-nav-badge project-github-status";
    badge.hidden = true;

    let actionsSnapshot: GitHubActionsSnapshot | null = null;
    let pullRequestsSnapshot: GitHubPullRequestsSnapshot | null = null;
    let currentSignal: GitHubProjectStatusSignal | null = null;
    let connectionCheckCompleted = false;

    function updateBadge() {
      const notificationState = observeWorkflowTransitions(projectKey, actionsSnapshot);
      const signals = getProjectStatusSignals(
        actionsSnapshot,
        pullRequestsSnapshot,
        notificationState.pendingResult
      );
      const priority = getProjectStatusPriority(globalConfig.githubProjectStatusPriority);
      currentSignal = priority
        .map((category) => signals.get(category) || null)
        .find(Boolean) || null;

      if (currentSignal?.category === "workflowRunning") {
        rememberDisplayedRunningWorkflows(notificationState, actionsSnapshot);
      }

      badge.hidden = !currentSignal;
      badge.className = [
        "project-nav-badge",
        "project-github-status",
        currentSignal?.className || ""
      ].filter(Boolean).join(" ");
      const summary = priority
        .map((category) => signals.get(category)?.label || "")
        .filter(Boolean)
        .join(" · ");
      badge.title = currentSignal ? `GitHub: ${summary}` : "";
      badge.setAttribute("aria-hidden", currentSignal ? "false" : "true");
      badge.setAttribute("aria-label", badge.title);
      badge.setAttribute("role", currentSignal?.url ? "link" : "img");
      badge.setAttribute("tabindex", currentSignal?.url ? "0" : "-1");
    }

    function activateCurrentSignal(event?: Event) {
      if (!currentSignal?.url) {
        return;
      }
      const signal = currentSignal;
      event?.preventDefault();
      event?.stopPropagation();
      globalScope.boatyard?.openExternal?.(signal.url);
    }

    badge.addEventListener("click", activateCurrentSignal);
    badge.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        activateCurrentSignal(event);
      }
    });

    queueMicrotask(() => {
      connectionCheckCompleted = true;
    });
    const isAlive = () => !connectionCheckCompleted || badge.isConnected;
    actionsCoordinator.subscribe(
      project,
      (state) => {
        actionsSnapshot = state.snapshot;
        updateBadge();
      },
      isAlive
    );
    pullRequestsCoordinator.subscribe(
      project,
      (state) => {
        pullRequestsSnapshot = state.snapshot;
        updateBadge();
      },
      isAlive
    );

    return badge;
  }

  function getStatusPresentation(status: string, conclusion = ""): StatusPresentation {
    const value = conclusion || status;
    const presentations: Record<string, StatusPresentation> = {
      action_required: { icon: "⚠", label: "Action required", tone: "warning" },
      cancelled: { icon: "—", label: "Cancelled", tone: "muted" },
      completed: { icon: "✓", label: "Completed", tone: "success" },
      failure: { icon: "✕", label: "Failed", tone: "failure" },
      in_progress: { icon: "◌", label: "In progress", tone: "running" },
      neutral: { icon: "•", label: "Neutral", tone: "muted" },
      pending: { icon: "○", label: "Pending", tone: "queued" },
      queued: { icon: "○", label: "Queued", tone: "queued" },
      requested: { icon: "○", label: "Requested", tone: "queued" },
      skipped: { icon: "↷", label: "Skipped", tone: "muted" },
      stale: { icon: "⚠", label: "Stale", tone: "warning" },
      success: { icon: "✓", label: "Passed", tone: "success" },
      timed_out: { icon: "⌛", label: "Timed out", tone: "failure" },
      waiting: { icon: "○", label: "Waiting", tone: "queued" }
    };
    return presentations[value] || { icon: "?", label: value || "Unknown", tone: "muted" };
  }

  function createStatusIcon(status: string, conclusion = ""): HTMLElement {
    const presentation = getStatusPresentation(status, conclusion);
    const icon = document.createElement("span");
    icon.className = `github-status-icon ${presentation.tone}`;
    icon.textContent = presentation.icon;
    icon.title = presentation.label;
    icon.setAttribute("aria-label", presentation.label);
    return icon;
  }

  function createExternalLink(label: string, url: string, className = "github-link-button"): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = className;
    button.type = "button";
    button.textContent = label;
    button.title = `Open ${label} on GitHub`;
    button.disabled = !url;
    button.addEventListener("click", () => {
      if (url) {
        globalScope.boatyard?.openExternal?.(url);
      }
    });
    return button;
  }

  function formatDuration(startValue: string, endValue = ""): string {
    const start = Date.parse(startValue);
    const end = endValue ? Date.parse(endValue) : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return "";
    }
    const seconds = Math.floor((end - start) / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ${seconds % 60}s`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  function formatTimestamp(value: string): string {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleString([], {
          dateStyle: "short",
          timeStyle: "short"
        })
      : "";
  }

  function getJobProgress(job: GitHubWorkflowJob): { completed: number; total: number } {
    return {
      completed: job.steps.filter((step) => step.status === "completed").length,
      total: job.steps.length
    };
  }

  function getCurrentStep(job: GitHubWorkflowJob): GitHubWorkflowStep | null {
    return job.steps.find((step) => step.status === "in_progress")
      || job.steps.find((step) => ["pending", "queued", "waiting"].includes(step.status))
      || null;
  }

  function createRunProgress(jobs: GitHubWorkflowJob[]): HTMLElement {
    const progress = document.createElement("div");
    progress.className = "github-run-progress";
    progress.setAttribute("aria-label", "Workflow job progress");
    if (!jobs.length) {
      progress.classList.add("empty");
      return progress;
    }

    for (const job of jobs) {
      const segment = document.createElement("span");
      const presentation = getStatusPresentation(job.status, job.conclusion);
      segment.className = `github-run-progress-segment ${presentation.tone}`;
      segment.title = `${job.name}: ${presentation.label}`;
      progress.append(segment);
    }
    return progress;
  }

  function createJobRow(job: GitHubWorkflowJob): HTMLElement {
    const row = document.createElement("div");
    row.className = "github-job-row";

    const status = createStatusIcon(job.status, job.conclusion);
    const content = document.createElement("div");
    content.className = "github-job-content";
    const link = createExternalLink(job.name, job.htmlUrl, "github-job-link");
    const detail = document.createElement("small");
    const currentStep = getCurrentStep(job);
    const progress = getJobProgress(job);
    const duration = formatDuration(job.startedAt, job.completedAt);
    if (currentStep) {
      detail.textContent = currentStep.name;
    } else if (progress.total) {
      detail.textContent = `${progress.completed}/${progress.total} known steps${duration ? ` · ${duration}` : ""}`;
    } else {
      detail.textContent = getStatusPresentation(job.status, job.conclusion).label;
    }
    content.append(link, detail);
    row.append(status, content);
    return row;
  }

  function createActiveRun(run: GitHubWorkflowRun): HTMLElement {
    const section = document.createElement("section");
    section.className = "github-active-run";

    const header = document.createElement("div");
    header.className = "github-run-header";
    const status = createStatusIcon(run.status, run.conclusion);
    const title = createExternalLink(run.name, run.htmlUrl, "github-run-link");
    const duration = document.createElement("small");
    duration.className = "github-run-duration";
    duration.textContent = formatDuration(run.startedAt || run.createdAt);
    header.append(status, title, duration);

    const metadata = document.createElement("div");
    metadata.className = "github-run-metadata";
    metadata.textContent = [
      run.headBranch || run.headSha.slice(0, 7),
      run.event,
      run.runAttempt > 1 ? `attempt ${run.runAttempt}` : ""
    ].filter(Boolean).join(" · ");

    const jobs = document.createElement("div");
    jobs.className = "github-job-list";
    if (run.jobs.length) {
      jobs.append(...run.jobs.map(createJobRow));
    } else {
      const waiting = document.createElement("small");
      waiting.className = "github-empty-detail";
      waiting.textContent = "Waiting for jobs.";
      jobs.append(waiting);
    }

    section.append(header, metadata, createRunProgress(run.jobs), jobs);
    return section;
  }

  function createCompletedRun(run: GitHubWorkflowRun): HTMLElement {
    const row = document.createElement("div");
    row.className = "github-completed-run";
    const status = createStatusIcon(run.status, run.conclusion);
    const link = createExternalLink(run.name, run.htmlUrl, "github-run-link");
    const metadata = document.createElement("small");
    metadata.textContent = [
      run.headBranch || run.headSha.slice(0, 7),
      formatDuration(run.startedAt || run.createdAt, run.updatedAt),
      formatTimestamp(run.updatedAt)
    ].filter(Boolean).join(" · ");
    row.append(status, link, metadata);
    return row;
  }

  function createActionsContent(snapshot: GitHubActionsSnapshot): HTMLElement {
    const content = document.createElement("div");
    content.className = "github-widget-content";

    if (snapshot.status.state !== "ready") {
      const message = document.createElement("p");
      message.className = "github-widget-message";
      message.textContent = snapshot.status.summary;
      content.append(message);
      const host = snapshot.status.details?.host;
      if (snapshot.status.state === "notConfigured" && host) {
        const command = document.createElement("code");
        command.className = "github-auth-command";
        command.textContent = `gh auth login --hostname ${host}`;
        content.append(command);
      }
      return content;
    }

    const activeRuns = snapshot.runs.filter((run) => isActiveWorkflowStatus(run.status));
    const completedRuns = snapshot.runs
      .filter((run) => !isActiveWorkflowStatus(run.status))
      .slice(0, 5);

    if (!activeRuns.length && !completedRuns.length) {
      const empty = document.createElement("p");
      empty.className = "github-widget-message";
      empty.textContent = "No workflow runs.";
      content.append(empty);
      return content;
    }

    if (activeRuns.length) {
      const section = document.createElement("div");
      section.className = "github-widget-section";
      const heading = document.createElement("h4");
      heading.textContent = activeRuns.length === 1 ? "Active run" : "Active runs";
      section.append(heading, ...activeRuns.map(createActiveRun));
      content.append(section);
    }

    if (completedRuns.length) {
      const section = document.createElement("div");
      section.className = "github-widget-section";
      const heading = document.createElement("h4");
      heading.textContent = "Recent";
      const list = document.createElement("div");
      list.className = "github-completed-list";
      list.append(...completedRuns.map(createCompletedRun));
      section.append(heading, list);
      content.append(section);
    }
    return content;
  }

  function createActionsWidget(project: GitHubProject): HTMLElement {
    const card = document.createElement("article");
    card.className = "widget-card github-widget github-actions-widget";

    const header = document.createElement("div");
    header.className = "github-widget-header";
    const titleGroup = document.createElement("div");
    titleGroup.className = "github-widget-title";
    const title = document.createElement("h3");
    title.textContent = "GitHub Actions";
    const subtitle = document.createElement("small");
    subtitle.textContent = "Loading workflow runs…";
    titleGroup.append(title, subtitle);

    const refreshButton = document.createElement("button");
    refreshButton.className = "github-refresh-button";
    refreshButton.type = "button";
    refreshButton.textContent = "↻";
    refreshButton.title = "Refresh GitHub Actions";
    refreshButton.setAttribute("aria-label", "Refresh GitHub Actions");
    header.append(titleGroup, refreshButton);

    const body = document.createElement("div");
    body.className = "github-widget-body";
    const loading = document.createElement("p");
    loading.className = "github-widget-message";
    loading.textContent = "Loading workflow runs…";
    body.append(loading);
    card.append(header, body);

    let wasConnected = false;
    const subscription = actionsCoordinator.subscribe(
      project,
      (state) => {
        refreshButton.disabled = state.loading;
        refreshButton.classList.toggle("loading", state.loading);
        if (state.snapshot) {
          body.replaceChildren(createActionsContent(state.snapshot));
          const activeText = state.snapshot.activeRunCount
            ? `${state.snapshot.activeRunCount} active`
            : "No active runs";
          subtitle.textContent = [
            activeText,
            state.stale ? "stale" : "",
            formatTimestamp(state.snapshot.refreshedAt)
          ].filter(Boolean).join(" · ");
        } else if (state.loading) {
          subtitle.textContent = "Loading workflow runs…";
        }

        if (state.error) {
          const error = document.createElement("p");
          error.className = "github-widget-error";
          error.textContent = state.stale
            ? `Could not refresh: ${state.error}`
            : state.error;
          if (!state.snapshot) {
            body.replaceChildren(error);
          } else {
            body.append(error);
          }
          subtitle.textContent = state.stale ? "Showing stale data" : "Refresh failed";
        }
      },
      () => {
        if (card.isConnected) {
          wasConnected = true;
        }
        return !wasConnected || card.isConnected;
      }
    );

    refreshButton.addEventListener("click", () => {
      void subscription.refresh(true);
    });
    return card;
  }

  function getReviewPresentation(pullRequest: GitHubPullRequest): StatusPresentation {
    if (pullRequest.isDraft) {
      return { icon: "◇", label: "Draft", tone: "muted" };
    }
    if (pullRequest.isReviewRequestedFromViewer) {
      return { icon: "◎", label: "Review requested from you", tone: "review-requested" };
    }
    if (pullRequest.reviewState === "changesRequested") {
      return { icon: "↺", label: "Changes requested", tone: "warning" };
    }
    if (pullRequest.reviewState === "approved") {
      return { icon: "✓", label: "Approved", tone: "success" };
    }
    if (pullRequest.isAuthoredByViewer && pullRequest.reviewState === "required") {
      return { icon: "○", label: "Waiting for reviewers", tone: "queued" };
    }
    if (pullRequest.reviewState === "required") {
      return { icon: "○", label: "Review required", tone: "queued" };
    }
    return { icon: "—", label: "No review requirement", tone: "muted" };
  }

  function getCiPresentation(ciState: GitHubPullRequestCiState): StatusPresentation {
    const presentations: Record<GitHubPullRequestCiState, StatusPresentation> = {
      blocked: { icon: "⚠", label: "Checks blocked or action required", tone: "warning" },
      failed: { icon: "✕", label: "Checks failed", tone: "failure" },
      none: { icon: "—", label: "No checks", tone: "muted" },
      passed: { icon: "✓", label: "Checks passed", tone: "success" },
      running: { icon: "◌", label: "Checks running", tone: "running" }
    };
    return presentations[ciState];
  }

  function createPullRequestStatus(
    presentation: StatusPresentation,
    className: string
  ): HTMLElement {
    const status = document.createElement("span");
    status.className = `github-pr-status ${className} ${presentation.tone}`;
    status.title = presentation.label;
    status.setAttribute("aria-label", presentation.label);
    const icon = document.createElement("span");
    icon.className = "github-pr-status-icon";
    icon.textContent = presentation.icon;
    const label = document.createElement("span");
    label.className = "github-pr-status-label";
    label.textContent = presentation.label;
    status.append(icon, label);
    return status;
  }

  function matchesPullRequestFilter(
    pullRequest: GitHubPullRequest,
    filter: GitHubPullRequestFilter
  ): boolean {
    switch (filter) {
      case "authored":
        return pullRequest.isAuthoredByViewer;
      case "changesRequested":
        return pullRequest.reviewState === "changesRequested";
      case "ready":
        return pullRequest.isReadyToMerge;
      case "reviewRequested":
        return pullRequest.isReviewRequestedFromViewer;
      default:
        return true;
    }
  }

  function getPullRequestFilterOptions(): Array<{
    id: GitHubPullRequestFilter;
    label: string;
  }> {
    return [
      { id: "all", label: "All" },
      { id: "reviewRequested", label: "Review requested" },
      { id: "authored", label: "Authored by me" },
      { id: "changesRequested", label: "Changes requested" },
      { id: "ready", label: "Ready" }
    ];
  }

  function createPullRequestRow(pullRequest: GitHubPullRequest): HTMLElement {
    const row = document.createElement("div");
    row.className = "github-pr-row";

    const main = document.createElement("div");
    main.className = "github-pr-main";
    const titleLine = document.createElement("div");
    titleLine.className = "github-pr-title-line";
    const number = document.createElement("span");
    number.className = "github-pr-number";
    number.textContent = `#${pullRequest.number}`;
    const title = createExternalLink(pullRequest.title, pullRequest.url, "github-pr-link");
    titleLine.append(number, title);

    const metadata = document.createElement("small");
    metadata.className = "github-pr-metadata";
    metadata.textContent = [
      pullRequest.authorLogin,
      pullRequest.headRefName && pullRequest.baseRefName
        ? `${pullRequest.headRefName} → ${pullRequest.baseRefName}`
        : "",
      formatTimestamp(pullRequest.updatedAt)
    ].filter(Boolean).join(" · ");
    main.append(titleLine, metadata);

    const statuses = document.createElement("div");
    statuses.className = "github-pr-statuses";
    statuses.append(
      createPullRequestStatus(getReviewPresentation(pullRequest), "review"),
      createPullRequestStatus(getCiPresentation(pullRequest.ciState), "ci")
    );
    if (pullRequest.mergeState === "conflicting") {
      statuses.append(createPullRequestStatus({
        icon: "⚠",
        label: "Merge conflicts",
        tone: "failure"
      }, "merge"));
    } else if (pullRequest.isReadyToMerge) {
      statuses.append(createPullRequestStatus({
        icon: "✓",
        label: "Ready to merge",
        tone: "ready"
      }, "merge"));
    }
    row.append(main, statuses);
    return row;
  }

  function createPullRequestsContent(
    snapshot: GitHubPullRequestsSnapshot,
    selectedFilter: GitHubPullRequestFilter,
    onSelectFilter: (filter: GitHubPullRequestFilter) => void
  ): HTMLElement {
    const content = document.createElement("div");
    content.className = "github-widget-content github-pr-content";

    if (snapshot.status.state !== "ready") {
      const message = document.createElement("p");
      message.className = "github-widget-message";
      message.textContent = snapshot.status.summary;
      content.append(message);
      const host = snapshot.status.details?.host;
      if (snapshot.status.state === "notConfigured" && host) {
        const command = document.createElement("code");
        command.className = "github-auth-command";
        command.textContent = `gh auth login --hostname ${host}`;
        content.append(command);
      }
      return content;
    }

    const filters = document.createElement("div");
    filters.className = "github-pr-filters";
    for (const option of getPullRequestFilterOptions()) {
      const count = snapshot.pullRequests.filter((pullRequest) => (
        matchesPullRequestFilter(pullRequest, option.id)
      )).length;
      const button = document.createElement("button");
      button.className = "github-pr-filter";
      button.classList.toggle("active", option.id === selectedFilter);
      button.type = "button";
      button.textContent = `${option.label} ${count}`;
      button.setAttribute("aria-pressed", String(option.id === selectedFilter));
      button.addEventListener("click", () => onSelectFilter(option.id));
      filters.append(button);
    }

    const pullRequests = snapshot.pullRequests.filter((pullRequest) => (
      matchesPullRequestFilter(pullRequest, selectedFilter)
    ));
    const list = document.createElement("div");
    list.className = "github-pr-list";
    if (pullRequests.length) {
      list.append(...pullRequests.map(createPullRequestRow));
    } else {
      const empty = document.createElement("p");
      empty.className = "github-widget-message";
      empty.textContent = snapshot.pullRequests.length
        ? "No pull requests match this filter."
        : "No open pull requests.";
      list.append(empty);
    }
    content.append(filters, list);
    return content;
  }

  function createPullRequestsWidget(project: GitHubProject): HTMLElement {
    const card = document.createElement("article");
    card.className = "widget-card github-widget github-pull-requests-widget";

    const header = document.createElement("div");
    header.className = "github-widget-header";
    const titleGroup = document.createElement("div");
    titleGroup.className = "github-widget-title";
    const title = document.createElement("h3");
    title.textContent = "Pull Requests";
    const subtitle = document.createElement("small");
    subtitle.textContent = "Loading pull requests…";
    titleGroup.append(title, subtitle);

    const refreshButton = document.createElement("button");
    refreshButton.className = "github-refresh-button";
    refreshButton.type = "button";
    refreshButton.textContent = "↻";
    refreshButton.title = "Refresh pull requests";
    refreshButton.setAttribute("aria-label", "Refresh pull requests");
    header.append(titleGroup, refreshButton);

    const body = document.createElement("div");
    body.className = "github-widget-body";
    const loading = document.createElement("p");
    loading.className = "github-widget-message";
    loading.textContent = "Loading pull requests…";
    body.append(loading);
    card.append(header, body);

    let latestSnapshot: GitHubPullRequestsSnapshot | null = null;
    let selectedFilter: GitHubPullRequestFilter = "all";
    let wasConnected = false;

    function renderSnapshot() {
      if (!latestSnapshot) {
        return;
      }
      body.replaceChildren(createPullRequestsContent(
        latestSnapshot,
        selectedFilter,
        (filter) => {
          selectedFilter = filter;
          renderSnapshot();
        }
      ));
    }

    const subscription = pullRequestsCoordinator.subscribe(
      project,
      (state) => {
        refreshButton.disabled = state.loading;
        refreshButton.classList.toggle("loading", state.loading);
        if (state.snapshot) {
          latestSnapshot = state.snapshot;
          renderSnapshot();
          subtitle.textContent = [
            `${state.snapshot.pullRequests.length} open`,
            state.stale ? "stale" : "",
            formatTimestamp(state.snapshot.refreshedAt)
          ].filter(Boolean).join(" · ");
        } else if (state.loading) {
          subtitle.textContent = "Loading pull requests…";
        }

        if (state.error) {
          const error = document.createElement("p");
          error.className = "github-widget-error";
          error.textContent = state.stale
            ? `Could not refresh: ${state.error}`
            : state.error;
          if (!state.snapshot) {
            body.replaceChildren(error);
          } else {
            body.append(error);
          }
          subtitle.textContent = state.stale ? "Showing stale data" : "Refresh failed";
        }
      },
      () => {
        if (card.isConnected) {
          wasConnected = true;
        }
        return !wasConnected || card.isConnected;
      }
    );

    refreshButton.addEventListener("click", () => {
      void subscription.refresh(true);
    });
    return card;
  }

  registry.register(
    {
      id: "boatyard.github",
      name: "GitHub",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: [
          "boatyard.github.actions",
          "boatyard.github.pullRequests"
        ],
        projectNavBadges: ["boatyard.github.projectStatus"],
        globalSettings: ["boatyard.github.global"]
      },
      permissions: [
        "system:exec",
        "widget:provide"
      ]
    },
    {
      activate(ctx) {
        ctx.status.set({
          state: "ready",
          summary: "GitHub integration is available"
        });

        ctx.settings.registerGlobalSection({
          id: "boatyard.github.global",
          title: "GitHub",
          fields: [
            {
              key: "githubProjectStatusPriority",
              label: "Project status priority",
              type: "select",
              valueType: "text",
              defaultValue: GITHUB_PROJECT_STATUS_PRIORITY_DEFAULT,
              options: GITHUB_PROJECT_STATUS_PRIORITY_OPTIONS
            }
          ]
        });

        ctx.projectNavBadges.register({
          id: "boatyard.github.projectStatus",
          render({
            project,
            globalConfig,
            isActiveProject,
            currentView
          }: PluginProjectNavBadgeRenderContext) {
            return createProjectStatusBadge(
              project || {},
              globalConfig as GitHubConfig | undefined,
              {
                currentView,
                isActiveProject
              }
            );
          }
        });

        ctx.widgets.register({
          id: "boatyard.github.actions",
          name: "GitHub Actions",
          title: "GitHub Actions",
          scope: "project",
          category: "Developer tools",
          status: "experimental",
          defaultVisible: false,
          description: "Shows live GitHub Actions runs, jobs, and steps for the project.",
          layout: {
            default: { columns: 4, rows: 4 },
            min: { columns: 3, rows: 3 }
          },
          createElement: createActionsWidget
        });

        ctx.widgets.register({
          id: "boatyard.github.pullRequests",
          name: "GitHub Pull Requests",
          title: "GitHub Pull Requests",
          scope: "project",
          category: "Developer tools",
          status: "experimental",
          defaultVisible: false,
          description: "Shows open pull requests with independent review and CI status.",
          layout: {
            default: { columns: 4, rows: 4 },
            min: { columns: 3, rows: 3 }
          },
          createElement: createPullRequestsWidget
        });
      },
      deactivate() {
        workflowNotificationStates.clear();
        selectedProjectKey = null;
      }
    }
  );
})(window);
