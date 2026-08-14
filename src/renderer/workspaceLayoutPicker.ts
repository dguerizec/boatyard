import type {
  WorkspaceLayout,
  WorkspaceLayoutPaneNode
} from "./rendererTypes.js";

type WorkspaceLayoutPickerOptions = {
  confirmLabel?: string;
  description?: string;
  getLayouts: () => Promise<WorkspaceLayout[]>;
  initialLayoutId?: string;
  isPaneTypeAvailable?: (paneTypeId: string) => boolean;
  getPaneTypeLabel?: (paneTypeId: string) => string;
  getAspectRatio?: () => number;
  onConfirm: (layout: WorkspaceLayout) => Promise<void> | void;
  onDelete?: (layout: WorkspaceLayout) => Promise<void>;
  onSaveAs?: (name: string, scope: "global" | "project") => Promise<WorkspaceLayout>;
  onUpdate?: (layout: WorkspaceLayout) => Promise<WorkspaceLayout>;
  projectScopeAvailable?: boolean;
  title?: string;
};

export function resolveWorkspaceLayoutSaveScope(
  projectScopeAvailable: boolean,
  global: boolean
): "global" | "project" {
  return projectScopeAvailable && !global ? "project" : "global";
}

function countLayoutPanes(node: WorkspaceLayoutPaneNode): number {
  return node.type === "pane"
    ? 1
    : countLayoutPanes(node.first) + countLayoutPanes(node.second);
}

function createPanePreview(
  node: WorkspaceLayoutPaneNode,
  isPaneTypeAvailable: (paneTypeId: string) => boolean,
  getPaneTypeLabel: (paneTypeId: string) => string
): HTMLElement {
  const element = document.createElement("div");
  if (node.type === "pane") {
    const paneTypeId = String(node.paneTypeId || "");
    const available = Boolean(paneTypeId && isPaneTypeAvailable(paneTypeId));
    element.className = `layout-preview-pane${available ? "" : " unavailable"}`;
    element.textContent = available ? getPaneTypeLabel(paneTypeId) : "Empty";
    if (paneTypeId && !available) {
      element.title = `${paneTypeId} is unavailable for this project`;
    }
    return element;
  }

  element.className = `layout-preview-split ${node.direction}`;
  const first = Math.max(0.05, Math.min(0.95, Number(node.ratio) || 0.5));
  const second = 1 - first;
  if (node.direction === "vertical") {
    element.style.gridTemplateColumns = `${first}fr ${second}fr`;
  } else {
    element.style.gridTemplateRows = `${first}fr ${second}fr`;
  }
  element.append(
    createPanePreview(node.first, isPaneTypeAvailable, getPaneTypeLabel),
    createPanePreview(node.second, isPaneTypeAvailable, getPaneTypeLabel)
  );
  return element;
}

export function createWorkspaceLayoutPreview(
  layout: WorkspaceLayout,
  isPaneTypeAvailable: (paneTypeId: string) => boolean = () => true,
  getPaneTypeLabel: (paneTypeId: string) => string = (paneTypeId) => paneTypeId,
  getAspectRatio: () => number = () => 16 / 10
) {
  const preview = document.createElement("div") as HTMLDivElement & { boatyardCleanup?: () => void };
  preview.className = "workspace-layout-preview";
  const slot = document.createElement("div");
  slot.className = "layout-preview-window-slot";
  const windowPreview = document.createElement("div");
  windowPreview.className = "layout-preview-window";
  const aspectRatio = Math.max(0.1, Number(getAspectRatio()) || 1);
  windowPreview.style.aspectRatio = String(aspectRatio);
  const label = document.createElement("span");
  label.className = "layout-preview-window-label";
  label.textContent = `Current window · ${aspectRatio.toFixed(2)}:1`;
  const panes = createPanePreview(layout.paneLayout, isPaneTypeAvailable, getPaneTypeLabel);
  panes.classList.add("layout-preview-window-panes");
  windowPreview.append(label, panes);
  slot.append(windowPreview);
  preview.append(slot);

  const fitPreview = () => {
    const availableWidth = slot.clientWidth;
    const availableHeight = slot.clientHeight;
    if (!availableWidth || !availableHeight) {
      return;
    }
    const width = Math.min(availableWidth, availableHeight * aspectRatio);
    windowPreview.style.width = `${Math.round(width)}px`;
    windowPreview.style.height = `${Math.round(width / aspectRatio)}px`;
  };
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(fitPreview);
    observer.observe(slot);
  }
  requestAnimationFrame(fitPreview);
  preview.boatyardCleanup = () => observer?.disconnect();
  return preview;
}

export function createWorkspaceLayoutPicker({
  confirmLabel = "Apply layout",
  description = "Choose a reusable pane arrangement.",
  getAspectRatio = () => 16 / 10,
  getLayouts,
  getPaneTypeLabel = (paneTypeId) => paneTypeId,
  initialLayoutId = "",
  isPaneTypeAvailable = () => true,
  onConfirm,
  onDelete,
  onSaveAs,
  onUpdate,
  projectScopeAvailable = false,
  title = "Workspace layouts"
}: WorkspaceLayoutPickerOptions) {
  const dialog = document.createElement("dialog");
  dialog.className = "workspace-layout-dialog";
  const panel = document.createElement("div");
  panel.className = "workspace-layout-dialog-panel";

  const header = document.createElement("header");
  header.className = "workspace-layout-dialog-header";
  const heading = document.createElement("div");
  const titleElement = document.createElement("h3");
  titleElement.textContent = title;
  const descriptionElement = document.createElement("p");
  descriptionElement.textContent = description;
  heading.append(titleElement, descriptionElement);
  const closeButton = document.createElement("button");
  closeButton.className = "icon-button";
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Close layout picker");
  closeButton.addEventListener("click", () => dialog.close());
  header.append(heading, closeButton);

  const content = document.createElement("div");
  content.className = "workspace-layout-dialog-content";
  const list = document.createElement("div");
  list.className = "workspace-layout-list";
  list.setAttribute("role", "listbox");
  const detail = document.createElement("div");
  detail.className = "workspace-layout-detail";
  content.append(list, detail);

  const error = document.createElement("p");
  error.className = "form-error";
  error.hidden = true;

  const saveRow = document.createElement("form");
  saveRow.className = "workspace-layout-save-row";
  saveRow.classList.toggle("project-scope", projectScopeAvailable);
  saveRow.hidden = !onSaveAs;
  const nameInput = document.createElement("input");
  nameInput.name = "layoutName";
  nameInput.placeholder = "Layout name, e.g. Development — wide";
  nameInput.setAttribute("aria-label", "New layout name");
  const saveButton = document.createElement("button");
  saveButton.className = "secondary-button";
  saveButton.type = "submit";
  saveButton.textContent = "Save current as new";
  const globalLabel = document.createElement("label");
  globalLabel.className = "switch-row workspace-layout-global-switch";
  const globalCopy = document.createElement("span");
  globalCopy.className = "switch-copy";
  const globalTitle = document.createElement("strong");
  globalTitle.textContent = "Global";
  globalCopy.append(globalTitle);
  const globalSwitch = document.createElement("input");
  globalSwitch.type = "checkbox";
  globalSwitch.name = "global";
  globalSwitch.checked = false;
  globalSwitch.setAttribute("role", "switch");
  const globalTrack = document.createElement("span");
  globalTrack.className = "switch-track";
  globalTrack.setAttribute("aria-hidden", "true");
  globalLabel.append(globalCopy, globalSwitch, globalTrack);
  saveRow.append(nameInput);
  if (projectScopeAvailable) {
    saveRow.append(globalLabel);
  }
  saveRow.append(saveButton);

  const actions = document.createElement("div");
  actions.className = "form-actions workspace-layout-actions";
  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button";
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.hidden = true;
  const updateButton = document.createElement("button");
  updateButton.className = "secondary-button";
  updateButton.type = "button";
  updateButton.textContent = "Update from current";
  updateButton.hidden = true;
  const cancelButton = document.createElement("button");
  cancelButton.className = "secondary-button";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => dialog.close());
  const confirmButton = document.createElement("button");
  confirmButton.className = "primary-button";
  confirmButton.type = "button";
  confirmButton.textContent = confirmLabel;
  actions.append(deleteButton, updateButton, cancelButton, confirmButton);

  panel.append(header, content, error, saveRow, actions);
  dialog.append(panel);

  let layouts: WorkspaceLayout[] = [];
  let selectedLayoutId = initialLayoutId;

  function getSelectedLayout() {
    return layouts.find((layout) => layout.id === selectedLayoutId) || layouts[0] || null;
  }

  function showError(value: unknown) {
    error.textContent = value instanceof Error ? value.message : String(value || "Could not update layouts.");
    error.hidden = false;
  }

  function renderDetail() {
    const previousPreview = detail.querySelector<HTMLElement & { boatyardCleanup?: () => void }>(".workspace-layout-preview");
    previousPreview?.boatyardCleanup?.();
    detail.innerHTML = "";
    const selected = getSelectedLayout();
    confirmButton.disabled = !selected;
    updateButton.hidden = !onUpdate || !selected || selected.builtIn === true;
    deleteButton.hidden = !onDelete || !selected || selected.builtIn === true;
    if (!selected) {
      detail.textContent = "No layout is available.";
      return;
    }
    const detailTitle = document.createElement("h4");
    detailTitle.textContent = selected.name;
    const summary = document.createElement("p");
    const paneCount = countLayoutPanes(selected.paneLayout);
    summary.textContent = `${paneCount} pane${paneCount === 1 ? "" : "s"}`;
    detail.append(detailTitle, summary, createWorkspaceLayoutPreview(
      selected,
      isPaneTypeAvailable,
      getPaneTypeLabel,
      getAspectRatio
    ));
  }

  function renderList() {
    list.innerHTML = "";
    for (const layout of layouts) {
      const button = document.createElement("button");
      button.className = "workspace-layout-list-item";
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(layout.id === selectedLayoutId));
      const name = document.createElement("strong");
      name.textContent = layout.name;
      const meta = document.createElement("span");
      meta.textContent = layout.builtIn
        ? "Built-in · Global"
        : layout.projectId ? "Project" : "Global";
      button.append(name, meta);
      button.addEventListener("click", () => {
        selectedLayoutId = layout.id;
        renderList();
        renderDetail();
      });
      list.append(button);
    }
  }

  async function refresh(preferredId = selectedLayoutId) {
    layouts = await getLayouts();
    selectedLayoutId = layouts.some((layout) => layout.id === preferredId)
      ? preferredId
      : layouts[0]?.id || "";
    renderList();
    renderDetail();
  }

  saveRow.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!onSaveAs || !name) {
      nameInput.focus();
      return;
    }
    error.hidden = true;
    saveButton.disabled = true;
    try {
      const saved = await onSaveAs(
        name,
        resolveWorkspaceLayoutSaveScope(projectScopeAvailable, globalSwitch.checked)
      );
      nameInput.value = "";
      globalSwitch.checked = false;
      await refresh(saved.id);
    } catch (saveError) {
      showError(saveError);
    } finally {
      saveButton.disabled = false;
    }
  });

  updateButton.addEventListener("click", async () => {
    const selected = getSelectedLayout();
    if (!onUpdate || !selected) {
      return;
    }
    error.hidden = true;
    updateButton.disabled = true;
    try {
      const saved = await onUpdate(selected);
      await refresh(saved.id);
    } catch (updateError) {
      showError(updateError);
    } finally {
      updateButton.disabled = false;
    }
  });

  deleteButton.addEventListener("click", async () => {
    const selected = getSelectedLayout();
    if (!onDelete || !selected) {
      return;
    }
    error.hidden = true;
    deleteButton.disabled = true;
    try {
      await onDelete(selected);
      await refresh();
    } catch (deleteError) {
      showError(deleteError);
    } finally {
      deleteButton.disabled = false;
    }
  });

  confirmButton.addEventListener("click", async () => {
    const selected = getSelectedLayout();
    if (!selected) {
      return;
    }
    error.hidden = true;
    confirmButton.disabled = true;
    try {
      await onConfirm(selected);
      dialog.close(selected.id);
    } catch (confirmError) {
      showError(confirmError);
      confirmButton.disabled = false;
    }
  });

  dialog.addEventListener("close", () => {
    const preview = detail.querySelector<HTMLElement & { boatyardCleanup?: () => void }>(".workspace-layout-preview");
    preview?.boatyardCleanup?.();
  }, { once: true });

  return Object.freeze({
    dialog,
    refresh
  });
}
