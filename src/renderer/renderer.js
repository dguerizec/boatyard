"use strict";

const globalNav = document.querySelector("#global-nav");
const globalNavRow = document.querySelector("#global-nav-row");
const globalSettingsButton = document.querySelector("#global-settings");
const globalViewButton = document.querySelector("#global-view");
const addProjectButton = document.querySelector("#add-project");
const projectCount = document.querySelector("#project-count");
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
const LEGACY_WIDGET_IDS = new Map([
  ["project-shell", "terminal-shell"],
  ["global-shell", "terminal-shell"],
  ["project-preview", "boatyard.pier.urls"],
  ["pier-urls", "boatyard.pier.urls"],
  ["boatyard.twicc.projectUsage", "boatyard.twicc.usage"]
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
const widgetLayoutsByProject = new Map();
const selectedWebAppByPane = new Map();
const loadedWebAppKeys = new Set();
const currentWebAppUrlsByKey = new Map();
const webAppAutofillEnabledByKey = new Map();
let visibleWebAppHosts = new Map();
let webAppBoundsFrame = null;
let nextPaneId = 1;
let frozenWebAppLayer = null;
let openWebAppTabMenu = null;
let openWidgetAddMenu = null;
let pierWorkloadPaneRefreshFrame = null;
let draggedProjectId = null;
let draggedWidgetId = null;
const terminalWidgetsBySurface = new Map();
const terminalWidgetsByTerminal = new Map();
const terminalTabSyncTimers = new Map();
const terminalTabOrdersByProject = new Map();
let nextTerminalSurfaceId = 1;
let pendingTerminalCloseFocus = null;
const TERMINAL_TAB_SYNC_DELAY_MS = 150;
const TERMINAL_TAB_SYNC_FOLLOWUP_DELAY_MS = 250;
const TERMINAL_CLOSE_FOCUS_TTL_MS = 3000;

function getProjects() {
  return state.projects;
}

function getSettings() {
  return {
    projectsBasePath: "",
    blurWebAppOverlays: true,
    webAppOpenRules: [],
    widgetRailWidth: 340,
    terminalEnv: "",
    ...(state.settings || {})
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
    getProjectPluginConfig(project.id, "boatyard.pier").pierPreviewUrl ||
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
    projectId: currentProjectId
  }).catch((error) => {
    console.error("Could not persist navigation:", error);
  });
}

function setCurrentView(view, projectId = null, { persist = true } = {}) {
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

function getXtermConstructor() {
  return window.Terminal?.Terminal || window.Terminal || null;
}

function getFitAddonConstructor() {
  return window.FitAddon?.FitAddon || window.FitAddon || null;
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function fitTerminal(term, fitAddon) {
  const dimensions = fitAddon.proposeDimensions();

  if (!dimensions) {
    return {
      cols: Math.max(20, term.cols || 80),
      rows: Math.max(5, term.rows || 24)
    };
  }

  fitAddon.fit();
  return {
    cols: dimensions.cols,
    rows: dimensions.rows
  };
}

function getTerminalSurfaceId(card) {
  if (!card.dataset.terminalSurfaceId) {
    card.dataset.terminalSurfaceId = `terminal-surface-${nextTerminalSurfaceId}`;
    nextTerminalSurfaceId += 1;
  }

  return card.dataset.terminalSurfaceId;
}

function detachTerminalSurface(surfaceId) {
  const session = terminalWidgetsBySurface.get(surfaceId);

  if (!session) {
    return;
  }

  if (session.terminalId) {
    window.boatyard.detachTerminal(session.terminalId).catch((error) => {
      console.error("Could not detach terminal:", error);
    });
    terminalWidgetsByTerminal.delete(session.terminalId);
  }

  for (const disposable of session.disposables || []) {
    disposable?.dispose?.();
  }
  session.removeMiddleClickPaste?.();
  session.resizeObserver?.disconnect();
  session.term?.dispose();
  clearTimeout(terminalTabSyncTimers.get(surfaceId)?.timer);
  terminalTabSyncTimers.delete(surfaceId);
  terminalWidgetsBySurface.delete(surfaceId);
}

function detachProjectTerminal(projectId) {
  for (const [surfaceId, session] of terminalWidgetsBySurface.entries()) {
    if (session.projectId === projectId) {
      detachTerminalSurface(surfaceId);
    }
  }
}

function detachInactiveProjectTerminals(activeProjectId = null) {
  for (const [surfaceId, session] of terminalWidgetsBySurface.entries()) {
    if (session.projectId !== activeProjectId) {
      detachTerminalSurface(surfaceId);
    }
  }
}

function setTerminalStatus(card, message) {
  const status = card.querySelector(".terminal-status");
  if (status) {
    status.textContent = message;
  }
}

function getRenderedTerminalTabIds(card) {
  return [...card.querySelectorAll(".terminal-tab")]
    .map((tabButton) => tabButton.dataset.windowId)
    .filter(Boolean);
}

function rememberTerminalTabOrder(projectId, orderedWindowIds) {
  const normalizedProjectId = String(projectId);
  const normalizedWindowIds = orderedWindowIds.map((windowId) => String(windowId));
  terminalTabOrdersByProject.set(normalizedProjectId, normalizedWindowIds);

  return normalizedWindowIds;
}

function persistTerminalTabOrder(projectId, orderedWindowIds) {
  const normalizedProjectId = String(projectId);
  const normalizedWindowIds = rememberTerminalTabOrder(normalizedProjectId, orderedWindowIds);
  state.terminalTabOrders = {
    ...(state.terminalTabOrders || {}),
    [normalizedProjectId]: normalizedWindowIds
  };

  if (!window.boatyard.updateTerminalTabOrder) {
    return;
  }

  window.boatyard.updateTerminalTabOrder(normalizedProjectId, normalizedWindowIds).catch((error) => {
    console.error("Could not persist terminal tab order:", error);
  });
}

function getOrderedTerminalTabs(projectId, tabs) {
  const order = terminalTabOrdersByProject.get(String(projectId));
  if (!order?.length) {
    rememberTerminalTabOrder(projectId, tabs.map((tab) => tab.id));
    return tabs;
  }

  const orderIndexes = new Map(order.map((windowId, index) => [windowId, index]));
  const orderedTabs = [...tabs].sort((left, right) => {
    const leftIndex = orderIndexes.get(left.id);
    const rightIndex = orderIndexes.get(right.id);

    if (leftIndex === undefined && rightIndex === undefined) {
      return left.index - right.index;
    }
    if (leftIndex === undefined) {
      return 1;
    }
    if (rightIndex === undefined) {
      return -1;
    }

    return leftIndex - rightIndex;
  });
  rememberTerminalTabOrder(projectId, orderedTabs.map((tab) => tab.id));
  return orderedTabs;
}

function getTerminalReplacementWindowId(card, removedWindowId, remainingTabs) {
  const remainingTabIds = remainingTabs
    .map((tab) => tab.id)
    .filter((tabId) => tabId !== String(removedWindowId));
  const removedIndex = getRenderedTerminalTabIds(card).indexOf(String(removedWindowId));

  if (removedIndex === -1 || !remainingTabIds.length) {
    return null;
  }

  return remainingTabIds[Math.min(removedIndex, remainingTabIds.length - 1)] || null;
}

function markTerminalCloseFocus(surfaceId, windowId) {
  pendingTerminalCloseFocus = {
    surfaceId,
    windowId: String(windowId),
    timestamp: Date.now()
  };
}

function shouldFocusAfterTerminalExit(surfaceId, windowId) {
  if (!pendingTerminalCloseFocus) {
    return true;
  }

  const isFresh = Date.now() - pendingTerminalCloseFocus.timestamp <= TERMINAL_CLOSE_FOCUS_TTL_MS;
  const shouldFocus = isFresh &&
    pendingTerminalCloseFocus.surfaceId === surfaceId &&
    pendingTerminalCloseFocus.windowId === String(windowId);

  if (!isFresh || shouldFocus) {
    pendingTerminalCloseFocus = null;
  }

  return shouldFocus;
}

function shouldRefreshTerminalTabs(session, tabs) {
  const tabIds = tabs.map((tab) => tab.id);
  const renderedTabIds = getRenderedTerminalTabIds(session.card);

  return !tabIds.includes(session.activeWindowId)
    || tabIds.length !== renderedTabIds.length
    || tabIds.some((tabId, index) => tabId !== renderedTabIds[index]);
}

async function syncTerminalTabsForSurface(surfaceId, followupsRemaining = 0) {
  terminalTabSyncTimers.delete(surfaceId);
  const session = terminalWidgetsBySurface.get(surfaceId);
  if (!session?.card?.isConnected) {
    return;
  }

  const project = getProjectById(session.projectId);
  if (!project) {
    return;
  }

  try {
    const tabs = getOrderedTerminalTabs(project.id, await window.boatyard.listTerminalTabs(project.id));
    if (shouldRefreshTerminalTabs(session, tabs)) {
      const closedWindowId = tabs.some((tab) => tab.id === session.activeWindowId)
        ? null
        : session.activeWindowId;
      await refreshTerminalSurfaceAfterClosedTab(project, session.card, closedWindowId, tabs, {
        focus: session.activeWindowId === closedWindowId
      });
      return;
    }
  } catch (error) {
    setTerminalStatus(session.card, `Could not refresh shells: ${error.message}`);
  }

  if (followupsRemaining > 0 && terminalWidgetsBySurface.has(surfaceId)) {
    scheduleTerminalSurfaceTabSync(surfaceId, followupsRemaining - 1, TERMINAL_TAB_SYNC_FOLLOWUP_DELAY_MS);
  }
}

function scheduleTerminalSurfaceTabSync(surfaceId, followupsRemaining = 0, delay = TERMINAL_TAB_SYNC_DELAY_MS) {
  const scheduled = terminalTabSyncTimers.get(surfaceId);
  if (scheduled) {
    scheduled.followupsRemaining = Math.max(scheduled.followupsRemaining, followupsRemaining);
    return;
  }

  const scheduledSync = {
    followupsRemaining,
    timer: setTimeout(() => {
      syncTerminalTabsForSurface(surfaceId, scheduledSync.followupsRemaining);
    }, delay)
  };
  terminalTabSyncTimers.set(surfaceId, scheduledSync);
}

function scheduleTerminalTabSync(terminalId, followupsRemaining = 0) {
  const terminalSession = terminalWidgetsByTerminal.get(terminalId);
  if (!terminalSession) {
    return;
  }

  scheduleTerminalSurfaceTabSync(terminalSession.surfaceId, followupsRemaining);
}

async function refreshProjectTerminalTabLabels(project) {
  const tabs = getOrderedTerminalTabs(project.id, await window.boatyard.listTerminalTabs(project.id));
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));

  for (const session of terminalWidgetsBySurface.values()) {
    if (session.projectId !== project.id || !session.card?.isConnected) {
      continue;
    }

    for (const tabButton of session.card.querySelectorAll(".terminal-tab")) {
      if (tabButton.classList.contains("terminal-tab-editor")) {
        continue;
      }

      const tab = tabsById.get(tabButton.dataset.windowId);
      if (tab) {
        tabButton.textContent = tab.name || `shell ${tab.index}`;
      }
      tabButton.classList.toggle("active", tabButton.dataset.windowId === session.activeWindowId);
    }
  }
}

async function renameTerminalTab(project, tab, nextName) {
  const currentName = tab.name || `shell ${tab.index}`;
  const normalizedName = nextName.trim();
  if (!normalizedName || normalizedName === currentName) {
    return;
  }

  await window.boatyard.renameTerminalTab(project.id, tab.id, normalizedName);
  await refreshProjectTerminalTabLabels(project);
}

function editTerminalTabName(project, card, tab, tabButton) {
  const currentName = tab.name || `shell ${tab.index}`;
  const editor = document.createElement("input");
  editor.className = "terminal-tab terminal-tab-editor";
  editor.type = "text";
  editor.value = currentName;
  editor.dataset.windowId = tab.id;
  editor.setAttribute("aria-label", "Shell name");

  let finished = false;
  const finish = async (shouldSave) => {
    if (finished) {
      return;
    }
    finished = true;

    const nextName = editor.value;
    editor.replaceWith(tabButton);
    if (!shouldSave) {
      return;
    }

    try {
      await renameTerminalTab(project, tab, nextName);
    } catch (error) {
      setTerminalStatus(card, `Could not rename shell: ${error.message}`);
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

  tabButton.replaceWith(editor);
  editor.focus();
  editor.select();
}

function getTerminalSurfaceSession(card) {
  return terminalWidgetsBySurface.get(getTerminalSurfaceId(card)) || null;
}

function getPersistedTerminalWindowId(projectId, surfaceKey) {
  return state.terminalSelections?.[projectId]?.[surfaceKey] || null;
}

function rememberTerminalSelection(projectId, surfaceKey, windowId) {
  const normalizedProjectId = String(projectId || "").trim();
  const normalizedSurfaceKey = String(surfaceKey || "").trim();
  const normalizedWindowId = String(windowId || "").trim();
  if (!normalizedProjectId || !normalizedSurfaceKey) {
    return;
  }

  state.terminalSelections = {
    ...(state.terminalSelections || {})
  };

  if (!normalizedWindowId) {
    if (state.terminalSelections[normalizedProjectId]) {
      delete state.terminalSelections[normalizedProjectId][normalizedSurfaceKey];
      if (!Object.keys(state.terminalSelections[normalizedProjectId]).length) {
        delete state.terminalSelections[normalizedProjectId];
      }
    }
    return;
  }

  state.terminalSelections[normalizedProjectId] = {
    ...(state.terminalSelections[normalizedProjectId] || {}),
    [normalizedSurfaceKey]: normalizedWindowId
  };
}

function persistTerminalSelection(projectId, surfaceKey, windowId) {
  if (!surfaceKey || !window.boatyard.updateTerminalSelection) {
    return;
  }

  rememberTerminalSelection(projectId, surfaceKey, windowId);

  window.boatyard.updateTerminalSelection(projectId, surfaceKey, windowId)
    .then((selections) => {
      if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
        return;
      }

      const normalizedProjectId = String(projectId || "").trim();
      state.terminalSelections = {
        ...(state.terminalSelections || {})
      };
      if (Object.keys(selections).length) {
        state.terminalSelections[normalizedProjectId] = selections;
      } else {
        delete state.terminalSelections[normalizedProjectId];
      }
    })
    .catch((error) => {
      console.error("Could not persist terminal selection:", error);
    });
}

async function selectTerminalTab(project, card, tab) {
  const session = getTerminalSurfaceSession(card);
  const pendingWindowId = card.dataset.pendingTerminalWindowId;
  if (session?.activeWindowId === tab.id) {
    persistTerminalSelection(project.id, card.dataset.terminalStorageKey, tab.id);
    session.term?.focus();
    return;
  }

  if (pendingWindowId === tab.id) {
    return;
  }

  card.dataset.pendingTerminalWindowId = tab.id;
  try {
    await attachTerminalTab(project, card, tab.id, { focus: true });
    persistTerminalSelection(project.id, card.dataset.terminalStorageKey, tab.id);
  } finally {
    if (card.dataset.pendingTerminalWindowId === tab.id) {
      delete card.dataset.pendingTerminalWindowId;
    }
  }
}

function selectAdjacentTerminalTab(project, card, direction) {
  if (card.querySelector(".terminal-tab-editor")) {
    return;
  }

  const tabButtons = [...card.querySelectorAll(".terminal-tab[data-window-id]")];
  if (tabButtons.length <= 1) {
    return;
  }

  const session = getTerminalSurfaceSession(card);
  const activeWindowId = session?.activeWindowId || tabButtons.find((tabButton) => tabButton.classList.contains("active"))?.dataset.windowId;
  const activeIndex = Math.max(0, tabButtons.findIndex((tabButton) => tabButton.dataset.windowId === activeWindowId));
  const nextIndex = (activeIndex + direction + tabButtons.length) % tabButtons.length;
  const nextWindowId = tabButtons[nextIndex]?.dataset.windowId;

  if (!nextWindowId || nextWindowId === activeWindowId) {
    return;
  }

  selectTerminalTab(project, card, { id: nextWindowId }).catch((error) => {
    setTerminalStatus(card, `Could not switch shell: ${error.message}`);
  });
}

function handleTerminalTabShortcut(project, card, event) {
  if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const direction = event.key === "ArrowLeft"
    ? -1
    : event.key === "ArrowRight"
      ? 1
      : 0;

  if (!direction || event.target?.closest?.(".terminal-tab-editor")) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  selectAdjacentTerminalTab(project, card, direction);
}

function clearTerminalTabDragState(tabList) {
  delete tabList.dataset.draggedWindowId;
  for (const tabButton of tabList.querySelectorAll(".terminal-tab")) {
    tabButton.classList.remove("dragging");
  }
  clearTerminalTabDropMarkers(tabList);
}

function clearTerminalTabDropMarkers(tabList) {
  for (const tabButton of tabList.querySelectorAll(".terminal-tab")) {
    tabButton.classList.remove("drop-before", "drop-after");
  }
}

function getReorderedTerminalTabIds(tabList, draggedWindowId, targetWindowId, insertAfter = false) {
  const tabIds = getRenderedTerminalTabIds(tabList);
  const sourceIndex = tabIds.indexOf(String(draggedWindowId));
  const targetIndex = tabIds.indexOf(String(targetWindowId));

  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return null;
  }

  const nextTabIds = [...tabIds];
  const [movedWindowId] = nextTabIds.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = nextTabIds.indexOf(String(targetWindowId));
  nextTabIds.splice(targetIndexAfterRemoval + (insertAfter ? 1 : 0), 0, movedWindowId);

  return nextTabIds;
}

function getTerminalTabDropPosition(tabList, event) {
  const directTarget = event.target?.closest?.(".terminal-tab[data-window-id]");
  if (directTarget && tabList.contains(directTarget)) {
    const rect = directTarget.getBoundingClientRect();
    return {
      targetButton: directTarget,
      insertAfter: event.clientX > rect.left + rect.width / 2
    };
  }

  const tabButtons = [...tabList.querySelectorAll(".terminal-tab[data-window-id]")];
  if (!tabButtons.length) {
    return null;
  }

  for (const tabButton of tabButtons) {
    const rect = tabButton.getBoundingClientRect();
    if (event.clientX <= rect.left + rect.width / 2) {
      return {
        targetButton: tabButton,
        insertAfter: false
      };
    }
  }

  return {
    targetButton: tabButtons.at(-1),
    insertAfter: true
  };
}

function updateTerminalTabDropMarker(tabList, dropPosition) {
  clearTerminalTabDropMarkers(tabList);

  if (!dropPosition?.targetButton) {
    return;
  }

  dropPosition.targetButton.classList.toggle("drop-before", !dropPosition.insertAfter);
  dropPosition.targetButton.classList.toggle("drop-after", dropPosition.insertAfter);
}

function bindTerminalTabDropHandlers(project, card, tabList) {
  tabList.ondragover = (event) => {
    const draggedWindowId = tabList.dataset.draggedWindowId;
    if (!draggedWindowId) {
      return;
    }

    const dropPosition = getTerminalTabDropPosition(tabList, event);
    if (!dropPosition || dropPosition.targetButton.dataset.windowId === draggedWindowId) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    updateTerminalTabDropMarker(tabList, dropPosition);
  };

  tabList.ondragleave = (event) => {
    if (!event.relatedTarget || !tabList.contains(event.relatedTarget)) {
      clearTerminalTabDropMarkers(tabList);
    }
  };

  tabList.ondrop = async (event) => {
    const draggedWindowId = tabList.dataset.draggedWindowId || event.dataTransfer?.getData("text/plain");
    if (!draggedWindowId) {
      return;
    }

    event.preventDefault();
    const dropPosition = getTerminalTabDropPosition(tabList, event);
    const targetWindowId = dropPosition?.targetButton?.dataset.windowId;
    const nextTabIds = targetWindowId
      ? getReorderedTerminalTabIds(tabList, draggedWindowId, targetWindowId, dropPosition.insertAfter)
      : null;
    clearTerminalTabDragState(tabList);

    if (!nextTabIds) {
      return;
    }

    const session = getTerminalSurfaceSession(card);
    const activeWindowId = session?.activeWindowId || draggedWindowId;

    try {
      persistTerminalTabOrder(project.id, nextTabIds);
      const tabs = getOrderedTerminalTabs(project.id, await window.boatyard.listTerminalTabs(project.id));
      await refreshTerminalTabs(project, card, activeWindowId, tabs, { focus: true });
    } catch (error) {
      setTerminalStatus(card, `Could not move shell: ${error.message}`);
    }
  };
}

function attachTerminalTabDragHandlers(card, tab, tabButton, tabList) {
  tabButton.draggable = true;

  tabButton.addEventListener("dragstart", (event) => {
    if (card.querySelector(".terminal-tab-editor")) {
      event.preventDefault();
      return;
    }

    tabList.dataset.draggedWindowId = tab.id;
    tabButton.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", tab.id);
    }
  });

  tabButton.addEventListener("dragend", () => {
    tabButton.classList.remove("dragging");
    clearTerminalTabDragState(tabList);
  });
}

async function refreshTerminalTabs(project, card, activeWindowId = null, knownTabs = null, { focus = false } = {}) {
  const tabList = card.querySelector(".terminal-tabs");
  tabList.innerHTML = "";
  bindTerminalTabDropHandlers(project, card, tabList);

  try {
    const tabs = getOrderedTerminalTabs(project.id, Array.isArray(knownTabs)
      ? knownTabs
      : await window.boatyard.listTerminalTabs(project.id));
    const preferredWindowId = activeWindowId || getPersistedTerminalWindowId(project.id, card.dataset.terminalStorageKey);
    const selectedTab = tabs.find((tab) => tab.id === preferredWindowId) || tabs[0];

    for (const tab of tabs) {
      const tabButton = document.createElement("button");
      tabButton.className = "terminal-tab";
      tabButton.classList.toggle("active", tab.id === selectedTab?.id);
      tabButton.type = "button";
      tabButton.dataset.windowId = tab.id;
      tabButton.textContent = tab.name || `shell ${tab.index}`;
      tabButton.title = "Double-click to rename shell";
      attachTerminalTabDragHandlers(card, tab, tabButton, tabList);
      tabButton.addEventListener("click", () => {
        selectTerminalTab(project, card, tab).catch((error) => {
          setTerminalStatus(card, `Could not switch shell: ${error.message}`);
        });
      });
      tabButton.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        editTerminalTabName(project, card, tab, tabButton);
      });
      tabList.append(tabButton);
    }

    if (selectedTab) {
      if (!card.isConnected) {
        return;
      }

      await attachTerminalTab(project, card, selectedTab.id, { focus });
      persistTerminalSelection(project.id, card.dataset.terminalStorageKey, selectedTab.id);
    }
  } catch (error) {
    setTerminalStatus(card, `Terminal unavailable: ${error.message}`);
  }
}

async function refreshTerminalSurfaceAfterClosedTab(project, card, closedWindowId, knownTabs, { focus = false } = {}) {
  const orderedTabs = getOrderedTerminalTabs(project.id, knownTabs);
  const activeWindowId = closedWindowId
    ? getTerminalReplacementWindowId(card, closedWindowId, orderedTabs)
    : null;

  await refreshTerminalTabs(project, card, activeWindowId, orderedTabs, { focus });
}

async function attachTerminalTab(project, card, windowId, { focus = false } = {}) {
  if (!card.isConnected) {
    return;
  }

  const TerminalConstructor = getXtermConstructor();
  const FitAddonConstructor = getFitAddonConstructor();

  if (!TerminalConstructor || !FitAddonConstructor) {
    setTerminalStatus(card, "Terminal renderer unavailable.");
    return;
  }

  const surfaceId = getTerminalSurfaceId(card);
  detachTerminalSurface(surfaceId);
  const viewport = card.querySelector(".terminal-viewport");
  viewport.innerHTML = "";
  setTerminalStatus(card, "Attaching...");

  const term = new TerminalConstructor({
    cursorBlink: true,
    convertEol: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    theme: {
      background: "#080c11",
      foreground: "#d7dde5",
      cursor: "#41b883"
    }
  });
  const fitAddon = new FitAddonConstructor();
  term.loadAddon(fitAddon);
  term.open(viewport);
  await nextAnimationFrame();
  const initialSize = fitTerminal(term, fitAddon);

  const attachResult = await window.boatyard.attachTerminal(project.id, windowId, initialSize);
  const disposable = term.onData((data) => {
    if (data.includes("\x04")) {
      markTerminalCloseFocus(surfaceId, attachResult.tab.id);
    }

    window.boatyard.writeTerminal(attachResult.terminalId, data);
    scheduleTerminalTabSync(attachResult.terminalId, /[\x04\r\n]/.test(data) ? 3 : 0);
  });
  let selectionTimer = null;
  let lastMiddlePaste = {
    text: "",
    time: 0
  };
  let suppressNativePasteUntil = 0;
  const publishTerminalSelection = (delay = 0) => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selection = term.getSelection();
      if (selection) {
        window.boatyard.writeTerminalSelection(selection).catch((error) => {
          console.error("Could not write terminal selection:", error);
        });
      }
    }, delay);
  };
  const selectionDisposable = term.onSelectionChange(() => {
    publishTerminalSelection(60);
  });
  const onLeftMouseUpSelection = (event) => {
    if (event.button !== 0) {
      return;
    }

    publishTerminalSelection(0);
  };
  const onLeftMouseDownSelection = (event) => {
    if (event.button !== 0 || event.shiftKey || term.modes.mouseTrackingMode === "none") {
      return;
    }

    try {
      Object.defineProperty(event, "shiftKey", {
        configurable: true,
        value: true
      });
    } catch (error) {
      console.error("Could not force terminal selection mode:", error);
    }
  };
  const onMiddleMouseDownPaste = (event) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    suppressNativePasteUntil = Date.now() + 300;
    term.focus();
    window.boatyard.readTerminalSelection()
      .then((selection) => {
        if (selection) {
          const session = terminalWidgetsBySurface.get(surfaceId);
          if (!session?.terminalId) {
            return;
          }

          const now = Date.now();
          if (selection === lastMiddlePaste.text && now - lastMiddlePaste.time < 150) {
            return;
          }

          lastMiddlePaste = {
            text: selection,
            time: now
          };
          session.term?.focus();
          window.boatyard.writeTerminal(session.terminalId, selection);
          scheduleTerminalTabSync(session.terminalId, /[\x04\r\n]/.test(selection) ? 3 : 0);
        }
      })
      .catch((error) => {
        console.error("Could not read terminal selection:", error);
      });
  };
  const onMiddleAuxClick = (event) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  };
  const onNativePaste = (event) => {
    if (Date.now() > suppressNativePasteUntil) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener("mouseup", onLeftMouseUpSelection, true);
  viewport.addEventListener("mousedown", onLeftMouseDownSelection, true);
  viewport.addEventListener("mousedown", onMiddleMouseDownPaste, true);
  viewport.addEventListener("auxclick", onMiddleAuxClick, true);
  viewport.addEventListener("paste", onNativePaste, true);
  const resizeObserver = new ResizeObserver(() => {
    const size = fitTerminal(term, fitAddon);
    window.boatyard.resizeTerminal(attachResult.terminalId, size);
  });
  resizeObserver.observe(viewport);
  terminalWidgetsBySurface.set(surfaceId, {
    projectId: project.id,
    card,
    terminalId: attachResult.terminalId,
    activeWindowId: attachResult.tab.id,
    term,
    fitAddon,
    disposables: [
      disposable,
      selectionDisposable,
      {
        dispose: () => clearTimeout(selectionTimer)
      }
    ],
    removeMiddleClickPaste: () => {
      document.removeEventListener("mouseup", onLeftMouseUpSelection, true);
      viewport.removeEventListener("mousedown", onLeftMouseDownSelection, true);
      viewport.removeEventListener("mousedown", onMiddleMouseDownPaste, true);
      viewport.removeEventListener("auxclick", onMiddleAuxClick, true);
      viewport.removeEventListener("paste", onNativePaste, true);
    },
    resizeObserver
  });
  terminalWidgetsByTerminal.set(attachResult.terminalId, {
    projectId: project.id,
    surfaceId,
    term
  });
  setTerminalStatus(card, attachResult.tab.name || "attached");

  for (const tabButton of card.querySelectorAll(".terminal-tab")) {
    tabButton.classList.toggle("active", tabButton.dataset.windowId === attachResult.tab.id);
  }

  if (focus) {
    term.focus();
  }
}

function createTerminalSurface(project, {
  tagName = "article",
  className = "widget-card terminal-widget",
  storageKey = "widget:default"
} = {}) {
  const card = document.createElement(tagName);
  card.className = className;
  card.dataset.terminalStorageKey = storageKey;

  const header = document.createElement("div");
  header.className = "terminal-widget-header";

  const title = document.createElement("div");
  title.className = "terminal-widget-title";
  title.innerHTML = "<span>Terminal</span><small>tmux</small>";

  const actions = document.createElement("div");
  actions.className = "terminal-widget-actions";

  const tabs = document.createElement("div");
  tabs.className = "terminal-tabs";

  const addButton = document.createElement("button");
  addButton.className = "terminal-action";
  addButton.type = "button";
  addButton.title = "New shell";
  addButton.setAttribute("aria-label", "New shell");
  addButton.textContent = "+";
  addButton.addEventListener("click", async () => {
    const tab = await window.boatyard.createTerminalTab(project.id, "shell");
    await refreshTerminalTabs(project, card, tab.id);
  });

  const closeButton = document.createElement("button");
  closeButton.className = "terminal-action";
  closeButton.type = "button";
  closeButton.title = "Close current shell";
  closeButton.setAttribute("aria-label", "Close current shell");
  closeButton.textContent = "x";
  closeButton.addEventListener("click", async () => {
    const surfaceId = getTerminalSurfaceId(card);
    const session = terminalWidgetsBySurface.get(surfaceId);
    if (!session) {
      return;
    }

    closeButton.disabled = true;
    const activeWindowId = session.activeWindowId;
    try {
      const allTabs = await window.boatyard.listTerminalTabs(project.id);
      if (!activeWindowId || allTabs.length <= 1) {
        return;
      }

      markTerminalCloseFocus(surfaceId, activeWindowId);
      const remainingTabs = (await window.boatyard.closeTerminalTab(project.id, activeWindowId))
        .filter((tab) => tab.id !== activeWindowId);
      await refreshTerminalSurfaceAfterClosedTab(project, card, activeWindowId, remainingTabs, { focus: true });
    } catch (error) {
      setTerminalStatus(card, `Could not close shell: ${error.message}`);
    } finally {
      closeButton.disabled = false;
    }
  });

  actions.append(addButton, closeButton);
  header.append(title, tabs, actions);

  const viewport = document.createElement("div");
  viewport.className = "terminal-viewport";

  const status = document.createElement("p");
  status.className = "terminal-status";
  status.textContent = "Loading tmux session...";

  card.addEventListener("keydown", (event) => {
    handleTerminalTabShortcut(project, card, event);
  }, true);

  card.append(header, viewport, status);
  queueMicrotask(() => {
    refreshTerminalTabs(project, card);
  });
  return card;
}

function createTerminalWidget(project, props = {}) {
  return createTerminalSurface(project, {
    storageKey: `widget:${props.widgetPaneId || DEFAULT_WIDGET_PANE_ID}`
  });
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

function getInstalledWidgets(filter = {}) {
  return window.BoatyardWidgetRegistry.list(filter);
}

function getProjectWidgetDefinitions(project = null) {
  return getInstalledWidgets({ scope: isGlobalWorkspace(project) ? "global" : "project" });
}

function normalizeWidgetId(widgetId) {
  const id = String(widgetId || "").trim();
  return LEGACY_WIDGET_IDS.get(id) || id;
}

function getMigratedWidgetEntry(entries = {}, widgetId) {
  if (!entries || typeof entries !== "object") {
    return null;
  }

  if (entries[widgetId]) {
    return entries[widgetId];
  }

  for (const [legacyId, nextId] of LEGACY_WIDGET_IDS) {
    if (nextId === widgetId && entries[legacyId]) {
      return entries[legacyId];
    }
  }

  return null;
}

function getProjectWidgetPanes(project) {
  const panes = Array.isArray(project.widgetPanes) ? project.widgetPanes : [];
  return panes.length
    ? panes
    : [{
        id: DEFAULT_WIDGET_PANE_ID,
        label: "Widgets"
      }];
}

function getPersistedWidgetPaneLayout(project, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const persistedProjectLayout = widgetLayoutsByProject.get(project.id) || {};
  if (persistedProjectLayout.panes && typeof persistedProjectLayout.panes === "object") {
    return persistedProjectLayout.panes[widgetPaneId] || {};
  }

  return widgetPaneId === DEFAULT_WIDGET_PANE_ID ? persistedProjectLayout : {};
}

function hasPersistedWidgetPaneLayout(project, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const persistedProjectLayout = widgetLayoutsByProject.get(project.id) || {};
  if (persistedProjectLayout.panes && typeof persistedProjectLayout.panes === "object") {
    return Boolean(persistedProjectLayout.panes[widgetPaneId]);
  }

  return widgetPaneId === DEFAULT_WIDGET_PANE_ID && Object.keys(persistedProjectLayout).length > 0;
}

function setWidgetPaneLayout(project, widgetPaneId, layout) {
  const persistedProjectLayout = widgetLayoutsByProject.get(project.id) || {};
  const panes = persistedProjectLayout.panes && typeof persistedProjectLayout.panes === "object"
    ? persistedProjectLayout.panes
    : {
        [DEFAULT_WIDGET_PANE_ID]: persistedProjectLayout
      };

  widgetLayoutsByProject.set(project.id, {
    panes: {
      ...panes,
      [widgetPaneId]: layout
    }
  });
}

function normalizeWidgetLayoutForProject(project, columnCount = null, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const persisted = getPersistedWidgetPaneLayout(project, widgetPaneId);
  const widgetDefinitions = getProjectWidgetDefinitions(project);
  const knownIds = widgetDefinitions.map((definition) => definition.id);
  const knownIdSet = new Set(knownIds);
  const definitionsById = new Map(widgetDefinitions.map((definition) => [definition.id, definition]));
  const startsEmpty = widgetPaneId !== DEFAULT_WIDGET_PANE_ID && !hasPersistedWidgetPaneLayout(project, widgetPaneId);
  const persistedOrderIdSet = new Set(Array.isArray(persisted.order)
    ? persisted.order.map(normalizeWidgetId).filter((id) => knownIdSet.has(id))
    : []);
  const hidden = Array.isArray(persisted.hidden)
    ? persisted.hidden
        .map(normalizeWidgetId)
        .filter((id, index, ids) => knownIdSet.has(id) && ids.indexOf(id) === index)
    : startsEmpty ? [...knownIds] : [];

  for (const definition of widgetDefinitions) {
    if (
      definition.defaultVisible === false &&
      !persistedOrderIdSet.has(definition.id) &&
      !hidden.includes(definition.id)
    ) {
      hidden.push(definition.id);
    }
  }

  const hiddenIdSet = new Set(hidden);
  const seenIds = new Set();
  const order = Array.isArray(persisted.order)
    ? persisted.order
        .map(normalizeWidgetId)
        .filter((id) => {
          if (!knownIdSet.has(id) || hiddenIdSet.has(id) || seenIds.has(id)) {
            return false;
          }

          seenIds.add(id);
          return true;
        })
    : [];

  for (const id of knownIds) {
    if (!seenIds.has(id) && !hiddenIdSet.has(id)) {
      order.push(id);
    }
  }
  const sizes = {};
  const positions = {};

  for (const id of order) {
    const definition = definitionsById.get(id);
    const size = clampWidgetGridSize(definition, getMigratedWidgetEntry(persisted.sizes, id));
    sizes[id] = columnCount ? fitWidgetSizeToGrid(size, columnCount) : size;
  }

  for (const id of order) {
    const persistedPosition = normalizeWidgetGridPosition(getMigratedWidgetEntry(persisted.positions, id));
    const position = persistedPosition && isWidgetAreaAvailable({
      widgetId: id,
      position: persistedPosition,
      size: sizes[id],
      positions,
      sizes,
      columnCount
    })
      ? persistedPosition
      : findAvailableWidgetPosition({
          widgetId: id,
          size: sizes[id],
          positions,
          sizes,
          columnCount
        });

    positions[id] = position;
  }

  return {
    order,
    hidden,
    sizes,
    positions,
    locked: persisted.locked !== false
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getWidgetLayoutSpec(definition) {
  const layout = definition.layout || {};
  const defaultSize = layout.default || { columns: 1, rows: 2 };
  const minSize = layout.min || { columns: 1, rows: 1 };
  const maxSize = layout.max || {};

  return {
    default: defaultSize,
    min: minSize,
    max: {
      columns: Number.isFinite(Number(maxSize.columns)) ? Number(maxSize.columns) : Number.POSITIVE_INFINITY,
      rows: Number.isFinite(Number(maxSize.rows)) ? Number(maxSize.rows) : Number.POSITIVE_INFINITY
    }
  };
}

function clampWidgetGridSize(definition, size) {
  const spec = getWidgetLayoutSpec(definition);
  const source = size && typeof size === "object" ? size : spec.default;
  const columns = Number(source.columns);
  const rows = Number(source.rows);

  return {
    columns: clamp(
      Number.isFinite(columns) ? Math.round(columns) : spec.default.columns,
      spec.min.columns,
      spec.max.columns
    ),
    rows: clamp(
      Number.isFinite(rows) ? Math.round(rows) : spec.default.rows,
      spec.min.rows,
      spec.max.rows
    )
  };
}

function getWidgetGridColumnCount(widgetRailWidth) {
  const width = Math.max(1, Math.round(widgetRailWidth || 0));

  return Math.max(1, Math.floor(width / WIDGET_GRID_MIN_COLUMN_WIDTH));
}

function getWidgetRailColumnCount(widgetRail) {
  const stored = Number(widgetRail?.dataset.widgetGridColumns);
  if (Number.isFinite(stored) && stored > 0) {
    return Math.round(stored);
  }

  return getWidgetGridColumnCount(widgetRail?.getBoundingClientRect().width || WIDGET_GRID_MAX_COLUMN_WIDTH);
}

function getWidgetGridTrackSpec(widgetRail) {
  if (!widgetRail) {
    return {
      rowHeight: WIDGET_GRID_ROW_HEIGHT,
      rowCount: 1
    };
  }

  const styles = window.getComputedStyle(widgetRail);
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const availableHeight = Math.max(
    WIDGET_GRID_ROW_HEIGHT,
    widgetRail.clientHeight - paddingTop - paddingBottom - WIDGET_GRID_SCROLL_GUARD
  );
  const rowCount = Math.max(
    1,
    Math.floor((availableHeight + WIDGET_GRID_GAP) / (WIDGET_GRID_ROW_HEIGHT + WIDGET_GRID_GAP))
  );
  const rowHeight = Math.max(
    1,
    (availableHeight - WIDGET_GRID_GAP * Math.max(0, rowCount - 1)) / rowCount
  );

  return { rowHeight, rowCount };
}

function fitWidgetSizeToGrid(size, columnCount) {
  return {
    columns: Math.min(columnCount, size.columns),
    rows: size.rows
  };
}

function applyWidgetGridLayout(widgetRail, project, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const layout = getProjectWidgetLayout(project, columnCount, widgetPaneId);
  const trackSpec = getWidgetGridTrackSpec(widgetRail);
  widgetRail.dataset.widgetGridColumns = String(columnCount);
  widgetRail.dataset.widgetGridRows = String(trackSpec.rowCount);
  widgetRail.dataset.widgetGridRowHeight = String(trackSpec.rowHeight);
  widgetRail.style.setProperty("--widget-grid-columns", String(columnCount));
  widgetRail.style.setProperty("--widget-grid-row-height", `${trackSpec.rowHeight}px`);

  for (const card of widgetRail.querySelectorAll(".widget-card")) {
    const widgetId = card.dataset.widgetId;
    const size = layout.sizes[widgetId];
    const position = layout.positions[widgetId];

    if (!size || !position) {
      continue;
    }

    card.style.gridColumn = `${position.x + 1} / span ${size.columns}`;
    card.style.gridRow = `${position.y + 1} / span ${size.rows}`;
  }
}

function normalizeWidgetGridPosition(position) {
  if (!position || typeof position !== "object") {
    return null;
  }

  const x = Number(position.x);
  const y = Number(position.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y))
  };
}

function doWidgetAreasOverlap(leftPosition, leftSize, rightPosition, rightSize) {
  return leftPosition.x < rightPosition.x + rightSize.columns &&
    leftPosition.x + leftSize.columns > rightPosition.x &&
    leftPosition.y < rightPosition.y + rightSize.rows &&
    leftPosition.y + leftSize.rows > rightPosition.y;
}

function isWidgetAreaAvailable({ widgetId, position, size, positions, sizes, columnCount }) {
  if (columnCount && position.x + size.columns > columnCount) {
    return false;
  }

  return Object.entries(positions).every(([otherId, otherPosition]) => {
    if (otherId === widgetId) {
      return true;
    }

    return !doWidgetAreasOverlap(position, size, otherPosition, sizes[otherId]);
  });
}

function findAvailableWidgetPosition({ widgetId, size, positions, sizes, columnCount }) {
  const columns = Math.max(1, columnCount || size.columns);

  for (let y = 0; y < 200; y += 1) {
    for (let x = 0; x <= columns - size.columns; x += 1) {
      const position = { x, y };

      if (isWidgetAreaAvailable({ widgetId, position, size, positions, sizes, columnCount: columns })) {
        return position;
      }
    }
  }

  return {
    x: 0,
    y: Object.entries(positions).reduce((maxY, [id, position]) => (
      Math.max(maxY, position.y + sizes[id].rows)
    ), 0)
  };
}

function getProjectWidgetLayout(project, columnCount = null, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const layout = normalizeWidgetLayoutForProject(project, columnCount, widgetPaneId);
  setWidgetPaneLayout(project, widgetPaneId, layout);
  return layout;
}

function getOrderedWidgetDefinitions(project, layout) {
  const definitionsById = new Map(getProjectWidgetDefinitions(project).map((definition) => [definition.id, definition]));
  return layout.order
    .map((id) => definitionsById.get(id))
    .filter(Boolean);
}

function getWidgetDefinition(project, widgetId) {
  return getProjectWidgetDefinitions(project).find((definition) => definition.id === widgetId) || null;
}

function persistWidgetLayout(project) {
  const layout = widgetLayoutsByProject.get(project.id);
  if (!layout) {
    return Promise.resolve(null);
  }

  return window.boatyard.updateWidgetLayout(project.id, layout).catch((error) => {
    console.error("Could not persist widget layout:", error);
    return null;
  });
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

async function toggleWidgetLayoutLock(project, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const layout = getProjectWidgetLayout(project, null, widgetPaneId);
  setWidgetPaneLayout(project, widgetPaneId, {
    ...layout,
    locked: !layout.locked
  });
  await persistWidgetLayout(project);
  renderWorkspaceDashboard(project);
}

async function removeProjectWidget(project, widgetId, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const definition = getWidgetDefinition(project, widgetId);

  if (!definition) {
    return false;
  }

  const layout = getProjectWidgetLayout(project, columnCount, widgetPaneId);
  const hidden = [...new Set([...layout.hidden, widgetId])];
  const sizes = { ...layout.sizes };
  const positions = { ...layout.positions };
  delete sizes[widgetId];
  delete positions[widgetId];

  setWidgetPaneLayout(project, widgetPaneId, {
    ...layout,
    order: layout.order.filter((id) => id !== widgetId),
    hidden,
    sizes,
    positions
  });
  await persistWidgetLayout(project);
  renderWorkspaceDashboard(project);
  return true;
}

async function addProjectWidget(project, widgetId, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const definition = getWidgetDefinition(project, widgetId);

  if (!definition) {
    return false;
  }

  const layout = getProjectWidgetLayout(project, columnCount, widgetPaneId);
  const size = fitWidgetSizeToGrid(clampWidgetGridSize(definition), columnCount);
  const hidden = layout.hidden.filter((id) => id !== widgetId);
  const positions = { ...layout.positions };
  const sizes = {
    ...layout.sizes,
    [widgetId]: size
  };
  positions[widgetId] = findAvailableWidgetPosition({
    widgetId,
    size,
    positions,
    sizes,
    columnCount
  });

  setWidgetPaneLayout(project, widgetPaneId, {
    ...layout,
    order: [...layout.order.filter((id) => id !== widgetId), widgetId],
    hidden,
    sizes,
    positions
  });
  await persistWidgetLayout(project);
  renderWorkspaceDashboard(project);
  return true;
}

function getWidgetGridPositionFromPointer(event, rail, columnCount, size) {
  const rect = rail.getBoundingClientRect();
  const styles = window.getComputedStyle(rail);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const rowHeight = Number(rail.dataset.widgetGridRowHeight) || WIDGET_GRID_ROW_HEIGHT;
  const contentWidth = Math.max(1, rail.clientWidth - paddingLeft - paddingRight);
  const columnWidth = (contentWidth - WIDGET_GRID_GAP * (columnCount - 1)) / columnCount;
  const x = Math.floor((event.clientX - rect.left - paddingLeft) / (columnWidth + WIDGET_GRID_GAP));
  const y = Math.floor(
    (event.clientY - rect.top - paddingTop) /
      (rowHeight + WIDGET_GRID_GAP)
  );

  return {
    x: clamp(x, 0, Math.max(0, columnCount - size.columns)),
    y: Math.max(0, y)
  };
}

function ensureWidgetDropPreview(widgetRail) {
  let preview = widgetRail.querySelector(".widget-drop-preview");

  if (!preview) {
    preview = document.createElement("div");
    preview.className = "widget-drop-preview";
    preview.setAttribute("aria-hidden", "true");
    widgetRail.append(preview);
  }

  return preview;
}

function updateWidgetDropPreview(widgetRail, position, size, available) {
  const preview = ensureWidgetDropPreview(widgetRail);
  preview.classList.toggle("blocked", !available);
  preview.style.gridColumn = `${position.x + 1} / span ${size.columns}`;
  preview.style.gridRow = `${position.y + 1} / span ${size.rows}`;
}

function clearWidgetDropPreview(widgetRail) {
  if (!widgetRail) {
    return;
  }

  widgetRail.querySelector(".widget-drop-preview")?.remove();
  delete widgetRail.dataset.dropState;
}

async function moveWidgetToGridPosition(project, widgetId, position, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const definition = getWidgetDefinition(project, widgetId);

  if (!definition) {
    return false;
  }

  const layout = getProjectWidgetLayout(project, columnCount, widgetPaneId);
  const size = layout.sizes[widgetId];

  if (!isWidgetAreaAvailable({
    widgetId,
    position,
    size,
    positions: layout.positions,
    sizes: layout.sizes,
    columnCount
  })) {
    return false;
  }

  setWidgetPaneLayout(project, widgetPaneId, {
    ...layout,
    positions: {
      ...layout.positions,
      [widgetId]: position
    }
  });
  await persistWidgetLayout(project);
  renderWorkspaceDashboard(project);
  return true;
}

function attachWidgetGridDropHandlers(widgetRail, project, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  widgetRail.addEventListener("dragover", (event) => {
    if (!draggedWidgetId) {
      return;
    }

    const currentColumnCount = getWidgetRailColumnCount(widgetRail) || columnCount;
    const layout = getProjectWidgetLayout(project, currentColumnCount, widgetPaneId);
    const size = layout.sizes[draggedWidgetId];
    if (!size) {
      return;
    }

    event.preventDefault();
    const position = getWidgetGridPositionFromPointer(event, widgetRail, currentColumnCount, size);
    const available = isWidgetAreaAvailable({
      widgetId: draggedWidgetId,
      position,
      size,
      positions: layout.positions,
      sizes: layout.sizes,
      columnCount: currentColumnCount
    });

    event.dataTransfer.dropEffect = available ? "move" : "none";
    widgetRail.dataset.dropState = available ? "available" : "blocked";
    updateWidgetDropPreview(widgetRail, position, size, available);
  });

  widgetRail.addEventListener("dragleave", (event) => {
    if (!widgetRail.contains(event.relatedTarget)) {
      clearWidgetDropPreview(widgetRail);
    }
  });

  widgetRail.addEventListener("drop", async (event) => {
    const widgetId = event.dataTransfer.getData("text/plain") || draggedWidgetId;
    const currentColumnCount = getWidgetRailColumnCount(widgetRail) || columnCount;
    const layout = getProjectWidgetLayout(project, currentColumnCount, widgetPaneId);
    const size = layout.sizes[widgetId];
    clearWidgetDropPreview(widgetRail);

    if (!widgetId || !size) {
      return;
    }

    event.preventDefault();
    const position = getWidgetGridPositionFromPointer(event, widgetRail, currentColumnCount, size);
    await moveWidgetToGridPosition(project, widgetId, position, currentColumnCount, widgetPaneId);
  });
}

function createProjectWidget(project, definition, layout, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const globalScope = isGlobalWorkspace(project);
  const props = {
    projectId: project.id,
    project,
    widgetPaneId,
    pluginConfig: definition.pluginId && !globalScope ? getProjectPluginConfig(project.id, definition.pluginId) : {},
    globalPluginConfig: definition.pluginId ? getGlobalPluginConfig(definition.pluginId) : {},
    allProjectPluginConfig: globalScope ? {} : state.pluginConfig?.projects?.[project.id] || {},
    openProjectWebApp(webAppId, url = "") {
      return openProjectWebApp(project.id, webAppId, url);
    }
  };
  const card = definition.createElement ? definition.createElement(project, props) : createCard(definition.create(project, props));
  const size = fitWidgetSizeToGrid(layout.sizes[definition.id], columnCount);
  const position = layout.positions[definition.id] || { x: 0, y: 0 };
  card.dataset.widgetId = definition.id;
  card.style.gridColumn = `${position.x + 1} / span ${size.columns}`;
  card.style.gridRow = `${position.y + 1} / span ${size.rows}`;

  if (!layout.locked) {
    card.draggable = true;
    card.addEventListener("dragstart", (event) => {
      draggedWidgetId = definition.id;
      card.classList.add("dragging");
      card.closest(".project-widget-rail")?.classList.add("dragging-widget");
      card.closest(".webapp-pane")?.classList.add("dragging-widget");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", definition.id);
    });
    card.addEventListener("dragend", () => {
      draggedWidgetId = null;
      card.classList.remove("dragging");
      card.closest(".project-widget-rail")?.classList.remove("dragging-widget");
      card.closest(".webapp-pane")?.classList.remove("dragging-widget");
      for (const item of dashboardGrid.querySelectorAll(".widget-card")) {
        item.classList.remove("drag-over");
      }
      for (const dropzone of document.querySelectorAll(".widget-trash-dropzone")) {
        dropzone.classList.remove("drag-over");
      }
      for (const rail of dashboardGrid.querySelectorAll(".project-widget-rail")) {
        clearWidgetDropPreview(rail);
      }
    });

    const resizeDirections = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];
    for (const direction of resizeDirections) {
      const resizeHandle = document.createElement("button");
      resizeHandle.className = `widget-resize-handle ${direction}`;
      resizeHandle.type = "button";
      resizeHandle.draggable = false;
      resizeHandle.title = "Resize widget";
      resizeHandle.setAttribute("aria-label", `Resize ${definition.name} ${direction}`);
      resizeHandle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const rail = event.currentTarget.closest(".project-widget-rail");
        const currentColumnCount = getWidgetRailColumnCount(rail) || columnCount;
        const currentLayout = getProjectWidgetLayout(project, currentColumnCount, widgetPaneId);
        const currentSize = currentLayout.sizes[definition.id] || size;
        startWidgetResize(event, project, definition, currentLayout, currentSize, currentColumnCount, direction, widgetPaneId);
      });
      card.append(resizeHandle);
    }
  }

  return card;
}

function startWidgetResize(event, project, definition, layout, startSize, columnCount, direction, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const spec = getWidgetLayoutSpec(definition);
  const startX = event.clientX;
  const startY = event.clientY;
  const startPosition = layout.positions[definition.id] || { x: 0, y: 0 };
  const card = event.currentTarget.closest(".widget-card");
  const rail = event.currentTarget.closest(".project-widget-rail");
  const railWidth = rail?.getBoundingClientRect().width || WIDGET_GRID_MIN_COLUMN_WIDTH;
  const columnWidth = (railWidth - WIDGET_GRID_GAP * (columnCount - 1)) / columnCount;
  const columnStep = Math.max(1, columnWidth + WIDGET_GRID_GAP);
  const trackSpec = getWidgetGridTrackSpec(rail);
  const rowStep = trackSpec.rowHeight + WIDGET_GRID_GAP;
  const maxColumns = Math.min(columnCount, spec.max.columns);
  const canResizeNorth = direction.includes("n");
  const canResizeEast = direction.includes("e");
  const canResizeSouth = direction.includes("s");
  const canResizeWest = direction.includes("w");
  let lastGeometryKey = `${startPosition.x}:${startPosition.y}:${startSize.columns}:${startSize.rows}`;

  function getNextGeometry(deltaColumns, deltaRows) {
    let nextX = startPosition.x;
    let nextY = startPosition.y;
    let nextColumns = startSize.columns;
    let nextRows = startSize.rows;

    if (canResizeWest) {
      const right = startPosition.x + startSize.columns;
      nextX = clamp(startPosition.x + deltaColumns, Math.max(0, right - maxColumns), right - spec.min.columns);
      nextColumns = right - nextX;
    } else if (canResizeEast) {
      nextColumns = clamp(
        startSize.columns + deltaColumns,
        spec.min.columns,
        Math.min(maxColumns, columnCount - startPosition.x)
      );
    }

    if (canResizeNorth) {
      const bottom = startPosition.y + startSize.rows;
      const maxRows = Math.max(spec.min.rows, Math.min(spec.max.rows, trackSpec.rowCount));
      nextY = clamp(startPosition.y + deltaRows, Math.max(0, bottom - maxRows), bottom - spec.min.rows);
      nextRows = bottom - nextY;
    } else if (canResizeSouth) {
      const maxRows = Math.max(spec.min.rows, Math.min(spec.max.rows, trackSpec.rowCount - startPosition.y));
      nextRows = clamp(startSize.rows + deltaRows, spec.min.rows, maxRows);
    }

    return {
      position: {
        x: nextX,
        y: nextY
      },
      size: {
        columns: nextColumns,
        rows: nextRows
      }
    };
  }

  function onPointerMove(moveEvent) {
    const deltaColumns = Math.round((moveEvent.clientX - startX) / columnStep);
    const deltaRows = Math.round((moveEvent.clientY - startY) / rowStep);
    const nextGeometry = getNextGeometry(deltaColumns, deltaRows);
    const nextGeometryKey = [
      nextGeometry.position.x,
      nextGeometry.position.y,
      nextGeometry.size.columns,
      nextGeometry.size.rows
    ].join(":");

    if (nextGeometryKey === lastGeometryKey) {
      return;
    }

    const nextSizes = {
      ...layout.sizes,
      [definition.id]: nextGeometry.size
    };
    const nextPositions = {
      ...layout.positions,
      [definition.id]: nextGeometry.position
    };

    if (!isWidgetAreaAvailable({
      widgetId: definition.id,
      position: nextGeometry.position,
      size: nextGeometry.size,
      positions: nextPositions,
      sizes: nextSizes,
      columnCount
    })) {
      return;
    }

    lastGeometryKey = nextGeometryKey;
    setWidgetPaneLayout(project, widgetPaneId, {
      ...layout,
      positions: nextPositions,
      sizes: nextSizes
    });

    if (card) {
      card.style.gridColumn = `${nextGeometry.position.x + 1} / span ${nextGeometry.size.columns}`;
      card.style.gridRow = `${nextGeometry.position.y + 1} / span ${nextGeometry.size.rows}`;
    }
  }

  async function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    await persistWidgetLayout(project);
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function closeWidgetAddMenu() {
  if (!openWidgetAddMenu) {
    return;
  }

  openWidgetAddMenu.cleanup?.();
  openWidgetAddMenu.remove();
  openWidgetAddMenu = null;
}

function openWidgetAddMenuFromButton(button, project, layout, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  closeWidgetAddMenu();

  const hiddenDefinitions = layout.hidden
    .map((id) => getWidgetDefinition(project, id))
    .filter(Boolean);

  if (!hiddenDefinitions.length) {
    return;
  }

  const menu = document.createElement("div");
  menu.className = "widget-add-menu";
  menu.setAttribute("role", "menu");

  const rect = button.getBoundingClientRect();
  const menuWidth = Math.min(280, Math.max(0, window.innerWidth - 24));
  const maxLeft = Math.max(12, window.innerWidth - menuWidth - 12);
  const menuLeft = clamp(rect.right - menuWidth, 12, maxLeft);
  menu.style.top = `${Math.round(rect.bottom + 6)}px`;
  menu.style.left = `${Math.round(menuLeft)}px`;

  for (const definition of hiddenDefinitions) {
    const item = document.createElement("button");
    item.className = "widget-add-menu-item";
    item.type = "button";
    item.setAttribute("role", "menuitem");

    const name = document.createElement("span");
    name.textContent = definition.name;

    const meta = document.createElement("small");
    meta.textContent = `${definition.category} / ${definition.status}`;

    item.append(name, meta);
    item.addEventListener("click", async () => {
      closeWidgetAddMenu();
      await addProjectWidget(project, definition.id, columnCount, widgetPaneId);
    });
    menu.append(item);
  }

  document.body.append(menu);
  openWidgetAddMenu = menu;
  button.setAttribute("aria-expanded", "true");

  function onPointerDown(event) {
    if (!menu.contains(event.target) && event.target !== button) {
      closeWidgetAddMenu();
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      closeWidgetAddMenu();
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

function getWidgetRailFromControl(control) {
  return control.closest(".project-widget-rail") || control.closest(".webapp-pane")?.querySelector(".project-widget-rail") || null;
}

function createWidgetTrashDropzone(project, columnCount, widgetPaneId = DEFAULT_WIDGET_PANE_ID) {
  const dropzone = document.createElement("div");
  dropzone.className = "widget-trash-dropzone";
  dropzone.setAttribute("role", "button");
  dropzone.setAttribute("aria-label", "Remove dragged widget");
  dropzone.textContent = "Trash";

  dropzone.addEventListener("dragover", (event) => {
    if (!draggedWidgetId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    clearWidgetDropPreview(getWidgetRailFromControl(dropzone));
    dropzone.classList.add("drag-over");
  });

  dropzone.addEventListener("dragleave", (event) => {
    if (!dropzone.contains(event.relatedTarget)) {
      dropzone.classList.remove("drag-over");
    }
  });

  dropzone.addEventListener("drop", async (event) => {
    const widgetId = event.dataTransfer.getData("text/plain") || draggedWidgetId;

    if (!widgetId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("drag-over");
    clearWidgetDropPreview(getWidgetRailFromControl(dropzone));
    draggedWidgetId = null;
    const rail = getWidgetRailFromControl(dropzone);
    await removeProjectWidget(project, widgetId, getWidgetRailColumnCount(rail) || columnCount, widgetPaneId);
  });

  return dropzone;
}

function createWidgetPaneActions(project, widgetPane, layout, columnCount) {
  const actions = document.createElement("div");
  actions.className = "widget-rail-actions";

  const actionConfigs = [
    {
      label: layout.locked ? "Unlock widget layout" : "Lock widget layout",
      text: layout.locked ? "Edit" : "Lock",
      wide: true,
      onClick: () => toggleWidgetLayoutLock(project, widgetPane.id)
    }
  ];

  const trashDropzone = !layout.locked ? createWidgetTrashDropzone(project, columnCount, widgetPane.id) : null;

  if (!layout.locked) {
    actionConfigs.push({
      label: "Add widget",
      text: "+",
      disabled: !layout.hidden.length,
      onClick: (event) => {
        const rail = getWidgetRailFromControl(event.currentTarget);
        const currentColumnCount = getWidgetRailColumnCount(rail) || columnCount;
        const currentLayout = getProjectWidgetLayout(project, currentColumnCount, widgetPane.id);
        openWidgetAddMenuFromButton(event.currentTarget, project, currentLayout, currentColumnCount, widgetPane.id);
      }
    });
  }

  for (const action of actionConfigs) {
    const button = document.createElement("button");
    button.className = `widget-rail-action${action.wide ? " wide" : ""}`;
    button.type = "button";
    button.title = action.label;
    button.setAttribute("aria-label", action.label);
    button.disabled = action.disabled === true;
    button.textContent = action.text;
    if (action.text === "+") {
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
    }
    if (action.onClick) {
      button.addEventListener("click", action.onClick);
    }
    actions.append(button);
    if (action.wide && trashDropzone) {
      actions.append(trashDropzone);
    }
  }

  return actions;
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

  if (paneNode?.transientWebApp?.url) {
    webApps.push({
      id: paneNode.transientWebApp.id,
      label: paneNode.transientWebApp.label || "Link",
      key: `${paneId}:transient:${paneNode.transientWebApp.id}`,
      url: paneNode.transientWebApp.url,
      restoreUrl: false,
      transient: true
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

function getWebAppOpenUrlLabel(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname || "Link";
  } catch {
    return "Link";
  }
}

function createTransientWebApp(url, label = "") {
  return {
    id: `transient:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    label: label || getWebAppOpenUrlLabel(url),
    url
  };
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
  replacement.second.transientWebApp = createTransientWebApp(url, label);
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
  const sourceBounds = getWebAppHostBounds(sourceEntry?.host) || null;
  await freezeWebAppsForOverlay();

  const dialog = document.createElement("dialog");
  dialog.className = "plugin-settings-dialog webapp-open-dialog";
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
  dialog.addEventListener("close", () => {
    dialog.remove();
    restoreWebAppsAfterOverlay();
  });
  document.body.append(dialog);
  dialog.showModal();
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

function createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps) {
  const widgetWebApps = webApps.filter((webApp) => webApp.kind === "widgets");
  const list = document.createElement("div");
  list.className = "widget-pane-tabs";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "Widget pages");

  for (const webApp of widgetWebApps) {
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

function findFirstPaneNode(node) {
  if (!node) {
    return null;
  }

  if (node.type === "pane") {
    return node;
  }

  return findFirstPaneNode(node.first) || findFirstPaneNode(node.second);
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

function createWidgetPaneSurface(project, widgetPane) {
  const rail = document.createElement("div");
  rail.className = "project-widget-rail";
  const fallbackWidth = Math.max(MIN_WIDGET_RAIL_WIDTH, Math.round((dashboardGrid.getBoundingClientRect().width || window.innerWidth) / 2));
  const widgetGridColumns = getWidgetGridColumnCount(fallbackWidth);
  const widgetLayout = getProjectWidgetLayout(project, widgetGridColumns, widgetPane.id);

  rail.classList.toggle("editing", !widgetLayout.locked);
  rail.dataset.widgetGridColumns = String(widgetGridColumns);
  rail.style.setProperty("--widget-grid-columns", String(widgetGridColumns));
  rail.style.setProperty("--widget-grid-row-height", `${WIDGET_GRID_ROW_HEIGHT}px`);

  rail.append(
    ...getOrderedWidgetDefinitions(project, widgetLayout).map((definition) => (
      createProjectWidget(project, definition, widgetLayout, widgetGridColumns, widgetPane.id)
    ))
  );
  attachWidgetGridDropHandlers(rail, project, widgetGridColumns, widgetPane.id);

  const resizeObserver = new ResizeObserver(() => {
    if (!rail.isConnected) {
      resizeObserver.disconnect();
      return;
    }

    const width = rail.getBoundingClientRect().width || fallbackWidth;
    applyWidgetGridLayout(rail, project, getWidgetGridColumnCount(width), widgetPane.id);
  });
  resizeObserver.observe(rail);

  requestAnimationFrame(() => {
    const width = rail.getBoundingClientRect().width || fallbackWidth;
    applyWidgetGridLayout(rail, project, getWidgetGridColumnCount(width), widgetPane.id);
  });

  return rail;
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

  const rect = button.getBoundingClientRect();
  await freezeWebAppsForOverlay();

  const menu = document.createElement("div");
  menu.className = "webapp-tab-menu";
  menu.setAttribute("role", "menu");

  menu.style.top = `${Math.round(rect.bottom + 6)}px`;
  menu.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - 220))}px`;

  for (const webApp of webApps) {
    const item = document.createElement("button");
    item.className = "webapp-tab-menu-item";
    item.classList.toggle("loaded", loadedWebAppKeys.has(webApp.key));
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.setAttribute("aria-current", String(webApp.id === selectedWebApp.id));
    item.setAttribute("data-load-state", loadedWebAppKeys.has(webApp.key) ? "Loaded" : "Not loaded");
    item.textContent = webApp.label;
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

function createWebAppPane(project, paneNode) {
  const webApps = getProjectWebApps(project, paneNode.id);
  const selectedWebApp = getSelectedWebApp(project, paneNode.id, webApps);
  const isTerminalPane = selectedWebApp.kind === "terminal";
  const isWidgetPane = selectedWebApp.kind === "widgets";
  const pane = document.createElement("section");
  pane.className = "webapp-pane";
  pane.classList.toggle("widget-pane", isWidgetPane);
  pane.dataset.paneId = paneNode.id;

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
    tabs.append(createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps));
  }

  if (!isTerminalPane && !isWidgetPane) {
    const homeButton = document.createElement("button");
    homeButton.className = "webapp-tool-button";
    homeButton.type = "button";
    homeButton.title = "Go home";
    homeButton.setAttribute("aria-label", "Go home");
    homeButton.textContent = "⌂";
    homeButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "home", selectedWebApp.url));

    const backButton = document.createElement("button");
    backButton.className = "webapp-tool-button";
    backButton.type = "button";
    backButton.title = "Go back";
    backButton.setAttribute("aria-label", "Go back");
    backButton.textContent = "←";
    backButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "back"));

    const forwardButton = document.createElement("button");
    forwardButton.className = "webapp-tool-button";
    forwardButton.type = "button";
    forwardButton.title = "Go forward";
    forwardButton.setAttribute("aria-label", "Go forward");
    forwardButton.textContent = "→";
    forwardButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "forward"));

    const refreshButton = document.createElement("button");
    refreshButton.className = "webapp-tool-button";
    refreshButton.type = "button";
    refreshButton.title = "Refresh";
    refreshButton.setAttribute("aria-label", "Refresh");
    refreshButton.textContent = "↻";
    refreshButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "refresh"));

    const autofillButton = isPasswordManagerEnabled() ? document.createElement("button") : null;
    if (autofillButton) {
      autofillButton.className = "webapp-tool-button autofill";
      autofillButton.type = "button";
      autofillButton.dataset.webappKey = selectedWebApp.key;
      autofillButton.textContent = "AF";
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
    const fallbackWidth = Math.max(MIN_WIDGET_RAIL_WIDTH, Math.round((dashboardGrid.getBoundingClientRect().width || window.innerWidth) / 2));
    const widgetGridColumns = getWidgetGridColumnCount(fallbackWidth);
    const widgetLayout = getProjectWidgetLayout(project, widgetGridColumns, selectedWebApp.widgetPane.id);
    actions.append(createWidgetPaneActions(project, selectedWebApp.widgetPane, widgetLayout, widgetGridColumns));
  }

  const verticalSplitButton = document.createElement("button");
  verticalSplitButton.className = "webapp-tool-button";
  verticalSplitButton.type = "button";
  verticalSplitButton.title = "Split vertically";
  verticalSplitButton.setAttribute("aria-label", "Split vertically");
  verticalSplitButton.textContent = "V";
  verticalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "vertical"));

  const horizontalSplitButton = document.createElement("button");
  horizontalSplitButton.className = "webapp-tool-button";
  horizontalSplitButton.type = "button";
  horizontalSplitButton.title = "Split horizontally";
  horizontalSplitButton.setAttribute("aria-label", "Split horizontally");
  horizontalSplitButton.textContent = "H";
  horizontalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "horizontal"));

  const closePaneButton = document.createElement("button");
  closePaneButton.className = "webapp-tool-button danger";
  closePaneButton.type = "button";
  closePaneButton.title = "Close pane";
  closePaneButton.setAttribute("aria-label", "Close pane");
  closePaneButton.textContent = "X";
  closePaneButton.disabled = countPaneNodes(getProjectPaneLayout(project)) <= 1;
  closePaneButton.addEventListener("click", () => closePane(project, paneNode.id));

  actions.append(verticalSplitButton, horizontalSplitButton, closePaneButton);
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
      storageKey: `pane:${paneNode.id}`
    }));
  } else if (isWidgetPane) {
    host.append(createWidgetPaneSurface(project, selectedWebApp.widgetPane));
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

  const split = document.createElement("div");
  split.className = `webapp-split ${node.direction}`;
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
  widgetLayoutsByProject.clear();
  const persistedLayouts = state.widgetLayouts || {};

  for (const [projectId, layout] of Object.entries(persistedLayouts)) {
    widgetLayoutsByProject.set(projectId, layout);
  }
}

function hydrateTerminalTabOrders() {
  terminalTabOrdersByProject.clear();
  const persistedOrders = state.terminalTabOrders || {};

  for (const [projectId, windowIds] of Object.entries(persistedOrders)) {
    if (Array.isArray(windowIds)) {
      rememberTerminalTabOrder(projectId, windowIds);
    }
  }
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
  visibleWebAppHosts = new Map();
  const paneLayoutElement = createPaneLayout(globalWorkspace, getProjectPaneLayout(globalWorkspace));
  const currentPaneLayoutElement = dashboardGrid.lastElementChild;

  if (!currentPaneLayoutElement) {
    renderGlobalDashboard();
    return;
  }

  currentPaneLayoutElement.replaceWith(paneLayoutElement);
}

function createGlobalProjectsSettingsForm({ settings, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Projects global settings";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Configure defaults shared by project forms and tooling.";
  heading.append(headingTitle, headingCopy);

  const projectsBasePathLabel = document.createElement("label");
  projectsBasePathLabel.textContent = "Projects base path";

  const projectsBasePathInput = document.createElement("input");
  projectsBasePathInput.name = "projectsBasePath";
  projectsBasePathInput.type = "text";
  projectsBasePathInput.autocomplete = "off";
  projectsBasePathInput.placeholder = "/workspace/projects";
  projectsBasePathInput.value = settings.projectsBasePath;

  const projectsBasePathControl = document.createElement("div");
  projectsBasePathControl.className = "path-picker";

  const browseButton = document.createElement("button");
  browseButton.className = "secondary-button";
  browseButton.type = "button";
  browseButton.textContent = "Browse";
  browseButton.addEventListener("click", async () => {
    error.textContent = "";
    error.hidden = true;

    try {
      const selectedPath = await window.boatyard.selectProjectsBasePath(projectsBasePathInput.value);
      if (selectedPath) {
        projectsBasePathInput.value = selectedPath;
      }
    } catch (selectError) {
      error.textContent = selectError.message;
      error.hidden = false;
    }
  });

  projectsBasePathControl.append(projectsBasePathInput, browseButton);
  projectsBasePathLabel.append(projectsBasePathControl);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save projects settings";

  actions.append(submitButton);
  form.append(heading, projectsBasePathLabel, error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit({
        projectsBasePath: projectsBasePathInput.value
      });
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  requestAnimationFrame(() => projectsBasePathInput.focus());
  return shell;
}

function createGlobalPresentationSettingsForm({ settings, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Presentation";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Tune how Boatyard displays webapp overlays.";
  heading.append(headingTitle, headingCopy);

  const blurLabel = document.createElement("label");
  blurLabel.className = "switch-row";

  const blurCopy = document.createElement("span");
  blurCopy.className = "switch-copy";
  blurCopy.innerHTML = "<strong>Blur webapp screenshots</strong><small>Apply blur to frozen WCV screenshots while a menu or overlay is open.</small>";

  const blurSwitch = document.createElement("input");
  blurSwitch.name = "blurWebAppOverlays";
  blurSwitch.type = "checkbox";
  blurSwitch.checked = settings.blurWebAppOverlays;

  const switchTrack = document.createElement("span");
  switchTrack.className = "switch-track";
  switchTrack.setAttribute("aria-hidden", "true");

  blurLabel.append(blurCopy, blurSwitch, switchTrack);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save presentation";

  actions.append(submitButton);
  form.append(heading, blurLabel, error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit({
        blurWebAppOverlays: blurSwitch.checked
      });
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  return shell;
}

function createGlobalTerminalSettingsForm({ settings, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Terminal";

  heading.append(headingTitle);

  const terminalEnvLabel = document.createElement("label");
  terminalEnvLabel.textContent = "Environment variables";

  const terminalEnvInput = document.createElement("textarea");
  terminalEnvInput.name = "terminalEnv";
  terminalEnvInput.autocomplete = "off";
  terminalEnvInput.rows = 4;
  terminalEnvInput.placeholder = "SSH_ASKPASS=\nSSH_ASKPASS_REQUIRE=never";
  terminalEnvInput.value = settings.terminalEnv || "";
  terminalEnvLabel.append(terminalEnvInput);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save terminal";

  actions.append(submitButton);
  form.append(heading, terminalEnvLabel, error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit({
        terminalEnv: terminalEnvInput.value
      });
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  return shell;
}

function createGlobalPasswordManagerSettingsForm({ settings, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page password-manager-settings";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Password manager";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Optional local autofill for webapp panes.";
  heading.append(headingTitle, headingCopy);

  const disclaimer = document.createElement("div");
  disclaimer.className = "password-manager-disclaimer";
  disclaimer.innerHTML = `
    <strong>Security disclaimer</strong>
    <span>Boatyard will store passwords locally, encrypted for the current OS user. This is a minimal convenience feature for trusted local use, not a hardened replacement for a dedicated password manager.</span>
  `;

  const enableLabel = document.createElement("label");
  enableLabel.className = "switch-row";

  const enableCopy = document.createElement("span");
  enableCopy.className = "switch-copy";
  enableCopy.innerHTML = "<strong>Enable local password manager</strong><small>Autofill and save credentials for webapp login forms after confirmation.</small>";

  const enableSwitch = document.createElement("input");
  enableSwitch.name = "passwordManagerEnabled";
  enableSwitch.type = "checkbox";
  enableSwitch.checked = settings.passwordManagerEnabled === true;

  const switchTrack = document.createElement("span");
  switchTrack.className = "switch-track";
  switchTrack.setAttribute("aria-hidden", "true");
  enableLabel.append(enableCopy, enableSwitch, switchTrack);

  const acceptLabel = document.createElement("label");
  acceptLabel.className = "checkbox-row";

  const acceptCheckbox = document.createElement("input");
  acceptCheckbox.name = "passwordManagerDisclaimerAccepted";
  acceptCheckbox.type = "checkbox";
  acceptCheckbox.checked = settings.passwordManagerDisclaimerAccepted === true;

  const acceptCopy = document.createElement("span");
  acceptCopy.textContent = "I understand this is a minimal local password manager and accept the risk.";
  acceptLabel.append(acceptCheckbox, acceptCopy);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save password settings";

  actions.append(submitButton);
  form.append(heading, disclaimer, enableLabel, acceptLabel, error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    if (enableSwitch.checked && !acceptCheckbox.checked) {
      error.textContent = "Accept the security disclaimer before enabling the password manager.";
      error.hidden = false;
      return;
    }

    try {
      await onSubmit({
        passwordManagerEnabled: enableSwitch.checked,
        passwordManagerDisclaimerAccepted: acceptCheckbox.checked
      });
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  return shell;
}

const WEBAPP_OPEN_TARGET_LABELS = {
  "same-pane": "Same pane",
  "split-pane": "Split pane",
  external: "External browser"
};

const WEBAPP_OPEN_SCOPE_LABELS = {
  exact: "Exact URL",
  host: "Host",
  "path-prefix": "Path prefix"
};

function createWebAppOpenRuleSelect(name, labelText, options, selectedValue) {
  const label = document.createElement("label");
  label.className = "field";

  const span = document.createElement("span");
  span.textContent = labelText;

  const select = document.createElement("select");
  select.name = name;
  for (const [value, text] of Object.entries(options)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = selectedValue === value;
    select.append(option);
  }

  label.append(span, select);
  return { label, select };
}

function createWebAppOpenRuleListItem(rule, index, { onEdit, onRemove }) {
  const item = document.createElement("article");
  item.className = "webapp-open-rule-item";

  const editButton = document.createElement("button");
  editButton.className = "webapp-open-rule-edit";
  editButton.type = "button";
  editButton.addEventListener("click", () => onEdit(index));

  const pattern = document.createElement("code");
  pattern.textContent = rule.pattern || "Untitled rule";

  const meta = document.createElement("span");
  meta.className = "webapp-open-rule-meta";
  const label = rule.label ? ` · ${rule.label}` : "";
  meta.textContent = `${WEBAPP_OPEN_TARGET_LABELS[rule.target] || rule.target} · ${WEBAPP_OPEN_SCOPE_LABELS[rule.scope] || rule.scope}${label}`;

  editButton.append(pattern, meta);

  const removeButton = document.createElement("button");
  removeButton.className = "project-url-remove";
  removeButton.type = "button";
  removeButton.title = "Remove rule";
  removeButton.setAttribute("aria-label", "Remove rule");
  removeButton.textContent = "X";
  removeButton.addEventListener("click", () => onRemove(index));

  item.append(editButton, removeButton);
  return item;
}

function openWebAppOpenRuleSettingsDialog(rule = {}, { onSave, onRemove } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "plugin-settings-dialog webapp-open-rule-dialog";

  const form = document.createElement("form");
  form.className = "plugin-settings-dialog-panel";

  const header = document.createElement("header");
  header.className = "plugin-settings-dialog-header";

  const title = document.createElement("h3");
  title.textContent = rule.pattern ? "Edit URL opening rule" : "Add URL opening rule";

  const closeButton = document.createElement("button");
  closeButton.className = "icon-button";
  closeButton.type = "button";
  closeButton.title = "Close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "X";
  closeButton.addEventListener("click", () => dialog.close());
  header.append(title, closeButton);

  const patternLabel = document.createElement("label");
  patternLabel.className = "field";
  const patternText = document.createElement("span");
  patternText.textContent = "URL pattern";
  const patternInput = document.createElement("input");
  patternInput.name = "openRulePattern";
  patternInput.type = "text";
  patternInput.autocomplete = "off";
  patternInput.placeholder = "https://accounts.google.com";
  patternInput.value = rule.pattern || "";
  applyFormControl(patternInput);
  patternLabel.append(patternText, patternInput);

  const { label: targetLabel, select: targetSelect } = createWebAppOpenRuleSelect(
    "openRuleTarget",
    "Open target",
    WEBAPP_OPEN_TARGET_LABELS,
    rule.target || "same-pane"
  );

  const { label: scopeLabel, select: scopeSelect } = createWebAppOpenRuleSelect(
    "openRuleScope",
    "Rule scope",
    WEBAPP_OPEN_SCOPE_LABELS,
    rule.scope || "exact"
  );

  const labelLabel = document.createElement("label");
  labelLabel.className = "field";
  const labelText = document.createElement("span");
  labelText.textContent = "Label";
  const labelInput = document.createElement("input");
  labelInput.name = "openRuleLabel";
  labelInput.type = "text";
  labelInput.autocomplete = "off";
  labelInput.placeholder = "Optional label";
  labelInput.value = rule.label || "";
  applyFormControl(labelInput);
  labelLabel.append(labelText, labelInput);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Remove";
  deleteButton.hidden = !onRemove;
  deleteButton.addEventListener("click", async () => {
    deleteButton.disabled = true;
    try {
      await onRemove();
      dialog.close();
    } catch (removeError) {
      error.textContent = removeError.message;
      error.hidden = false;
    } finally {
      deleteButton.disabled = false;
    }
  });

  const cancelButton = document.createElement("button");
  cancelButton.className = "secondary-button";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => dialog.close());

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save";

  actions.append(deleteButton, cancelButton, submitButton);
  form.append(header, patternLabel, targetLabel, scopeLabel, labelLabel, error, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;
    submitButton.disabled = true;

    const nextRule = {
      pattern: patternInput.value.trim(),
      target: targetSelect.value,
      scope: scopeSelect.value,
      label: labelInput.value.trim()
    };

    if (!nextRule.pattern) {
      error.textContent = "URL pattern is required.";
      error.hidden = false;
      submitButton.disabled = false;
      return;
    }

    try {
      await onSave(nextRule);
      dialog.close();
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  patternInput.focus();
  patternInput.select();
}

function createGlobalWebAppOpenRulesSettingsForm({ settings, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const panel = document.createElement("div");
  panel.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Webapp URL opening";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Manage saved rules created by Open with dialogs.";
  heading.append(headingTitle, headingCopy);

  const list = document.createElement("div");
  list.className = "webapp-open-rule-list";
  let rules = [...(settings.webAppOpenRules || [])];

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  async function saveRules(nextRules) {
    error.textContent = "";
    error.hidden = true;
    await onSubmit({
      webAppOpenRules: nextRules.filter((rule) => rule.pattern?.trim())
    });
  }

  function renderRules() {
    list.innerHTML = "";

    if (rules.length === 0) {
      const empty = document.createElement("p");
      empty.className = "webapp-open-rule-empty";
      empty.textContent = "No saved URL opening rules.";
      list.append(empty);
      return;
    }

    rules.forEach((rule, index) => {
      list.append(createWebAppOpenRuleListItem(rule, index, {
        onEdit: (ruleIndex) => {
          openWebAppOpenRuleSettingsDialog(rules[ruleIndex], {
            onSave: (nextRule) => {
              const nextRules = rules.map((currentRule, currentIndex) => (
                currentIndex === ruleIndex ? nextRule : currentRule
              ));
              return saveRules(nextRules);
            },
            onRemove: () => saveRules(rules.filter((_, currentIndex) => currentIndex !== ruleIndex))
          });
        },
        onRemove: (ruleIndex) => saveRules(rules.filter((_, currentIndex) => currentIndex !== ruleIndex))
      }));
    });
  }

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const addButton = document.createElement("button");
  addButton.className = "secondary-button";
  addButton.type = "button";
  addButton.textContent = "Add rule";
  addButton.addEventListener("click", () => {
    openWebAppOpenRuleSettingsDialog({}, {
      onSave: (nextRule) => saveRules([...rules, nextRule])
    });
  });

  actions.append(addButton);
  panel.append(heading, list, error, actions);
  renderRules();

  shell.append(panel);
  return shell;
}

function createGlobalWidgetsSettingsView() {
  const shell = document.createElement("section");
  shell.className = "project-form-page widgets-settings-page";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Widgets";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Installed widget plugins available to Boatyard.";
  heading.append(headingTitle, headingCopy);

  const list = document.createElement("div");
  list.className = "installed-widget-list";

  for (const widget of getInstalledWidgets()) {
    const item = document.createElement("article");
    item.className = "installed-widget-item";

    const titleRow = document.createElement("div");
    titleRow.className = "installed-widget-title";

    const title = document.createElement("h4");
    title.textContent = widget.name;

    const status = document.createElement("span");
    status.className = `widget-status ${widget.status}`;
    status.textContent = widget.status;

    titleRow.append(title, status);

    const description = document.createElement("p");
    description.textContent = widget.description || "No description provided.";

    const meta = document.createElement("div");
    meta.className = "installed-widget-meta";

    for (const value of [...widget.scopes, widget.category, widget.provider]) {
      const chip = document.createElement("span");
      chip.textContent = value;
      meta.append(chip);
    }

    item.append(titleRow, description, meta);
    list.append(item);
  }

  shell.append(heading, list);
  return shell;
}

function createGlobalPluginsSettingsView() {
  const shell = document.createElement("section");
  shell.className = "project-form-page plugins-settings-page";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Plugins";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Installed plugins and their Boatyard contributions.";
  heading.append(headingTitle, headingCopy);

  const list = document.createElement("div");
  list.className = "installed-plugin-list";

  for (const plugin of window.BoatyardPluginRegistry?.list() || []) {
    const status = window.BoatyardPluginRegistry.getStatus(plugin.id);
    const globalSettingsSections = getPluginGlobalSettingsSections()
      .filter((section) => section.pluginId === plugin.id);
    const item = document.createElement("article");
    item.className = "installed-plugin-item";

    const titleRow = document.createElement("div");
    titleRow.className = "installed-widget-title";

    const title = document.createElement("h4");
    title.textContent = plugin.name;

    const statusBadge = document.createElement("span");
    statusBadge.className = `plugin-status ${status?.state || "unknown"}`;
    statusBadge.textContent = status?.state || "unknown";

    titleRow.append(title, statusBadge);

    const description = document.createElement("p");
    description.textContent = status?.summary || plugin.description || "No plugin status provided.";

    const meta = document.createElement("div");
    meta.className = "installed-widget-meta";

    const contributionCounts = [
      ["widgets", plugin.contributes?.widgets?.length || 0],
      ["panes", plugin.contributes?.panes?.length || 0],
      ["global settings", plugin.contributes?.globalSettings?.length || globalSettingsSections.length],
      ["project settings", plugin.contributes?.projectSettings?.length || 0],
      ["services", plugin.contributes?.services?.length || 0],
      ["tools", plugin.contributes?.tools?.length || 0]
    ];

    for (const value of [plugin.id, `v${plugin.version}`, ...contributionCounts.map(([label, count]) => `${count} ${label}`)]) {
      const chip = document.createElement("span");
      chip.textContent = value;
      meta.append(chip);
    }

    const controls = document.createElement("label");
    controls.className = "plugin-toggle-row";

    const controlCopy = document.createElement("span");
    controlCopy.textContent = plugin.enabled ? "Enabled" : "Disabled";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = plugin.enabled !== false;
    toggle.addEventListener("change", async () => {
      state = await window.boatyard.updatePluginEnabled(plugin.id, toggle.checked);
      window.BoatyardPluginRegistry.setEnabled(plugin.id, toggle.checked);
      renderGlobalSettingsPage();
    });

    const switchTrack = document.createElement("span");
    switchTrack.className = "switch-track";
    switchTrack.setAttribute("aria-hidden", "true");

    controls.append(controlCopy, toggle, switchTrack);

    const settingsButton = document.createElement("button");
    settingsButton.className = "plugin-settings-button";
    settingsButton.type = "button";
    settingsButton.title = `${plugin.name} settings`;
    settingsButton.setAttribute("aria-label", `${plugin.name} settings`);
    settingsButton.textContent = "⚙";
    settingsButton.hidden = !globalSettingsSections.length;
    settingsButton.addEventListener("click", () => {
      openGlobalPluginSettingsDialog(plugin, globalSettingsSections);
    });

    const reloadButton = document.createElement("button");
    reloadButton.className = "plugin-reload-button";
    reloadButton.type = "button";
    reloadButton.textContent = "Reload";
    reloadButton.disabled = plugin.enabled === false;
    reloadButton.addEventListener("click", () => {
      try {
        window.BoatyardPluginRegistry.reload(plugin.id);
      } catch (error) {
        console.error(`Could not reload plugin ${plugin.id}:`, error);
      }
      renderGlobalSettingsPage();
    });

    const titleActions = document.createElement("div");
    titleActions.className = "installed-plugin-actions";
    titleActions.append(settingsButton, reloadButton, controls);

    titleRow.append(titleActions);
    item.append(titleRow, description, meta);

    list.append(item);
  }

  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "settings-empty-state";
    empty.textContent = "No plugins installed.";
    list.append(empty);
  }

  shell.append(heading, list);
  return shell;
}

function openGlobalPluginSettingsDialog(plugin, sections) {
  const dialog = document.createElement("dialog");
  dialog.className = "plugin-settings-dialog";

  const panel = document.createElement("div");
  panel.className = "plugin-settings-dialog-panel";

  const header = document.createElement("header");
  header.className = "plugin-settings-dialog-header";

  const title = document.createElement("h3");
  title.textContent = `${plugin.name} settings`;

  const closeButton = document.createElement("button");
  closeButton.className = "icon-button";
  closeButton.type = "button";
  closeButton.title = "Close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "X";
  closeButton.addEventListener("click", () => dialog.close());

  header.append(title, closeButton);
  panel.append(header);

  for (const section of sections) {
    panel.append(createGlobalPluginSettingsForm(section, {
      onSaved() {
        dialog.close();
        renderGlobalSettingsPage();
      }
    }));
  }

  dialog.append(panel);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function createGlobalPluginSettingsForm(section, options = {}) {
  const form = document.createElement("form");
  form.className = "plugin-global-settings-form";

  const pluginConfig = getGlobalPluginConfig(section.pluginId);
  const inputs = new Map();

  for (const field of section.fields) {
    const label = document.createElement("label");
    label.textContent = field.label;

    const input = document.createElement("input");
    input.name = field.key;
    input.type = field.type || "text";
    input.autocomplete = "off";
    input.placeholder = field.placeholder || "";
    input.readOnly = field.readOnly === true;
    const defaultValue = window.BoatyardPluginSettingsFields.resolveFieldDefault(field);
    input.dataset.defaultValue = String(defaultValue || "");
    input.value = pluginConfig[field.key] || input.dataset.defaultValue;
    label.append(input);
    const fieldState = { field, input, action: null };

    if (field.action) {
      const action = document.createElement("div");
      action.className = "field-action";
      action.hidden = field.action.hidden !== false;

      const actionMessage = document.createElement("span");
      actionMessage.textContent = field.action.message || "";

      const actionButton = document.createElement("button");
      actionButton.className = "secondary-button";
      actionButton.type = "button";
      actionButton.textContent = field.action.label || "Run";
      actionButton.addEventListener("click", async () => {
        if (typeof field.action.run !== "function") {
          return;
        }

        error.hidden = true;
        error.textContent = "";
        actionButton.disabled = true;
        const originalLabel = actionButton.textContent;
        actionButton.textContent = field.action.pendingLabel || "Working...";

        try {
          await field.action.run({
            globalConfig: pluginConfig,
            fields: createPluginFieldApi(inputs)
          });
        } catch (actionError) {
          error.textContent = actionError.message;
          error.hidden = false;
        } finally {
          actionButton.disabled = false;
          actionButton.textContent = originalLabel;
        }
      });

      action.append(actionMessage, actionButton);
      label.append(action);
      fieldState.action = { element: action, message: actionMessage, button: actionButton };
    }

    inputs.set(field.key, fieldState);
    form.append(label);
  }

  const error = document.createElement("p");
  error.className = "form-error";
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save";

  actions.append(submitButton);
  form.append(error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    error.textContent = "";

    try {
      const values = {};
      for (const [key, { field, input }] of inputs) {
        if (field.persist === false) {
          continue;
        }

        values[key] = readPluginSettingsFieldValue(field, input);
      }

      state = await window.boatyard.updateGlobalPluginConfig(section.pluginId, values);
      if (typeof options.onSaved === "function") {
        options.onSaved();
      } else {
        renderGlobalSettingsPage();
      }
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  return form;
}

function renderGlobalSettingsPage() {
  closeWidgetAddMenu();
  visibleWebAppHosts = new Map();
  invokeWebApp("hideWebApp");
  workspace.classList.remove("project-mode");
  workspaceKicker.textContent = "Global";
  workspaceTitle.textContent = "Global settings";
  workspaceSummary.textContent = "";
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-form-layout";
  dashboardGrid.style.gridTemplateColumns = "";

  dashboardGrid.append(createGlobalProjectsSettingsForm({
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
  visibleWebAppHosts = new Map();
  const paneLayoutElement = createPaneLayout(project, getProjectPaneLayout(project));
  const currentPaneLayoutElement = dashboardGrid.lastElementChild;

  if (!currentPaneLayoutElement) {
    renderProjectDashboard(project);
    return;
  }

  currentPaneLayoutElement.replaceWith(paneLayoutElement);
}

function createProjectFormView({ title, submitLabel, initialValues, onSubmit, onCancel }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = title;

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Configure the project identity, source checkout, and linked tools.";

  heading.append(headingTitle, headingCopy);

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Name";

  const nameInput = document.createElement("input");
  nameInput.name = "name";
  nameInput.type = "text";
  nameInput.autocomplete = "off";
  nameInput.required = true;
  nameInput.value = initialValues.name || "";
  nameLabel.append(nameInput);

  const slugLabel = document.createElement("label");
  slugLabel.textContent = "Slug";

  const slugInput = document.createElement("input");
  slugInput.name = "slug";
  slugInput.type = "text";
  slugInput.autocomplete = "off";
  slugInput.required = true;
  slugInput.value = initialValues.slug || "";
  slugLabel.append(slugInput);

  const sourcePathLabel = document.createElement("label");
  sourcePathLabel.textContent = "Source path";

  const sourcePathInput = document.createElement("input");
  sourcePathInput.name = "sourcePath";
  sourcePathInput.type = "text";
  sourcePathInput.autocomplete = "off";
  sourcePathInput.required = true;
  sourcePathInput.placeholder = "/workspace/projects/example";
  sourcePathInput.value = initialValues.sourcePath || "";

  const sourcePathControl = document.createElement("div");
  sourcePathControl.className = "path-picker";

  const sourcePathBrowseButton = document.createElement("button");
  sourcePathBrowseButton.className = "secondary-button";
  sourcePathBrowseButton.type = "button";
  sourcePathBrowseButton.textContent = "Browse";
  sourcePathBrowseButton.addEventListener("click", async () => {
    error.textContent = "";
    error.hidden = true;

    try {
      const settings = getSettings();
      const selectedPath = await window.boatyard.selectProjectsBasePath(
        sourcePathInput.value || settings.projectsBasePath
      );
      if (selectedPath) {
        setCoreFieldValue("sourcePath", selectedPath, { markEdited: true, source: "browse" });
        await applySourcePathInspection(selectedPath);
      }
    } catch (selectError) {
      error.textContent = selectError.message;
      error.hidden = false;
    }
  });

  sourcePathControl.append(sourcePathInput, sourcePathBrowseButton);
  sourcePathLabel.append(sourcePathControl);

  const gitUrlLabel = document.createElement("label");
  gitUrlLabel.textContent = "Git URL";

  const gitUrlInput = document.createElement("input");
  gitUrlInput.name = "gitUrl";
  gitUrlInput.type = "text";
  gitUrlInput.autocomplete = "off";
  gitUrlInput.placeholder = "git@github.com:owner/repo.git";
  gitUrlInput.value = initialValues.gitUrl || "";
  gitUrlLabel.append(gitUrlInput);

  const repoUrlLabel = document.createElement("label");
  repoUrlLabel.textContent = "Repo URL";

  const repoUrlInput = document.createElement("input");
  repoUrlInput.name = "repoUrl";
  repoUrlInput.type = "text";
  repoUrlInput.autocomplete = "off";
  repoUrlInput.placeholder = "https://github.com/owner/repo/tree/main/path";
  repoUrlInput.value = initialValues.repoUrl || deriveRepoUrl(initialValues.gitUrl);
  repoUrlLabel.append(repoUrlInput);

  const devBranchLabel = document.createElement("label");
  devBranchLabel.textContent = "Dev branch";

  const devBranchInput = document.createElement("input");
  devBranchInput.name = "devBranch";
  devBranchInput.type = "text";
  devBranchInput.autocomplete = "off";
  devBranchInput.placeholder = "main";
  devBranchInput.value = initialValues.devBranch || "";
  devBranchLabel.append(devBranchInput);

  const coreInputs = {
    name: nameInput,
    slug: slugInput,
    sourcePath: sourcePathInput,
    gitUrl: gitUrlInput,
    repoUrl: repoUrlInput,
    devBranch: devBranchInput
  };

  function readCoreProjectFields() {
    return Object.fromEntries(
      Object.entries(coreInputs).map(([key, input]) => [key, input.value])
    );
  }

  function setCoreFieldValue(key, value, options = {}) {
    const input = coreInputs[key];
    if (!input) {
      return false;
    }

    if (options.ifUnedited && input.dataset.edited) {
      return false;
    }

    const nextValue = String(value || "");
    if (input.value === nextValue) {
      return false;
    }

    input.value = nextValue;
    if (options.markEdited) {
      input.dataset.edited = "true";
    }
    emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
      field: key,
      value: nextValue,
      source: options.source || "core"
    });
    return true;
  }

  function markCoreFieldEdited(key) {
    const input = coreInputs[key];
    if (input) {
      input.dataset.edited = "true";
    }
  }

  nameInput.addEventListener("input", () => {
    markCoreFieldEdited("name");
    emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
      field: "name",
      value: nameInput.value,
      source: "user"
    });

    if (!slugInput.dataset.edited) {
      const nextSlug = slugify(nameInput.value);
      setCoreFieldValue("slug", nextSlug, { source: "derived" });
    }
  });

  slugInput.addEventListener("input", () => {
    markCoreFieldEdited("slug");
    emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
      field: "slug",
      value: slugInput.value,
      source: "user"
    });

  });

  gitUrlInput.addEventListener("input", () => {
    markCoreFieldEdited("gitUrl");
    emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
      field: "gitUrl",
      value: gitUrlInput.value,
      source: "user"
    });

    if (!repoUrlInput.dataset.edited) {
      setCoreFieldValue("repoUrl", deriveRepoUrl(gitUrlInput.value), { ifUnedited: true, source: "derived" });
    }
  });

  repoUrlInput.addEventListener("input", () => {
    markCoreFieldEdited("repoUrl");
    emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
      field: "repoUrl",
      value: repoUrlInput.value,
      source: "user"
    });
  });

  sourcePathInput.addEventListener("input", () => {
    markCoreFieldEdited("sourcePath");
    emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
      field: "sourcePath",
      value: sourcePathInput.value,
      source: "user"
    });
  });

  devBranchInput.addEventListener("input", () => {
    markCoreFieldEdited("devBranch");
    emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
      field: "devBranch",
      value: devBranchInput.value,
      source: "user"
    });
  });

  function applySourcePathIdentity(sourcePath) {
    const projectName = formatProjectNameFromPath(sourcePath);
    const projectSlug = slugify(deriveProjectNameFromPath(sourcePath));

    if (!projectName) {
      return;
    }

    if (!nameInput.value.trim()) {
      setCoreFieldValue("name", projectName, { source: "sourcePath" });
    }

    if (!slugInput.value.trim()) {
      setCoreFieldValue("slug", projectSlug || slugify(nameInput.value), { source: "sourcePath" });
    }

  }

  async function applySourcePathInspection(sourcePath) {
    applySourcePathIdentity(sourcePath);

    const inspected = await window.boatyard.inspectSourcePath(sourcePath);

    if (inspected?.gitUrl) {
      setCoreFieldValue("gitUrl", inspected.gitUrl, { source: "inspection" });
    }

    if (inspected?.repoUrl) {
      setCoreFieldValue("repoUrl", inspected.repoUrl, { source: "inspection" });
    } else if (inspected?.gitUrl && !repoUrlInput.dataset.edited) {
      setCoreFieldValue("repoUrl", deriveRepoUrl(inspected.gitUrl), { ifUnedited: true, source: "inspection" });
    }

    emitProjectFormEvent("boatyard.projectForm.sourcePathInspected", {
      sourcePath,
      inspected
    });
  }

  function emitProjectFormEvent(eventName, payload) {
    window.BoatyardPluginRegistry?.emit(eventName, {
      ...payload,
      projectId: initialValues.id || "",
      forPlugin: (pluginId) => ({
        coreFields: readCoreProjectFields(),
        globalConfig: getGlobalPluginConfig(pluginId),
        fields: pluginSettings.createFieldApi(pluginId)
      })
    });
  }

  sourcePathInput.addEventListener("change", async () => {
    const sourcePath = sourcePathInput.value;
    if (!sourcePath.trim()) {
      return;
    }

    error.textContent = "";
    error.hidden = true;

    try {
      await applySourcePathInspection(sourcePath);
    } catch (inspectionError) {
      error.textContent = inspectionError.message;
      error.hidden = false;
    }
  });

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const pluginSettings = createProjectPluginSettingsControls(initialValues, {
    readCoreProjectFields,
    setError(message) {
      error.textContent = message || "";
      error.hidden = !message;
    }
  });

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const cancelButton = document.createElement("button");
  cancelButton.className = "secondary-button";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", onCancel);

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = submitLabel;

  actions.append(cancelButton, submitButton);
  form.append(
    heading,
    nameLabel,
    slugLabel,
    sourcePathLabel,
    gitUrlLabel,
    repoUrlLabel,
    devBranchLabel,
    ...pluginSettings.controls,
    error,
    actions
  );
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit({
        name: nameInput.value,
        slug: slugInput.value,
        sourcePath: sourcePathInput.value,
        gitUrl: gitUrlInput.value,
        repoUrl: repoUrlInput.value,
        devBranch: devBranchInput.value,
        pluginConfig: pluginSettings.readValues()
      });
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  requestAnimationFrame(() => nameInput.focus());
  return shell;
}

function createProjectUrlRow(entry = {}) {
  const row = document.createElement("div");
  row.className = "project-url-row";

  const idInput = document.createElement("input");
  idInput.name = "urlId";
  idInput.type = "hidden";
  idInput.value = entry.id || "";

  const labelInput = document.createElement("input");
  labelInput.name = "urlLabel";
  labelInput.type = "text";
  labelInput.autocomplete = "off";
  labelInput.placeholder = "Cloudflare";
  labelInput.value = entry.label || "";
  labelInput.setAttribute("aria-label", "URL label");
  applyFormControl(labelInput);

  const urlInput = document.createElement("input");
  urlInput.name = "urlValue";
  urlInput.type = "text";
  urlInput.autocomplete = "off";
  urlInput.placeholder = "https://dash.cloudflare.com/...";
  urlInput.value = entry.url || "";
  urlInput.setAttribute("aria-label", "URL");
  applyFormControl(urlInput);

  const removeButton = document.createElement("button");
  removeButton.className = "project-url-remove";
  removeButton.type = "button";
  removeButton.title = "Remove URL";
  removeButton.setAttribute("aria-label", "Remove URL");
  removeButton.textContent = "X";
  removeButton.addEventListener("click", () => row.remove());

  row.append(idInput, labelInput, urlInput, removeButton);
  return row;
}

function createProjectWidgetPaneRow(entry = {}) {
  const row = document.createElement("div");
  row.className = "project-url-row";

  const idInput = document.createElement("input");
  idInput.name = "widgetPaneId";
  idInput.type = "hidden";
  idInput.value = entry.id || "";

  const labelInput = document.createElement("input");
  labelInput.name = "widgetPaneLabel";
  labelInput.type = "text";
  labelInput.autocomplete = "off";
  labelInput.placeholder = "Widgets";
  labelInput.value = entry.label || "";
  labelInput.setAttribute("aria-label", "Widget pane name");
  applyFormControl(labelInput);

  const spacer = document.createElement("div");
  spacer.className = "project-url-spacer";

  const removeButton = document.createElement("button");
  removeButton.className = "project-url-remove";
  removeButton.type = "button";
  removeButton.title = "Remove widget pane";
  removeButton.setAttribute("aria-label", "Remove widget pane");
  removeButton.textContent = "X";
  removeButton.addEventListener("click", () => row.remove());

  row.append(idInput, labelInput, spacer, removeButton);
  return row;
}

function createProjectPluginSettingsControls(initialValues = {}, options = {}) {
  const controls = [];
  const sections = [];

  for (const section of getPluginProjectSettingsSections()) {
    const projectPluginConfig = initialValues.id
      ? getProjectPluginConfig(initialValues.id, section.pluginId)
      : {};
    const inputs = new Map();
    const wrapper = document.createElement("div");
    wrapper.className = "plugin-project-settings-section";

    const heading = document.createElement("div");
    heading.className = "form-heading";

    const title = document.createElement("h3");
    title.textContent = section.title;
    heading.append(title);
    wrapper.append(heading);

    for (const field of section.fields) {
      const label = document.createElement("label");
      label.textContent = field.label;

      const input = document.createElement("input");
      input.name = field.key;
      input.type = field.type || "text";
      input.autocomplete = "off";
      const defaultValue = window.BoatyardPluginSettingsFields.resolveFieldDefault(field, {
        project: initialValues,
        coreFields: options.readCoreProjectFields?.() || {}
      });
      input.dataset.defaultValue = String(defaultValue || "");
      input.placeholder = input.dataset.defaultValue || field.placeholder || "";
      input.value = projectPluginConfig[field.key] || "";
      input.addEventListener("input", () => {
        input.dataset.edited = "true";
      });
      label.append(input);
      const fieldState = { field, input, action: null };

      if (field.action) {
        const action = document.createElement("div");
        action.className = "field-action";
        action.hidden = field.action.hidden !== false;

        const actionMessage = document.createElement("span");
        actionMessage.textContent = field.action.message || "";

        const actionButton = document.createElement("button");
        actionButton.className = "secondary-button";
        actionButton.type = "button";
        actionButton.textContent = field.action.label || "Run";
        actionButton.addEventListener("click", async () => {
          if (typeof field.action.run !== "function") {
            return;
          }

          options.setError?.("");
          actionButton.disabled = true;
          const originalLabel = actionButton.textContent;
          actionButton.textContent = field.action.pendingLabel || "Working...";

          try {
            await field.action.run({
              project: initialValues,
              coreFields: options.readCoreProjectFields?.() || {},
              globalConfig: getGlobalPluginConfig(section.pluginId),
              fields: createPluginFieldApi(inputs)
            });
          } catch (actionError) {
            options.setError?.(actionError.message);
          } finally {
            actionButton.disabled = false;
            actionButton.textContent = originalLabel;
          }
        });

        action.append(actionMessage, actionButton);
        label.append(action);
        fieldState.action = { element: action, message: actionMessage, button: actionButton };
      }

      inputs.set(field.key, fieldState);
      wrapper.append(label);
    }

    sections.push({ pluginId: section.pluginId, inputs });
    controls.push(wrapper);
  }

  return {
    controls,
    readValues() {
      const values = {};
      for (const section of sections) {
        values[section.pluginId] = {};
        for (const [key, { field, input }] of section.inputs) {
          values[section.pluginId][key] = readPluginSettingsFieldValue(field, input);
        }
      }

      return values;
    },
    createFieldApi(pluginId) {
      const section = sections.find((entry) => entry.pluginId === pluginId);
      const inputs = section?.inputs || new Map();
      return createPluginFieldApi(inputs);
    }
  };
}

function createPluginFieldApi(inputs) {
  return Object.freeze({
    getValue(key) {
      return inputs.get(key)?.input.value || "";
    },
    setValue(key, value, options = {}) {
      const input = inputs.get(key)?.input;
      if (!input) {
        return false;
      }

      if (options.ifUnedited && input.dataset.edited) {
        return false;
      }

      input.value = String(value || "");
      if (options.markEdited) {
        input.dataset.edited = "true";
      }
      return true;
    },
    isEdited(key) {
      return inputs.get(key)?.input.dataset.edited === "true";
    },
    setDefaultValue(key, value) {
      const input = inputs.get(key)?.input;
      if (!input) {
        return false;
      }

      const nextValue = String(value || "");
      input.dataset.defaultValue = nextValue;
      input.placeholder = nextValue || inputs.get(key)?.field.placeholder || "";
      return true;
    },
    setActionVisible(key, visible) {
      const action = inputs.get(key)?.action;
      if (!action) {
        return false;
      }

      action.element.hidden = !visible;
      return true;
    },
    setActionMessage(key, message) {
      const action = inputs.get(key)?.action;
      if (!action) {
        return false;
      }

      action.message.textContent = String(message || "");
      return true;
    }
  });
}

function readProjectUrlRows(list) {
  return [...list.querySelectorAll(".project-url-row")]
    .map((row) => ({
      id: row.querySelector('[name="urlId"]').value,
      label: row.querySelector('[name="urlLabel"]').value,
      url: row.querySelector('[name="urlValue"]').value
    }))
    .filter((entry) => entry.id.trim() || entry.label.trim() || entry.url.trim());
}

function readProjectWidgetPaneRows(list) {
  return [...list.querySelectorAll(".project-url-row")]
    .map((row) => ({
      id: row.querySelector('[name="widgetPaneId"]').value,
      label: row.querySelector('[name="widgetPaneLabel"]').value
    }))
    .filter((entry) => entry.id.trim() || entry.label.trim());
}

function createProjectUrlsForm({ project, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Project URLs";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Add provider and operations URLs that should appear as webapp tabs.";
  heading.append(headingTitle, headingCopy);

  const list = document.createElement("div");
  list.className = "project-url-list";

  for (const entry of project.urls || []) {
    list.append(createProjectUrlRow(entry));
  }

  if (list.children.length === 0) {
    list.append(createProjectUrlRow());
  }

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const addButton = document.createElement("button");
  addButton.className = "secondary-button";
  addButton.type = "button";
  addButton.textContent = "Add URL";
  addButton.addEventListener("click", () => list.append(createProjectUrlRow()));

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save URLs";

  actions.append(addButton, submitButton);
  form.append(heading, list, error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit(readProjectUrlRows(list));
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  return shell;
}

function createGlobalUrlsSettingsForm({ onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Global URLs";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Add infrastructure and operations dashboards that should appear as Global webapp panes.";
  heading.append(headingTitle, headingCopy);

  const list = document.createElement("div");
  list.className = "project-url-list";

  for (const entry of state.globalUrls || []) {
    list.append(createProjectUrlRow(entry));
  }

  if (list.children.length === 0) {
    list.append(createProjectUrlRow());
  }

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const addButton = document.createElement("button");
  addButton.className = "secondary-button";
  addButton.type = "button";
  addButton.textContent = "Add URL";
  addButton.addEventListener("click", () => list.append(createProjectUrlRow()));

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save global URLs";

  actions.append(addButton, submitButton);
  form.append(heading, list, error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit(readProjectUrlRows(list));
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  return shell;
}

function createProjectWidgetPanesForm({ project, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Widget panes";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Add named widget panes that should appear as pane tabs.";
  heading.append(headingTitle, headingCopy);

  const list = document.createElement("div");
  list.className = "project-url-list";

  for (const entry of getProjectWidgetPanes(project)) {
    list.append(createProjectWidgetPaneRow(entry));
  }

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const addButton = document.createElement("button");
  addButton.className = "secondary-button";
  addButton.type = "button";
  addButton.textContent = "Add widget pane";
  addButton.addEventListener("click", () => list.append(createProjectWidgetPaneRow()));

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save widget panes";

  actions.append(addButton, submitButton);
  form.append(heading, list, error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit(readProjectWidgetPaneRows(list));
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  return shell;
}

function createProjectTerminalSettingsForm({ project, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Terminal";
  heading.append(headingTitle);

  const terminalEnvLabel = document.createElement("label");
  terminalEnvLabel.textContent = "Environment variables";

  const terminalEnvInput = document.createElement("textarea");
  terminalEnvInput.name = "terminalEnv";
  terminalEnvInput.autocomplete = "off";
  terminalEnvInput.rows = 4;
  terminalEnvInput.placeholder = "SSH_ASKPASS=\nSSH_ASKPASS_REQUIRE=never";
  terminalEnvInput.value = project.terminalEnv || "";
  terminalEnvLabel.append(terminalEnvInput);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save terminal";

  actions.append(submitButton);
  form.append(heading, terminalEnvLabel, error, actions);
  applyFormControls(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit({
        terminalEnv: terminalEnvInput.value
      });
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
  return shell;
}

function createProjectDangerZone({ project, onUnregister }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page danger-zone";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Danger zone";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Unregister this project from Boatyard without deleting files on disk.";
  heading.append(headingTitle, headingCopy);

  const form = document.createElement("form");
  form.className = "danger-zone-action";

  const confirmation = document.createElement("div");
  confirmation.className = "danger-confirmation";

  const confirmationCopy = document.createElement("p");
  confirmationCopy.textContent = `Type "${project.name}" to confirm.`;

  const label = document.createElement("label");
  label.textContent = "Project name";

  const confirmInput = document.createElement("input");
  confirmInput.name = "projectName";
  confirmInput.type = "text";
  confirmInput.autocomplete = "off";
  applyFormControl(confirmInput);
  label.append(confirmInput);
  confirmation.append(confirmationCopy, label);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const unregisterButton = document.createElement("button");
  unregisterButton.className = "danger-button";
  unregisterButton.type = "submit";
  unregisterButton.textContent = "Unregister project";
  unregisterButton.disabled = true;

  confirmInput.addEventListener("input", () => {
    unregisterButton.disabled = confirmInput.value !== project.name;
  });

  actions.append(unregisterButton);
  form.append(confirmation, error, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    if (confirmInput.value !== project.name) {
      unregisterButton.disabled = true;
      return;
    }

    try {
      await onUnregister();
    } catch (unregisterError) {
      error.textContent = unregisterError.message;
      error.hidden = false;
    }
  });

  shell.append(heading, form);
  return shell;
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
  dashboardGrid.className = "project-form-layout";
  dashboardGrid.style.gridTemplateColumns = "";

  dashboardGrid.append(createProjectFormView({
    title: "Project settings",
    submitLabel: "Save changes",
    initialValues: project,
    onCancel: () => selectProject(project.id),
    onSubmit: async (values) => {
      state = await window.boatyard.updateProject(project.id, {
        name: values.name,
        slug: values.slug,
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
  }), createProjectTerminalSettingsForm({
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
  invokeWebApp("setVisibleWebApps", visibleKeys);
}

function queueWebAppSync() {
  if (webAppBoundsFrame !== null) {
    return;
  }

  webAppBoundsFrame = requestAnimationFrame(syncWebAppView);
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

async function freezeWebAppsForOverlay() {
  try {
    const captures = await window.boatyard.freezeWebApps();
    renderFrozenWebApps(captures);
  } catch (error) {
    console.error("Could not freeze webapps:", error);
  }
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

function renderProjectList() {
  const projects = getProjects();
  projectCount.textContent = String(projects.length);
  projectList.innerHTML = "";

  globalNav.classList.toggle("active", currentView === "global" || currentView === "global-settings");
  globalNavRow.classList.toggle("active", currentView === "global" || currentView === "global-settings");
  addProjectButton.classList.toggle("active", currentView === "project-create");

  if (projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "No projects configured yet.";
    projectList.append(empty);
    return;
  }

  for (const project of projects) {
    const isActiveProject =
      (currentView === "project" || currentView === "project-edit") && project.id === currentProjectId;
    const row = document.createElement("div");
    row.className = "project-nav-row";
    row.classList.toggle("active", isActiveProject);
    row.draggable = true;
    row.dataset.projectId = project.id;
    row.addEventListener("dragstart", (event) => {
      draggedProjectId = project.id;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", project.id);
    });
    row.addEventListener("dragend", () => {
      draggedProjectId = null;
      row.classList.remove("dragging");
      for (const item of projectList.querySelectorAll(".project-nav-row")) {
        item.classList.remove("drag-over");
      }
    });
    row.addEventListener("dragover", (event) => {
      if (!draggedProjectId || draggedProjectId === project.id) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over");
    });
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      row.classList.remove("drag-over");
      const sourceId = event.dataTransfer.getData("text/plain") || draggedProjectId;

      if (!sourceId || sourceId === project.id) {
        return;
      }

      await reorderProjects(sourceId, project.id);
    });

    const button = document.createElement("button");
    button.className = "nav-item";
    button.type = "button";
    button.classList.toggle("active", isActiveProject);

    const titleRow = document.createElement("div");
    titleRow.className = "project-nav-title";
    const projectName = document.createElement("span");
    projectName.className = "project-nav-name";
    projectName.textContent = project.name;
    titleRow.append(projectName);

    renderProjectNavBadges(project, titleRow, { isActiveProject });

    const projectSlug = document.createElement("small");
    projectSlug.textContent = project.slug;
    button.append(titleRow, projectSlug);
    button.addEventListener("click", () => selectProject(project.id));
    row.append(button);

    const settingsButton = document.createElement("button");
    settingsButton.className = "project-settings-button";
    settingsButton.type = "button";
    settingsButton.title = "Project settings";
    settingsButton.setAttribute("aria-label", `${project.name} settings`);
    settingsButton.textContent = "⚙";
    settingsButton.addEventListener("click", () => selectEditProject(project.id));
    row.append(settingsButton);

    projectList.append(row);
  }
}

async function reorderProjects(sourceId, targetId) {
  const projects = getProjects();
  const sourceIndex = projects.findIndex((project) => project.id === sourceId);
  const targetIndex = projects.findIndex((project) => project.id === targetId);

  if (sourceIndex === -1 || targetIndex === -1) {
    return;
  }

  const reordered = [...projects];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  state = await window.boatyard.reorderProjects(reordered.map((project) => project.id));
  render();
}

function render() {
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
}

window.boatyard.onWebAppUrlChanged(({ key, url }) => {
  if (!key || !url) {
    return;
  }

  currentWebAppUrlsByKey.set(key, url);
  for (const input of document.querySelectorAll(".webapp-url")) {
    if (input.dataset.webappKey === key && input !== document.activeElement) {
      input.value = url;
    }
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

window.boatyard.onTerminalData(({ terminalId, data }) => {
  const session = terminalWidgetsByTerminal.get(terminalId);
  session?.term.write(data);
  scheduleTerminalTabSync(terminalId);
});

window.boatyard.onTerminalExit(async ({ terminalId, projectId, windowId }) => {
  const session = terminalWidgetsByTerminal.get(terminalId);
  if (!session) {
    return;
  }

  terminalWidgetsByTerminal.delete(terminalId);
  const surfaceSession = terminalWidgetsBySurface.get(session.surfaceId);
  if (!surfaceSession || surfaceSession.terminalId !== terminalId) {
    return;
  }

  const exitedProjectId = projectId || surfaceSession.projectId;
  const exitedWindowId = windowId || surfaceSession.activeWindowId;
  if (!exitedProjectId || !exitedWindowId) {
    terminalWidgetsBySurface.delete(session.surfaceId);
    return;
  }

  const project = getProjectById(exitedProjectId);
  if (!project) {
    terminalWidgetsBySurface.delete(session.surfaceId);
    return;
  }

  try {
    const tabs = await window.boatyard.listTerminalTabs(project.id);
    await refreshTerminalSurfaceAfterClosedTab(project, surfaceSession.card, exitedWindowId, tabs, {
      focus: shouldFocusAfterTerminalExit(session.surfaceId, exitedWindowId)
    });
  } catch (error) {
    setTerminalStatus(surfaceSession.card, `Could not refresh shells: ${error.message}`);
  }
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
addProjectButton.addEventListener("click", selectCreateProject);
window.addEventListener("resize", queueWebAppSync);
workspace.addEventListener("scroll", queueWebAppSync);

loadState();
