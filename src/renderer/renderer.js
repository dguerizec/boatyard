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

const DEFAULT_TWICC_URL = "http://localhost:3500";
const DEFAULT_HAWSER_API_URL = "http://127.0.0.1:60082/";
const MIN_WIDGET_RAIL_WIDTH = 240;
const MIN_WEBAPP_AREA_WIDTH = 420;
const WIDGET_RAIL_RESIZER_WIDTH = 6;
const WIDGET_GRID_MIN_COLUMN_WIDTH = 150;
const WIDGET_GRID_MAX_COLUMN_WIDTH = 220;
const WIDGET_GRID_ROW_HEIGHT = 84;
const WIDGET_GRID_GAP = 12;
const WIDGET_GRID_HORIZONTAL_PADDING = 18;

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
let visibleWebAppHosts = new Map();
let webAppBoundsFrame = null;
let nextPaneId = 1;
let frozenWebAppLayer = null;
let openWebAppTabMenu = null;
let openWidgetAddMenu = null;
let draggedProjectId = null;
let draggedWidgetId = null;
const terminalWidgetsByProject = new Map();
const terminalWidgetsByTerminal = new Map();

function getProjects() {
  return state.projects;
}

function getSettings() {
  return {
    projectsBasePath: "",
    blurWebAppOverlays: true,
    hawserApiUrl: DEFAULT_HAWSER_API_URL,
    hawserToken: "",
    widgetRailWidth: 340,
    ...(state.settings || {})
  };
}

function getCurrentProject() {
  return getProjects().find((project) => project.id === currentProjectId) || null;
}

function isRestorableView(view) {
  return ["global", "global-settings", "project", "project-edit"].includes(view);
}

function persistNavigation() {
  if (!isRestorableView(currentView)) {
    return;
  }

  window.dashtop.updateNavigation({
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

function detachProjectTerminal(projectId) {
  const session = terminalWidgetsByProject.get(projectId);

  if (!session) {
    return;
  }

  if (session.terminalId) {
    window.dashtop.detachTerminal(session.terminalId).catch((error) => {
      console.error("Could not detach terminal:", error);
    });
    terminalWidgetsByTerminal.delete(session.terminalId);
  }

  session.disposable?.dispose();
  session.resizeObserver?.disconnect();
  session.term?.dispose();
  terminalWidgetsByProject.delete(projectId);
}

function detachInactiveProjectTerminals(activeProjectId = null) {
  for (const projectId of terminalWidgetsByProject.keys()) {
    if (projectId !== activeProjectId) {
      detachProjectTerminal(projectId);
    }
  }
}

function setTerminalStatus(card, message) {
  const status = card.querySelector(".terminal-status");
  if (status) {
    status.textContent = message;
  }
}

async function refreshTerminalTabs(project, card, activeWindowId = null) {
  const tabList = card.querySelector(".terminal-tabs");
  tabList.innerHTML = "";

  try {
    const tabs = await window.dashtop.listTerminalTabs(project.id);
    const selectedTab = tabs.find((tab) => tab.id === activeWindowId) || tabs[0];

    for (const tab of tabs) {
      const tabButton = document.createElement("button");
      tabButton.className = "terminal-tab";
      tabButton.classList.toggle("active", tab.id === selectedTab?.id);
      tabButton.type = "button";
      tabButton.dataset.windowId = tab.id;
      tabButton.textContent = tab.name || `shell ${tab.index}`;
      tabButton.addEventListener("click", () => attachTerminalTab(project, card, tab.id));
      tabList.append(tabButton);
    }

    if (selectedTab) {
      if (!card.isConnected) {
        return;
      }

      await attachTerminalTab(project, card, selectedTab.id);
    }
  } catch (error) {
    setTerminalStatus(card, `Terminal unavailable: ${error.message}`);
  }
}

async function attachTerminalTab(project, card, windowId) {
  if (!card.isConnected) {
    return;
  }

  const TerminalConstructor = getXtermConstructor();
  const FitAddonConstructor = getFitAddonConstructor();

  if (!TerminalConstructor || !FitAddonConstructor) {
    setTerminalStatus(card, "Terminal renderer unavailable.");
    return;
  }

  detachProjectTerminal(project.id);
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

  const attachResult = await window.dashtop.attachTerminal(project.id, windowId, initialSize);
  const disposable = term.onData((data) => {
    window.dashtop.writeTerminal(attachResult.terminalId, data);
  });
  const resizeObserver = new ResizeObserver(() => {
    const size = fitTerminal(term, fitAddon);
    window.dashtop.resizeTerminal(attachResult.terminalId, size);
  });
  resizeObserver.observe(viewport);
  terminalWidgetsByProject.set(project.id, {
    terminalId: attachResult.terminalId,
    activeWindowId: attachResult.tab.id,
    term,
    fitAddon,
    disposable,
    resizeObserver
  });
  terminalWidgetsByTerminal.set(attachResult.terminalId, {
    projectId: project.id,
    term
  });
  setTerminalStatus(card, attachResult.tab.name || "attached");

  for (const tabButton of card.querySelectorAll(".terminal-tab")) {
    tabButton.classList.toggle("active", tabButton.dataset.windowId === attachResult.tab.id);
  }
}

function createTerminalWidget(project) {
  const card = document.createElement("article");
  card.className = "widget-card terminal-widget";

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
    const tab = await window.dashtop.createTerminalTab(project.id, "shell");
    await refreshTerminalTabs(project, card, tab.id);
  });

  const closeButton = document.createElement("button");
  closeButton.className = "terminal-action";
  closeButton.type = "button";
  closeButton.title = "Close current shell";
  closeButton.setAttribute("aria-label", "Close current shell");
  closeButton.textContent = "x";
  closeButton.addEventListener("click", async () => {
    const session = terminalWidgetsByProject.get(project.id);
    if (!session) {
      return;
    }

    const activeWindowId = session.activeWindowId;
    detachProjectTerminal(project.id);
    const allTabs = await window.dashtop.listTerminalTabs(project.id);
    if (activeWindowId && allTabs.length > 1) {
      await window.dashtop.closeTerminalTab(project.id, activeWindowId);
    }
    await refreshTerminalTabs(project, card);
  });

  actions.append(addButton, closeButton);
  header.append(title, tabs, actions);

  const viewport = document.createElement("div");
  viewport.className = "terminal-viewport";

  const status = document.createElement("p");
  status.className = "terminal-status";
  status.textContent = "Loading tmux session...";

  card.append(header, viewport, status);
  queueMicrotask(() => {
    refreshTerminalTabs(project, card);
  });
  return card;
}

function formatHawserEndpoint(message) {
  if (message.direction === "in") {
    return `from ${message.fromProject || "?"}${message.fromSession ? `:${message.fromSession}` : ""}`;
  }

  return `to ${message.toProject || "?"}${message.toSession ? `:${message.toSession}` : ""}`;
}

function createHawserWidget(project) {
  const card = document.createElement("article");
  card.className = "widget-card hawser-widget";

  const header = document.createElement("header");
  header.className = "hawser-widget-header";

  const title = document.createElement("div");
  title.className = "hawser-widget-title";

  const titleText = document.createElement("h3");
  titleText.textContent = "Hawser";

  const subtitle = document.createElement("small");
  subtitle.textContent = project.hawserMainSession || `${project.slug}:main`;

  title.append(titleText, subtitle);

  const status = document.createElement("span");
  status.className = "hawser-widget-status";
  status.textContent = "Loading";

  header.append(title, status);

  const metrics = document.createElement("div");
  metrics.className = "hawser-widget-metrics";

  const metricEntries = [
    ["unread", "Unread"],
    ["processing", "Processing"],
    ["activeTasks", "Tasks"]
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

  function renderMessages(data) {
    list.innerHTML = "";

    if (!data.messages.length) {
      const empty = document.createElement("p");
      empty.className = "hawser-message-empty";
      empty.textContent = "No active inbox or tasks.";
      list.append(empty);
      return;
    }

    for (const message of data.messages.slice(0, 5)) {
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
      list.append(row);
    }
  }

  async function refresh() {
    if (!document.body.contains(card)) {
      clearInterval(intervalId);
      return;
    }

    try {
      const data = await window.dashtop.getHawserWidgetData(project.id);
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

function registerBuiltinProjectWidgets() {
  const registry = window.DashtopWidgetRegistry;

  if (!registry) {
    throw new Error("Widget registry is unavailable.");
  }

  [
    {
      id: "project-summary",
      name: "Project summary",
      title: "Project",
      scope: "project",
      category: "Project",
      status: "stable",
      description: "Displays the selected project's identity and source path.",
      layout: {
        default: { columns: 2, rows: 2 },
        min: { columns: 1, rows: 2 },
        max: { columns: 3, rows: 3 }
      },
      create: (project) => ({
        eyebrow: "Project",
        title: project.name,
        body: project.sourcePath || project.slug,
        meta: "Active workspace"
      })
    },
    {
      id: "project-preview",
      name: "Project preview",
      title: "Project preview",
      scope: "project",
      category: "Project",
      status: "stable",
      description: "Links to the project's main preview URL when one is configured.",
      layout: {
        default: { columns: 2, rows: 2 },
        min: { columns: 1, rows: 2 },
        max: { columns: 3, rows: 3 }
      },
      create: (project) => ({
        eyebrow: "Preview",
        title: "Project preview",
        body: project.previewUrl
          ? "Project preview is available as a webapp tab in the project pane."
          : "No preview URL configured for this project.",
        meta: project.previewUrl || "Optional",
        action: project.previewUrl
          ? {
              label: "Open URL",
              onClick: () => window.dashtop.openExternal(project.previewUrl)
            }
          : null
      })
    },
    {
      id: "twicc-sessions",
      name: "Twicc",
      title: "Twicc",
      scope: "project",
      category: "Developer tools",
      status: "experimental",
      description: "Shows project sessions from Twicc.",
      requires: [{ type: "projectField", key: "twiccUrl" }],
      layout: {
        default: { columns: 2, rows: 2 },
        min: { columns: 1, rows: 2 },
        max: { columns: 4, rows: 4 }
      },
      create: () => ({
        eyebrow: "Sessions",
        title: "Twicc",
        body: "Placeholder for sessions linked to this project.",
        meta: "Contextual widget"
      })
    },
    {
      id: "project-shell",
      name: "Terminal",
      title: "Terminal",
      scope: "project",
      category: "Developer tools",
      status: "experimental",
      description: "Persistent multi-tab tmux terminal rooted in the project.",
      requires: [{ type: "projectField", key: "sourcePath" }],
      layout: {
        default: { columns: 4, rows: 5 },
        min: { columns: 2, rows: 3 },
        max: { columns: 4, rows: 8 }
      },
      createElement: (project) => createTerminalWidget(project)
    },
    {
      id: "hawser-inbox",
      name: "Hawser",
      title: "Hawser",
      scope: "project",
      category: "Developer tools",
      status: "experimental",
      defaultVisible: false,
      description: "Shows Hawser inbox counts and active task status for the project.",
      requires: [{ type: "projectField", key: "hawserMainSession" }],
      layout: {
        default: { columns: 2, rows: 3 },
        min: { columns: 2, rows: 2 },
        max: { columns: 4, rows: 6 }
      },
      createElement: (project) => createHawserWidget(project)
    },
    {
      id: "discord",
      name: "Discord",
      title: "Discord",
      scope: "project",
      category: "Communication",
      status: "experimental",
      description: "Shows project communication and activity feed placeholders.",
      layout: {
        default: { columns: 2, rows: 2 },
        min: { columns: 1, rows: 2 },
        max: { columns: 4, rows: 4 }
      },
      create: () => ({
        eyebrow: "Comms",
        title: "Discord",
        body: "Placeholder for the project channel or activity feed.",
        meta: "Contextual widget"
      })
    }
  ].forEach((definition) => registry.register(definition));
}

registerBuiltinProjectWidgets();

function getInstalledWidgets(filter = {}) {
  return window.DashtopWidgetRegistry.list(filter);
}

function getProjectWidgetDefinitions() {
  return getInstalledWidgets({ scope: "project" });
}

function normalizeWidgetLayoutForProject(project, columnCount = null) {
  const persisted = widgetLayoutsByProject.get(project.id) || {};
  const widgetDefinitions = getProjectWidgetDefinitions();
  const knownIds = widgetDefinitions.map((definition) => definition.id);
  const knownIdSet = new Set(knownIds);
  const definitionsById = new Map(widgetDefinitions.map((definition) => [definition.id, definition]));
  const persistedOrderIdSet = new Set(Array.isArray(persisted.order)
    ? persisted.order.map((id) => String(id || "").trim()).filter((id) => knownIdSet.has(id))
    : []);
  const hidden = Array.isArray(persisted.hidden)
    ? persisted.hidden
        .map((id) => String(id || "").trim())
        .filter((id, index, ids) => knownIdSet.has(id) && ids.indexOf(id) === index)
    : [];

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
        .map((id) => String(id || "").trim())
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
    const size = clampWidgetGridSize(definition, persisted.sizes?.[id]);
    sizes[id] = columnCount ? fitWidgetSizeToGrid(size, columnCount) : size;
  }

  for (const id of order) {
    const persistedPosition = normalizeWidgetGridPosition(persisted.positions?.[id]);
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
  const maxSize = layout.max || { columns: 4, rows: 6 };

  return {
    default: defaultSize,
    min: minSize,
    max: maxSize
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
  const contentWidth = Math.max(1, widgetRailWidth - WIDGET_GRID_HORIZONTAL_PADDING);
  const maxColumnsByMinStep = Math.max(
    1,
    Math.floor((contentWidth + WIDGET_GRID_GAP) / (WIDGET_GRID_MIN_COLUMN_WIDTH + WIDGET_GRID_GAP))
  );
  const minColumnsByMaxStep = Math.max(
    1,
    Math.ceil((contentWidth + WIDGET_GRID_GAP) / (WIDGET_GRID_MAX_COLUMN_WIDTH + WIDGET_GRID_GAP))
  );

  return Math.min(maxColumnsByMinStep, minColumnsByMaxStep);
}

function fitWidgetSizeToGrid(size, columnCount) {
  return {
    columns: Math.min(columnCount, size.columns),
    rows: size.rows
  };
}

function applyWidgetGridLayout(widgetRail, project, columnCount) {
  const layout = getProjectWidgetLayout(project, columnCount);
  widgetRail.style.setProperty("--widget-grid-columns", String(columnCount));
  widgetRail.style.setProperty("--widget-grid-row-height", `${WIDGET_GRID_ROW_HEIGHT}px`);

  for (const card of widgetRail.querySelectorAll(".widget-card")) {
    const widgetId = card.dataset.widgetId;
    const size = layout.sizes[widgetId];
    const position = layout.positions[widgetId];

    if (!size || !position) {
      continue;
    }

    card.style.gridColumn = `${position.x + 1} / span ${size.columns}`;
    card.style.gridRow = `${position.y + 2} / span ${size.rows}`;
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

function getProjectWidgetLayout(project, columnCount = null) {
  const layout = normalizeWidgetLayoutForProject(project, columnCount);
  widgetLayoutsByProject.set(project.id, layout);
  return layout;
}

function getOrderedWidgetDefinitions(layout) {
  const definitionsById = new Map(getProjectWidgetDefinitions().map((definition) => [definition.id, definition]));
  return layout.order
    .map((id) => definitionsById.get(id))
    .filter(Boolean);
}

function getWidgetDefinition(widgetId) {
  return getProjectWidgetDefinitions().find((definition) => definition.id === widgetId) || null;
}

function persistWidgetLayout(project) {
  const layout = widgetLayoutsByProject.get(project.id);
  if (!layout) {
    return Promise.resolve(null);
  }

  return window.dashtop.updateWidgetLayout(project.id, layout).catch((error) => {
    console.error("Could not persist widget layout:", error);
    return null;
  });
}

async function toggleWidgetLayoutLock(project) {
  const layout = getProjectWidgetLayout(project);
  widgetLayoutsByProject.set(project.id, {
    ...layout,
    locked: !layout.locked
  });
  await persistWidgetLayout(project);
  renderProjectDashboard(project);
}

async function removeProjectWidget(project, widgetId, columnCount) {
  const definition = getWidgetDefinition(widgetId);

  if (!definition) {
    return false;
  }

  const layout = getProjectWidgetLayout(project, columnCount);
  const hidden = [...new Set([...layout.hidden, widgetId])];
  const sizes = { ...layout.sizes };
  const positions = { ...layout.positions };
  delete sizes[widgetId];
  delete positions[widgetId];

  widgetLayoutsByProject.set(project.id, {
    ...layout,
    order: layout.order.filter((id) => id !== widgetId),
    hidden,
    sizes,
    positions
  });
  await persistWidgetLayout(project);
  renderProjectDashboard(project);
  return true;
}

async function addProjectWidget(project, widgetId, columnCount) {
  const definition = getWidgetDefinition(widgetId);

  if (!definition) {
    return false;
  }

  const layout = getProjectWidgetLayout(project, columnCount);
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

  widgetLayoutsByProject.set(project.id, {
    ...layout,
    order: [...layout.order.filter((id) => id !== widgetId), widgetId],
    hidden,
    sizes,
    positions
  });
  await persistWidgetLayout(project);
  renderProjectDashboard(project);
  return true;
}

function getWidgetGridPositionFromPointer(event, rail, columnCount, size) {
  const rect = rail.getBoundingClientRect();
  const styles = window.getComputedStyle(rail);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const contentWidth = Math.max(1, rail.clientWidth - paddingLeft - paddingRight);
  const columnWidth = (contentWidth - WIDGET_GRID_GAP * (columnCount - 1)) / columnCount;
  const x = Math.floor((event.clientX - rect.left - paddingLeft) / (columnWidth + WIDGET_GRID_GAP));
  const y = Math.floor(
    (event.clientY - rect.top - paddingTop - WIDGET_GRID_ROW_HEIGHT - WIDGET_GRID_GAP) /
      (WIDGET_GRID_ROW_HEIGHT + WIDGET_GRID_GAP)
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
  preview.style.gridRow = `${position.y + 2} / span ${size.rows}`;
}

function clearWidgetDropPreview(widgetRail) {
  if (!widgetRail) {
    return;
  }

  widgetRail.querySelector(".widget-drop-preview")?.remove();
  delete widgetRail.dataset.dropState;
}

async function moveWidgetToGridPosition(project, widgetId, position, columnCount) {
  const definition = getWidgetDefinition(widgetId);

  if (!definition) {
    return false;
  }

  const layout = getProjectWidgetLayout(project, columnCount);
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

  widgetLayoutsByProject.set(project.id, {
    ...layout,
    positions: {
      ...layout.positions,
      [widgetId]: position
    }
  });
  await persistWidgetLayout(project);
  renderProjectDashboard(project);
  return true;
}

function attachWidgetGridDropHandlers(widgetRail, project, columnCount) {
  widgetRail.addEventListener("dragover", (event) => {
    if (!draggedWidgetId) {
      return;
    }

    const layout = getProjectWidgetLayout(project, columnCount);
    const size = layout.sizes[draggedWidgetId];
    if (!size) {
      return;
    }

    event.preventDefault();
    const position = getWidgetGridPositionFromPointer(event, widgetRail, columnCount, size);
    const available = isWidgetAreaAvailable({
      widgetId: draggedWidgetId,
      position,
      size,
      positions: layout.positions,
      sizes: layout.sizes,
      columnCount
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
    const layout = getProjectWidgetLayout(project, columnCount);
    const size = layout.sizes[widgetId];
    clearWidgetDropPreview(widgetRail);

    if (!widgetId || !size) {
      return;
    }

    event.preventDefault();
    const position = getWidgetGridPositionFromPointer(event, widgetRail, columnCount, size);
    await moveWidgetToGridPosition(project, widgetId, position, columnCount);
  });
}

function createProjectWidget(project, definition, layout, columnCount) {
  const card = definition.createElement ? definition.createElement(project) : createCard(definition.create(project));
  const size = fitWidgetSizeToGrid(layout.sizes[definition.id], columnCount);
  const position = layout.positions[definition.id] || { x: 0, y: 0 };
  card.dataset.widgetId = definition.id;
  card.style.gridColumn = `${position.x + 1} / span ${size.columns}`;
  card.style.gridRow = `${position.y + 2} / span ${size.rows}`;

  if (!layout.locked) {
    card.draggable = true;
    card.addEventListener("dragstart", (event) => {
      draggedWidgetId = definition.id;
      card.classList.add("dragging");
      card.closest(".project-widget-rail")?.classList.add("dragging-widget");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", definition.id);
    });
    card.addEventListener("dragend", () => {
      draggedWidgetId = null;
      card.classList.remove("dragging");
      card.closest(".project-widget-rail")?.classList.remove("dragging-widget");
      for (const item of dashboardGrid.querySelectorAll(".widget-card")) {
        item.classList.remove("drag-over");
      }
      for (const dropzone of dashboardGrid.querySelectorAll(".widget-trash-dropzone")) {
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
        startWidgetResize(event, project, definition, layout, size, columnCount, direction);
      });
      card.append(resizeHandle);
    }
  }

  return card;
}

function startWidgetResize(event, project, definition, layout, startSize, columnCount, direction) {
  const spec = getWidgetLayoutSpec(definition);
  const startX = event.clientX;
  const startY = event.clientY;
  const startPosition = layout.positions[definition.id] || { x: 0, y: 0 };
  const card = event.currentTarget.closest(".widget-card");
  const rail = event.currentTarget.closest(".project-widget-rail");
  const railWidth = rail?.getBoundingClientRect().width || WIDGET_GRID_MIN_COLUMN_WIDTH;
  const columnWidth = (railWidth - WIDGET_GRID_GAP * (columnCount - 1)) / columnCount;
  const columnStep = Math.max(1, columnWidth + WIDGET_GRID_GAP);
  const rowStep = WIDGET_GRID_ROW_HEIGHT + WIDGET_GRID_GAP;
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
      nextY = clamp(startPosition.y + deltaRows, Math.max(0, bottom - spec.max.rows), bottom - spec.min.rows);
      nextRows = bottom - nextY;
    } else if (canResizeSouth) {
      nextRows = clamp(startSize.rows + deltaRows, spec.min.rows, spec.max.rows);
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
    widgetLayoutsByProject.set(project.id, {
      ...layout,
      positions: nextPositions,
      sizes: nextSizes
    });

    if (card) {
      card.style.gridColumn = `${nextGeometry.position.x + 1} / span ${nextGeometry.size.columns}`;
      card.style.gridRow = `${nextGeometry.position.y + 2} / span ${nextGeometry.size.rows}`;
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

function openWidgetAddMenuFromButton(button, project, layout, columnCount) {
  closeWidgetAddMenu();

  const hiddenDefinitions = layout.hidden
    .map((id) => getWidgetDefinition(id))
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
      await addProjectWidget(project, definition.id, columnCount);
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

function createWidgetTrashDropzone(project, columnCount) {
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
    clearWidgetDropPreview(dropzone.closest(".project-widget-rail"));
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
    clearWidgetDropPreview(dropzone.closest(".project-widget-rail"));
    draggedWidgetId = null;
    await removeProjectWidget(project, widgetId, columnCount);
  });

  return dropzone;
}

function createWidgetRailHeader(project, layout, columnCount) {
  const header = document.createElement("header");
  header.className = "widget-rail-header";

  const title = document.createElement("h3");
  title.textContent = project.name;

  const actions = document.createElement("div");
  actions.className = "widget-rail-actions";

  const actionConfigs = [
    {
      label: layout.locked ? "Unlock widget layout" : "Lock widget layout",
      text: layout.locked ? "Edit" : "Lock",
      wide: true,
      onClick: () => toggleWidgetLayoutLock(project)
    }
  ];

  const trashDropzone = !layout.locked ? createWidgetTrashDropzone(project, columnCount) : null;

  if (!layout.locked) {
    actionConfigs.push({
      label: "Add widget",
      text: "+",
      disabled: !layout.hidden.length,
      onClick: (event) => openWidgetAddMenuFromButton(event.currentTarget, project, layout, columnCount)
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

  header.append(title, actions);
  return header;
}

function getProjectWebApps(project, paneId) {
  const webApps = [
    {
      id: "twicc",
      label: "Twicc",
      key: `${paneId}:twicc`,
      url: project.twiccUrl || DEFAULT_TWICC_URL
    }
  ];

  if (project.previewUrl) {
    webApps.push({
      id: "preview",
      label: "Preview",
      key: `${paneId}:preview`,
      url: project.previewUrl
    });
  }

  if (project.repoUrl) {
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
      label: projectUrl.label,
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
  return window.dashtop[action](...payload).catch((error) => {
    console.error(`Could not ${action}:`, error);
  });
}

function getCurrentWebAppUrl(webApp) {
  return currentWebAppUrlsByKey.get(webApp.key) || webApp.url;
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
  renderProjectDashboard(project);
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

  await freezeWebAppsForOverlay();

  const menu = document.createElement("div");
  menu.className = "webapp-tab-menu";
  menu.setAttribute("role", "menu");

  const rect = button.getBoundingClientRect();
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
  const pane = document.createElement("section");
  pane.className = "webapp-pane";
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
  tabPickerButton.textContent = selectedWebApp.label;
  tabPickerButton.addEventListener("click", () => {
    const isOpen = Boolean(openWebAppTabMenu);
    tabPickerButton.setAttribute("aria-expanded", String(!isOpen));

    if (isOpen) {
      closeWebAppTabMenu();
    } else {
      openWebAppTabMenuFromButton(tabPickerButton, project, paneNode, selectedWebApp, webApps);
    }
  });

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

  tabs.append(tabPickerButton, homeButton, backButton, forwardButton, refreshButton, activeUrl);

  const actions = document.createElement("div");
  actions.className = "webapp-actions";

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
  host.className = "webapp-host";
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", `${project.name} ${selectedWebApp.label}`);

  pane.append(header, host);

  visibleWebAppHosts.set(paneNode.id, {
    webApp: selectedWebApp,
    host
  });
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
  renderProjectDashboard(project);
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
  renderProjectDashboard(project);
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
  const first = `${Math.round(splitNode.ratio * 1000) / 10}%`;
  const second = `${Math.round((1 - splitNode.ratio) * 1000) / 10}%`;

  if (splitNode.direction === "vertical") {
    splitElement.style.gridTemplateColumns = `${first} 6px ${second}`;
    splitElement.style.gridTemplateRows = "";
  } else {
    splitElement.style.gridTemplateColumns = "";
    splitElement.style.gridTemplateRows = `${first} 6px ${second}`;
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

  window.dashtop.updatePaneLayout(project.id, layout).catch((error) => {
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
  const projects = getProjects();
  closeWidgetAddMenu();
  visibleWebAppHosts = new Map();
  invokeWebApp("hideWebApp");
  workspace.classList.remove("project-mode");
  workspaceKicker.textContent = "Global";
  workspaceTitle.textContent = "System overview";
  workspaceSummary.textContent = "Global widgets will collect usage, agents, assistants, and service health.";
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "dashboard-grid";
  dashboardGrid.style.gridTemplateColumns = "";

  dashboardGrid.append(
    createCard({
      eyebrow: "Projects",
      title: String(projects.length),
      body: "Configured projects in this workspace.",
      meta: "Project switcher is the primary navigation."
    }),
    createCard({
      eyebrow: "Usage",
      title: "Usage",
      body: "Placeholder for global agent and API usage.",
      meta: "Runtime widget target"
    }),
    createCard({
      eyebrow: "Agents",
      title: "Agent config",
      body: "Placeholder for Tars, Hermes, and agent settings.",
      meta: "Global widget"
    }),
    createCard({
      eyebrow: "Inbox",
      title: "Hawser",
      body: "Placeholder for cross-project messages and active requests.",
      meta: "API widget target"
    })
  );
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
      const selectedPath = await window.dashtop.selectProjectsBasePath(projectsBasePathInput.value);
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
  headingCopy.textContent = "Tune how Dashtop displays webapp overlays.";
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

function createGlobalHawserSettingsForm({ settings, onSubmit }) {
  const shell = document.createElement("section");
  shell.className = "project-form-page";

  const form = document.createElement("form");
  form.className = "project-form";

  const heading = document.createElement("div");
  heading.className = "form-heading";

  const headingTitle = document.createElement("h3");
  headingTitle.textContent = "Hawser";

  const headingCopy = document.createElement("p");
  headingCopy.textContent = "Configure the Hawser API used by project widgets.";
  heading.append(headingTitle, headingCopy);

  const apiUrlLabel = document.createElement("label");
  apiUrlLabel.textContent = "API URL";

  const apiUrlInput = document.createElement("input");
  apiUrlInput.name = "hawserApiUrl";
  apiUrlInput.type = "text";
  apiUrlInput.autocomplete = "off";
  apiUrlInput.placeholder = DEFAULT_HAWSER_API_URL;
  apiUrlInput.value = settings.hawserApiUrl || DEFAULT_HAWSER_API_URL;
  apiUrlLabel.append(apiUrlInput);

  const tokenLabel = document.createElement("label");
  tokenLabel.textContent = "API token";

  const tokenInput = document.createElement("input");
  tokenInput.name = "hawserToken";
  tokenInput.type = "password";
  tokenInput.autocomplete = "off";
  tokenInput.value = settings.hawserToken || "";
  tokenLabel.append(tokenInput);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "form-actions";

  const submitButton = document.createElement("button");
  submitButton.className = "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = "Save Hawser";

  actions.append(submitButton);
  form.append(heading, apiUrlLabel, tokenLabel, error, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    error.hidden = true;

    try {
      await onSubmit({
        hawserApiUrl: apiUrlInput.value,
        hawserToken: tokenInput.value
      });
    } catch (submitError) {
      error.textContent = submitError.message;
      error.hidden = false;
    }
  });

  shell.append(form);
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
  headingCopy.textContent = "Installed widget plugins available to Dashtop.";
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

    for (const value of [widget.scope, widget.category, widget.provider]) {
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
      state = await window.dashtop.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalPresentationSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await window.dashtop.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalHawserSettingsForm({
    settings: getSettings(),
    onSubmit: async (values) => {
      state = await window.dashtop.updateSettings(values);
      renderGlobalSettingsPage();
    }
  }), createGlobalWidgetsSettingsView());
}

function renderProjectDashboard(project) {
  closeWidgetAddMenu();
  detachProjectTerminal(project.id);
  const settings = getSettings();
  const widgetRailWidth = clampWidgetRailWidth(settings.widgetRailWidth);
  workspace.classList.add("project-mode");
  workspaceKicker.textContent = "Project";
  workspaceTitle.textContent = project.name;
  workspaceSummary.textContent = project.sourcePath || project.previewUrl || project.slug;
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-workbench";
  dashboardGrid.style.gridTemplateColumns = `${widgetRailWidth}px ${WIDGET_RAIL_RESIZER_WIDTH}px minmax(${MIN_WEBAPP_AREA_WIDTH}px, 1fr)`;
  visibleWebAppHosts = new Map();

  const widgetGridColumns = getWidgetGridColumnCount(widgetRailWidth);
  const widgetLayout = getProjectWidgetLayout(project, widgetGridColumns);
  const widgetRail = document.createElement("aside");
  widgetRail.className = "project-widget-rail";
  widgetRail.classList.toggle("editing", !widgetLayout.locked);
  widgetRail.style.setProperty("--widget-grid-columns", String(widgetGridColumns));
  widgetRail.style.setProperty("--widget-grid-row-height", `${WIDGET_GRID_ROW_HEIGHT}px`);

  widgetRail.append(
    createWidgetRailHeader(project, widgetLayout, widgetGridColumns),
    ...getOrderedWidgetDefinitions(widgetLayout).map((definition) => (
      createProjectWidget(project, definition, widgetLayout, widgetGridColumns)
    ))
  );
  attachWidgetGridDropHandlers(widgetRail, project, widgetGridColumns);

  dashboardGrid.append(widgetRail, createWidgetRailResizer(), createPaneLayout(project, getProjectPaneLayout(project)));
}

function clampWidgetRailWidth(width) {
  const workbenchWidth = dashboardGrid.getBoundingClientRect().width || window.innerWidth;
  const maxWidth = Math.max(
    MIN_WIDGET_RAIL_WIDTH,
    workbenchWidth - MIN_WEBAPP_AREA_WIDTH - WIDGET_RAIL_RESIZER_WIDTH
  );
  return Math.min(maxWidth, Math.max(MIN_WIDGET_RAIL_WIDTH, Math.round(width || 340)));
}

function createWidgetRailResizer() {
  const resizer = document.createElement("div");
  resizer.className = "widget-rail-resizer";
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", "Resize widgets");

  resizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = getSettings().widgetRailWidth;

    function onPointerMove(moveEvent) {
      const nextWidth = clampWidgetRailWidth(startWidth + moveEvent.clientX - startX);
      const project = getCurrentProject();
      state.settings = {
        ...getSettings(),
        widgetRailWidth: nextWidth
      };
      dashboardGrid.style.gridTemplateColumns = `${nextWidth}px ${WIDGET_RAIL_RESIZER_WIDTH}px minmax(${MIN_WEBAPP_AREA_WIDTH}px, 1fr)`;
      const widgetRail = dashboardGrid.querySelector(".project-widget-rail");
      if (project && widgetRail) {
        applyWidgetGridLayout(widgetRail, project, getWidgetGridColumnCount(nextWidth));
      }
      queueWebAppSync();
    }

    async function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      state = await window.dashtop.updateSettings({
        widgetRailWidth: getSettings().widgetRailWidth
      });
      const project = getCurrentProject();
      if (project) {
        renderProjectDashboard(project);
      }
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  });

  return resizer;
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
      const selectedPath = await window.dashtop.selectProjectsBasePath(
        sourcePathInput.value || settings.projectsBasePath
      );
      if (selectedPath) {
        sourcePathInput.value = selectedPath;
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

  const previewUrlLabel = document.createElement("label");
  previewUrlLabel.textContent = "Preview URL";

  const previewUrlInput = document.createElement("input");
  previewUrlInput.name = "previewUrl";
  previewUrlInput.type = "text";
  previewUrlInput.placeholder = "http://localhost:5173";
  previewUrlInput.value = initialValues.previewUrl || "";
  previewUrlLabel.append(previewUrlInput);

  const twiccUrlLabel = document.createElement("label");
  twiccUrlLabel.textContent = "Twicc URL";

  const twiccUrlInput = document.createElement("input");
  twiccUrlInput.name = "twiccUrl";
  twiccUrlInput.type = "text";
  twiccUrlInput.required = true;
  twiccUrlInput.value = initialValues.twiccUrl || DEFAULT_TWICC_URL;
  twiccUrlLabel.append(twiccUrlInput);

  const hawserMainSessionLabel = document.createElement("label");
  hawserMainSessionLabel.textContent = "Hawser main session";

  const hawserMainSessionInput = document.createElement("input");
  hawserMainSessionInput.name = "hawserMainSession";
  hawserMainSessionInput.type = "text";
  hawserMainSessionInput.required = true;
  hawserMainSessionInput.value = initialValues.hawserMainSession || "";
  hawserMainSessionLabel.append(hawserMainSessionInput);

  nameInput.addEventListener("input", () => {
    if (!slugInput.dataset.edited) {
      const nextSlug = slugify(nameInput.value);
      slugInput.value = nextSlug;
      hawserMainSessionInput.value = nextSlug ? `${nextSlug}:main` : "";
    }
  });

  slugInput.addEventListener("input", () => {
    slugInput.dataset.edited = "true";

    if (!hawserMainSessionInput.dataset.edited) {
      const nextSlug = slugify(slugInput.value);
      hawserMainSessionInput.value = nextSlug ? `${nextSlug}:main` : "";
    }
  });

  gitUrlInput.addEventListener("input", () => {
    if (!repoUrlInput.dataset.edited) {
      repoUrlInput.value = deriveRepoUrl(gitUrlInput.value);
    }
  });

  repoUrlInput.addEventListener("input", () => {
    repoUrlInput.dataset.edited = "true";
  });

  hawserMainSessionInput.addEventListener("input", () => {
    hawserMainSessionInput.dataset.edited = "true";
  });

  async function applySourcePathInspection(sourcePath) {
    const inspected = await window.dashtop.inspectSourcePath(sourcePath);

    if (inspected?.gitUrl) {
      gitUrlInput.value = inspected.gitUrl;
    }

    if (inspected?.repoUrl) {
      repoUrlInput.value = inspected.repoUrl;
    } else if (inspected?.gitUrl && !repoUrlInput.dataset.edited) {
      repoUrlInput.value = deriveRepoUrl(inspected.gitUrl);
    }
  }

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

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
    previewUrlLabel,
    twiccUrlLabel,
    hawserMainSessionLabel,
    error,
    actions
  );

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
        previewUrl: previewUrlInput.value,
        twiccUrl: twiccUrlInput.value,
        hawserMainSession: hawserMainSessionInput.value
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

  const urlInput = document.createElement("input");
  urlInput.name = "urlValue";
  urlInput.type = "text";
  urlInput.autocomplete = "off";
  urlInput.placeholder = "https://dash.cloudflare.com/...";
  urlInput.value = entry.url || "";
  urlInput.setAttribute("aria-label", "URL");

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

function readProjectUrlRows(list) {
  return [...list.querySelectorAll(".project-url-row")]
    .map((row) => ({
      id: row.querySelector('[name="urlId"]').value,
      label: row.querySelector('[name="urlLabel"]').value,
      url: row.querySelector('[name="urlValue"]').value
    }))
    .filter((entry) => entry.id.trim() || entry.label.trim() || entry.url.trim());
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
      state = await window.dashtop.addProject({
        name: values.name,
        slug: values.slug,
        sourcePath: values.sourcePath,
        gitUrl: values.gitUrl,
        repoUrl: values.repoUrl,
        devBranch: values.devBranch,
        previewUrl: values.previewUrl,
        twiccUrl: values.twiccUrl,
        hawserMainSession: values.hawserMainSession,
        isOpen: false
      });
      const project = state.projects[state.projects.length - 1];
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
      state = await window.dashtop.updateProject(project.id, {
        name: values.name,
        slug: values.slug,
        sourcePath: values.sourcePath,
        gitUrl: values.gitUrl,
        repoUrl: values.repoUrl,
        devBranch: values.devBranch,
        previewUrl: values.previewUrl,
        twiccUrl: values.twiccUrl,
        hawserMainSession: values.hawserMainSession
      });
      reloadProjectSettings(project.id);
    }
  }), createProjectUrlsForm({
    project,
    onSubmit: async (urls) => {
      state = await window.dashtop.updateProject(project.id, { urls });
      reloadProjectSettings(project.id);
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
      bounds
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
    const captures = await window.dashtop.freezeWebApps();
    renderFrozenWebApps(captures);
  } catch (error) {
    console.error("Could not freeze webapps:", error);
  }
}

async function restoreWebAppsAfterOverlay() {
  clearFrozenWebAppLayer();

  try {
    await window.dashtop.restoreWebApps();
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
    button.innerHTML = `
      <span></span>
      <small></small>
    `;
    button.querySelector("span").textContent = project.name;
    button.querySelector("small").textContent = project.slug;
    button.addEventListener("click", () => selectProject(project.id));
    row.append(button);

    if (isActiveProject) {
      const settingsButton = document.createElement("button");
      settingsButton.className = "project-settings-button";
      settingsButton.type = "button";
      settingsButton.title = "Project settings";
      settingsButton.setAttribute("aria-label", `${project.name} settings`);
      settingsButton.textContent = "⚙";
      settingsButton.addEventListener("click", () => selectEditProject(project.id));
      row.append(settingsButton);
    }

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
  state = await window.dashtop.reorderProjects(reordered.map((project) => project.id));
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
  state = await window.dashtop.getState();
  currentWebAppUrlsByKey.clear();
  for (const [key, webApp] of Object.entries(state.webApps || {})) {
    if (webApp.url) {
      currentWebAppUrlsByKey.set(key, webApp.url);
    }
  }
  hydratePaneLayouts();
  hydrateWidgetLayouts();
  restoreNavigation();
  render();
}

window.dashtop.onWebAppUrlChanged(({ key, url }) => {
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

window.dashtop.onTerminalData(({ terminalId, data }) => {
  const session = terminalWidgetsByTerminal.get(terminalId);
  session?.term.write(data);
});

window.dashtop.onTerminalExit(({ terminalId }) => {
  const session = terminalWidgetsByTerminal.get(terminalId);
  if (!session) {
    return;
  }

  terminalWidgetsByTerminal.delete(terminalId);
  const projectSession = terminalWidgetsByProject.get(session.projectId);
  if (projectSession?.terminalId === terminalId) {
    terminalWidgetsByProject.delete(session.projectId);
  }
});

globalNav.addEventListener("click", selectGlobal);
globalSettingsButton.addEventListener("click", selectGlobalSettings);
globalViewButton.addEventListener("click", selectGlobal);
addProjectButton.addEventListener("click", selectCreateProject);
window.addEventListener("resize", queueWebAppSync);
workspace.addEventListener("scroll", queueWebAppSync);

loadState();
