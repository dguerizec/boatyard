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
const MIN_WIDGET_RAIL_WIDTH = 240;
const MIN_WEBAPP_AREA_WIDTH = 420;
const WIDGET_RAIL_RESIZER_WIDTH = 6;

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
const selectedWebAppByPane = new Map();
const loadedWebAppKeys = new Set();
const currentWebAppUrlsByKey = new Map();
let visibleWebAppHosts = new Map();
let webAppBoundsFrame = null;
let nextPaneId = 1;
let frozenWebAppLayer = null;
let openWebAppTabMenu = null;
let draggedProjectId = null;

function getProjects() {
  return state.projects;
}

function getSettings() {
  return {
    projectsBasePath: "",
    blurWebAppOverlays: true,
    widgetRailWidth: 340,
    ...(state.settings || {})
  };
}

function getCurrentProject() {
  return getProjects().find((project) => project.id === currentProjectId) || null;
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

function renderGlobalSettingsPage() {
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
  }));
}

function renderProjectDashboard(project) {
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

  const widgetRail = document.createElement("aside");
  widgetRail.className = "project-widget-rail";

  widgetRail.append(
    createCard({
      eyebrow: "Project",
      title: project.name,
      body: project.sourcePath || project.slug,
      meta: "Active workspace"
    }),
    createCard({
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
    }),
    createCard({
      eyebrow: "Sessions",
      title: "Twicc",
      body: "Placeholder for sessions linked to this project.",
      meta: "Contextual widget"
    }),
    createCard({
      eyebrow: "Terminal",
      title: "Project shell",
      body: "Placeholder for a terminal pane rooted in the project directory.",
      meta: "Contextual widget"
    }),
    createCard({
      eyebrow: "Comms",
      title: "Discord",
      body: "Placeholder for the project channel or activity feed.",
      meta: "Contextual widget"
    })
  );

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
      state.settings = {
        ...getSettings(),
        widgetRailWidth: nextWidth
      };
      dashboardGrid.style.gridTemplateColumns = `${nextWidth}px ${WIDGET_RAIL_RESIZER_WIDTH}px minmax(${MIN_WEBAPP_AREA_WIDTH}px, 1fr)`;
      queueWebAppSync();
    }

    async function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      state = await window.dashtop.updateSettings({
        widgetRailWidth: getSettings().widgetRailWidth
      });
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
  currentView = "global";
  currentProjectId = null;
  render();
}

function selectGlobalSettings() {
  currentView = "global-settings";
  currentProjectId = null;
  render();
}

function selectCreateProject() {
  if (currentView !== "project-create") {
    returnView = {
      view: currentView,
      projectId: currentProjectId
    };
  }
  currentView = "project-create";
  currentProjectId = null;
  render();
}

function selectProject(id) {
  currentView = "project";
  currentProjectId = id;
  render();
}

function selectEditProject(id) {
  currentView = "project-edit";
  currentProjectId = id;
  render();
}

function reloadProjectSettings(id) {
  currentView = "project-edit";
  currentProjectId = id;
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

globalNav.addEventListener("click", selectGlobal);
globalSettingsButton.addEventListener("click", selectGlobalSettings);
globalViewButton.addEventListener("click", selectGlobal);
addProjectButton.addEventListener("click", selectCreateProject);
window.addEventListener("resize", queueWebAppSync);
workspace.addEventListener("scroll", queueWebAppSync);

loadState();
