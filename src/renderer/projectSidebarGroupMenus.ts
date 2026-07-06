type ProjectGroupMenu = HTMLDivElement & {
  cleanup?: () => void;
};

type SidebarGroupProject = {
  id?: string;
  name?: string;
};

type ProjectSidebarGroupMenusOptions = {
  applyFormControl: (control: HTMLElement) => void;
  clamp: (value: number, min: number, max: number) => number;
  createProjectGroupForProject: (project: SidebarGroupProject, groupName: string) => Promise<void>;
  explodeProjectGroup: (groupName: string) => Promise<void>;
  isProjectPinned: (projectId: string) => boolean;
  setProjectPinned: (projectId: string, pinned: boolean) => Promise<void>;
  showOverlayDialog: (dialog: HTMLDialogElement, options: Record<string, unknown>) => Promise<boolean>;
  updateProjectGroupName: (groupName: string, nextGroupName: string) => Promise<void>;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function createDialogShell(titleText: string) {
  const dialog = document.createElement("dialog");
  dialog.className = "plugin-settings-dialog";

  const form = document.createElement("form");
  form.className = "plugin-settings-dialog-panel";

  const header = document.createElement("header");
  header.className = "plugin-settings-dialog-header";

  const title = document.createElement("h3");
  title.textContent = titleText;

  const closeButton = document.createElement("button");
  closeButton.className = "icon-button";
  closeButton.type = "button";
  closeButton.title = "Close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "X";
  closeButton.addEventListener("click", () => dialog.close());
  header.append(title, closeButton);

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  return {
    dialog,
    error,
    form,
    header
  };
}

function createDialogActions(cancelLabel: string, submitLabel: string, danger = false) {
  const actions = document.createElement("div");
  actions.className = "form-actions";

  const cancelButton = document.createElement("button");
  cancelButton.className = "secondary-button";
  cancelButton.type = "button";
  cancelButton.textContent = cancelLabel;

  const submitButton = document.createElement("button");
  submitButton.className = danger ? "danger-button" : "primary-button";
  submitButton.type = "submit";
  submitButton.textContent = submitLabel;

  actions.append(cancelButton, submitButton);
  return {
    actions,
    cancelButton,
    submitButton
  };
}

export function createProjectSidebarGroupMenus({
  applyFormControl,
  clamp,
  createProjectGroupForProject,
  explodeProjectGroup,
  isProjectPinned,
  setProjectPinned,
  showOverlayDialog,
  updateProjectGroupName
}: ProjectSidebarGroupMenusOptions) {
  let openProjectGroupMenu: ProjectGroupMenu | null = null;

  function closeProjectGroupMenu() {
    if (!openProjectGroupMenu) {
      return;
    }

    openProjectGroupMenu.cleanup?.();
    openProjectGroupMenu.remove();
    openProjectGroupMenu = null;
  }

  function openProjectCreateGroupDialog(project: SidebarGroupProject) {
    const { dialog, error, form, header } = createDialogShell("Create group");

    const label = document.createElement("label");
    label.textContent = `Group for ${project.name}`;

    const input = document.createElement("input");
    input.name = "projectGroup";
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = "Group name";
    applyFormControl(input);
    label.append(input);

    const { actions, cancelButton, submitButton } = createDialogActions("Cancel", "Create group");
    cancelButton.addEventListener("click", () => dialog.close());

    form.append(header, label, error, actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      error.hidden = true;
      submitButton.disabled = true;

      try {
        await createProjectGroupForProject(project, input.value);
        dialog.close();
      } catch (createError) {
        error.textContent = getErrorMessage(createError);
        error.hidden = false;
      } finally {
        submitButton.disabled = false;
      }
    });

    dialog.append(form);
    void showOverlayDialog(dialog, {
      freeze: "overlap",
      removeOnClose: true
    }).then((shown) => {
      if (shown) {
        input.focus();
      }
    });
  }

  function openProjectGroupRenameDialog(groupName: string) {
    const { dialog, error, form, header } = createDialogShell("Rename group");

    const label = document.createElement("label");
    label.className = "field";
    const labelText = document.createElement("span");
    labelText.textContent = "Group name";
    const input = document.createElement("input");
    input.name = "projectGroupName";
    input.type = "text";
    input.autocomplete = "off";
    input.required = true;
    input.value = groupName;
    applyFormControl(input);
    label.append(labelText, input);

    const { actions, cancelButton, submitButton } = createDialogActions("Cancel", "Rename");
    cancelButton.addEventListener("click", () => dialog.close());

    form.append(header, label, error, actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      error.hidden = true;
      submitButton.disabled = true;

      try {
        const nextName = input.value.trim();
        if (!nextName) {
          throw new Error("Group name is required.");
        }
        await updateProjectGroupName(groupName, nextName);
        dialog.close();
      } catch (renameError) {
        error.textContent = getErrorMessage(renameError);
        error.hidden = false;
      } finally {
        submitButton.disabled = false;
      }
    });

    dialog.append(form);
    void showOverlayDialog(dialog, {
      freeze: "overlap",
      removeOnClose: true
    }).then((shown) => {
      if (!shown) {
        return;
      }
      input.focus();
      input.select();
    });
  }

  function openProjectGroupExplodeDialog(groupName: string, projects: SidebarGroupProject[]) {
    const { dialog, error, form, header } = createDialogShell("Explode group");
    form.classList.add("danger-zone");

    const confirmation = document.createElement("div");
    confirmation.className = "danger-confirmation";

    const copy = document.createElement("p");
    copy.textContent = `This removes the "${groupName}" group from ${projects.length} ${projects.length === 1 ? "project" : "projects"}. Projects are not deleted.`;
    confirmation.append(copy);

    const { actions, cancelButton, submitButton } = createDialogActions("Cancel", "Explode group", true);
    cancelButton.addEventListener("click", () => dialog.close());

    form.append(header, confirmation, error, actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      error.hidden = true;
      submitButton.disabled = true;
      try {
        await explodeProjectGroup(groupName);
        dialog.close();
      } catch (explodeError) {
        error.textContent = getErrorMessage(explodeError);
        error.hidden = false;
      } finally {
        submitButton.disabled = false;
      }
    });

    dialog.append(form);
    void showOverlayDialog(dialog, {
      freeze: "overlap",
      removeOnClose: true
    }).then((shown) => {
      if (shown) {
        submitButton.focus();
      }
    });
  }

  function createProjectGroupMenu(event: MouseEvent, maxBottomOffset: number) {
    event.preventDefault();
    closeProjectGroupMenu();

    const menu = document.createElement("div") as ProjectGroupMenu;
    menu.className = "webapp-tab-menu project-group-context-menu";
    menu.setAttribute("role", "menu");

    const menuWidth = 220;
    const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
    const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - maxBottomOffset));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    document.body.append(menu);
    openProjectGroupMenu = menu;

    function onPointerDown(pointerEvent: PointerEvent) {
      if (pointerEvent.target instanceof Node && !menu.contains(pointerEvent.target)) {
        closeProjectGroupMenu();
      }
    }

    function onKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") {
        closeProjectGroupMenu();
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

    return menu;
  }

  function openProjectGroupContextMenu(event: MouseEvent, groupName: string, projects: SidebarGroupProject[]) {
    const menu = createProjectGroupMenu(event, 92);

    const renameItem = document.createElement("button");
    renameItem.className = "webapp-tab-menu-item";
    renameItem.type = "button";
    renameItem.setAttribute("role", "menuitem");
    renameItem.textContent = "Rename";
    renameItem.addEventListener("click", () => {
      closeProjectGroupMenu();
      openProjectGroupRenameDialog(groupName);
    });

    const explodeItem = document.createElement("button");
    explodeItem.className = "webapp-tab-menu-item danger";
    explodeItem.type = "button";
    explodeItem.setAttribute("role", "menuitem");
    explodeItem.textContent = "Explode";
    explodeItem.addEventListener("click", () => {
      closeProjectGroupMenu();
      openProjectGroupExplodeDialog(groupName, projects);
    });

    menu.append(renameItem, explodeItem);
    menu.querySelector("button")?.focus();
  }

  function openProjectContextMenu(event: MouseEvent, project: SidebarGroupProject) {
    const menu = createProjectGroupMenu(event, 52);
    const projectId = project.id || "";

    const pinItem = document.createElement("button");
    pinItem.className = "webapp-tab-menu-item";
    pinItem.type = "button";
    pinItem.setAttribute("role", "menuitem");
    pinItem.textContent = isProjectPinned(projectId) ? "Unpin" : "Pin";
    pinItem.disabled = !projectId;
    pinItem.addEventListener("click", () => {
      closeProjectGroupMenu();
      if (projectId) {
        setProjectPinned(projectId, !isProjectPinned(projectId)).catch((error) => {
          console.error("Could not update pinned project:", error);
        });
      }
    });

    const createGroupItem = document.createElement("button");
    createGroupItem.className = "webapp-tab-menu-item";
    createGroupItem.type = "button";
    createGroupItem.setAttribute("role", "menuitem");
    createGroupItem.textContent = "Create group";
    createGroupItem.addEventListener("click", () => {
      closeProjectGroupMenu();
      openProjectCreateGroupDialog(project);
    });

    menu.append(pinItem, createGroupItem);
    menu.querySelector("button")?.focus();
  }

  return Object.freeze({
    closeProjectGroupMenu,
    openProjectContextMenu,
    openProjectCreateGroupDialog,
    openProjectGroupContextMenu,
    openProjectGroupExplodeDialog,
    openProjectGroupRenameDialog
  });
}
