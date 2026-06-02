"use strict";

const MIN_WIDTH = 260;
const MIN_HEIGHT = 200;
const TITLEBAR_HEIGHT = 36;

const desktop = document.querySelector("#desktop");
const emptyState = document.querySelector("#empty-state");
const configPanel = document.querySelector("#config-panel");
const toggleConfigButton = document.querySelector("#toggle-config");
const closeConfigButton = document.querySelector("#close-config");
const emptyAddButton = document.querySelector("#empty-add");
const appForm = document.querySelector("#app-form");
const appNameInput = document.querySelector("#app-name");
const appUrlInput = document.querySelector("#app-url");
const formError = document.querySelector("#form-error");
const appList = document.querySelector("#app-list");

let state = { apps: [] };
let activeAppId = null;
let dragSession = null;
let saveLayoutTimer = null;
let highestZ = 1;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getDesktopSize() {
  return {
    width: desktop.clientWidth,
    height: desktop.clientHeight
  };
}

function getAppElement(id) {
  return desktop.querySelector(`.app-window[data-app-id="${CSS.escape(id)}"]`);
}

function getSurfaceBounds(element) {
  const surface = element.querySelector(".web-surface");
  const rect = surface.getBoundingClientRect();

  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function setElementBounds(element, bounds) {
  const size = getDesktopSize();
  const width = clamp(bounds.width, MIN_WIDTH, Math.max(MIN_WIDTH, size.width));
  const height = clamp(bounds.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, size.height));
  const x = clamp(bounds.x, 0, Math.max(0, size.width - width));
  const y = clamp(bounds.y, 0, Math.max(0, size.height - height));

  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

function syncViewBounds(id) {
  const element = getAppElement(id);

  if (element) {
    window.dashtop.setViewBounds(id, getSurfaceBounds(element));
  }
}

function syncAllViewBounds() {
  if (!configPanel.hidden) {
    return;
  }

  for (const appConfig of state.apps) {
    if (appConfig.isOpen) {
      syncViewBounds(appConfig.id);
    }
  }
}

function scheduleLayoutSave(id) {
  window.clearTimeout(saveLayoutTimer);
  saveLayoutTimer = window.setTimeout(async () => {
    const element = getAppElement(id);

    if (!element) {
      return;
    }

    const bounds = {
      x: Number.parseInt(element.style.left, 10),
      y: Number.parseInt(element.style.top, 10),
      width: Number.parseInt(element.style.width, 10),
      height: Number.parseInt(element.style.height, 10)
    };

    state = await window.dashtop.updateApp(id, { bounds });
    render();
  }, 150);
}

async function focusApp(id) {
  activeAppId = id;
  const element = getAppElement(id);

  if (element) {
    highestZ += 1;
    element.style.zIndex = String(highestZ);
    document.querySelectorAll(".app-window.active").forEach((node) => {
      node.classList.remove("active");
    });
    element.classList.add("active");
  }

  await window.dashtop.focusView(id);
  syncViewBounds(id);
}

function startDrag(event, id, mode) {
  const element = getAppElement(id);

  if (!element) {
    return;
  }

  event.preventDefault();
  focusApp(id);

  const rect = element.getBoundingClientRect();
  const desktopRect = desktop.getBoundingClientRect();
  dragSession = {
    id,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    bounds: {
      x: rect.left - desktopRect.left,
      y: rect.top - desktopRect.top,
      width: rect.width,
      height: rect.height
    }
  };
}

function handlePointerMove(event) {
  if (!dragSession) {
    return;
  }

  const deltaX = event.clientX - dragSession.startX;
  const deltaY = event.clientY - dragSession.startY;
  const nextBounds = { ...dragSession.bounds };

  if (dragSession.mode === "move") {
    nextBounds.x += deltaX;
    nextBounds.y += deltaY;
  } else {
    nextBounds.width += deltaX;
    nextBounds.height += deltaY;
  }

  const element = getAppElement(dragSession.id);
  setElementBounds(element, nextBounds);
  syncViewBounds(dragSession.id);
}

function handlePointerUp() {
  if (!dragSession) {
    return;
  }

  scheduleLayoutSave(dragSession.id);
  dragSession = null;
}

function createWindowElement(appConfig) {
  const element = document.createElement("article");
  element.className = "app-window";
  element.dataset.appId = appConfig.id;
  element.innerHTML = `
    <div class="window-titlebar">
      <span class="window-title"></span>
      <div class="window-actions">
        <button class="icon-button close-window" type="button" aria-label="Close window">x</button>
      </div>
    </div>
    <div class="web-surface"></div>
    <div class="resize-handle" aria-hidden="true"></div>
  `;

  element.querySelector(".window-title").textContent = appConfig.name;
  setElementBounds(element, appConfig.bounds);

  element.addEventListener("pointerdown", () => {
    focusApp(appConfig.id);
  });
  element.querySelector(".window-titlebar").addEventListener("pointerdown", (event) => {
    startDrag(event, appConfig.id, "move");
  });
  element.querySelector(".resize-handle").addEventListener("pointerdown", (event) => {
    startDrag(event, appConfig.id, "resize");
  });
  element.querySelector(".close-window").addEventListener("click", async (event) => {
    event.stopPropagation();
    state = await window.dashtop.updateApp(appConfig.id, { isOpen: false });
    render();
  });

  return element;
}

function renderDesktop() {
  for (const node of desktop.querySelectorAll(".app-window")) {
    node.remove();
  }

  const openApps = state.apps.filter((appConfig) => appConfig.isOpen);
  emptyState.hidden = state.apps.length > 0;

  for (const appConfig of openApps) {
    const element = createWindowElement(appConfig);
    highestZ += 1;
    element.style.zIndex = String(highestZ);
    desktop.append(element);
  }

  if (!activeAppId && openApps.length > 0) {
    activeAppId = openApps[openApps.length - 1].id;
  }

  if (activeAppId) {
    const active = getAppElement(activeAppId);

    if (active) {
      active.classList.add("active");
    }
  }

  requestAnimationFrame(syncAllViewBounds);
}

function renderAppList() {
  appList.innerHTML = "";

  for (const appConfig of state.apps) {
    const item = document.createElement("div");
    item.className = "app-list-item";
    item.innerHTML = `
      <div class="app-list-title">
        <strong></strong>
        <span></span>
      </div>
      <div class="app-list-actions">
        <button class="secondary-button open-app" type="button"></button>
        <button class="danger-button remove-app" type="button">Remove</button>
      </div>
    `;

    item.querySelector("strong").textContent = appConfig.name;
    item.querySelector("span").textContent = appConfig.url;
    item.querySelector(".open-app").textContent = appConfig.isOpen ? "Focus" : "Open";
    item.querySelector(".open-app").addEventListener("click", async () => {
      state = await window.dashtop.updateApp(appConfig.id, { isOpen: true });
      activeAppId = appConfig.id;
      render();
      await focusApp(appConfig.id);
    });
    item.querySelector(".remove-app").addEventListener("click", async () => {
      state = await window.dashtop.removeApp(appConfig.id);
      if (activeAppId === appConfig.id) {
        activeAppId = null;
      }
      render();
    });

    appList.append(item);
  }
}

function render() {
  renderDesktop();
  renderAppList();
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

async function loadState() {
  state = await window.dashtop.getState();
  render();
}

toggleConfigButton.addEventListener("click", () => {
  configPanel.hidden = !configPanel.hidden;

  if (configPanel.hidden) {
    window.dashtop.resumeViews().then(syncAllViewBounds);
  } else {
    window.dashtop.suspendViews();
  }

  appNameInput.focus();
});

emptyAddButton.addEventListener("click", () => {
  configPanel.hidden = false;
  window.dashtop.suspendViews();
  appNameInput.focus();
});

closeConfigButton.addEventListener("click", () => {
  configPanel.hidden = true;
  window.dashtop.resumeViews().then(syncAllViewBounds);
});

appForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");

  try {
    state = await window.dashtop.addApp({
      name: appNameInput.value,
      url: appUrlInput.value
    });
    activeAppId = state.apps[state.apps.length - 1].id;
    appForm.reset();
    render();

    if (!configPanel.hidden) {
      await window.dashtop.suspendViews();
    }
  } catch (error) {
    showError(error.message);
  }
});

window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);
window.addEventListener("resize", () => {
  renderDesktop();
});

loadState();
