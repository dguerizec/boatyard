"use strict";

const globalNav = document.querySelector("#global-nav");
const globalViewButton = document.querySelector("#global-view");
const projectCount = document.querySelector("#project-count");
const projectList = document.querySelector("#project-list");
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

let state = { apps: [] };
let currentProjectId = null;

function getProjects() {
  return state.apps;
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

function renderGlobalDashboard() {
  const projects = getProjects();
  workspaceKicker.textContent = "Global";
  workspaceTitle.textContent = "System overview";
  workspaceSummary.textContent = "Global widgets will collect usage, agents, assistants, and service health.";
  dashboardGrid.innerHTML = "";

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
  workspaceKicker.textContent = "Project";
  workspaceTitle.textContent = project.name;
  workspaceSummary.textContent = project.url;
  dashboardGrid.innerHTML = "";

  dashboardGrid.append(
    createCard({
      eyebrow: "Preview",
      title: "Project preview",
      body: "A non-overlapping app pane can render this project when the focus mode lands.",
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
      state = await window.dashtop.removeApp(project.id);

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
    state = await window.dashtop.addApp({
      name: projectNameInput.value,
      url: projectUrlInput.value,
      isOpen: false
    });
    const project = state.apps[state.apps.length - 1];
    currentProjectId = project.id;
    projectForm.reset();
    render();
  } catch (error) {
    showError(error.message);
  }
});

loadState();
