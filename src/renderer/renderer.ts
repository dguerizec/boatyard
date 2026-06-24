"use strict";

type BoatyardRendererWindow = Window & {
  boatyard: any;
  BoatyardGlobalSettingsViews: any;
  BoatyardHawserUI?: any;
  BoatyardManual?: any;
  BoatyardOnboardingTour: any;
  BoatyardOverlayDialog?: any;
  BoatyardPaneLayoutState: any;
  BoatyardPaneLayoutView: any;
  BoatyardPaneNavigation?: any;
  BoatyardPluginLoader: any;
  BoatyardPluginRegistry: any;
  BoatyardPluginSettingsFields: any;
  BoatyardProjectSettingsViews: any;
  BoatyardProjectSidebar: any;
  BoatyardTerminalSurfaces: any;
  BoatyardUpdateViews: any;
  BoatyardWebAppMenus: any;
  BoatyardWebAppSurfaces: any;
  BoatyardWidgetRegistry: any;
  BoatyardWidgetSurfaces: any;
};

type ProjectNavBadgeRenderOptions = {
  isActiveProject?: boolean;
};

type HawserWidgetOptions = {
  loadData?: (project: any) => Promise<any>;
  onOpenMessage?: (message: any) => void;
  subtitle?: string;
  title?: string;
};

const boatyardWindow = window as unknown as BoatyardRendererWindow;

const globalNav = document.querySelector<HTMLElement>("#global-nav");
const globalNavRow = document.querySelector<HTMLElement>("#global-nav-row");
const globalSettingsButton = document.querySelector<HTMLButtonElement>("#global-settings");
const globalViewButton = document.querySelector<HTMLButtonElement>("#global-view");
const manualTourButton = document.querySelector<HTMLButtonElement>("#manual-tour");
const sidebarUpdateNotice = document.querySelector<HTMLElement>("#sidebar-update-notice");
const addProjectButton = document.querySelector<HTMLButtonElement>("#add-project");
const projectCount = document.querySelector<HTMLElement>("#project-count");
const projectSearchInput = document.querySelector<HTMLInputElement>("#project-search");
const projectList = document.querySelector<HTMLElement>("#project-list");
const workspace = document.querySelector<HTMLElement>(".workspace");
const dashboardGrid = document.querySelector<HTMLElement>("#dashboard-grid");
const workspaceKicker = document.querySelector<HTMLElement>("#workspace-kicker");
const workspaceTitle = document.querySelector<HTMLElement>("#workspace-title");
const workspaceSummary = document.querySelector<HTMLElement>("#workspace-summary");

const MIN_WIDGET_RAIL_WIDTH = 240;
const DEFAULT_WIDGET_PANE_ID = "widgets-0";
const GLOBAL_WORKSPACE_ID = "__global__";
const WIDGET_GRID_MIN_COLUMN_WIDTH = 100;
const WIDGET_GRID_MAX_COLUMN_WIDTH = 200;
const WIDGET_GRID_ROW_HEIGHT = 84;
const WIDGET_GRID_GAP = 12;
const WIDGET_GRID_SCROLL_GUARD = 10;
const WEBAPP_SPLIT_RESIZER_SIZE = 6;
const WEBAPP_OPEN_SPLIT_RATIO = 2 / 3;
const ONBOARDING_VERSION = boatyardWindow.BoatyardManual?.version || 1;
const LEGACY_WIDGET_IDS = new Map([
  ["project-shell", "terminal-shell"],
  ["global-shell", "terminal-shell"]
]);

function slugify(value) {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveRepoUrl(gitUrl) {
  const trimmed = String(gitUrl || "").trim();

  if (!trimmed) {
    return "";
  }

  const stripGitSuffix = (pathname) => pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
  const scpLikeMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (scpLikeMatch) {
    return `https://${scpLikeMatch[1]}/${stripGitSuffix(scpLikeMatch[2])}`;
  }

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol === "ssh:" && parsed.username === "git") {
      return `https://${parsed.host}${stripGitSuffix(parsed.pathname)}`;
    }

    if (["http:", "https:"].includes(parsed.protocol)) {
      return `https://${parsed.host}${stripGitSuffix(parsed.pathname)}`;
    }
  } catch {
    return "";
  }

  return "";
}

function deriveProjectNameFromPath(sourcePath) {
  const segments = String(sourcePath || "")
    .trim()
    .replace(/[/\\]+$/g, "")
    .split(/[/\\]+/)
    .filter(Boolean);

  return segments.at(-1) || "";
}

function formatProjectNameFromPath(sourcePath) {
  const projectName = deriveProjectNameFromPath(sourcePath).replace(/[-_]+/g, " ").trim();
  return projectName ? `${projectName.charAt(0).toUpperCase()}${projectName.slice(1)}` : "";
}

let state: any = { projects: [] };
let currentView = "global";
let currentProjectId = null;
let returnView = { view: "global", projectId: null };
const loadedWebAppKeys = new Set<string>();
const currentWebAppUrlsByKey = new Map<string, string>();
const loadedWebAppUrlsByKey = new Map<string, string>();
const webAppLoadWaiters = new Set<(payload: unknown) => void>();
const webAppAutofillEnabledByKey = new Map<string, boolean>();
let visibleWebAppHosts = new Map();
let pierWorkloadPaneRefreshFrame = null;
const UPDATE_POLL_INTERVAL_MS = 10 * 60 * 1000;
const SVG_NS = "http://www.w3.org/2000/svg";
const TOOL_ICONS = {
  arrowLeft: [
    "M19 12H5",
    "M12 5l-7 7 7 7"
  ],
  arrowRight: [
    "M5 12h14",
    "M12 5l7 7-7 7"
  ],
  home: [
    "M4 11.5L12 5l8 6.5",
    "M6.5 10v9h11v-9",
    "M10 19v-5h4v5"
  ],
  key: [
    "M15 7.5a4 4 0 1 1-1.18-2.82A4 4 0 0 1 15 7.5z",
    "M10.6 10.4L4 17v3h3l1.5-1.5H11v-2.5h2.5L16 13"
  ],
  lock: [
    "M6.5 10V7.5a5.5 5.5 0 0 1 11 0V10",
    "M5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-7A1.5 1.5 0 0 1 5.5 10z"
  ],
  pencil: [
    "M12 20h9",
    "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"
  ],
  plus: [
    "M12 5v14",
    "M5 12h14"
  ],
  refresh: [
    "M20 6v5h-5",
    "M4 18v-5h5",
    "M18 11a6.5 6.5 0 0 0-11.42-4.24L4 9",
    "M6 13a6.5 6.5 0 0 0 11.42 4.24L20 15"
  ],
  trash: [
    "M3 6h18",
    "M8 6V4h8v2",
    "M6 6l1 14h10l1-14",
    "M10 11v5",
    "M14 11v5"
  ],
  splitVertical: [
    "M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5h-13C4.67 20 4 19.33 4 18.5z",
    "M12 4v16"
  ],
  splitHorizontal: [
    "M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5h-13C4.67 20 4 19.33 4 18.5z",
    "M4 12h16"
  ],
  expandPane: [
    "M8 3H3v5",
    "M3 3l7 7",
    "M16 21h5v-5",
    "M21 21l-7-7"
  ],
  shrinkPane: [
    "M10 3v7H3",
    "M10 10L3 3",
    "M14 21v-7h7",
    "M14 14l7 7"
  ],
  close: [
    "M6 6l12 12",
    "M18 6L6 18"
  ]
};

function createToolIcon(name) {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.classList.add("webapp-tool-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");

  for (const d of TOOL_ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    icon.append(path);
  }

  return icon;
}

function getProjects() {
  return state.projects as any[];
}

function getProjectGroups() {
  const groups = [...new Set(getProjects()
    .map((project) => String(project.group || "").trim())
    .filter(Boolean))] as string[];
  return groups.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function normalizeProjectSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function projectMatchesSearch(project, query) {
  const normalizedQuery = normalizeProjectSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const groupName = String(project.group || "").trim();
  return [
    project.name,
    project.slug,
    project.sourcePath,
    groupName
  ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
}

function getCollapsedProjectGroups() {
  return new Set(Array.isArray(state.navigation?.collapsedProjectGroups)
    ? state.navigation.collapsedProjectGroups
    : []);
}

function getProjectGroupsByName(projects = getProjects()) {
  const groups = new Map();

  for (const project of projects) {
    const groupName = String(project.group || "").trim();
    if (!groupName) {
      continue;
    }

    if (!groups.has(groupName)) {
      groups.set(groupName, []);
    }
    groups.get(groupName).push(project);
  }

  return groups;
}

function getSettings() {
  return {
    projectsBasePath: "",
    blurWebAppOverlays: false,
    webAppOpenRules: [],
    widgetRailWidth: 340,
    terminalEnv: "",
    ...(state.settings || {})
  };
}

function getManual() {
  return boatyardWindow.BoatyardManual || {
    title: "Boatyard Manual",
    description: "",
    sections: [],
    onboarding: []
  };
}

function getCurrentProject() {
  return getProjects().find((project) => project.id === currentProjectId) || null;
}

function getProjectById(projectId) {
  return getProjects().find((project) => project.id === projectId) || null;
}

function getGlobalWorkspace() {
  return {
    id: GLOBAL_WORKSPACE_ID,
    name: "Global",
    slug: "global",
    urls: state.globalUrls || [],
    widgetPanes: [{
      id: DEFAULT_WIDGET_PANE_ID,
      label: "Widgets"
    }],
    isGlobalWorkspace: true
  };
}

function isGlobalWorkspace(project) {
  return project?.isGlobalWorkspace === true || project?.id === GLOBAL_WORKSPACE_ID;
}

function getProjectPluginConfig(projectId, pluginId) {
  return state.pluginConfig?.projects?.[projectId]?.[pluginId] || {};
}

function getGlobalPluginConfig(pluginId) {
  return state.pluginConfig?.global?.[pluginId] || {};
}

function applyFormControl(control) {
  control.classList.add("form-control");
  return control;
}

function applyFormControls(root) {
  root
    .querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), textarea')
    .forEach(applyFormControl);
}

function getPluginPaneDefinitions(filter = {}) {
  return boatyardWindow.BoatyardPluginRegistry?.listPanes(filter) || [];
}

function getPluginProjectNavBadgeDefinitions() {
  return boatyardWindow.BoatyardPluginRegistry?.listProjectNavBadges() || [];
}

function getPluginProjectSettingsSections() {
  return boatyardWindow.BoatyardPluginRegistry?.listProjectSettingsSections() || [];
}

function getPluginGlobalSettingsSections() {
  return boatyardWindow.BoatyardPluginRegistry?.listGlobalSettingsSections() || [];
}

function getPluginEnabledState() {
  return state.plugins?.enabled || {};
}

function getProjectSummaryTarget(project) {
  return project.sourcePath ||
    project.slug;
}

function renderProjectNavBadges(project, container, options: ProjectNavBadgeRenderOptions = {}) {
  for (const badge of getPluginProjectNavBadgeDefinitions()) {
    try {
      const element = badge.render({
        project,
        projectConfig: getProjectPluginConfig(project.id, badge.pluginId),
        globalConfig: getGlobalPluginConfig(badge.pluginId),
        isActiveProject: options.isActiveProject === true,
        currentView
      });

      if (element && typeof element === "object" && typeof element.nodeType === "number") {
        container.append(element);
      }
    } catch (error) {
      console.error(`Could not render project nav badge ${badge.id}:`, error);
    }
  }
}

async function persistProjectPluginConfig(projectId, pluginConfig = {}) {
  let nextState = state;

  for (const [pluginId, config] of Object.entries(pluginConfig)) {
    nextState = await boatyardWindow.boatyard.updateProjectPluginConfig(projectId, pluginId, config);
  }

  return nextState;
}

function readPluginSettingsFieldValue(field, input) {
  return boatyardWindow.BoatyardPluginSettingsFields.readFieldValue(field, input, {
    normalizeUrl: normalizeAddressInput
  });
}

function isRestorableView(view) {
  return ["global", "global-settings", "project", "project-edit"].includes(view);
}

function persistNavigation() {
  if (!isRestorableView(currentView)) {
    return;
  }

  boatyardWindow.boatyard.updateNavigation({
    view: currentView,
    projectId: currentProjectId,
    collapsedProjectGroups: [...getCollapsedProjectGroups()]
  }).catch((error) => {
    console.error("Could not persist navigation:", error);
  });
}

function setCurrentView(view, projectId = null, { persist = true } = {}) {
  if (view !== currentView || projectId !== currentProjectId) {
    closeProjectGroupMenu();
    closeTerminalTabMenu();
  }

  currentView = view;
  currentProjectId = projectId;

  if (persist) {
    persistNavigation();
  }
}

function restoreNavigation() {
  const navigation = state.navigation || {};
  const projectExists = getProjects().some((project) => project.id === navigation.projectId);

  if (navigation.view === "global-settings") {
    setCurrentView("global-settings", null, { persist: false });
  } else if ((navigation.view === "project" || navigation.view === "project-edit") && projectExists) {
    setCurrentView(navigation.view, navigation.projectId, { persist: false });
  } else {
    setCurrentView("global", null, { persist: false });
  }
}

function createCard({ title, eyebrow, body, meta, action }) {
  const card = document.createElement("article");
  card.className = "widget-card";

  const content = document.createElement("div");
  content.className = "widget-content";

  if (eyebrow) {
    const eyebrowNode = document.createElement("p");
    eyebrowNode.className = "widget-eyebrow";
    eyebrowNode.textContent = eyebrow;
    content.append(eyebrowNode);
  }

  const titleNode = document.createElement("h3");
  titleNode.textContent = title;
  content.append(titleNode);

  const bodyNode = document.createElement("p");
  bodyNode.textContent = body;
  content.append(bodyNode);

  if (meta) {
    const metaNode = document.createElement("span");
    metaNode.className = "widget-meta";
    metaNode.textContent = meta;
    content.append(metaNode);
  }

  card.append(content);

  if (action) {
    const button = document.createElement("button");
    button.className = "secondary-button";
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    card.append(button);
  }

  return card;
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function normalizeComparableUrl(url) {
  try {
    return new URL(url).toString();
  } catch {
    return String(url || "");
  }
}

function matchesWebAppLoad(payload, key, expectedUrl = "") {
  if (!payload || payload.key !== key) {
    return false;
  }

  if (!expectedUrl) {
    return true;
  }

  return normalizeComparableUrl(payload.url) === normalizeComparableUrl(expectedUrl);
}

function hasLoadedWebApp(key, expectedUrl = "") {
  const loadedUrl = loadedWebAppUrlsByKey.get(key);
  if (!loadedUrl) {
    return false;
  }

  return matchesWebAppLoad({ key, url: loadedUrl }, key, expectedUrl);
}

function waitForWebAppLoad(key, expectedUrl = "", timeoutMs = 6000) {
  if (!key || hasLoadedWebApp(key, expectedUrl)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let timeout = null;
    let waiter = null;
    const cleanup = (loaded) => {
      clearTimeout(timeout);
      webAppLoadWaiters.delete(waiter);
      resolve(loaded);
    };
    waiter = (payload) => {
      if (matchesWebAppLoad(payload, key, expectedUrl)) {
        cleanup(true);
      }
    };

    webAppLoadWaiters.add(waiter);
    timeout = setTimeout(() => cleanup(false), timeoutMs);
  });
}

const paneLayoutState = boatyardWindow.BoatyardPaneLayoutState.create({
  updatePaneLayout: (projectId, layout) => boatyardWindow.boatyard.updatePaneLayout(projectId, layout)
});

const terminalSurfaces = boatyardWindow.BoatyardTerminalSurfaces.create({
  boatyard: boatyardWindow.boatyard,
  getProjectById,
  getState: () => state,
  createToolIcon,
  clamp,
  defaultWidgetPaneId: DEFAULT_WIDGET_PANE_ID
});

function closeTerminalTabMenu() {
  terminalSurfaces.closeTerminalTabMenu();
}

function detachProjectTerminal(projectId) {
  terminalSurfaces.detachProjectTerminal(projectId);
}

function detachInactiveProjectTerminals(activeProjectId = null) {
  terminalSurfaces.detachInactiveProjectTerminals(activeProjectId);
}

function createTerminalSurface(project, options = {}) {
  return terminalSurfaces.createTerminalSurface(project, options);
}

function createTerminalWidget(project, props = {}) {
  return terminalSurfaces.createTerminalWidget(project, props);
}

function formatHawserEndpoint(message) {
  if (message.direction === "in") {
    return `from ${message.fromProject || "?"}${message.fromSession ? `:${message.fromSession}` : ""}`;
  }

  return `to ${message.toProject || "?"}${message.toSession ? `:${message.toSession}` : ""}`;
}

function createHawserWidget(project, options: HawserWidgetOptions = {}) {
  const loadData = options.loadData;
  const card = document.createElement("article");
  card.className = "widget-card hawser-widget";

  const header = document.createElement("header");
  header.className = "hawser-widget-header";

  const title = document.createElement("div");
  title.className = "hawser-widget-title";

  const titleText = document.createElement("h3");
  titleText.textContent = options.title || "Hawser";

  const subtitle = document.createElement("small");
  subtitle.textContent = options.subtitle || `${project.slug}:main`;

  title.append(titleText, subtitle);

  const status = document.createElement("span");
  status.className = "hawser-widget-status";
  status.textContent = "Loading";

  header.append(title, status);

  const metrics = document.createElement("div");
  metrics.className = "hawser-widget-metrics";

  const metricEntries = [
    ["unread", "Unread"],
    ["queued", "Queued"],
    ["processing", "Running"]
  ];
  const metricValues = new Map();

  for (const [key, label] of metricEntries) {
    const metric = document.createElement("div");
    metric.className = "hawser-widget-metric";

    const value = document.createElement("strong");
    value.textContent = "0";
    metricValues.set(key, value);

    const labelElement = document.createElement("span");
    labelElement.textContent = label;

    metric.append(value, labelElement);
    metrics.append(metric);
  }

  const list = document.createElement("div");
  list.className = "hawser-message-list";

  const footer = document.createElement("p");
  footer.className = "hawser-widget-footer";
  footer.hidden = true;

  card.append(header, metrics, list, footer);

  function isActiveHawserMessage(message) {
    return ["unread", "processing"].includes(message.status);
  }

  function isPendingHawserSession(message) {
    return message.kind === "task" && isActiveHawserMessage(message) && !message.twiccSessionUrl;
  }

  function createHawserMessageRow(message) {
    const row = document.createElement("div");
    row.className = `hawser-message-row ${message.status}`;

    const subject = document.createElement("strong");
    subject.textContent = message.subject;

    const meta = document.createElement("span");
    meta.textContent = `${message.kind} / ${message.status} / ${formatHawserEndpoint(message)}`;

    const preview = document.createElement("small");
    preview.textContent = message.worktree?.state
      ? `${message.worktree.kind || "worktree"} / ${message.worktree.state}`
      : message.preview || "No preview.";

    row.append(subject, meta, preview);

    if (message.twiccSessionUrl && typeof options.onOpenMessage === "function") {
      const twiccButton = document.createElement("button");
      twiccButton.className = "hawser-message-link";
      twiccButton.type = "button";
      twiccButton.textContent = "Open Twicc session";
      twiccButton.addEventListener("click", () => options.onOpenMessage(message));
      row.append(twiccButton);
    } else if (isPendingHawserSession(message)) {
      const pending = document.createElement("span");
      pending.className = "hawser-message-pending";
      pending.textContent = "Session pending";
      row.append(pending);
    }

    return row;
  }

  function appendMessageSection(title, messages) {
    if (!messages.length) {
      return;
    }

    const section = document.createElement("section");
    section.className = "hawser-message-section";

    const heading = document.createElement("h4");
    heading.textContent = title;
    section.append(heading, ...messages.map(createHawserMessageRow));
    list.append(section);
  }

  function renderMessages(data) {
    list.innerHTML = "";

    if (!data.messages.length) {
      const empty = document.createElement("p");
      empty.className = "hawser-message-empty";
      empty.textContent = "No active inbox or linked sessions.";
      list.append(empty);
      return;
    }

    const activeMessages = data.messages.filter(isActiveHawserMessage);
    const historyMessages = data.messages.filter((message) => !isActiveHawserMessage(message));
    appendMessageSection("Active", activeMessages);
    appendMessageSection("History", historyMessages);
  }

  async function refresh() {
    if (!document.body.contains(card)) {
      clearInterval(intervalId);
      return;
    }

    try {
      const data = await loadData(project);
      status.textContent = data.live ? "Live" : "Offline";
      status.classList.toggle("offline", !data.live);
      for (const [key, value] of metricValues) {
        value.textContent = String(data.counts?.[key] || 0);
      }
      renderMessages(data);
      footer.hidden = !data.error;
      footer.textContent = data.error || "";
    } catch (error) {
      status.textContent = "Error";
      status.classList.add("offline");
      footer.hidden = false;
      footer.textContent = error.message;
    }
  }

  const intervalId = setInterval(refresh, 5000);
  queueMicrotask(refresh);
  return card;
}

boatyardWindow.BoatyardHawserUI = Object.freeze({
  createWidget: createHawserWidget
});

function registerBuiltinWidgets() {
  const registry = boatyardWindow.BoatyardWidgetRegistry;

  if (!registry) {
    throw new Error("Widget registry is unavailable.");
  }

  [
    {
      id: "terminal-shell",
      name: "Terminal",
      title: "Terminal",
      scopes: ["global", "project"],
      category: "Developer tools",
      status: "experimental",
      description: "Persistent multi-tab tmux terminal.",
      layout: {
        default: { columns: 4, rows: 5 },
        min: { columns: 2, rows: 3 }
      },
      createElement: (project, props) => createTerminalWidget(project, props)
    }
  ].forEach((definition) => registry.register(definition));
}

registerBuiltinWidgets();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const widgetSurfaces = boatyardWindow.BoatyardWidgetSurfaces.create({
  boatyard: boatyardWindow.boatyard,
  getState: () => state,
  getProjectPluginConfig,
  getGlobalPluginConfig,
  isGlobalWorkspace,
  openProjectWebApp,
  createCard,
  createToolIcon,
  renderWorkspaceDashboard,
  dashboardGrid,
  clamp,
  minWidgetRailWidth: MIN_WIDGET_RAIL_WIDTH,
  defaultWidgetPaneId: DEFAULT_WIDGET_PANE_ID,
  widgetGridMinColumnWidth: WIDGET_GRID_MIN_COLUMN_WIDTH,
  widgetGridMaxColumnWidth: WIDGET_GRID_MAX_COLUMN_WIDTH,
  widgetGridRowHeight: WIDGET_GRID_ROW_HEIGHT,
  widgetGridGap: WIDGET_GRID_GAP,
  widgetGridScrollGuard: WIDGET_GRID_SCROLL_GUARD,
  legacyWidgetIds: LEGACY_WIDGET_IDS
});

function getInstalledWidgets(filter = {}) {
  return widgetSurfaces.getInstalledWidgets(filter);
}

function getProjectWidgetDefinitions(project = null) {
  return widgetSurfaces.getProjectWidgetDefinitions(project);
}

function getProjectWidgetPanes(project) {
  return widgetSurfaces.getProjectWidgetPanes(project);
}

function getProjectWidgetLayout(project, columnCount = null, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  return widgetSurfaces.getProjectWidgetLayout(project, columnCount, widgetPaneId);
}

function getOrderedWidgetDefinitions(project, layout) {
  return widgetSurfaces.getOrderedWidgetDefinitions(project, layout);
}

function getWidgetGridColumnCount(widgetRailWidth) {
  return widgetSurfaces.getWidgetGridColumnCount(widgetRailWidth);
}

function getWidgetRailColumnCount(widgetRail) {
  return widgetSurfaces.getWidgetRailColumnCount(widgetRail);
}

function applyWidgetGridLayout(widgetRail, project, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  widgetSurfaces.applyWidgetGridLayout(widgetRail, project, columnCount, widgetPaneId);
}

function createProjectWidget(project, definition, layout, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  return widgetSurfaces.createProjectWidget(project, definition, layout, columnCount, widgetPaneId);
}

function createWidgetPaneActions(project, widgetPane, layout, columnCount) {
  return widgetSurfaces.createWidgetPaneActions(project, widgetPane, layout, columnCount);
}

function createWidgetPaneSurface(project, widgetPane) {
  return widgetSurfaces.createWidgetPaneSurface(project, widgetPane);
}

function closeWidgetAddMenu() {
  widgetSurfaces.closeWidgetAddMenu();
}

function renderWorkspaceDashboard(project) {
  if (isGlobalWorkspace(project)) {
    renderGlobalDashboard();
  } else {
    renderProjectDashboard(project);
  }
}

function renderWorkspacePaneArea(project) {
  if (isGlobalWorkspace(project)) {
    renderGlobalPaneArea();
  } else {
    renderProjectPaneArea(project);
  }
}

function getProjectWebApps(project, paneId) {
  const paneNode = findPaneNode(getProjectPaneLayout(project), paneId);
  const webApps = getProjectWidgetPanes(project).map((widgetPane, index) => ({
    id: `widgets:${widgetPane.id}`,
    label: widgetPane.label || `Widgets ${index + 1}`,
    key: `${paneId}:widgets:${widgetPane.id}`,
    kind: "widgets",
    widgetPane
  }));

  if (paneNode?.transientWebApp?.url && paneNode.selectedWebAppId === paneNode.transientWebApp.id) {
    webApps.push({
      id: paneNode.transientWebApp.id,
      label: paneNode.transientWebApp.label || "Link",
      parentLabel: paneNode.transientWebApp.parentLabel || "",
      parentWebAppId: paneNode.transientWebApp.parentWebAppId || "",
      key: `${paneId}:transient:${paneNode.transientWebApp.id}`,
      url: paneNode.transientWebApp.url,
      restoreUrl: false,
      transient: true
    });
  }

  for (const homeTab of project.webAppHomeTabs || []) {
    webApps.push({
      id: homeTab.id,
      label: homeTab.label || "Link",
      parentLabel: homeTab.parentLabel || "",
      parentWebAppId: homeTab.parentWebAppId || "",
      key: `${paneId}:home:${homeTab.id}`,
      url: homeTab.url,
      homeTab: true,
      homeTabId: homeTab.id
    });
  }

  if (isGlobalWorkspace(project) || project.sourcePath) {
    webApps.push({
      id: "terminal",
      label: "Terminal",
      key: `${paneId}:terminal`,
      kind: "terminal"
    });
  }

  webApps.push({
    id: "manual",
    label: "Manual",
    key: `${paneId}:manual`,
    url: "https://boatyard.dev/doc/",
    restoreUrl: false
  });

  for (const pluginPane of getPluginPaneDefinitions({ scope: isGlobalWorkspace(project) ? "global" : "project", kind: "dom" })) {
    webApps.push({
      id: pluginPane.webAppId,
      label: pluginPane.title,
      key: `${paneId}:${pluginPane.key}`,
      kind: "dom",
      pluginPane
    });
  }

  for (const pluginPane of getPluginPaneDefinitions({ scope: isGlobalWorkspace(project) ? "global" : "project", kind: "wcv" })) {
    const projectPluginConfig = isGlobalWorkspace(project) ? {} : getProjectPluginConfig(project.id, pluginPane.pluginId);
    const context = {
      project,
      projectConfig: projectPluginConfig,
      globalPluginConfig: getGlobalPluginConfig(pluginPane.pluginId)
    };

    if (typeof pluginPane.resolveWebApps === "function") {
      for (const webApp of pluginPane.resolveWebApps(context) || []) {
        if (!webApp?.url) {
          continue;
        }
        webApps.push({
          id: webApp.id || `${pluginPane.webAppId}:${webApp.key || webApp.url}`,
          label: webApp.label || pluginPane.title,
          key: `${paneId}:${pluginPane.key}:${webApp.key || webApp.id || webApp.url}`,
          url: webApp.url,
          restoreUrl: webApp.restoreUrl
        });
      }
      continue;
    }

    const url = pluginPane.resolveUrl(context);
    if (!url) {
      continue;
    }

    webApps.push({
      id: pluginPane.webAppId,
      label: pluginPane.title,
      key: `${paneId}:${pluginPane.key}`,
      url
    });
  }

  if (!isGlobalWorkspace(project) && project.repoUrl) {
    webApps.push({
      id: "repo",
      label: "Repo",
      key: `${paneId}:repo`,
      url: project.repoUrl
    });
  }

  for (const projectUrl of project.urls || []) {
    webApps.push({
      id: `url:${projectUrl.id}`,
      label: isGlobalWorkspace(project) ? projectUrl.label : `URL: ${projectUrl.label}`,
      key: `${paneId}:url:${projectUrl.id}`,
      url: projectUrl.url
    });
  }

  return webApps;
}

function getProjectPaneLayout(project) {
  return paneLayoutState.getProjectPaneLayout(project);
}

function getSelectedWebApp(project, paneId, webApps) {
  return paneLayoutState.getSelectedWebApp(project, paneId, webApps);
}

function invokeWebApp(action, ...payload) {
  return boatyardWindow.boatyard[action](...payload).catch((error) => {
    console.error(`Could not ${action}:`, error);
  });
}

function isWebAppAutofillEnabled(webApp) {
  return webAppAutofillEnabledByKey.get(webApp.key) === true;
}

function isPasswordManagerEnabled() {
  const settings = getSettings();
  return settings.passwordManagerEnabled === true && settings.passwordManagerDisclaimerAccepted === true;
}

function syncWebAppAutofillButton(button, enabled) {
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  button.title = enabled
    ? "Saved login and password fill is enabled. Click to disable."
    : "Enable one-time fill with the saved login and password.";
  button.setAttribute("aria-label", button.title);
}

async function toggleWebAppAutofill(webApp, button) {
  const enabled = !isWebAppAutofillEnabled(webApp);
  webAppAutofillEnabledByKey.set(webApp.key, enabled);
  syncWebAppAutofillButton(button, enabled);
  await invokeWebApp("updateWebAppAutofill", webApp.key, enabled);
}

function getCurrentWebAppUrl(webApp) {
  if (webApp.restoreUrl === false) {
    return webApp.url;
  }

  return currentWebAppUrlsByKey.get(webApp.key) || webApp.url;
}

function getVisibleWebAppByKey(key) {
  for (const { webApp } of visibleWebAppHosts.values()) {
    if (webApp.key === key) {
      return webApp;
    }
  }

  return null;
}

function getVisibleWebAppEntryByKey(key) {
  for (const [paneId, entry] of visibleWebAppHosts.entries()) {
    if (entry.webApp.key === key) {
      return {
        ...entry,
        paneId
      };
    }
  }

  return null;
}

function getVisibleWebAppEntryByUrl(url) {
  if (!url) {
    return null;
  }

  for (const [paneId, entry] of visibleWebAppHosts.entries()) {
    if (getCurrentWebAppUrl(entry.webApp) === url || entry.webApp.url === url) {
      return {
        ...entry,
        paneId
      };
    }
  }

  return null;
}

function getVisibleWebAppProject() {
  if (currentView === "global") {
    return getGlobalWorkspace();
  }

  if (currentView === "project") {
    return getCurrentProject();
  }

  return null;
}

function persistVisibleWebAppPaneLayout(key, url = "") {
  if (isOnboardingTourActive()) {
    return;
  }

  const sourceEntry = getVisibleWebAppEntryByKey(key);
  const project = sourceEntry ? getVisibleWebAppProject() : null;
  if (project) {
    const paneNode = findPaneNode(getProjectPaneLayout(project), sourceEntry.paneId);
    if (paneNode?.transientWebApp?.id === sourceEntry.webApp.id && url) {
      paneNode.transientWebApp = {
        ...paneNode.transientWebApp,
        url
      };
    }
    persistPaneLayout(project);
  }
}

function findFirstPaneNode(node) {
  return paneLayoutState.findFirstPaneNode(node);
}

function collectPaneNodes(node, panes = []) {
  return paneLayoutState.collectPaneNodes(node, panes);
}

function findPaneNodeBySelectedWebApp(node, webAppId) {
  return paneLayoutState.findPaneNodeBySelectedWebApp(node, webAppId);
}

function createSplitNode(project, direction, first, selectedWebAppId = null) {
  return paneLayoutState.createSplitNode(project, direction, first, selectedWebAppId);
}

function findPaneNode(node, paneId) {
  return paneLayoutState.findPaneNode(node, paneId);
}

function replacePaneNode(node, paneId, replacement) {
  return paneLayoutState.replacePaneNode(node, paneId, replacement);
}

function countPaneNodes(node) {
  return paneLayoutState.countPaneNodes(node);
}

function openProjectWebApp(projectId, webAppId, url = "") {
  const project = getProjects().find((candidate) => candidate.id === projectId);
  if (!project) {
    return false;
  }

  const layout = getProjectPaneLayout(project);
  const paneNode = findPaneNodeBySelectedWebApp(layout, webAppId) || findFirstPaneNode(layout);
  if (!paneNode) {
    return false;
  }

  const webApp = getProjectWebApps(project, paneNode.id).find((candidate) => candidate.id === webAppId);
  if (!webApp) {
    return false;
  }

  paneLayoutState.setSelectedWebAppForPane(paneNode.id, webApp.id);
  paneNode.selectedWebAppId = webApp.id;
  paneLayoutState.setSelectedWebAppForProject(project.id, webApp.id);

  if (url) {
    currentWebAppUrlsByKey.set(webApp.key, url);
  }

  persistPaneLayout(project);
  renderWorkspacePaneArea(project);

  if (url) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => invokeWebApp("navigateWebApp", webApp.key, "open", url));
    });
  }

  return true;
}

boatyardWindow.BoatyardPaneNavigation = Object.freeze({
  openProjectWebApp
});

const paneLayoutView = boatyardWindow.BoatyardPaneLayoutView.create({
  minWidgetRailWidth: MIN_WIDGET_RAIL_WIDTH,
  webAppSplitResizerSize: WEBAPP_SPLIT_RESIZER_SIZE,
  dashboardGrid,
  createToolIcon,
  paneLayoutState,
  getProjectWebApps,
  getProjectPaneLayout,
  getSelectedWebApp,
  getProjectWidgetLayout,
  getWidgetGridColumnCount,
  createWidgetPaneActions,
  createWidgetPaneSurface,
  createWidgetPaneTabs,
  isWebAppTabMenuOpen,
  closeWebAppTabMenu,
  openWebAppTabMenuFromButton,
  openWebAppHomeMenu,
  openWebAppRefreshMenu,
  createTerminalSurface,
  invokeWebApp,
  isPasswordManagerEnabled,
  isWebAppAutofillEnabled,
  syncWebAppAutofillButton,
  toggleWebAppAutofill,
  getCurrentWebAppUrl,
  setCurrentWebAppUrl: (key, url) => {
    currentWebAppUrlsByKey.set(key, url);
  },
  normalizeAddressInput,
  isGlobalWorkspace,
  getProjectPluginConfig,
  getGlobalPluginConfig,
  getAllProjectPluginConfig: (project) => (isGlobalWorkspace(project) ? {} : state.pluginConfig?.projects?.[project.id] || {}),
  openProjectWebApp,
  setVisibleWebAppHost: (paneId, entry) => {
    visibleWebAppHosts.set(paneId, entry);
  },
  queueWebAppSync,
  renderWorkspaceDashboard,
  persistPaneLayout
});

function createPaneLayout(project, node) {
  return paneLayoutView.createPaneLayout(project, node);
}

function persistPaneLayout(project) {
  paneLayoutState.persistPaneLayout(project);
}

function hydratePaneLayouts() {
  paneLayoutState.hydratePaneLayouts(state.paneLayouts || {});
}

function hydrateWidgetLayouts() {
  widgetSurfaces.hydrateWidgetLayouts();
}

function hydrateTerminalTabOrders() {
  terminalSurfaces.hydrateTerminalTabOrders();
}

function renderGlobalDashboard() {
  const globalWorkspace = getGlobalWorkspace();
  closeWidgetAddMenu();
  closeProjectGroupMenu();
  closeTerminalTabMenu();
  visibleWebAppHosts = new Map();
  workspace.classList.add("project-mode");
  workspaceKicker.textContent = "Global";
  workspaceTitle.textContent = "System overview";
  workspaceSummary.textContent = "Global workspace for cross-project widgets and operations dashboards.";
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-workbench";
  dashboardGrid.style.gridTemplateColumns = "";

  dashboardGrid.append(createPaneLayout(globalWorkspace, getProjectPaneLayout(globalWorkspace)));
}

function renderGlobalPaneArea() {
  if (
    currentView !== "global" ||
    !dashboardGrid.classList.contains("project-workbench")
  ) {
    renderGlobalDashboard();
    return;
  }

  const globalWorkspace = getGlobalWorkspace();
  closeWebAppTabMenu();
  closeProjectGroupMenu();
  closeTerminalTabMenu();
  visibleWebAppHosts = new Map();
  const paneLayoutElement = createPaneLayout(globalWorkspace, getProjectPaneLayout(globalWorkspace));
  const currentPaneLayoutElement = dashboardGrid.lastElementChild;

  if (!currentPaneLayoutElement) {
    renderGlobalDashboard();
    return;
  }

  currentPaneLayoutElement.replaceWith(paneLayoutElement);
}

function createManualSection(section) {
  const card = document.createElement("article");
  card.className = "manual-section";
  card.id = `manual-${section.id}`;

  const heading = document.createElement("div");
  heading.className = "manual-section-heading";

  const title = document.createElement("h3");
  title.textContent = section.title;

  const summary = document.createElement("p");
  summary.textContent = section.summary || "";
  heading.append(title, summary);

  const entries = document.createElement("div");
  entries.className = "manual-entry-list";

  for (const entry of section.entries || []) {
    const item = document.createElement("section");
    item.className = "manual-entry";

    const itemTitle = document.createElement("h4");
    itemTitle.textContent = entry.title;

    const itemBody = document.createElement("p");
    itemBody.textContent = entry.body;
    item.append(itemTitle, itemBody);
    entries.append(item);
  }

  card.append(heading, entries);
  return card;
}

function createManualSurface({ includeIntroAction = true } = {}) {
  const manual = getManual();
  const content = document.createElement("div");
  content.className = "manual-content";

  const intro = document.createElement("section");
  intro.className = "manual-intro";

  const introTitle = document.createElement("h3");
  introTitle.textContent = "Working with Boatyard";

  const introBody = document.createElement("p");
  introBody.textContent = "Use this manual as an operational reference while configuring projects, arranging panes, and enabling plugins.";

  intro.append(introTitle, introBody);

  if (includeIntroAction) {
    const introActions = document.createElement("div");
    introActions.className = "manual-actions";

    const tourButton = document.createElement("button");
    tourButton.className = "primary-button";
    tourButton.type = "button";
    tourButton.textContent = "Start guided tour";
    tourButton.addEventListener("click", () => openOnboardingTour({ force: true }));
    introActions.append(tourButton);
    intro.append(introActions);
  }

  content.append(intro);

  for (const section of manual.sections || []) {
    content.append(createManualSection(section));
  }

  return content;
}

function renderManualPage() {
  const manual = getManual();
  closeWidgetAddMenu();
  visibleWebAppHosts = new Map();
  invokeWebApp("hideWebApp");
  workspace.classList.remove("project-mode");
  workspaceKicker.textContent = "Help";
  workspaceTitle.textContent = manual.title;
  workspaceSummary.textContent = manual.description || "";
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "manual-page";
  dashboardGrid.style.gridTemplateColumns = "";

  const nav = document.createElement("nav");
  nav.className = "manual-nav";
  nav.setAttribute("aria-label", "Manual sections");

  const navTitle = document.createElement("h3");
  navTitle.textContent = "Contents";
  nav.append(navTitle);

  for (const section of manual.sections || []) {
    const link = document.createElement("a");
    link.href = `#manual-${section.id}`;
    link.textContent = section.title;
    nav.append(link);
  }

  const note = document.createElement("p");
  note.className = "manual-hosting-note";
  note.textContent = "Public documentation hosting will use the future Boatyard documentation domain.";
  nav.append(note);

  dashboardGrid.append(nav, createManualSurface());
}

function renderGlobalSettingsPage() {
  closeWidgetAddMenu();
  closeTerminalTabMenu();
  visibleWebAppHosts = new Map();
  invokeWebApp("hideWebApp");
  workspace.classList.remove("project-mode");
  workspaceKicker.textContent = "Global";
  workspaceTitle.textContent = "Global settings";
  workspaceSummary.textContent = "";
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-form-layout global-settings-layout";
  dashboardGrid.style.gridTemplateColumns = "";

  dashboardGrid.append(createGlobalUpdateCard(), createGlobalProjectsSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalUrlsSettingsForm({
    onSubmit: async (urls) => {
      state = await boatyardWindow.boatyard.updateGlobalUrls(urls);
      hydratePaneLayouts();
      hydrateWidgetLayouts();
      renderGlobalSettingsPage();
    }
  }), createGlobalPresentationSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalTerminalSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalPasswordManagerSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalWebAppOpenRulesSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalPluginsSettingsView(), createGlobalWidgetsSettingsView());

  boatyardWindow.BoatyardPluginRegistry?.emit("boatyard.globalSettings.opened", {
    forPlugin: (pluginId) => ({
      globalConfig: getGlobalPluginConfig(pluginId)
    })
  });
}

function renderProjectDashboard(project) {
  closeWidgetAddMenu();
  closeTerminalTabMenu();
  detachProjectTerminal(project.id);
  workspace.classList.add("project-mode");
  workspaceKicker.textContent = "Project";
  workspaceTitle.textContent = project.name;
  workspaceSummary.textContent = getProjectSummaryTarget(project);
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-workbench";
  dashboardGrid.style.gridTemplateColumns = "";
  visibleWebAppHosts = new Map();

  dashboardGrid.append(createPaneLayout(project, getProjectPaneLayout(project)));
}

function renderProjectPaneArea(project) {
  if (
    currentView !== "project" ||
    currentProjectId !== project.id ||
    !dashboardGrid.classList.contains("project-workbench")
  ) {
    renderProjectDashboard(project);
    return;
  }

  closeWebAppTabMenu();
  closeTerminalTabMenu();
  visibleWebAppHosts = new Map();
  const paneLayoutElement = createPaneLayout(project, getProjectPaneLayout(project));
  const currentPaneLayoutElement = dashboardGrid.lastElementChild;

  if (!currentPaneLayoutElement) {
    renderProjectDashboard(project);
    return;
  }

  currentPaneLayoutElement.replaceWith(paneLayoutElement);
}

const webAppMenus = boatyardWindow.BoatyardWebAppMenus.create({
  webAppOpenSplitRatio: WEBAPP_OPEN_SPLIT_RATIO,
  getCurrentWebAppUrl,
  getSettings,
  getProjectById,
  getProjectWidgetPanes,
  getVisibleWebAppEntryByKey,
  getVisibleWebAppEntryByUrl,
  getVisibleWebAppProject,
  getProjectPaneLayout,
  getWebAppHostBounds,
  findPaneNode,
  createSplitNode,
  replacePaneNode,
  setPaneLayout: paneLayoutState.setPaneLayout,
  setSelectedWebAppForPane: paneLayoutState.setSelectedWebAppForPane,
  getSelectedWebAppForPane: paneLayoutState.getSelectedWebAppForPane,
  setSelectedWebAppForProject: paneLayoutState.setSelectedWebAppForProject,
  getSelectedWebAppForProject: paneLayoutState.getSelectedWebAppForProject,
  setCurrentWebAppUrl: (key, url) => {
    currentWebAppUrlsByKey.set(key, url);
  },
  persistPaneLayout,
  renderWorkspaceDashboard,
  updateWebAppHomeTab: async (projectId, tab) => {
    state = await boatyardWindow.boatyard.updateWebAppHomeTab(projectId, tab);
    return state;
  },
  updateSettings: async (values) => {
    state = await boatyardWindow.boatyard.updateSettings(values);
    return state;
  },
  updateProject: async (projectId, values) => {
    state = await boatyardWindow.boatyard.updateProject(projectId, values);
    return state;
  },
  invokeWebApp,
  openExternal: (url) => boatyardWindow.boatyard.openExternal(url),
  showOverlayDialog,
  normalizePayloadBounds,
  freezeWebAppsForOverlay,
  restoreWebAppsAfterOverlay,
  closeTerminalTabMenu,
  clamp,
  isGlobalWorkspace,
  isWebAppLoaded: (key) => loadedWebAppKeys.has(key)
});

function applyWebAppOpenChoice(payload, choice) {
  return webAppMenus.applyWebAppOpenChoice(payload, choice);
}

function closeWebAppTabMenu() {
  webAppMenus.closeWebAppTabMenu();
}

function createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, options = {}) {
  return webAppMenus.createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, options);
}

function normalizeAddressInput(rawUrl) {
  return webAppMenus.normalizeAddressInput(rawUrl);
}

function openWebAppHomeMenu(event, project, paneNode, selectedWebApp) {
  return webAppMenus.openWebAppHomeMenu(event, project, paneNode, selectedWebApp);
}

function openWebAppOpenUrlDialog(payload = {}) {
  return webAppMenus.openWebAppOpenUrlDialog(payload);
}

function openWebAppRefreshMenu(event, selectedWebApp) {
  return webAppMenus.openWebAppRefreshMenu(event, selectedWebApp);
}

function openWebAppTabMenuFromButton(button, project, paneNode, selectedWebApp, webApps) {
  return webAppMenus.openWebAppTabMenuFromButton(button, project, paneNode, selectedWebApp, webApps);
}

function isWebAppTabMenuOpen() {
  return webAppMenus.isWebAppTabMenuOpen();
}

const updateViews = boatyardWindow.BoatyardUpdateViews.create({
  boatyard: boatyardWindow.boatyard,
  createToolIcon,
  showOverlayDialog,
  sidebarUpdateNotice,
  updatePollIntervalMs: UPDATE_POLL_INTERVAL_MS
});

function renderSidebarUpdateNotice() {
  updateViews.renderSidebarUpdateNotice();
}

function createGlobalUpdateCard() {
  return updateViews.createGlobalUpdateCard();
}

function openChangelogDialog(changelog, options = {}) {
  return updateViews.openChangelogDialog(changelog, options);
}

function maybeOpenPendingChangelog() {
  return updateViews.maybeOpenPendingChangelog();
}

function loadPreparedUpdateNotice() {
  return updateViews.loadPreparedUpdateNotice();
}

function startUpdatePolling() {
  updateViews.startUpdatePolling();
}

function resetActiveUpdateCardUpdater() {
  updateViews.resetActiveUpdateCardUpdater();
}

const onboardingTour = boatyardWindow.BoatyardOnboardingTour.create({
  elements: {
    addProjectButton,
    projectList
  },
  onboardingVersion: ONBOARDING_VERSION,
  getManual,
  getViewState: () => ({ currentView }),
  selectGlobalForTour: () => {
    setCurrentView("global", null, { persist: false });
    render();
  },
  getGlobalWorkspace,
  getProjectWebApps,
  getProjectPaneLayout,
  getSelectedWebApp,
  findPaneNode,
  findFirstPaneNode,
  collectPaneNodes,
  countPaneNodes,
  createSplitNode,
  replacePaneNode,
  setPaneLayout: paneLayoutState.setPaneLayout,
  getPaneLayout: paneLayoutState.getPaneLayout,
  setSelectedWebAppForPane: paneLayoutState.setSelectedWebAppForPane,
  getSelectedWebAppForPane: paneLayoutState.getSelectedWebAppForPane,
  setSelectedWebAppForProject: paneLayoutState.setSelectedWebAppForProject,
  getSelectedWebAppForProject: paneLayoutState.getSelectedWebAppForProject,
  deleteSelectedWebAppForPane: paneLayoutState.deleteSelectedWebAppForPane,
  deleteSelectedWebAppForProject: paneLayoutState.deleteSelectedWebAppForProject,
  getVisibleWebAppEntries: () => visibleWebAppHosts.values(),
  renderWorkspaceDashboard,
  closeWebAppTabMenu,
  openWebAppTabMenuFromButton,
  waitForWebAppLoad,
  syncWebAppView,
  freezeWebAppsForOverlay,
  restoreWebAppsAfterOverlay,
  nextAnimationFrame,
  updateOnboarding: async (values) => {
    state.onboarding = await boatyardWindow.boatyard.updateOnboarding(values);
    return state.onboarding;
  },
  updatePaneLayout: (projectId, layout) => boatyardWindow.boatyard.updatePaneLayout(projectId, layout)
});

function ensureOnboardingDemoProject() {
  return onboardingTour.ensureOnboardingDemoProject();
}

function isOnboardingDemoProjectVisible() {
  return onboardingTour.isDemoProjectVisible();
}

function isOnboardingTourActive() {
  return onboardingTour.isTourActive();
}

function openOnboardingTour(options = {}) {
  return onboardingTour.openOnboardingTour(options);
}

const projectSidebar = boatyardWindow.BoatyardProjectSidebar.create({
  elements: {
    addProjectButton,
    globalNav,
    globalNavRow,
    globalViewButton,
    projectCount,
    projectList,
    projectSearchInput
  },
  getViewState: () => ({ currentView, currentProjectId }),
  getProjects,
  getProjectGroups,
  getProjectGroupsByName,
  getCollapsedProjectGroups,
  normalizeProjectSearchText,
  projectMatchesSearch,
  renderSidebarUpdateNotice,
  renderProjectNavBadges,
  selectProject,
  selectEditProject,
  clamp,
  applyFormControl,
  applyFormControls,
  showOverlayDialog,
  isOnboardingDemoProjectVisible,
  ensureOnboardingDemoProject,
  updateNavigation: async (values) => {
    const navigation = await boatyardWindow.boatyard.updateNavigation(values);
    state = {
      ...state,
      navigation
    };
    return navigation;
  },
  updateProject: async (projectId, values) => {
    state = await boatyardWindow.boatyard.updateProject(projectId, values);
    return state;
  },
  reorderProjectIds: async (projectIds) => {
    state = await boatyardWindow.boatyard.reorderProjects(projectIds);
    return state;
  },
  renderApp: render
});

function closeProjectGroupMenu() {
  projectSidebar.closeProjectGroupMenu();
}

function renderProjectList() {
  projectSidebar.renderProjectList();
}

const projectSettingsViews = boatyardWindow.BoatyardProjectSettingsViews.create({
  boatyard: boatyardWindow.boatyard,
  getState: () => state,
  getSettings,
  getProjectGroups,
  getProjectWidgetPanes,
  getProjectPluginConfig,
  getGlobalPluginConfig,
  getPluginProjectSettingsSections,
  applyFormControl,
  applyFormControls,
  readPluginSettingsFieldValue,
  deriveRepoUrl,
  deriveProjectNameFromPath,
  formatProjectNameFromPath,
  slugify
});

const globalSettingsViews = boatyardWindow.BoatyardGlobalSettingsViews.create({
  boatyard: boatyardWindow.boatyard,
  applyFormControl,
  applyFormControls,
  getInstalledWidgets,
  getPluginGlobalSettingsSections,
  getGlobalPluginConfig,
  readPluginSettingsFieldValue,
  showOverlayDialog,
  renderGlobalSettingsPage,
  updatePluginEnabled: async (pluginId, enabled) => {
    state = await boatyardWindow.boatyard.updatePluginEnabled(pluginId, enabled);
    boatyardWindow.BoatyardPluginRegistry.setEnabled(pluginId, enabled);
  },
  updateGlobalPluginConfig: async (pluginId, values) => {
    state = await boatyardWindow.boatyard.updateGlobalPluginConfig(pluginId, values);
  }
});

function createGlobalProjectsSettingsForm(options) {
  return globalSettingsViews.createGlobalProjectsSettingsForm(options);
}

function createGlobalPresentationSettingsForm(options) {
  return globalSettingsViews.createGlobalPresentationSettingsForm(options);
}

function createGlobalTerminalSettingsForm(options) {
  return globalSettingsViews.createGlobalTerminalSettingsForm(options);
}

function createGlobalPasswordManagerSettingsForm(options) {
  return globalSettingsViews.createGlobalPasswordManagerSettingsForm(options);
}

function createGlobalWebAppOpenRulesSettingsForm(options) {
  return globalSettingsViews.createGlobalWebAppOpenRulesSettingsForm(options);
}

function createGlobalPluginsSettingsView() {
  return globalSettingsViews.createGlobalPluginsSettingsView();
}

function createGlobalWidgetsSettingsView() {
  return globalSettingsViews.createGlobalWidgetsSettingsView();
}

function createGlobalUrlsSettingsForm(options) {
  return projectSettingsViews.createGlobalUrlsSettingsForm(options);
}

function createProjectDangerZone(options) {
  return projectSettingsViews.createProjectDangerZone(options);
}

function createProjectFormView(options) {
  return projectSettingsViews.createProjectFormView(options);
}

function createProjectTerminalSettingsForm(options) {
  return projectSettingsViews.createProjectTerminalSettingsForm(options);
}

function createProjectUrlsForm(options) {
  return projectSettingsViews.createProjectUrlsForm(options);
}

function createProjectWebAppHomeTabsForm(options) {
  return projectSettingsViews.createProjectWebAppHomeTabsForm(options);
}

function createProjectWidgetPanesForm(options) {
  return projectSettingsViews.createProjectWidgetPanesForm(options);
}

function renderCreateProjectPage() {
  visibleWebAppHosts = new Map();
  invokeWebApp("hideWebApp");
  workspace.classList.remove("project-mode");
  workspaceKicker.textContent = "Project";
  workspaceTitle.textContent = "Add project";
  workspaceSummary.textContent = "";
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-form-layout";
  dashboardGrid.style.gridTemplateColumns = "";

  dashboardGrid.append(createProjectFormView({
    title: "Project details",
    submitLabel: "Add project",
    initialValues: {},
    onCancel: () => restoreReturnView(),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.addProject({
        name: values.name,
        slug: values.slug,
        group: values.group,
        sourcePath: values.sourcePath,
        gitUrl: values.gitUrl,
        repoUrl: values.repoUrl,
        devBranch: values.devBranch,
        isOpen: false
      });
      const project = state.projects[state.projects.length - 1];
      state = await persistProjectPluginConfig(
        project.id,
        values.pluginConfig
      );
      selectProject(project.id);
    }
  }));
}

function renderEditProjectPage(project) {
  visibleWebAppHosts = new Map();
  invokeWebApp("hideWebApp");
  workspace.classList.remove("project-mode");
  workspaceKicker.textContent = "Project";
  workspaceTitle.textContent = `${project.name} settings`;
  workspaceSummary.textContent = project.slug;
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-form-layout project-settings-layout";
  dashboardGrid.style.gridTemplateColumns = "";

  const primaryColumn = document.createElement("div");
  primaryColumn.className = "project-settings-primary";

  const secondaryColumn = document.createElement("div");
  secondaryColumn.className = "project-settings-secondary";

  primaryColumn.append(createProjectFormView({
    title: "Project settings",
    submitLabel: "Save changes",
    initialValues: project,
    onCancel: () => selectProject(project.id),
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateProject(project.id, {
        name: values.name,
        slug: values.slug,
        group: values.group,
        sourcePath: values.sourcePath,
        gitUrl: values.gitUrl,
        repoUrl: values.repoUrl,
        devBranch: values.devBranch
      });
      state = await persistProjectPluginConfig(
        project.id,
        values.pluginConfig
      );
      reloadProjectSettings(project.id);
    }
  }));

  secondaryColumn.append(createProjectTerminalSettingsForm({
    project,
    onSubmit: async (values) => {
      state = await boatyardWindow.boatyard.updateProject(project.id, values);
      reloadProjectSettings(project.id);
    }
  }), createProjectUrlsForm({
    project,
    onSubmit: async (urls) => {
      state = await boatyardWindow.boatyard.updateProject(project.id, { urls });
      reloadProjectSettings(project.id);
    }
  }), createProjectWebAppHomeTabsForm({
    project,
    onSubmit: async (homeTabs) => {
      state = await boatyardWindow.boatyard.updateWebAppHomeTabs(project.id, homeTabs);
      reloadProjectSettings(project.id);
    }
  }), createProjectWidgetPanesForm({
    project,
    onSubmit: async (widgetPanes) => {
      state = await boatyardWindow.boatyard.updateProject(project.id, { widgetPanes });
      reloadProjectSettings(project.id);
    }
  }), createProjectDangerZone({
    project,
    onUnregister: async () => {
      state = await boatyardWindow.boatyard.removeProject(project.id);
      selectGlobal();
    }
  }));

  dashboardGrid.append(primaryColumn, secondaryColumn);
}

const webAppSurfaces = boatyardWindow.BoatyardWebAppSurfaces.create({
  boatyard: boatyardWindow.boatyard,
  getSettings,
  getVisibleWebAppEntries: () => visibleWebAppHosts.values(),
  invokeWebApp,
  isWebAppAutofillEnabled,
  markWebAppLoaded: (key) => {
    loadedWebAppKeys.add(key);
  }
});

function getWebAppHostBounds(host) {
  return webAppSurfaces.getWebAppHostBounds(host);
}

function normalizePayloadBounds(bounds) {
  return webAppSurfaces.normalizePayloadBounds(bounds);
}

function syncWebAppView() {
  return webAppSurfaces.syncWebAppView();
}

function queueWebAppSync() {
  webAppSurfaces.queueWebAppSync();
}

function freezeWebAppsForOverlay(options = undefined) {
  return webAppSurfaces.freezeWebAppsForOverlay(options);
}

function restoreWebAppsAfterOverlay() {
  return webAppSurfaces.restoreWebAppsAfterOverlay();
}

function showOverlayDialog(dialog, options = {}) {
  return webAppSurfaces.showOverlayDialog(dialog, options);
}

boatyardWindow.BoatyardOverlayDialog = Object.freeze({
  show: showOverlayDialog
});

function maybeOpenInitialOnboarding() {
  if ((state.onboarding?.completedVersion || 0) >= ONBOARDING_VERSION) {
    return;
  }

  requestAnimationFrame(() => openOnboardingTour());
}

function selectGlobal() {
  setCurrentView("global");
  render();
}

function selectGlobalSettings() {
  setCurrentView("global-settings");
  render();
}

function selectCreateProject() {
  if (currentView !== "project-create") {
    returnView = {
      view: currentView,
      projectId: currentProjectId
    };
  }
  setCurrentView("project-create", null, { persist: false });
  render();
}

function selectProject(id) {
  setCurrentView("project", id);
  render();
}

function selectEditProject(id) {
  setCurrentView("project-edit", id);
  render();
}

function reloadProjectSettings(id) {
  setCurrentView("project-edit", id);
  render();
}

function restoreReturnView() {
  if (returnView.view === "project" && getProjects().some((project) => project.id === returnView.projectId)) {
    selectProject(returnView.projectId);
    return;
  }

  selectGlobal();
}

function render() {
  resetActiveUpdateCardUpdater();
  renderProjectList();

  const project = getCurrentProject();
  detachInactiveProjectTerminals(currentView === "project" && project ? project.id : null);

  if (currentView === "project-create") {
    renderCreateProjectPage();
  } else if (currentView === "global-settings") {
    renderGlobalSettingsPage();
  } else if (currentView === "project-edit" && project) {
    renderEditProjectPage(project);
  } else if (currentView === "project" && project) {
    renderProjectDashboard(project);
  } else {
    renderGlobalDashboard();
  }
}

async function loadState() {
  state = await boatyardWindow.boatyard.getState();
  boatyardWindow.BoatyardPluginRegistry?.applyEnabledState(getPluginEnabledState());
  currentWebAppUrlsByKey.clear();
  for (const [key, webApp] of Object.entries(state.webApps || {}) as Array<[string, any]>) {
    if (webApp.url) {
      currentWebAppUrlsByKey.set(key, webApp.url);
    }
  }
  hydratePaneLayouts();
  hydrateWidgetLayouts();
  hydrateTerminalTabOrders();
  restoreNavigation();
  render();
  void loadPreparedUpdateNotice();
  startUpdatePolling();
  if (!(await maybeOpenPendingChangelog())) {
    maybeOpenInitialOnboarding();
  }
}

boatyardWindow.boatyard.onWebAppUrlChanged(({ key, url }) => {
  if (!key || !url) {
    return;
  }

  currentWebAppUrlsByKey.set(key, url);
  persistVisibleWebAppPaneLayout(key, url);
  for (const input of document.querySelectorAll<HTMLInputElement>(".webapp-url")) {
    if (input.dataset.webappKey === key && input !== document.activeElement) {
      input.value = url;
    }
  }
});

boatyardWindow.boatyard.onWebAppLoaded?.((payload) => {
  const { key, url } = payload || {};
  if (!key || !url) {
    return;
  }

  loadedWebAppKeys.add(key);
  loadedWebAppUrlsByKey.set(key, url);
  for (const waiter of [...webAppLoadWaiters]) {
    waiter(payload);
  }
});

boatyardWindow.boatyard.onWebAppAutofillChanged?.(({ key, enabled }) => {
  if (!key) {
    return;
  }

  webAppAutofillEnabledByKey.set(key, enabled === true);
  for (const button of document.querySelectorAll<HTMLButtonElement>(".webapp-tool-button.autofill")) {
    if (button.dataset.webappKey === key) {
      syncWebAppAutofillButton(button, enabled === true);
    }
  }
});

boatyardWindow.boatyard.onWebAppOpenUrlRequested?.((payload) => {
  if (payload?.target) {
    applyWebAppOpenChoice(payload, {
      target: payload.target,
      persist: false,
      scope: "exact",
      label: ""
    }).catch((error) => {
      console.error("Could not apply webapp URL opening rule:", error);
    });
    return;
  }

  openWebAppOpenUrlDialog(payload);
});

boatyardWindow.boatyard.onTerminalData((payload) => {
  terminalSurfaces.handleTerminalData(payload);
});

boatyardWindow.boatyard.onTerminalExit((payload) => {
  terminalSurfaces.handleTerminalExit(payload);
});

window.addEventListener("boatyard:plugin-status-changed", () => {
  if (currentView === "global-settings") {
    renderGlobalSettingsPage();
  }
});

window.addEventListener("boatyard:project-nav-badges-changed", renderProjectList);

window.addEventListener("boatyard:pier-workloads-changed", () => {
  if (currentView !== "project" || pierWorkloadPaneRefreshFrame) {
    return;
  }

  pierWorkloadPaneRefreshFrame = requestAnimationFrame(() => {
    pierWorkloadPaneRefreshFrame = null;
    renderWorkspacePaneArea(getCurrentProject());
  });
});

globalNav.addEventListener("click", selectGlobal);
globalSettingsButton.addEventListener("click", selectGlobalSettings);
globalViewButton.addEventListener("click", selectGlobal);
manualTourButton.addEventListener("click", () => openOnboardingTour({ force: true }));
addProjectButton.addEventListener("click", selectCreateProject);
window.addEventListener("resize", queueWebAppSync);
workspace.addEventListener("scroll", queueWebAppSync);

boatyardWindow.BoatyardPluginLoader?.ready
  ?.catch((error) => {
    console.error("Could not load plugins:", error);
  })
  .finally(loadState) || loadState();
