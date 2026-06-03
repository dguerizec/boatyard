"use strict";

const globalNav = document.querySelector("#global-nav");
const globalViewButton = document.querySelector("#global-view");
const projectCount = document.querySelector("#project-count");
const projectList = document.querySelector("#project-list");
const workspace = document.querySelector(".workspace");
const dashboardGrid = document.querySelector("#dashboard-grid");
const workspaceKicker = document.querySelector("#workspace-kicker");
const workspaceTitle = document.querySelector("#workspace-title");
const workspaceSummary = document.querySelector("#workspace-summary");
const configPanel = document.querySelector("#config-panel");
const toggleConfigButton = document.querySelector("#toggle-config");
const closeConfigButton = document.querySelector("#close-config");
const projectForm = document.querySelector("#project-form");
const projectNameInput = document.querySelector("#project-name");
const projectUrlInput = document.querySelector("#project-url");
const formError = document.querySelector("#form-error");
const configuredProjects = document.querySelector("#configured-projects");

const DEFAULT_TWICC_URL = "http://localhost:3500";

let state = { projects: [] };
let currentProjectId = null;
const selectedWebAppByProject = new Map();
const paneLayoutsByProject = new Map();
const selectedWebAppByPane = new Map();
let visibleWebAppHosts = new Map();
let webAppBoundsFrame = null;
let nextPaneId = 1;

function getProjects() {
  return state.projects;
}

function getCurrentProject() {
  return getProjects().find((project) => project.id === currentProjectId) || null;
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
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

function getProjectWebApps(project) {
  return [
    {
      id: "twicc",
      label: "Twicc",
      key: `${project.id}:twicc`,
      url: DEFAULT_TWICC_URL
    },
    {
      id: "preview",
      label: "Preview",
      key: `${project.id}:preview`,
      url: project.url
    }
  ];
}

function createPaneNode(project, selectedWebAppId = null) {
  const id = `${project.id}:pane:${nextPaneId}`;
  nextPaneId += 1;

  if (selectedWebAppId) {
    selectedWebAppByPane.set(id, selectedWebAppId);
  }

  return {
    type: "pane",
    id
  };
}

function getProjectPaneLayout(project) {
  if (!paneLayoutsByProject.has(project.id)) {
    paneLayoutsByProject.set(project.id, createPaneNode(project));
  }

  return paneLayoutsByProject.get(project.id);
}

function getSelectedWebApp(project, paneId, webApps) {
  const selectedId =
    selectedWebAppByPane.get(paneId) ||
    selectedWebAppByProject.get(project.id) ||
    webApps[0].id;
  return webApps.find((webApp) => webApp.id === selectedId) || webApps[0];
}

function invokeWebApp(action, payload) {
  return window.dashtop[action](payload).catch((error) => {
    console.error(`Could not ${action}:`, error);
  });
}

function createWebAppPane(project, paneNode) {
  const webApps = getProjectWebApps(project);
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

  for (const webApp of webApps) {
    const tab = document.createElement("button");
    tab.className = "webapp-tab";
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(webApp.id === selectedWebApp.id));
    tab.textContent = webApp.label;
    tab.addEventListener("click", () => {
      selectedWebAppByPane.set(paneNode.id, webApp.id);
      selectedWebAppByProject.set(project.id, webApp.id);
      renderProjectDashboard(project);
    });
    tabs.append(tab);
  }

  const actions = document.createElement("div");
  actions.className = "webapp-actions";

  const activeUrl = document.createElement("span");
  activeUrl.className = "webapp-url";
  activeUrl.textContent = selectedWebApp.url;

  const openButton = document.createElement("button");
  openButton.className = "secondary-button";
  openButton.type = "button";
  openButton.textContent = "Open";
  openButton.addEventListener("click", () => window.dashtop.openExternal(selectedWebApp.url));

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

  actions.append(activeUrl, verticalSplitButton, horizontalSplitButton, openButton);
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

function splitPane(project, paneId, direction) {
  const layout = getProjectPaneLayout(project);
  const webApps = getProjectWebApps(project);
  const currentWebAppId = selectedWebAppByPane.get(paneId) || selectedWebAppByProject.get(project.id) || webApps[0].id;
  const nextWebAppId = webApps.find((webApp) => webApp.id !== currentWebAppId)?.id || currentWebAppId;
  const replacement = createSplitNode(project, direction, { type: "pane", id: paneId }, nextWebAppId);
  paneLayoutsByProject.set(project.id, replacePaneNode(layout, paneId, replacement));
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

function renderProjectDashboard(project) {
  workspace.classList.add("project-mode");
  workspaceKicker.textContent = "Project";
  workspaceTitle.textContent = project.name;
  workspaceSummary.textContent = project.url;
  dashboardGrid.innerHTML = "";
  dashboardGrid.className = "project-workbench";
  visibleWebAppHosts = new Map();

  const widgetRail = document.createElement("aside");
  widgetRail.className = "project-widget-rail";

  widgetRail.append(
    createCard({
      eyebrow: "Project",
      title: project.name,
      body: project.url,
      meta: "Active workspace"
    }),
    createCard({
      eyebrow: "Preview",
      title: "Project preview",
      body: "Project preview is available as a webapp tab in the project pane.",
      meta: project.url,
      action: {
        label: "Open URL",
        onClick: () => window.dashtop.openExternal(project.url)
      }
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

  dashboardGrid.append(widgetRail, createPaneLayout(project, getProjectPaneLayout(project)));
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
  invokeWebApp("setVisibleWebApps", visibleKeys);
}

function queueWebAppSync() {
  if (webAppBoundsFrame !== null) {
    return;
  }

  webAppBoundsFrame = requestAnimationFrame(syncWebAppView);
}

function selectProject(id) {
  currentProjectId = id;
  render();
}

function renderProjectList() {
  const projects = getProjects();
  projectCount.textContent = String(projects.length);
  projectList.innerHTML = "";

  globalNav.classList.toggle("active", currentProjectId === null);

  if (projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "No projects configured yet.";
    projectList.append(empty);
    return;
  }

  for (const project of projects) {
    const button = document.createElement("button");
    button.className = "nav-item";
    button.type = "button";
    button.classList.toggle("active", project.id === currentProjectId);
    button.innerHTML = `
      <span></span>
      <small></small>
    `;
    button.querySelector("span").textContent = project.name;
    button.querySelector("small").textContent = project.url;
    button.addEventListener("click", () => selectProject(project.id));
    projectList.append(button);
  }
}

function renderConfiguredProjects() {
  configuredProjects.innerHTML = "";

  for (const project of getProjects()) {
    const item = document.createElement("div");
    item.className = "configured-project";
    item.innerHTML = `
      <div>
        <strong></strong>
        <span></span>
      </div>
      <button class="danger-button" type="button">Remove</button>
    `;

    item.querySelector("strong").textContent = project.name;
    item.querySelector("span").textContent = project.url;
    item.querySelector("button").addEventListener("click", async () => {
      state = await window.dashtop.removeProject(project.id);

      if (currentProjectId === project.id) {
        currentProjectId = null;
      }

      render();
    });
    configuredProjects.append(item);
  }
}

function render() {
  renderProjectList();
  renderConfiguredProjects();

  const project = getCurrentProject();

  if (project) {
    renderProjectDashboard(project);
  } else {
    renderGlobalDashboard();
  }
}

async function loadState() {
  state = await window.dashtop.getState();
  render();
}

globalNav.addEventListener("click", () => selectProject(null));
globalViewButton.addEventListener("click", () => selectProject(null));
window.addEventListener("resize", queueWebAppSync);
workspace.addEventListener("scroll", queueWebAppSync);

toggleConfigButton.addEventListener("click", () => {
  configPanel.hidden = !configPanel.hidden;
  projectNameInput.focus();
});

closeConfigButton.addEventListener("click", () => {
  configPanel.hidden = true;
});

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");

  try {
    state = await window.dashtop.addProject({
      name: projectNameInput.value,
      url: projectUrlInput.value,
      isOpen: false
    });
    const project = state.projects[state.projects.length - 1];
    currentProjectId = project.id;
    projectForm.reset();
    render();
  } catch (error) {
    showError(error.message);
  }
});

loadState();
