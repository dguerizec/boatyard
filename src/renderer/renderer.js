"use strict";

const globalNav = document.querySelector("#global-nav");
const globalNavRow = document.querySelector("#global-nav-row");
const globalSettingsButton = document.querySelector("#global-settings");
const globalViewButton = document.querySelector("#global-view");
const manualTourButton = document.querySelector("#manual-tour");
const sidebarUpdateNotice = document.querySelector("#sidebar-update-notice");
const addProjectButton = document.querySelector("#add-project");
const projectCount = document.querySelector("#project-count");
const projectSearchInput = document.querySelector("#project-search");
const projectList = document.querySelector("#project-list");
const workspace = document.querySelector(".workspace");
const dashboardGrid = document.querySelector("#dashboard-grid");
const workspaceKicker = document.querySelector("#workspace-kicker");
const workspaceTitle = document.querySelector("#workspace-title");
const workspaceSummary = document.querySelector("#workspace-summary");

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
const ONBOARDING_VERSION = window.BoatyardManual?.version || 1;
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

let state = { projects: [] };
let currentView = "global";
let currentProjectId = null;
let returnView = { view: "global", projectId: null };
const selectedWebAppByProject = new Map();
const paneLayoutsByProject = new Map();
const selectedWebAppByPane = new Map();
const loadedWebAppKeys = new Set();
const currentWebAppUrlsByKey = new Map();
const loadedWebAppUrlsByKey = new Map();
const webAppLoadWaiters = new Set();
const webAppAutofillEnabledByKey = new Map();
let visibleWebAppHosts = new Map();
let webAppBoundsFrame = null;
let nextPaneId = 1;
let frozenWebAppLayer = null;
let openWebAppTabMenu = null;
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
  return state.projects;
}

function getProjectGroups() {
  return [...new Set(getProjects()
    .map((project) => String(project.group || "").trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
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
  return window.BoatyardManual || {
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
  return window.BoatyardPluginRegistry?.listPanes(filter) || [];
}

function getPluginProjectNavBadgeDefinitions() {
  return window.BoatyardPluginRegistry?.listProjectNavBadges() || [];
}

function getPluginProjectSettingsSections() {
  return window.BoatyardPluginRegistry?.listProjectSettingsSections() || [];
}

function getPluginGlobalSettingsSections() {
  return window.BoatyardPluginRegistry?.listGlobalSettingsSections() || [];
}

function getPluginEnabledState() {
  return state.plugins?.enabled || {};
}

function getProjectSummaryTarget(project) {
  return project.sourcePath ||
    project.slug;
}

function renderProjectNavBadges(project, container, options = {}) {
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
    nextState = await window.boatyard.updateProjectPluginConfig(projectId, pluginId, config);
  }

  return nextState;
}

function readPluginSettingsFieldValue(field, input) {
  return window.BoatyardPluginSettingsFields.readFieldValue(field, input, {
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

  window.boatyard.updateNavigation({
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
  return new Promise((resolve) => {
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

const terminalSurfaces = window.BoatyardTerminalSurfaces.create({
  boatyard: window.boatyard,
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

function createHawserWidget(project, options = {}) {
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

window.BoatyardHawserUI = Object.freeze({
  createWidget: createHawserWidget
});

function registerBuiltinWidgets() {
  const registry = window.BoatyardWidgetRegistry;

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

const widgetSurfaces = window.BoatyardWidgetSurfaces.create({
  boatyard: window.boatyard,
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

function createPaneNode(project, selectedWebAppId = null) {
  const id = `${project.id}:pane:${nextPaneId}`;
  nextPaneId += 1;

  if (selectedWebAppId) {
    selectedWebAppByPane.set(id, selectedWebAppId);
  }

  return {
    type: "pane",
    id,
    selectedWebAppId: selectedWebAppId || null
  };
}

function getProjectPaneLayout(project) {
  if (!paneLayoutsByProject.has(project.id)) {
    paneLayoutsByProject.set(project.id, createPaneNode(project));
  }

  return paneLayoutsByProject.get(project.id);
}

function getSelectedWebApp(project, paneId, webApps) {
  const paneNode = findPaneNode(getProjectPaneLayout(project), paneId);
  const selectedId =
    selectedWebAppByPane.get(paneId) ||
    paneNode?.selectedWebAppId ||
    selectedWebAppByProject.get(project.id) ||
    webApps[0].id;
  return webApps.find((webApp) => webApp.id === selectedId) || webApps[0];
}

function invokeWebApp(action, ...payload) {
  return window.boatyard[action](...payload).catch((error) => {
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

function getWebAppOpenUrlLabel(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname || "Link";
  } catch {
    return "Link";
  }
}

function createTransientWebApp(url, label = "", parentWebApp = null) {
  return {
    id: `transient:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    label: label || getWebAppOpenUrlLabel(url),
    parentLabel: parentWebApp?.label || "",
    parentWebAppId: parentWebApp?.id || "",
    url
  };
}

function createWebAppHomeTabId() {
  return `home:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function getParentWebAppForDerivedTab(webApp) {
  if ((webApp?.transient || webApp?.homeTab) && webApp.parentWebAppId) {
    return {
      id: webApp.parentWebAppId,
      label: webApp.parentLabel || ""
    };
  }

  return webApp;
}

async function saveCurrentUrlAsWebAppHomeTab(project, paneNode, selectedWebApp) {
  const currentUrl = getCurrentWebAppUrl(selectedWebApp);
  if (!currentUrl) {
    return false;
  }

  const parentWebApp = getParentWebAppForDerivedTab(selectedWebApp);
  if (!parentWebApp?.id) {
    return false;
  }

  const nextTab = {
    id: selectedWebApp.homeTabId || createWebAppHomeTabId(),
    parentWebAppId: parentWebApp.id,
    parentLabel: parentWebApp.label || "",
    label: getWebAppOpenUrlLabel(currentUrl),
    url: currentUrl
  };

  state = await window.boatyard.updateWebAppHomeTab(project.id, nextTab);
  paneNode.selectedWebAppId = nextTab.id;
  selectedWebAppByPane.set(paneNode.id, nextTab.id);
  selectedWebAppByProject.set(project.id, nextTab.id);
  currentWebAppUrlsByKey.set(`${paneNode.id}:home:${nextTab.id}`, currentUrl);

  const updatedProject = getProjectById(project.id) || project;
  persistPaneLayout(updatedProject);
  renderWorkspaceDashboard(updatedProject);
  return true;
}

function openUrlInSplitPane(sourceWebAppKey, url, label = "") {
  const sourceEntry = getVisibleWebAppEntryByKey(sourceWebAppKey);
  return openUrlInSplitPaneFromEntry(sourceEntry, url, label);
}

function openUrlInSplitPaneFromEntry(sourceEntry, url, label = "") {
  const project = sourceEntry ? getVisibleWebAppProject() : null;
  if (!sourceEntry || !project) {
    return false;
  }

  const existingEntry = getVisibleWebAppEntryByUrl(url);
  if (existingEntry) {
    return true;
  }

  const layout = getProjectPaneLayout(project);
  const sourcePaneNode = findPaneNode(layout, sourceEntry.paneId);
  if (!sourcePaneNode) {
    return false;
  }

  const sourceWebAppId = sourceEntry.webApp.id;
  const sourceBounds = getWebAppHostBounds(sourceEntry.host);
  const splitDirection = sourceBounds && sourceBounds.height > 0 && sourceBounds.width / sourceBounds.height <= 1
    ? "horizontal"
    : "vertical";
  const replacement = createSplitNode(
    project,
    splitDirection,
    { ...sourcePaneNode, selectedWebAppId: sourceWebAppId },
    null
  );
  replacement.ratio = WEBAPP_OPEN_SPLIT_RATIO;
  replacement.second.transientWebApp = createTransientWebApp(url, label, sourceEntry.webApp);
  replacement.second.selectedWebAppId = replacement.second.transientWebApp.id;

  paneLayoutsByProject.set(project.id, replacePaneNode(layout, sourceEntry.paneId, replacement));
  selectedWebAppByPane.set(sourceEntry.paneId, sourceWebAppId);
  selectedWebAppByPane.set(replacement.second.id, replacement.second.selectedWebAppId);

  persistPaneLayout(project);
  renderWorkspaceDashboard(project);
  return true;
}

function getWebAppOpenRulePattern(url, scope) {
  const parsedUrl = new URL(url);
  if (scope === "host") {
    return parsedUrl.host;
  }

  if (scope === "path-prefix") {
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  }

  return parsedUrl.toString();
}

function upsertWebAppOpenRule(rules, nextRule) {
  return [
    ...rules.filter((rule) => !(rule.scope === nextRule.scope && rule.pattern === nextRule.pattern)),
    nextRule
  ];
}

async function applyWebAppOpenChoice(payload, choice) {
  const url = normalizeAddressInput(payload.url);

  if (choice.target === "external") {
    await window.boatyard.openExternal(url);
  } else if (choice.target === "split-pane") {
    const sourceEntry = getVisibleWebAppEntryByKey(payload.sourceWebAppKey) ||
      getVisibleWebAppEntryByUrl(payload.sourceUrl);
    if (!openUrlInSplitPaneFromEntry(sourceEntry, url, choice.label || "")) {
      const opened = await invokeWebApp("navigateWebApp", payload.sourceWebAppKey, "open", url);
      if (!opened) {
        await window.boatyard.openExternal(url);
      }
    }
  } else {
    await invokeWebApp("navigateWebApp", payload.sourceWebAppKey, "open", url);
  }

  if (!choice.persist) {
    return;
  }

  const settings = getSettings();
  const nextRule = {
    pattern: getWebAppOpenRulePattern(url, choice.scope),
    scope: choice.scope,
    target: choice.target,
    label: choice.label || ""
  };
  state = await window.boatyard.updateSettings({
    webAppOpenRules: upsertWebAppOpenRule(settings.webAppOpenRules || [], nextRule)
  });
}

function createRadioOption(name, value, labelText, descriptionText, checked = false) {
  const label = document.createElement("label");
  label.className = "webapp-open-option";

  const input = document.createElement("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.checked = checked;

  const copy = document.createElement("span");
  copy.innerHTML = `<strong>${labelText}</strong><small>${descriptionText}</small>`;

  label.append(input, copy);
  return { label, input };
}

async function openWebAppOpenUrlDialog(payload = {}) {
  let url = "";
  try {
    url = normalizeAddressInput(payload.url);
  } catch {
    return;
  }

  const sourceEntry = getVisibleWebAppEntryByKey(payload.sourceWebAppKey);
  const sourceWebApp = sourceEntry?.webApp || null;
  const sourceBounds = normalizePayloadBounds(payload.sourceBounds) || getWebAppHostBounds(sourceEntry?.host) || null;

  const dialog = document.createElement("dialog");
  dialog.className = "plugin-settings-dialog webapp-open-dialog";
  dialog.style.visibility = "hidden";
  if (sourceBounds) {
    dialog.classList.add("anchored");
    dialog.style.left = `${Math.round(sourceBounds.x + (sourceBounds.width / 2))}px`;
    dialog.style.top = `${Math.round(sourceBounds.y + (sourceBounds.height / 2))}px`;
  }

  const panel = document.createElement("form");
  panel.className = "plugin-settings-dialog-panel webapp-open-dialog-panel";

  const header = document.createElement("header");
  header.className = "plugin-settings-dialog-header";

  const title = document.createElement("h3");
  title.textContent = "Open URL";

  const closeButton = document.createElement("button");
  closeButton.className = "icon-button";
  closeButton.type = "button";
  closeButton.title = "Close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "X";
  closeButton.addEventListener("click", () => dialog.close());
  header.append(title, closeButton);

  const summary = document.createElement("div");
  summary.className = "webapp-open-summary";
  const source = document.createElement("span");
  source.textContent = sourceWebApp ? `From ${sourceWebApp.label}` : "From webapp";
  const urlText = document.createElement("code");
  urlText.textContent = url;
  summary.append(source, urlText);

  const targetGroup = document.createElement("div");
  targetGroup.className = "webapp-open-options";
  const samePane = createRadioOption(
    "webAppOpenTarget",
    "same-pane",
    "Same pane",
    "Navigate the current webapp pane to this URL.",
    true
  );
  const splitPane = createRadioOption(
    "webAppOpenTarget",
    "split-pane",
    "Split pane",
    "Open this URL in a new pane next to the current one."
  );
  const external = createRadioOption(
    "webAppOpenTarget",
    "external",
    "External browser",
    "Open this URL outside Boatyard."
  );
  targetGroup.append(samePane.label, splitPane.label, external.label);

  const persistLabel = document.createElement("label");
  persistLabel.className = "webapp-open-persist";
  const persistInput = document.createElement("input");
  persistInput.type = "checkbox";
  persistInput.name = "persistRule";
  const persistCopy = document.createElement("span");
  persistCopy.innerHTML = "<strong>Always use this method</strong><small>Save a rule in global settings.</small>";
  persistLabel.append(persistInput, persistCopy);

  const scopeLabel = document.createElement("label");
  scopeLabel.className = "webapp-open-scope";
  const scopeText = document.createElement("span");
  scopeText.textContent = "Rule scope";
  const scopeSelect = document.createElement("select");
  scopeSelect.name = "ruleScope";
  for (const [value, label] of [
    ["exact", "Exact URL"],
    ["host", "This host"],
    ["path-prefix", "This path prefix"]
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    scopeSelect.append(option);
  }
  scopeLabel.append(scopeText, scopeSelect);
  scopeLabel.hidden = true;

  persistInput.addEventListener("change", () => {
    scopeLabel.hidden = !persistInput.checked;
  });

  const error = document.createElement("p");
  error.className = "form-error";
  error.hidden = true;

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
  submitButton.textContent = "Open";
  actions.append(cancelButton, submitButton);

  panel.append(header, summary, targetGroup, persistLabel, scopeLabel, error, actions);
  panel.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submitButton.disabled = true;

    try {
      await applyWebAppOpenChoice(payload, {
        target: panel.elements.webAppOpenTarget.value,
        persist: persistInput.checked,
        scope: scopeSelect.value,
        label: sourceWebApp?.label || ""
      });
      dialog.close();
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  dialog.append(panel);
  await showOverlayDialog(dialog, {
    freeze: "overlap",
    removeOnClose: true,
    freezeMargin: 16
  });
}

function normalizeAddressInput(rawUrl) {
  const trimmed = String(rawUrl || "").trim();

  if (!trimmed) {
    throw new Error("URL is required.");
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed);
  const isLocalhost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/.test(trimmed);
  return hasProtocol ? trimmed : `${isLocalhost ? "http" : "https"}://${trimmed}`;
}

function selectWebApp(project, paneNode, webApp) {
  selectedWebAppByPane.set(paneNode.id, webApp.id);
  paneNode.selectedWebAppId = webApp.id;
  selectedWebAppByProject.set(project.id, webApp.id);
  persistPaneLayout(project);
  renderWorkspaceDashboard(project);
}

async function renameWidgetPane(project, widgetPane, nextLabel) {
  const currentLabel = widgetPane.label || "Widgets";
  const normalizedLabel = String(nextLabel || "").trim();
  if (!normalizedLabel || normalizedLabel === currentLabel) {
    return;
  }

  const widgetPanes = getProjectWidgetPanes(project).map((pane) => (
    pane.id === widgetPane.id
      ? { ...pane, label: normalizedLabel }
      : pane
  ));
  state = await window.boatyard.updateProject(project.id, { widgetPanes });
  renderWorkspaceDashboard(getProjectById(project.id) || project);
}

function editWidgetPaneLabel(project, widgetPane, button) {
  const editor = document.createElement("input");
  editor.className = "widget-pane-tab widget-pane-tab-editor";
  editor.type = "text";
  editor.value = widgetPane.label || "Widgets";
  editor.setAttribute("aria-label", "Widget page name");

  let finished = false;
  const finish = async (shouldSave) => {
    if (finished) {
      return;
    }
    finished = true;

    const nextLabel = editor.value;
    editor.replaceWith(button);
    if (!shouldSave) {
      return;
    }

    try {
      await renameWidgetPane(project, widgetPane, nextLabel);
    } catch (error) {
      console.error("Could not rename widget pane:", error);
    }
  };

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  editor.addEventListener("blur", () => finish(true));

  button.replaceWith(editor);
  editor.focus();
  editor.select();
}

function createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, options = {}) {
  const widgetWebApps = webApps.filter((webApp) => webApp.kind === "widgets");
  const list = document.createElement("div");
  list.className = "widget-pane-tabs";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "Widget pages");

  for (const webApp of widgetWebApps) {
    if (options.editing && webApp.id !== selectedWebApp.id) {
      continue;
    }

    const button = document.createElement("button");
    button.className = "widget-pane-tab";
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(webApp.id === selectedWebApp.id));
    button.textContent = webApp.label;
    button.addEventListener("click", () => {
      if (webApp.id !== selectedWebApp.id) {
        selectWebApp(project, paneNode, webApp);
      }
    });
    if (!isGlobalWorkspace(project)) {
      button.title = "Double-click to rename widget page";
      button.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        editWidgetPaneLabel(project, webApp.widgetPane, button);
      });
    }
    list.append(button);
  }

  return list;
}

function closeWebAppTabMenu() {
  if (!openWebAppTabMenu) {
    return;
  }

  openWebAppTabMenu.cleanup?.();
  openWebAppTabMenu.remove();
  openWebAppTabMenu = null;
  restoreWebAppsAfterOverlay();
}

async function openWebAppTabMenuFromButton(button, project, paneNode, selectedWebApp, webApps) {
  closeWebAppTabMenu();
  closeTerminalTabMenu();

  const rect = button.getBoundingClientRect();
  await freezeWebAppsForOverlay({
    keys: selectedWebApp?.key ? [selectedWebApp.key] : []
  });

  const menu = document.createElement("div");
  menu.className = "webapp-tab-menu";
  menu.setAttribute("role", "menu");

  menu.style.top = `${Math.round(rect.bottom + 6)}px`;
  menu.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - 220))}px`;

  const rootWebApps = webApps.filter((webApp) => !webApp.parentWebAppId);
  const childWebAppsByParentId = new Map();
  for (const webApp of webApps.filter((candidate) => candidate.parentWebAppId)) {
    const children = childWebAppsByParentId.get(webApp.parentWebAppId) || [];
    children.push(webApp);
    childWebAppsByParentId.set(webApp.parentWebAppId, children);
  }
  const orderedWebApps = [];
  for (const webApp of rootWebApps) {
    orderedWebApps.push({
      webApp,
      depth: 0
    });
    for (const childWebApp of childWebAppsByParentId.get(webApp.id) || []) {
      orderedWebApps.push({
        webApp: childWebApp,
        depth: 1
      });
    }
  }
  for (const [parentId, children] of childWebAppsByParentId) {
    if (rootWebApps.some((webApp) => webApp.id === parentId)) {
      continue;
    }
    for (const webApp of children) {
      orderedWebApps.push({
        webApp,
        depth: 0
      });
    }
  }

  for (const { webApp, depth } of orderedWebApps) {
    const item = document.createElement("button");
    item.className = "webapp-tab-menu-item";
    item.classList.toggle("child", depth > 0);
    item.classList.toggle("loaded", loadedWebAppKeys.has(webApp.key));
    item.type = "button";
    item.dataset.webAppId = webApp.id;
    item.setAttribute("role", "menuitem");
    item.setAttribute("aria-current", String(webApp.id === selectedWebApp.id));
    item.setAttribute("data-load-state", loadedWebAppKeys.has(webApp.key) ? "Loaded" : "Not loaded");
    item.textContent = depth > 0 && webApp.parentLabel
      ? `${webApp.parentLabel} -> ${webApp.label}`
      : webApp.label;
    item.addEventListener("click", () => {
      closeWebAppTabMenu();
      selectWebApp(project, paneNode, webApp);
    });
    menu.append(item);
  }

  document.body.append(menu);
  openWebAppTabMenu = menu;

  function onPointerDown(event) {
    if (!menu.contains(event.target) && event.target !== button) {
      closeWebAppTabMenu();
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      closeWebAppTabMenu();
    }
  }

  menu.cleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    button.setAttribute("aria-expanded", "false");
  };

  setTimeout(() => {
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
  }, 0);

  menu.querySelector("button")?.focus();
}

async function openWebAppHomeMenu(event, project, paneNode, selectedWebApp) {
  event.preventDefault();
  const sourceButton = event.currentTarget;
  closeWebAppTabMenu();
  closeTerminalTabMenu();
  await freezeWebAppsForOverlay({
    keys: selectedWebApp?.key ? [selectedWebApp.key] : []
  });

  const menu = document.createElement("div");
  menu.className = "webapp-tab-menu";
  menu.setAttribute("role", "menu");

  const menuWidth = 260;
  const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
  const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 48));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;

  const item = document.createElement("button");
  item.className = "webapp-tab-menu-item";
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.textContent = selectedWebApp.homeTab ? "Update this tab home" : "Save current URL as sub-tab";
  item.addEventListener("click", () => {
    closeWebAppTabMenu();
    saveCurrentUrlAsWebAppHomeTab(project, paneNode, selectedWebApp).catch((error) => {
      console.error("Could not save webapp home tab:", error);
    });
  });
  menu.append(item);

  document.body.append(menu);
  openWebAppTabMenu = menu;

  function onPointerDown(pointerEvent) {
    if (!menu.contains(pointerEvent.target) && pointerEvent.target !== sourceButton) {
      closeWebAppTabMenu();
    }
  }

  function onKeyDown(keyEvent) {
    if (keyEvent.key === "Escape") {
      closeWebAppTabMenu();
    }
  }

  menu.cleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
  };

  setTimeout(() => {
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
  }, 0);

  item.focus();
}

async function openWebAppRefreshMenu(event, selectedWebApp) {
  event.preventDefault();
  const sourceButton = event.currentTarget;
  closeWebAppTabMenu();
  closeTerminalTabMenu();
  await freezeWebAppsForOverlay({
    keys: selectedWebApp?.key ? [selectedWebApp.key] : []
  });

  const menu = document.createElement("div");
  menu.className = "webapp-tab-menu";
  menu.setAttribute("role", "menu");

  const menuWidth = 180;
  const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
  const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 48));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;

  const item = document.createElement("button");
  item.className = "webapp-tab-menu-item";
  item.type = "button";
  item.setAttribute("role", "menuitem");
  item.textContent = "Hard reload";
  item.addEventListener("click", () => {
    closeWebAppTabMenu();
    invokeWebApp("navigateWebApp", selectedWebApp.key, "hard-refresh").catch((error) => {
      console.error("Could not hard reload webapp:", error);
    });
  });
  menu.append(item);

  document.body.append(menu);
  openWebAppTabMenu = menu;

  function onPointerDown(pointerEvent) {
    if (!menu.contains(pointerEvent.target) && pointerEvent.target !== sourceButton) {
      closeWebAppTabMenu();
    }
  }

  function onKeyDown(keyEvent) {
    if (keyEvent.key === "Escape") {
      closeWebAppTabMenu();
    }
  }

  menu.cleanup = () => {
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
  };

  setTimeout(() => {
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
  }, 0);

  item.focus();
}

function findFirstPaneNode(node) {
  if (!node) {
    return null;
  }

  if (node.type === "pane") {
    return node;
  }

  return findFirstPaneNode(node.first) || findFirstPaneNode(node.second);
}

function collectPaneNodes(node, panes = []) {
  if (!node) {
    return panes;
  }

  if (node.type === "pane") {
    panes.push(node);
    return panes;
  }

  collectPaneNodes(node.first, panes);
  collectPaneNodes(node.second, panes);
  return panes;
}

function findPaneNodeBySelectedWebApp(node, webAppId) {
  if (!node) {
    return null;
  }

  if (node.type === "pane") {
    const selectedWebAppId =
      selectedWebAppByPane.get(node.id) ||
      node.selectedWebAppId ||
      null;
    return selectedWebAppId === webAppId ? node : null;
  }

  return findPaneNodeBySelectedWebApp(node.first, webAppId) || findPaneNodeBySelectedWebApp(node.second, webAppId);
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

  selectedWebAppByPane.set(paneNode.id, webApp.id);
  paneNode.selectedWebAppId = webApp.id;
  selectedWebAppByProject.set(project.id, webApp.id);

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

window.BoatyardPaneNavigation = Object.freeze({
  openProjectWebApp
});

function createWebAppPane(project, paneNode) {
  const webApps = getProjectWebApps(project, paneNode.id);
  const selectedWebApp = getSelectedWebApp(project, paneNode.id, webApps);
  const isTerminalPane = selectedWebApp.kind === "terminal";
  const isWidgetPane = selectedWebApp.kind === "widgets";
  const isDomPane = selectedWebApp.kind === "dom";
  const widgetFallbackWidth = isWidgetPane
    ? Math.max(MIN_WIDGET_RAIL_WIDTH, Math.round((dashboardGrid.getBoundingClientRect().width || window.innerWidth) / 2))
    : null;
  const widgetGridColumns = isWidgetPane ? getWidgetGridColumnCount(widgetFallbackWidth) : null;
  const widgetLayout = isWidgetPane ? getProjectWidgetLayout(project, widgetGridColumns, selectedWebApp.widgetPane.id) : null;
  const isWidgetEditing = Boolean(isWidgetPane && widgetLayout && !widgetLayout.locked);
  const pane = document.createElement("section");
  pane.className = "webapp-pane";
  pane.classList.toggle("widget-pane", isWidgetPane);
  pane.classList.toggle("editing", isWidgetEditing);
  pane.dataset.paneId = paneNode.id;
  pane.dataset.webAppId = selectedWebApp.id;
  if (selectedWebApp.kind) {
    pane.dataset.webAppKind = selectedWebApp.kind;
  }

  const header = document.createElement("div");
  header.className = "webapp-pane-header";

  const tabs = document.createElement("div");
  tabs.className = "webapp-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Project webapps");

  const tabPickerButton = document.createElement("button");
  tabPickerButton.className = "webapp-tab webapp-tab-picker";
  tabPickerButton.type = "button";
  tabPickerButton.setAttribute("role", "tab");
  tabPickerButton.setAttribute("aria-selected", "true");
  tabPickerButton.setAttribute("aria-haspopup", "menu");
  tabPickerButton.setAttribute("aria-expanded", "false");
  tabPickerButton.textContent = isWidgetPane ? "Widgets" : selectedWebApp.label;
  tabPickerButton.addEventListener("click", () => {
    const isOpen = Boolean(openWebAppTabMenu);
    tabPickerButton.setAttribute("aria-expanded", String(!isOpen));

    if (isOpen) {
      closeWebAppTabMenu();
    } else {
      openWebAppTabMenuFromButton(tabPickerButton, project, paneNode, selectedWebApp, webApps);
    }
  });

  tabs.append(tabPickerButton);

  if (isWidgetPane) {
    tabs.append(createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, {
      editing: isWidgetEditing
    }));
  }

  if (!isTerminalPane && !isWidgetPane && !isDomPane) {
    const homeButton = document.createElement("button");
    homeButton.className = "webapp-tool-button";
    homeButton.type = "button";
    homeButton.title = "Go home";
    homeButton.setAttribute("aria-label", "Go home");
    homeButton.append(createToolIcon("home"));
    homeButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "home", selectedWebApp.url));
    homeButton.addEventListener("contextmenu", (event) => {
      openWebAppHomeMenu(event, project, paneNode, selectedWebApp);
    });

    const backButton = document.createElement("button");
    backButton.className = "webapp-tool-button";
    backButton.type = "button";
    backButton.title = "Go back";
    backButton.setAttribute("aria-label", "Go back");
    backButton.append(createToolIcon("arrowLeft"));
    backButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "back"));

    const forwardButton = document.createElement("button");
    forwardButton.className = "webapp-tool-button";
    forwardButton.type = "button";
    forwardButton.title = "Go forward";
    forwardButton.setAttribute("aria-label", "Go forward");
    forwardButton.append(createToolIcon("arrowRight"));
    forwardButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "forward"));

    const refreshButton = document.createElement("button");
    refreshButton.className = "webapp-tool-button";
    refreshButton.type = "button";
    refreshButton.title = "Refresh";
    refreshButton.setAttribute("aria-label", "Refresh");
    refreshButton.append(createToolIcon("refresh"));
    refreshButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "refresh"));
    refreshButton.addEventListener("contextmenu", (event) => {
      openWebAppRefreshMenu(event, selectedWebApp);
    });

    const autofillButton = isPasswordManagerEnabled() ? document.createElement("button") : null;
    if (autofillButton) {
      autofillButton.className = "webapp-tool-button autofill";
      autofillButton.type = "button";
      autofillButton.dataset.webappKey = selectedWebApp.key;
      autofillButton.title = "Autofill credentials";
      autofillButton.setAttribute("aria-label", "Autofill credentials");
      autofillButton.append(createToolIcon("key"));
      syncWebAppAutofillButton(autofillButton, isWebAppAutofillEnabled(selectedWebApp));
      autofillButton.addEventListener("click", () => {
        toggleWebAppAutofill(selectedWebApp, autofillButton).catch((error) => {
          console.error("Could not update webapp autofill:", error);
        });
      });
    }

    const activeUrl = document.createElement("input");
    activeUrl.className = "webapp-url";
    activeUrl.type = "text";
    activeUrl.autocomplete = "off";
    activeUrl.spellcheck = false;
    activeUrl.value = getCurrentWebAppUrl(selectedWebApp);
    activeUrl.dataset.webappKey = selectedWebApp.key;
    activeUrl.setAttribute("aria-label", "Current webapp URL");
    activeUrl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();

        try {
          const nextUrl = normalizeAddressInput(activeUrl.value);
          currentWebAppUrlsByKey.set(selectedWebApp.key, nextUrl);
          activeUrl.value = nextUrl;
          invokeWebApp("navigateWebApp", selectedWebApp.key, "open", nextUrl);
        } catch {
          activeUrl.value = getCurrentWebAppUrl(selectedWebApp);
        }
      } else if (event.key === "Escape") {
        activeUrl.value = getCurrentWebAppUrl(selectedWebApp);
        activeUrl.blur();
      }
    });

    tabs.append(
      homeButton,
      backButton,
      forwardButton,
      refreshButton,
      ...(autofillButton ? [autofillButton] : []),
      activeUrl
    );
  }

  const actions = document.createElement("div");
  actions.className = "webapp-actions";

  if (isWidgetPane) {
    actions.append(createWidgetPaneActions(project, selectedWebApp.widgetPane, widgetLayout, widgetGridColumns));
  }

  const terminalPaneTabs = isTerminalPane ? document.createElement("div") : null;
  if (terminalPaneTabs) {
    terminalPaneTabs.className = "pane-terminal-tabs-slot";
    tabs.append(terminalPaneTabs);
  }

  const expansionState = getPaneExpansionState(project, paneNode.id);
  const expandPaneButton = document.createElement("button");
  expandPaneButton.className = "webapp-tool-button";
  expandPaneButton.type = "button";
  expandPaneButton.title = "Expand pane";
  expandPaneButton.setAttribute("aria-label", "Expand pane");
  expandPaneButton.append(createToolIcon("expandPane"));
  expandPaneButton.disabled = !expansionState.canExpand;
  expandPaneButton.addEventListener("mouseenter", () => previewPaneExpansion(project, paneNode.id, !expandPaneButton.disabled));
  expandPaneButton.addEventListener("mouseleave", clearPaneExpansionPreview);
  expandPaneButton.addEventListener("focus", () => previewPaneExpansion(project, paneNode.id, !expandPaneButton.disabled));
  expandPaneButton.addEventListener("blur", clearPaneExpansionPreview);
  expandPaneButton.addEventListener("click", () => expandPane(project, paneNode.id));

  const shrinkPaneButton = document.createElement("button");
  shrinkPaneButton.className = "webapp-tool-button";
  shrinkPaneButton.type = "button";
  shrinkPaneButton.title = "Shrink pane";
  shrinkPaneButton.setAttribute("aria-label", "Shrink pane");
  shrinkPaneButton.append(createToolIcon("shrinkPane"));
  shrinkPaneButton.disabled = !expansionState.canShrink;
  shrinkPaneButton.classList.toggle("active", expansionState.canShrink);
  shrinkPaneButton.addEventListener("click", () => shrinkPane(project, paneNode.id));

  const verticalSplitButton = document.createElement("button");
  verticalSplitButton.className = "webapp-tool-button split-vertical";
  verticalSplitButton.type = "button";
  verticalSplitButton.title = "Split vertically";
  verticalSplitButton.setAttribute("aria-label", "Split vertically");
  verticalSplitButton.append(createToolIcon("splitVertical"));
  verticalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "vertical"));

  const horizontalSplitButton = document.createElement("button");
  horizontalSplitButton.className = "webapp-tool-button split-horizontal";
  horizontalSplitButton.type = "button";
  horizontalSplitButton.title = "Split horizontally";
  horizontalSplitButton.setAttribute("aria-label", "Split horizontally");
  horizontalSplitButton.append(createToolIcon("splitHorizontal"));
  horizontalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "horizontal"));

  const closePaneButton = document.createElement("button");
  closePaneButton.className = "webapp-tool-button danger";
  closePaneButton.type = "button";
  closePaneButton.title = "Close pane";
  closePaneButton.setAttribute("aria-label", "Close pane");
  closePaneButton.append(createToolIcon("close"));
  closePaneButton.disabled = countPaneNodes(getProjectPaneLayout(project)) <= 1;
  closePaneButton.addEventListener("click", () => closePane(project, paneNode.id));

  actions.append(expandPaneButton, shrinkPaneButton, verticalSplitButton, horizontalSplitButton, closePaneButton);
  header.append(tabs, actions);

  const host = document.createElement("div");
  host.className = `webapp-host${isTerminalPane ? " terminal-pane-host" : ""}`;
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", `${project.name} ${selectedWebApp.label}`);

  pane.append(header, host);

  if (isTerminalPane) {
    host.append(createTerminalSurface(project, {
      tagName: "div",
      className: "terminal-pane-surface terminal-widget",
      storageKey: `pane:${paneNode.id}`,
      tabsContainer: terminalPaneTabs
    }));
  } else if (isWidgetPane) {
    host.append(createWidgetPaneSurface(project, selectedWebApp.widgetPane));
  } else if (isDomPane) {
    const pluginPane = selectedWebApp.pluginPane;
    const cleanup = pluginPane.render(host, {
      project,
      projectId: project.id,
      projectConfig: isGlobalWorkspace(project) ? {} : getProjectPluginConfig(project.id, pluginPane.pluginId),
      globalPluginConfig: getGlobalPluginConfig(pluginPane.pluginId),
      allProjectPluginConfig: isGlobalWorkspace(project) ? {} : state.pluginConfig?.projects?.[project.id] || {},
      openProjectWebApp(webAppId, url = "") {
        return openProjectWebApp(project.id, webAppId, url);
      }
    });
    if (typeof cleanup === "function") {
      host.boatyardCleanup = cleanup;
    }
  } else {
    visibleWebAppHosts.set(paneNode.id, {
      webApp: selectedWebApp,
      host
    });
  }

  queueWebAppSync();
  return pane;
}

function createSplitNode(project, direction, first, selectedWebAppId = null) {
  return {
    type: "split",
    id: `${project.id}:split:${nextPaneId++}`,
    direction,
    ratio: 0.5,
    first,
    second: createPaneNode(project, selectedWebAppId)
  };
}

function findPaneNode(node, paneId) {
  if (!node) {
    return null;
  }

  if (node.type === "pane") {
    return node.id === paneId ? node : null;
  }

  return findPaneNode(node.first, paneId) || findPaneNode(node.second, paneId);
}

function replacePaneNode(node, paneId, replacement) {
  if (node.type === "pane") {
    return node.id === paneId ? replacement : node;
  }

  return {
    ...node,
    first: replacePaneNode(node.first, paneId, replacement),
    second: replacePaneNode(node.second, paneId, replacement)
  };
}

function getPaneAncestorPath(node, paneId, path = []) {
  if (!node) {
    return null;
  }

  if (node.type === "pane") {
    return node.id === paneId ? path : null;
  }

  return getPaneAncestorPath(node.first, paneId, [
    ...path,
    {
      node,
      side: "first"
    }
  ]) || getPaneAncestorPath(node.second, paneId, [
    ...path,
    {
      node,
      side: "second"
    }
  ]);
}

function getPaneExpansionState(project, paneId) {
  const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
  return {
    canExpand: path.some(({ node }) => !node.expandedChild),
    canShrink: path.some(({ node, side }) => node.expandedChild === side)
  };
}

function getPaneExpansionTarget(project, paneId) {
  const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
  return [...path].reverse().find(({ node }) => !node.expandedChild) || null;
}

function clearPaneExpansionPreview() {
  document.querySelectorAll(".webapp-split.pane-expand-preview").forEach((split) => {
    split.classList.remove("pane-expand-preview");
  });
}

function previewPaneExpansion(project, paneId, enabled) {
  clearPaneExpansionPreview();

  if (!enabled) {
    return;
  }

  const target = getPaneExpansionTarget(project, paneId);
  if (!target) {
    return;
  }

  const split = [...document.querySelectorAll(".webapp-split")].find((candidate) => candidate.dataset.splitId === target.node.id);
  if (split) {
    split.classList.add("pane-expand-preview");
  }
}

function expandPane(project, paneId) {
  const target = getPaneExpansionTarget(project, paneId);

  if (!target) {
    return;
  }

  target.node.expandedChild = target.side;
  persistPaneLayout(project);
  renderWorkspaceDashboard(project);
}

function shrinkPane(project, paneId) {
  const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
  const target = path.find(({ node, side }) => node.expandedChild === side);

  if (!target) {
    return;
  }

  delete target.node.expandedChild;
  persistPaneLayout(project);
  renderWorkspaceDashboard(project);
}

function countPaneNodes(node) {
  if (!node) {
    return 0;
  }

  if (node.type === "pane") {
    return 1;
  }

  return countPaneNodes(node.first) + countPaneNodes(node.second);
}

function removePaneNode(node, paneId) {
  if (!node || node.type === "pane") {
    return {
      node,
      removed: false
    };
  }

  if (node.first.type === "pane" && node.first.id === paneId) {
    return {
      node: node.second,
      removed: true
    };
  }

  if (node.second.type === "pane" && node.second.id === paneId) {
    return {
      node: node.first,
      removed: true
    };
  }

  const firstResult = removePaneNode(node.first, paneId);
  if (firstResult.removed) {
    return {
      node: {
        ...node,
        first: firstResult.node
      },
      removed: true
    };
  }

  const secondResult = removePaneNode(node.second, paneId);
  if (secondResult.removed) {
    return {
      node: {
        ...node,
        second: secondResult.node
      },
      removed: true
    };
  }

  return {
    node,
    removed: false
  };
}

function splitPane(project, paneId, direction) {
  const layout = getProjectPaneLayout(project);
  const webApps = getProjectWebApps(project, paneId);
  const currentWebAppId = selectedWebAppByPane.get(paneId) || selectedWebAppByProject.get(project.id) || webApps[0].id;
  const nextWebAppId = webApps.find((webApp) => webApp.id !== currentWebAppId)?.id || currentWebAppId;
  const replacement = createSplitNode(project, direction, { type: "pane", id: paneId }, nextWebAppId);
  replacement.first.selectedWebAppId = currentWebAppId;
  paneLayoutsByProject.set(project.id, replacePaneNode(layout, paneId, replacement));
  selectedWebAppByPane.set(paneId, currentWebAppId);
  persistPaneLayout(project);
  renderWorkspaceDashboard(project);
}

function closePane(project, paneId) {
  const layout = getProjectPaneLayout(project);

  if (countPaneNodes(layout) <= 1) {
    return;
  }

  const result = removePaneNode(layout, paneId);
  if (!result.removed) {
    return;
  }

  selectedWebAppByPane.delete(paneId);
  paneLayoutsByProject.set(project.id, result.node);
  persistPaneLayout(project);
  renderWorkspaceDashboard(project);
}

function createSplitResizer(project, splitNode) {
  const resizer = document.createElement("div");
  resizer.className = `webapp-split-resizer ${splitNode.direction}`;
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", splitNode.direction === "vertical" ? "vertical" : "horizontal");

  resizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const splitElement = resizer.parentElement;
    const rect = splitElement.getBoundingClientRect();
    const isVertical = splitNode.direction === "vertical";

    function onPointerMove(moveEvent) {
      const rawRatio = isVertical
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height;
      splitNode.ratio = Math.min(0.85, Math.max(0.15, rawRatio));
      applySplitRatio(splitElement, splitNode);
      queueWebAppSync();
    }

    function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      persistPaneLayout(project);
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  });

  return resizer;
}

function applySplitRatio(splitElement, splitNode) {
  const firstRatio = Math.round(splitNode.ratio * 1000) / 10;
  const secondRatio = Math.round((1 - splitNode.ratio) * 1000) / 10;
  const resizerOffset = WEBAPP_SPLIT_RESIZER_SIZE / 2;
  const first = `minmax(0, calc(${firstRatio}% - ${resizerOffset}px))`;
  const second = `minmax(0, calc(${secondRatio}% - ${resizerOffset}px))`;
  const resizer = `${WEBAPP_SPLIT_RESIZER_SIZE}px`;

  if (splitNode.direction === "vertical") {
    splitElement.style.gridTemplateColumns = `${first} ${resizer} ${second}`;
    splitElement.style.gridTemplateRows = "";
  } else {
    splitElement.style.gridTemplateColumns = "";
    splitElement.style.gridTemplateRows = `${first} ${resizer} ${second}`;
  }
}

function createPaneLayout(project, node) {
  if (node.type === "pane") {
    return createWebAppPane(project, node);
  }

  if (node.expandedChild === "first" || node.expandedChild === "second") {
    return createPaneLayout(project, node[node.expandedChild]);
  }

  const split = document.createElement("div");
  split.className = `webapp-split ${node.direction}`;
  split.dataset.splitId = node.id;
  applySplitRatio(split, node);
  split.append(
    createPaneLayout(project, node.first),
    createSplitResizer(project, node),
    createPaneLayout(project, node.second)
  );
  return split;
}

function persistPaneLayout(project) {
  const layout = paneLayoutsByProject.get(project.id);
  if (!layout) {
    return;
  }

  window.boatyard.updatePaneLayout(project.id, layout).catch((error) => {
    console.error("Could not persist pane layout:", error);
  });
}

function hydratePaneLayouts() {
  const persistedLayouts = state.paneLayouts || {};

  for (const [projectId, layout] of Object.entries(persistedLayouts)) {
    paneLayoutsByProject.set(projectId, layout);
    hydratePaneLayoutSelections(layout);
  }
}

function hydrateWidgetLayouts() {
  widgetSurfaces.hydrateWidgetLayouts();
}

function hydrateTerminalTabOrders() {
  terminalSurfaces.hydrateTerminalTabOrders();
}

function hydratePaneLayoutSelections(node) {
  if (!node) {
    return;
  }

  if (node.type === "pane") {
    if (node.selectedWebAppId) {
      selectedWebAppByPane.set(node.id, node.selectedWebAppId);
    }

    const idMatch = node.id.match(/:pane:(\d+)$/);
    if (idMatch) {
      nextPaneId = Math.max(nextPaneId, Number(idMatch[1]) + 1);
    }
    return;
  }

  const splitMatch = node.id.match(/:split:(\d+)$/);
  if (splitMatch) {
    nextPaneId = Math.max(nextPaneId, Number(splitMatch[1]) + 1);
  }
  hydratePaneLayoutSelections(node.first);
  hydratePaneLayoutSelections(node.second);
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
      state = await window.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalUrlsSettingsForm({
    onSubmit: async (urls) => {
      state = await window.boatyard.updateGlobalUrls(urls);
      hydratePaneLayouts();
      hydrateWidgetLayouts();
      renderGlobalSettingsPage();
    }
  }), createGlobalPresentationSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await window.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalTerminalSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await window.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalPasswordManagerSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await window.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalWebAppOpenRulesSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await window.boatyard.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalPluginsSettingsView(), createGlobalWidgetsSettingsView());

  window.BoatyardPluginRegistry?.emit("boatyard.globalSettings.opened", {
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

const updateViews = window.BoatyardUpdateViews.create({
  boatyard: window.boatyard,
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

const onboardingTour = window.BoatyardOnboardingTour.create({
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
  setPaneLayout: (projectId, layout) => {
    paneLayoutsByProject.set(projectId, layout);
  },
  getPaneLayout: (projectId) => paneLayoutsByProject.get(projectId),
  setSelectedWebAppForPane: (paneId, webAppId) => {
    selectedWebAppByPane.set(paneId, webAppId);
  },
  getSelectedWebAppForPane: (paneId) => selectedWebAppByPane.get(paneId),
  setSelectedWebAppForProject: (projectId, webAppId) => {
    selectedWebAppByProject.set(projectId, webAppId);
  },
  getSelectedWebAppForProject: (projectId) => selectedWebAppByProject.get(projectId),
  deleteSelectedWebAppForPane: (paneId) => {
    selectedWebAppByPane.delete(paneId);
  },
  deleteSelectedWebAppForProject: (projectId) => {
    selectedWebAppByProject.delete(projectId);
  },
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
    state.onboarding = await window.boatyard.updateOnboarding(values);
    return state.onboarding;
  },
  updatePaneLayout: (projectId, layout) => window.boatyard.updatePaneLayout(projectId, layout)
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

const projectSidebar = window.BoatyardProjectSidebar.create({
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
    const navigation = await window.boatyard.updateNavigation(values);
    state = {
      ...state,
      navigation
    };
    return navigation;
  },
  updateProject: async (projectId, values) => {
    state = await window.boatyard.updateProject(projectId, values);
    return state;
  },
  reorderProjectIds: async (projectIds) => {
    state = await window.boatyard.reorderProjects(projectIds);
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

const projectSettingsViews = window.BoatyardProjectSettingsViews.create({
  boatyard: window.boatyard,
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

const globalSettingsViews = window.BoatyardGlobalSettingsViews.create({
  boatyard: window.boatyard,
  applyFormControl,
  applyFormControls,
  getInstalledWidgets,
  getPluginGlobalSettingsSections,
  getGlobalPluginConfig,
  readPluginSettingsFieldValue,
  showOverlayDialog,
  renderGlobalSettingsPage,
  updatePluginEnabled: async (pluginId, enabled) => {
    state = await window.boatyard.updatePluginEnabled(pluginId, enabled);
    window.BoatyardPluginRegistry.setEnabled(pluginId, enabled);
  },
  updateGlobalPluginConfig: async (pluginId, values) => {
    state = await window.boatyard.updateGlobalPluginConfig(pluginId, values);
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
      state = await window.boatyard.addProject({
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
      state = await window.boatyard.updateProject(project.id, {
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
      state = await window.boatyard.updateProject(project.id, values);
      reloadProjectSettings(project.id);
    }
  }), createProjectUrlsForm({
    project,
    onSubmit: async (urls) => {
      state = await window.boatyard.updateProject(project.id, { urls });
      reloadProjectSettings(project.id);
    }
  }), createProjectWebAppHomeTabsForm({
    project,
    onSubmit: async (homeTabs) => {
      state = await window.boatyard.updateWebAppHomeTabs(project.id, homeTabs);
      reloadProjectSettings(project.id);
    }
  }), createProjectWidgetPanesForm({
    project,
    onSubmit: async (widgetPanes) => {
      state = await window.boatyard.updateProject(project.id, { widgetPanes });
      reloadProjectSettings(project.id);
    }
  }), createProjectDangerZone({
    project,
    onUnregister: async () => {
      state = await window.boatyard.removeProject(project.id);
      selectGlobal();
    }
  }));

  dashboardGrid.append(primaryColumn, secondaryColumn);
}

function getWebAppHostBounds(host) {
  if (!host) {
    return null;
  }

  const rect = host.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
}

function normalizePayloadBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    x,
    y,
    width,
    height
  };
}

function inflateRect(rect, margin = 0) {
  const value = Math.max(0, Number(margin) || 0);
  return {
    x: rect.x - value,
    y: rect.y - value,
    width: rect.width + value * 2,
    height: rect.height + value * 2
  };
}

function rectsIntersect(left, right) {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

function getVisibleWebAppKeysIntersectingRect(rect, { margin = 0 } = {}) {
  const targetRect = inflateRect(rect, margin);
  const keys = [];

  for (const { webApp, host } of visibleWebAppHosts.values()) {
    const hostBounds = getWebAppHostBounds(host);
    if (hostBounds && rectsIntersect(targetRect, hostBounds)) {
      keys.push(webApp.key);
    }
  }

  return keys;
}

async function syncWebAppView() {
  webAppBoundsFrame = null;

  if (visibleWebAppHosts.size === 0) {
    invokeWebApp("hideWebApp");
    return;
  }

  const visibleKeys = [];

  const showCalls = [];

  for (const { webApp, host } of visibleWebAppHosts.values()) {
    const bounds = getWebAppHostBounds(host);
    if (!bounds) {
      continue;
    }

    visibleKeys.push(webApp.key);
    showCalls.push(invokeWebApp("showWebApp", {
      key: webApp.key,
      url: webApp.url,
      bounds,
      autofillEnabled: isWebAppAutofillEnabled(webApp),
      restoreUrl: webApp.restoreUrl
    }));
  }

  await Promise.all(showCalls);
  for (const key of visibleKeys) {
    loadedWebAppKeys.add(key);
  }
  await invokeWebApp("setVisibleWebApps", visibleKeys);
}

function queueWebAppSync() {
  if (webAppBoundsFrame !== null) {
    return;
  }

  webAppBoundsFrame = requestAnimationFrame(syncWebAppView);
}

async function flushWebAppSync() {
  if (webAppBoundsFrame !== null) {
    cancelAnimationFrame(webAppBoundsFrame);
    webAppBoundsFrame = null;
  }

  await syncWebAppView();
}

function clearFrozenWebAppLayer() {
  frozenWebAppLayer?.remove();
  frozenWebAppLayer = null;
}

function renderFrozenWebApps(captures) {
  clearFrozenWebAppLayer();

  if (!Array.isArray(captures) || captures.length === 0) {
    return;
  }

  const layer = document.createElement("div");
  layer.className = "webapp-freeze-layer";
  layer.classList.toggle("blur-disabled", getSettings().blurWebAppOverlays === false);
  layer.setAttribute("aria-hidden", "true");

  for (const capture of captures) {
    if (!capture?.bounds || !capture.dataUrl) {
      continue;
    }

    const image = document.createElement("img");
    image.className = "webapp-freeze-shot";
    image.src = capture.dataUrl;
    image.alt = "";
    image.style.left = `${capture.bounds.x}px`;
    image.style.top = `${capture.bounds.y}px`;
    image.style.width = `${capture.bounds.width}px`;
    image.style.height = `${capture.bounds.height}px`;
    layer.append(image);
  }

  document.body.append(layer);
  frozenWebAppLayer = layer;
}

async function freezeWebAppsForOverlay(options = undefined) {
  try {
    const captures = await window.boatyard.freezeWebApps(options);
    renderFrozenWebApps(captures);
  } catch (error) {
    console.error("Could not freeze webapps:", error);
  }
}

async function freezeWebAppsForKeys(keys) {
  const uniqueKeys = [...new Set(keys.map(String).filter(Boolean))];
  await freezeWebAppsForOverlay({ keys: uniqueKeys });
}

async function freezeWebAppsForRect(rect, { margin = 0 } = {}) {
  const keys = getVisibleWebAppKeysIntersectingRect(rect, { margin });
  await freezeWebAppsForKeys(keys);
}

function getOverlayDialogFreezeRect(dialog) {
  const contentRect = dialog.firstElementChild?.getBoundingClientRect();
  if (contentRect?.width > 0 && contentRect.height > 0) {
    return contentRect;
  }

  return dialog.getBoundingClientRect();
}

async function restoreWebAppsAfterOverlay() {
  clearFrozenWebAppLayer();

  try {
    await window.boatyard.restoreWebApps();
  } catch (error) {
    console.error("Could not restore webapps:", error);
  }

  queueWebAppSync();
}

async function showOverlayDialog(dialog, {
  freeze = "overlap",
  freezeMargin = 16,
  onClose = null,
  removeOnClose = false
} = {}) {
  let closed = false;
  let didFreeze = false;

  dialog.style.visibility = "hidden";
  if (!dialog.isConnected) {
    document.body.append(dialog);
  }

  dialog.addEventListener("close", () => {
    closed = true;
    if (didFreeze) {
      restoreWebAppsAfterOverlay();
    }
    if (removeOnClose) {
      dialog.remove();
    }
    onClose?.();
  }, { once: true });

  dialog.showModal();

  if (freeze === "all" || freeze === "overlap") {
    await flushWebAppSync();
  }

  if (closed) {
    return false;
  }

  if (freeze === "all") {
    didFreeze = true;
    await freezeWebAppsForOverlay();
  } else if (freeze === "overlap") {
    didFreeze = true;
    await freezeWebAppsForRect(getOverlayDialogFreezeRect(dialog), {
      margin: freezeMargin
    });
  }

  if (closed) {
    return false;
  }

  dialog.style.visibility = "";
  return true;
}

window.BoatyardOverlayDialog = Object.freeze({
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
  state = await window.boatyard.getState();
  window.BoatyardPluginRegistry?.applyEnabledState(getPluginEnabledState());
  currentWebAppUrlsByKey.clear();
  for (const [key, webApp] of Object.entries(state.webApps || {})) {
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

window.boatyard.onWebAppUrlChanged(({ key, url }) => {
  if (!key || !url) {
    return;
  }

  currentWebAppUrlsByKey.set(key, url);
  persistVisibleWebAppPaneLayout(key, url);
  for (const input of document.querySelectorAll(".webapp-url")) {
    if (input.dataset.webappKey === key && input !== document.activeElement) {
      input.value = url;
    }
  }
});

window.boatyard.onWebAppLoaded?.((payload) => {
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

window.boatyard.onWebAppAutofillChanged?.(({ key, enabled }) => {
  if (!key) {
    return;
  }

  webAppAutofillEnabledByKey.set(key, enabled === true);
  for (const button of document.querySelectorAll(".webapp-tool-button.autofill")) {
    if (button.dataset.webappKey === key) {
      syncWebAppAutofillButton(button, enabled === true);
    }
  }
});

window.boatyard.onWebAppOpenUrlRequested?.((payload) => {
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

window.boatyard.onTerminalData((payload) => {
  terminalSurfaces.handleTerminalData(payload);
});

window.boatyard.onTerminalExit((payload) => {
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

window.BoatyardPluginLoader?.ready
  ?.catch((error) => {
    console.error("Could not load plugins:", error);
  })
  .finally(loadState) || loadState();
