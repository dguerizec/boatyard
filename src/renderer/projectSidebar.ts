"use strict";

(function () {
  type ProjectGroupMenu = HTMLDivElement & {
    cleanup?: () => void;
  };

  type ProjectNavRowOptions = {
    grouped?: boolean;
    groupName?: string;
  };

  type ProjectGroupDragOptions = {
    dragImage?: "collapsed-group";
  };

  type ProjectSidebarGlobal = Window & {
    BoatyardProjectSidebar: {
      create: typeof createProjectSidebar;
    };
  };

  function createProjectSidebar({
    elements,
    getViewState,
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
    updateNavigation,
    updateProject,
    reorderProjectIds,
    renderApp
  }) {
    const {
      addProjectButton,
      globalNav,
      globalNavRow,
      globalViewButton,
      projectCount,
      projectList,
      projectSearchInput
    } = elements;

    let openProjectGroupMenu: ProjectGroupMenu | null = null;
    let projectSearchQuery = "";
    let draggedProjectId = null;
    let draggedProjectGroupName = null;
    let draggedProjectListPointerOffsetY = 0;
    let draggedProjectListGhostHeight = 0;
    let draggedProjectListDragImage = null;
    let projectListInsertionTarget = null;
    let projectListInsertionPlaceholder = null;
    let pendingProjectGroupExpandTimer = null;
    let pendingProjectGroupExpandName = "";
    let pendingProjectGroupCollapseTimer = null;
    let pendingProjectGroupCollapseName = "";
    const autoExpandedProjectGroups = new Set();

    function closeProjectGroupMenu() {
      if (!openProjectGroupMenu) {
        return;
      }

      openProjectGroupMenu.cleanup?.();
      openProjectGroupMenu.remove();
      openProjectGroupMenu = null;
    }

    function createProjectNavRow(project, options: ProjectNavRowOptions = {}) {
      const isActiveProject =
        (getViewState().currentView === "project" || getViewState().currentView === "project-edit") && project.id === getViewState().currentProjectId;
      const row = document.createElement("div");
      row.className = "project-nav-row";
      row.classList.toggle("project-nav-row-grouped", options.grouped === true);
      row.classList.toggle("active", isActiveProject);
      row.draggable = true;
      row.dataset.projectId = project.id;
      row.addEventListener("dragstart", (event) => {
        const rect = row.getBoundingClientRect();
        draggedProjectId = project.id;
        draggedProjectGroupName = null;
        draggedProjectListPointerOffsetY = event.clientY - rect.top;
        draggedProjectListGhostHeight = rect.height;
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", project.id);
      });
      row.addEventListener("dragend", () => {
        draggedProjectId = null;
        draggedProjectGroupName = null;
        draggedProjectListPointerOffsetY = 0;
        draggedProjectListGhostHeight = 0;
        clearProjectListInsertionPlaceholder();
        cancelPendingProjectGroupExpand();
        row.classList.remove("dragging");
        for (const item of projectList.querySelectorAll(".project-nav-row, .project-group-row")) {
          item.classList.remove("drag-over");
        }
      });
      row.addEventListener("dragover", (event) => {
        if (draggedProjectGroupName) {
          return;
        }

        if (options.grouped && draggedProjectId && !draggedProjectGroupName) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          cancelPendingProjectGroupCollapse(options.groupName || "");
          updateProjectGroupInsertionPlaceholder(row.parentElement, event, options.groupName || "");
          return;
        }

        if (!draggedProjectId || draggedProjectId === project.id) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        clearProjectListInsertionPlaceholder();
        cancelPendingProjectGroupExpand();
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });
      row.addEventListener("drop", async (event) => {
        if (draggedProjectGroupName) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        row.classList.remove("drag-over");

        if (options.grouped && draggedProjectId && !draggedProjectGroupName) {
          const target = projectListInsertionTarget;
          clearProjectListInsertionPlaceholder();
          await moveProjectToGroupInsertion(
            draggedProjectId || event.dataTransfer.getData("text/plain"),
            options.groupName || "",
            target?.beforeProjectId || project.id
          );
          return;
        }

        const sourceId = event.dataTransfer.getData("text/plain") || draggedProjectId;
        if (!sourceId || sourceId === project.id) {
          return;
        }
        await moveProjectBeforeProject(sourceId, project.id);
      });
      row.addEventListener("contextmenu", (event) => {
        openProjectContextMenu(event, project);
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

      return row;
    }

    function getProjectListBlocks() {
      return [...projectList.children].filter((element) =>
        element !== projectListInsertionPlaceholder &&
        (
          element.classList.contains("project-nav-row") ||
          element.classList.contains("project-group-row") ||
          element.classList.contains("project-group-expanded")
        )
      );
    }

    function getFirstProjectIdForProjectListBlock(block) {
      if (!block) {
        return null;
      }

      if (block.classList.contains("project-nav-row")) {
        return block.dataset.projectId || null;
      }

      const groupName = block.dataset.projectGroup || "";
      return getProjects().find((project) => String(project.group || "").trim() === groupName)?.id || null;
    }

    function getProjectListInsertionTarget(clientY) {
      const blocks = getProjectListBlocks();

      for (const block of blocks) {
        const rect = block.getBoundingClientRect();
        if (clientY < rect.top + (rect.height / 2)) {
          return {
            beforeNode: block,
            beforeProjectId: getFirstProjectIdForProjectListBlock(block)
          };
        }
      }

      return {
        beforeNode: null,
        beforeProjectId: null
      };
    }

    function getProjectGroupInsertionTarget(container, clientY, groupName) {
      const rows = [...container.children].filter((element) =>
        element !== projectListInsertionPlaceholder &&
        element.classList.contains("project-nav-row")
      );

      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (clientY < rect.top + (rect.height / 2)) {
          return {
            beforeNode: row,
            beforeProjectId: row.dataset.projectId || null,
            groupName
          };
        }
      }

      return {
        beforeNode: null,
        beforeProjectId: null,
        groupName
      };
    }

    function getProjectListDragReferenceY(event) {
      if (!draggedProjectListGhostHeight) {
        return event.clientY;
      }

      return event.clientY - draggedProjectListPointerOffsetY + (draggedProjectListGhostHeight / 2);
    }

    function ensureProjectListInsertionPlaceholder() {
      if (projectListInsertionPlaceholder) {
        return projectListInsertionPlaceholder;
      }

      const placeholder = document.createElement("div");
      placeholder.className = "project-list-insertion-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      placeholder.addEventListener("drop", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = projectListInsertionTarget;
        clearProjectListInsertionPlaceholder();

        if (!target) {
          return;
        }

        if (draggedProjectGroupName) {
          await reorderProjectGroupBeforeProject(draggedProjectGroupName, target.beforeProjectId);
          return;
        }

        const sourceId = draggedProjectId || event.dataTransfer.getData("text/plain");
        if (!sourceId) {
          return;
        }
        if (target.groupName) {
          await moveProjectToGroupInsertion(sourceId, target.groupName, target.beforeProjectId);
          return;
        }
        await moveProjectToUngroupedInsertion(sourceId, target.beforeProjectId);
      });
      projectListInsertionPlaceholder = placeholder;
      return placeholder;
    }

    function updateProjectListInsertionPlaceholder(event) {
      if (!draggedProjectId && !draggedProjectGroupName) {
        clearProjectListInsertionPlaceholder();
        return;
      }

      projectListInsertionTarget = getProjectListInsertionTarget(getProjectListDragReferenceY(event));
      const placeholder = ensureProjectListInsertionPlaceholder();
      projectList.insertBefore(placeholder, projectListInsertionTarget.beforeNode);
    }

    function updateProjectGroupInsertionPlaceholder(container, event, groupName) {
      if (!draggedProjectId || draggedProjectGroupName || !container) {
        clearProjectListInsertionPlaceholder();
        return;
      }

      projectListInsertionTarget = getProjectGroupInsertionTarget(container, getProjectListDragReferenceY(event), groupName);
      const placeholder = ensureProjectListInsertionPlaceholder();
      container.insertBefore(placeholder, projectListInsertionTarget.beforeNode);
    }

    function clearProjectListInsertionPlaceholder() {
      projectListInsertionTarget = null;
      projectListInsertionPlaceholder?.remove();
      projectListInsertionPlaceholder = null;
    }

    function appendGroupedProjectBadges(projects, container) {
      const priority = new Map([
        ["input", 3],
        ["working", 2],
        ["done", 1]
      ]);
      const badgeSummaries = new Map();

      for (const project of projects) {
        const scratch = document.createElement("div");
        renderProjectNavBadges(project, scratch, { isActiveProject: false });
        for (const badge of scratch.querySelectorAll<HTMLElement>(".project-nav-badge")) {
          const stateName = [...badge.classList].find((className) => priority.has(className)) || "";
          const key = stateName || badge.textContent || badge.className;
          const summary = badgeSummaries.get(key) || {
            className: badge.className,
            text: badge.textContent,
            titles: [],
            stateName,
            priority: priority.get(stateName) || 0,
            count: 0
          };
          summary.count += 1;
          if (badge.title || badge.textContent) {
            summary.titles.push(badge.title || badge.textContent);
          }
          badgeSummaries.set(key, summary);
        }
      }

      if (!badgeSummaries.size) {
        return;
      }

      const summaries = [...badgeSummaries.values()]
        .sort((left, right) => right.priority - left.priority || left.text.localeCompare(right.text));

      for (const summary of summaries) {
        const badge = document.createElement("span");
        badge.className = summary.className;
        badge.textContent = summary.count > 1 ? `${summary.text} ${summary.count}` : summary.text;
        badge.title = summary.titles.join("\n");
        container.append(badge);
      }
    }

    async function setProjectGroupCollapsed(groupName, collapsed) {
      const collapsedGroups = getCollapsedProjectGroups();
      if (collapsed) {
        collapsedGroups.add(groupName);
        autoExpandedProjectGroups.delete(groupName);
      } else {
        collapsedGroups.delete(groupName);
      }

      await updateNavigation({
        view: getViewState().currentView,
        projectId: getViewState().currentProjectId,
        collapsedProjectGroups: [...collapsedGroups]
      });
      renderProjectList();
    }

    function cancelPendingProjectGroupExpand() {
      if (pendingProjectGroupExpandTimer) {
        clearTimeout(pendingProjectGroupExpandTimer);
      }
      pendingProjectGroupExpandTimer = null;
      pendingProjectGroupExpandName = "";
    }

    function cancelPendingProjectGroupCollapse(groupName = "") {
      if (groupName && pendingProjectGroupCollapseName && pendingProjectGroupCollapseName !== groupName) {
        return;
      }

      if (pendingProjectGroupCollapseTimer) {
        clearTimeout(pendingProjectGroupCollapseTimer);
      }
      pendingProjectGroupCollapseTimer = null;
      pendingProjectGroupCollapseName = "";
    }

    function scheduleProjectGroupExpand(groupName) {
      if (!draggedProjectId || draggedProjectGroupName || !getCollapsedProjectGroups().has(groupName)) {
        return;
      }

      if (pendingProjectGroupExpandName === groupName) {
        return;
      }

      cancelPendingProjectGroupExpand();
      pendingProjectGroupExpandName = groupName;
      pendingProjectGroupExpandTimer = setTimeout(() => {
        const targetGroupName = pendingProjectGroupExpandName;
        cancelPendingProjectGroupExpand();
        if (!draggedProjectId || !targetGroupName || !getCollapsedProjectGroups().has(targetGroupName)) {
          return;
        }
        autoExpandedProjectGroups.add(targetGroupName);
        setProjectGroupCollapsed(targetGroupName, false).catch((error) => {
          console.error("Could not expand project group:", error);
        });
      }, 2000);
    }

    function scheduleProjectGroupCollapse(groupName) {
      if (!autoExpandedProjectGroups.has(groupName) || getCollapsedProjectGroups().has(groupName)) {
        return;
      }

      if (pendingProjectGroupCollapseName === groupName) {
        return;
      }

      cancelPendingProjectGroupCollapse();
      pendingProjectGroupCollapseName = groupName;
      pendingProjectGroupCollapseTimer = setTimeout(() => {
        const targetGroupName = pendingProjectGroupCollapseName;
        cancelPendingProjectGroupCollapse();
        if (!targetGroupName || !autoExpandedProjectGroups.has(targetGroupName) || getCollapsedProjectGroups().has(targetGroupName)) {
          return;
        }
        setProjectGroupCollapsed(targetGroupName, true).catch((error) => {
          console.error("Could not collapse project group:", error);
        });
      }, 2000);
    }

    function createProjectGroupRow(groupName, projects, collapsed) {
      const hasActiveProject = projects.some((project) =>
        (getViewState().currentView === "project" || getViewState().currentView === "project-edit") && project.id === getViewState().currentProjectId
      );
      const row = document.createElement("div");
      row.className = "project-group-row";
      row.classList.toggle("collapsed", collapsed);
      row.classList.toggle("active", hasActiveProject);
      row.draggable = true;
      row.dataset.projectGroup = groupName;
      attachProjectGroupDragHandlers(row, groupName, projects);
      row.addEventListener("contextmenu", (event) => {
        openProjectGroupContextMenu(event, groupName, projects);
      });

      const button = document.createElement("button");
      button.className = "project-group-button nav-item";
      button.type = "button";
      button.classList.toggle("active", hasActiveProject);
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");

      const titleRow = document.createElement("div");
      titleRow.className = "project-nav-title";

      const chevron = document.createElement("span");
      chevron.className = "project-group-chevron";
      chevron.textContent = collapsed ? ">" : "v";
      chevron.setAttribute("aria-hidden", "true");

      const groupLabel = document.createElement("span");
      groupLabel.className = "project-nav-name";
      groupLabel.textContent = groupName;

      titleRow.append(chevron, groupLabel);
      if (collapsed) {
        appendGroupedProjectBadges(projects, titleRow);
      }

      const groupSummary = document.createElement("small");
      groupSummary.textContent = `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;

      button.append(titleRow, groupSummary);
      button.addEventListener("click", () => {
        setProjectGroupCollapsed(groupName, !collapsed).catch((error) => {
          console.error("Could not update project group collapse state:", error);
        });
      });
      row.append(button);
      return row;
    }

    function createProjectGroupDragImage(groupName, projects) {
      const row = document.createElement("div");
      row.className = "project-group-row project-group-drag-image collapsed";
      row.style.width = `${projectList.getBoundingClientRect().width}px`;

      const button = document.createElement("div");
      button.className = "project-group-button nav-item";

      const titleRow = document.createElement("div");
      titleRow.className = "project-nav-title";

      const chevron = document.createElement("span");
      chevron.className = "project-group-chevron";
      chevron.textContent = ">";
      chevron.setAttribute("aria-hidden", "true");

      const groupLabel = document.createElement("span");
      groupLabel.className = "project-nav-name";
      groupLabel.textContent = groupName;

      titleRow.append(chevron, groupLabel);
      appendGroupedProjectBadges(projects, titleRow);

      const groupSummary = document.createElement("small");
      groupSummary.textContent = `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;

      button.append(titleRow, groupSummary);
      row.append(button);
      return row;
    }

    function clearProjectListDragImage() {
      draggedProjectListDragImage?.remove();
      draggedProjectListDragImage = null;
    }

    async function updateProjectGroupName(groupName, nextGroupName) {
      const currentGroup = String(groupName || "").trim();
      const nextGroup = String(nextGroupName || "").trim();

      if (!currentGroup || !nextGroup || currentGroup === nextGroup) {
        return;
      }

      const projects = getProjects().filter((project) => String(project.group || "").trim() === currentGroup);
      for (const project of projects) {
        await updateProject(project.id, {
          group: nextGroup
        });
      }

      const collapsedGroups = getCollapsedProjectGroups();
      if (collapsedGroups.delete(currentGroup)) {
        collapsedGroups.add(nextGroup);
        await updateNavigation({
          view: getViewState().currentView,
          projectId: getViewState().currentProjectId,
          collapsedProjectGroups: [...collapsedGroups]
        });
      }

      renderApp();
    }

    async function explodeProjectGroup(groupName) {
      const currentGroup = String(groupName || "").trim();
      if (!currentGroup) {
        return;
      }

      const projects = getProjects().filter((project) => String(project.group || "").trim() === currentGroup);
      for (const project of projects) {
        await updateProject(project.id, {
          group: ""
        });
      }

      const collapsedGroups = getCollapsedProjectGroups();
      if (collapsedGroups.delete(currentGroup)) {
        await updateNavigation({
          view: getViewState().currentView,
          projectId: getViewState().currentProjectId,
          collapsedProjectGroups: [...collapsedGroups]
        });
      }

      renderApp();
    }

    async function createProjectGroupForProject(project, groupName) {
      const nextGroup = String(groupName || "").trim();
      if (!project || !nextGroup) {
        throw new Error("Group name is required.");
      }

      if (getProjectGroups().includes(nextGroup)) {
        throw new Error("This group already exists.");
      }

      await updateProject(project.id, {
        group: nextGroup
      });
      renderApp();
    }

    function openProjectCreateGroupDialog(project) {
      const dialog = document.createElement("dialog");
      dialog.className = "plugin-settings-dialog";

      const form = document.createElement("form");
      form.className = "plugin-settings-dialog-panel";

      const header = document.createElement("header");
      header.className = "plugin-settings-dialog-header";

      const title = document.createElement("h3");
      title.textContent = "Create group";

      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = "Close";
      closeButton.setAttribute("aria-label", "Close");
      closeButton.textContent = "X";
      closeButton.addEventListener("click", () => dialog.close());
      header.append(title, closeButton);

      const label = document.createElement("label");
      label.textContent = `Group for ${project.name}`;

      const input = document.createElement("input");
      input.name = "projectGroup";
      input.type = "text";
      input.autocomplete = "off";
      input.placeholder = "Group name";
      applyFormControl(input);
      label.append(input);

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
      cancelButton.addEventListener("click", () => dialog.close());

      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Create group";

      actions.append(cancelButton, submitButton);
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
          error.textContent = createError.message;
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
      });
    }

    function openProjectGroupRenameDialog(groupName) {
      const dialog = document.createElement("dialog");
      dialog.className = "plugin-settings-dialog";

      const form = document.createElement("form");
      form.className = "plugin-settings-dialog-panel";

      const header = document.createElement("header");
      header.className = "plugin-settings-dialog-header";

      const title = document.createElement("h3");
      title.textContent = "Rename group";

      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = "Close";
      closeButton.setAttribute("aria-label", "Close");
      closeButton.textContent = "X";
      closeButton.addEventListener("click", () => dialog.close());
      header.append(title, closeButton);

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
      cancelButton.addEventListener("click", () => dialog.close());

      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Rename";

      actions.append(cancelButton, submitButton);
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
          error.textContent = renameError.message;
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

    function openProjectGroupExplodeDialog(groupName, projects) {
      const dialog = document.createElement("dialog");
      dialog.className = "plugin-settings-dialog";

      const form = document.createElement("form");
      form.className = "plugin-settings-dialog-panel danger-zone";

      const header = document.createElement("header");
      header.className = "plugin-settings-dialog-header";

      const title = document.createElement("h3");
      title.textContent = "Explode group";

      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = "Close";
      closeButton.setAttribute("aria-label", "Close");
      closeButton.textContent = "X";
      closeButton.addEventListener("click", () => dialog.close());
      header.append(title, closeButton);

      const confirmation = document.createElement("div");
      confirmation.className = "danger-confirmation";

      const copy = document.createElement("p");
      copy.textContent = `This removes the "${groupName}" group from ${projects.length} ${projects.length === 1 ? "project" : "projects"}. Projects are not deleted.`;
      confirmation.append(copy);

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
      cancelButton.addEventListener("click", () => dialog.close());

      const submitButton = document.createElement("button");
      submitButton.className = "danger-button";
      submitButton.type = "submit";
      submitButton.textContent = "Explode group";

      actions.append(cancelButton, submitButton);
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
          error.textContent = explodeError.message;
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
        submitButton.focus();
      });
    }

    function openProjectGroupContextMenu(event, groupName, projects) {
      event.preventDefault();
      closeProjectGroupMenu();

      const menu = document.createElement("div") as ProjectGroupMenu;
      menu.className = "webapp-tab-menu project-group-context-menu";
      menu.setAttribute("role", "menu");

      const menuWidth = 220;
      const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
      const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 92));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;

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
      document.body.append(menu);
      openProjectGroupMenu = menu;

      function onPointerDown(pointerEvent) {
        if (!menu.contains(pointerEvent.target as Node)) {
          closeProjectGroupMenu();
        }
      }

      function onKeyDown(keyEvent) {
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

      menu.querySelector("button")?.focus();
    }

    function openProjectContextMenu(event, project) {
      event.preventDefault();
      closeProjectGroupMenu();

      const menu = document.createElement("div") as ProjectGroupMenu;
      menu.className = "webapp-tab-menu project-group-context-menu";
      menu.setAttribute("role", "menu");

      const menuWidth = 220;
      const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
      const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 52));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;

      const createGroupItem = document.createElement("button");
      createGroupItem.className = "webapp-tab-menu-item";
      createGroupItem.type = "button";
      createGroupItem.setAttribute("role", "menuitem");
      createGroupItem.textContent = "Create group";
      createGroupItem.addEventListener("click", () => {
        closeProjectGroupMenu();
        openProjectCreateGroupDialog(project);
      });

      menu.append(createGroupItem);
      document.body.append(menu);
      openProjectGroupMenu = menu;

      function onPointerDown(pointerEvent) {
        if (!menu.contains(pointerEvent.target as Node)) {
          closeProjectGroupMenu();
        }
      }

      function onKeyDown(keyEvent) {
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

      menu.querySelector("button")?.focus();
    }

    function attachProjectGroupDragHandlers(element, groupName, projects, options: ProjectGroupDragOptions = {}) {
      element.addEventListener("dragstart", (event) => {
        const rect = element.getBoundingClientRect();
        clearProjectListDragImage();
        draggedProjectId = null;
        draggedProjectGroupName = groupName;
        draggedProjectListPointerOffsetY = event.clientY - rect.top;
        draggedProjectListGhostHeight = rect.height;
        if (options.dragImage === "collapsed-group" && event.dataTransfer) {
          const dragImage = createProjectGroupDragImage(groupName, projects);
          document.body.append(dragImage);
          const dragImageRect = dragImage.getBoundingClientRect();
          const offsetY = dragImageRect.height / 2;
          draggedProjectListPointerOffsetY = offsetY;
          draggedProjectListGhostHeight = dragImageRect.height;
          event.dataTransfer.setDragImage(dragImage, Math.min(24, dragImageRect.width / 2), offsetY);
          draggedProjectListDragImage = dragImage;
        }
        element.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `group:${groupName}`);
      });
      element.addEventListener("dragend", () => {
        draggedProjectId = null;
        draggedProjectGroupName = null;
        draggedProjectListPointerOffsetY = 0;
        draggedProjectListGhostHeight = 0;
        clearProjectListDragImage();
        clearProjectListInsertionPlaceholder();
        cancelPendingProjectGroupExpand();
        cancelPendingProjectGroupCollapse();
        element.classList.remove("dragging");
        for (const item of projectList.querySelectorAll(".project-nav-row, .project-group-row, .project-group-expanded")) {
          item.classList.remove("drag-over");
        }
      });
      element.addEventListener("dragover", (event) => {
        if (draggedProjectGroupName) {
          return;
        }

        if (!draggedProjectId || projects.some((project) => project.id === draggedProjectId)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        clearProjectListInsertionPlaceholder();
        cancelPendingProjectGroupCollapse(groupName);
        scheduleProjectGroupExpand(groupName);
        element.classList.add("drag-over");
      });
      element.addEventListener("dragleave", () => {
        if (pendingProjectGroupExpandName === groupName) {
          cancelPendingProjectGroupExpand();
        }
        element.classList.remove("drag-over");
      });
      element.addEventListener("drop", async (event) => {
        if (draggedProjectGroupName) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        element.classList.remove("drag-over");
        cancelPendingProjectGroupExpand();
        cancelPendingProjectGroupCollapse();

        const sourceId = draggedProjectId || event.dataTransfer.getData("text/plain");
        if (!sourceId || projects.some((project) => project.id === sourceId)) {
          return;
        }
        await moveProjectToGroup(sourceId, groupName);
      });
    }

    function createExpandedProjectGroup(groupName, projects) {
      const group = document.createElement("div");
      group.className = "project-group-expanded";
      group.dataset.projectGroup = groupName;
      group.addEventListener("dragover", (event) => {
        if (draggedProjectGroupName) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          clearProjectListInsertionPlaceholder();
          return;
        }

        if (!draggedProjectId || draggedProjectGroupName) {
          return;
        }

        cancelPendingProjectGroupCollapse(groupName);
      });
      group.addEventListener("dragleave", (event) => {
        if (group.contains(event.relatedTarget as Node | null)) {
          return;
        }

        scheduleProjectGroupCollapse(groupName);
      });

      const rail = document.createElement("button");
      rail.className = "project-group-rail";
      rail.type = "button";
      rail.draggable = true;
      rail.title = `Collapse ${groupName}`;
      rail.setAttribute("aria-label", `Collapse ${groupName} group`);
      rail.addEventListener("click", () => {
        setProjectGroupCollapsed(groupName, true).catch((error) => {
          console.error("Could not update project group collapse state:", error);
        });
      });
      rail.addEventListener("contextmenu", (event) => {
        openProjectGroupContextMenu(event, groupName, projects);
      });
      attachProjectGroupDragHandlers(rail, groupName, projects, { dragImage: "collapsed-group" });

      const projectRows = document.createElement("div");
      projectRows.className = "project-group-projects";
      projectRows.addEventListener("dragover", (event) => {
        if (!draggedProjectId || draggedProjectGroupName) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        cancelPendingProjectGroupCollapse(groupName);
        updateProjectGroupInsertionPlaceholder(projectRows, event, groupName);
      });
      projectRows.addEventListener("dragleave", (event) => {
        if (projectRows.contains(event.relatedTarget as Node | null)) {
          return;
        }

        clearProjectListInsertionPlaceholder();
      });
      projectRows.addEventListener("drop", async (event) => {
        if (!projectListInsertionTarget) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        cancelPendingProjectGroupCollapse(groupName);
        const target = projectListInsertionTarget;
        clearProjectListInsertionPlaceholder();

        const sourceId = draggedProjectId || event.dataTransfer.getData("text/plain");
        if (!sourceId) {
          return;
        }
        await moveProjectToGroupInsertion(sourceId, groupName, target.beforeProjectId);
      });
      for (const groupedProject of projects) {
        projectRows.append(createProjectNavRow(groupedProject, { grouped: true, groupName }));
      }

      group.append(rail, projectRows);
      return group;
    }

    function renderProjectList() {
      renderSidebarUpdateNotice();

      const projects = getProjects();
      const query = normalizeProjectSearchText(projectSearchQuery);
      const visibleProjects = query
        ? projects.filter((project) => projectMatchesSearch(project, query))
        : projects;
      const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
      projectCount.textContent = query ? `${visibleProjects.length} / ${projects.length}` : String(projects.length);
      projectList.innerHTML = "";

      globalNav.classList.toggle("active", getViewState().currentView === "global" || getViewState().currentView === "global-settings");
      globalNavRow.classList.toggle("active", getViewState().currentView === "global" || getViewState().currentView === "global-settings");
      globalViewButton.classList.toggle("active", getViewState().currentView === "global");
      addProjectButton.classList.toggle("active", getViewState().currentView === "project-create");

      if (projects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-copy";
        empty.textContent = "No projects configured yet.";
        projectList.append(empty);
        if (isOnboardingDemoProjectVisible()) {
          ensureOnboardingDemoProject();
        }
        return;
      }

      if (visibleProjects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-copy";
        empty.textContent = "No projects match this search.";
        projectList.append(empty);
        return;
      }

      const groups = getProjectGroupsByName(visibleProjects);
      const renderedGroups = new Set();
      const collapsedGroups = getCollapsedProjectGroups();

      for (const project of projects) {
        if (!visibleProjectIds.has(project.id)) {
          continue;
        }

        const groupName = String(project.group || "").trim();
        const groupProjects = groupName ? groups.get(groupName) || [] : [];

        if (groupName && groupProjects.length > 0) {
          if (renderedGroups.has(groupName)) {
            continue;
          }

          renderedGroups.add(groupName);
          const collapsed = collapsedGroups.has(groupName);
          projectList.append(collapsed
            ? createProjectGroupRow(groupName, groupProjects, collapsed)
            : createExpandedProjectGroup(groupName, groupProjects));
          continue;
        }

        projectList.append(createProjectNavRow(project));
      }

      if (isOnboardingDemoProjectVisible()) {
        ensureOnboardingDemoProject();
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
      await reorderProjectIds(reordered.map((project) => project.id));
      renderApp();
    }

    async function moveProjectBeforeProject(sourceId, targetId) {
      const projects = getProjects();
      const source = projects.find((project) => project.id === sourceId);
      const target = projects.find((project) => project.id === targetId);

      if (!source || !target || source.id === target.id) {
        return;
      }

      const targetGroup = String(target.group || "").trim();
      if (String(source.group || "").trim() !== targetGroup) {
        await updateProject(source.id, {
          group: targetGroup
        });
      }

      await reorderProjects(source.id, target.id);
    }

    async function moveProjectToGroup(sourceId, targetGroupName) {
      const groupName = String(targetGroupName || "").trim();
      const projects = getProjects();
      const source = projects.find((project) => project.id === sourceId);
      const groupProjects = projects.filter((project) => String(project.group || "").trim() === groupName);

      if (!source || !groupName || groupProjects.some((project) => project.id === source.id)) {
        return;
      }

      await updateProject(source.id, {
        group: groupName
      });

      const updatedProjects = getProjects();
      const updatedGroupProjects = updatedProjects.filter((project) => String(project.group || "").trim() === groupName);
      const lastGroupProject = updatedGroupProjects.at(-1);
      if (!lastGroupProject || lastGroupProject.id === source.id) {
        renderApp();
        return;
      }

      const remaining = updatedProjects.filter((project) => project.id !== source.id);
      const targetIndex = remaining.findIndex((project) => project.id === lastGroupProject.id);
      if (targetIndex === -1) {
        renderApp();
        return;
      }

      const reordered = [...remaining];
      reordered.splice(targetIndex + 1, 0, source);
      await reorderProjectIds(reordered.map((project) => project.id));
      renderApp();
    }

    async function moveProjectToGroupInsertion(sourceId, targetGroupName, beforeProjectId = null) {
      const groupName = String(targetGroupName || "").trim();
      const projects = getProjects();
      const source = projects.find((project) => project.id === sourceId);

      if (!source || !groupName) {
        return;
      }

      if (String(source.group || "").trim() !== groupName) {
        await updateProject(source.id, {
          group: groupName
        });
      }

      const updatedProjects = getProjects();
      const remaining = updatedProjects.filter((project) => project.id !== source.id);
      const groupProjects = remaining.filter((project) => String(project.group || "").trim() === groupName);
      const fallbackProjectId = groupProjects.at(-1)?.id || null;
      const insertionProjectId = beforeProjectId || fallbackProjectId;
      const targetIndex = insertionProjectId
        ? remaining.findIndex((project) => project.id === insertionProjectId)
        : remaining.length;

      if (targetIndex < 0) {
        renderApp();
        return;
      }

      const reordered = [...remaining];
      reordered.splice(beforeProjectId ? targetIndex : targetIndex + 1, 0, source);
      await reorderProjectIds(reordered.map((project) => project.id));
      renderApp();
    }

    async function moveProjectToUngroupedInsertion(sourceId, beforeProjectId = null) {
      const projects = getProjects();
      const source = projects.find((project) => project.id === sourceId);

      if (!source) {
        return;
      }

      if (String(source.group || "").trim()) {
        await updateProject(source.id, {
          group: ""
        });
      }

      const updatedProjects = getProjects();
      const remaining = updatedProjects.filter((project) => project.id !== source.id);
      const targetIndex = beforeProjectId
        ? remaining.findIndex((project) => project.id === beforeProjectId)
        : remaining.length;

      if (targetIndex < 0) {
        renderApp();
        return;
      }

      const reordered = [...remaining];
      reordered.splice(targetIndex, 0, source);
      await reorderProjectIds(reordered.map((project) => project.id));
      renderApp();
    }

    async function reorderProjectGroup(sourceGroupName, targetIndexResolver) {
      const groupName = String(sourceGroupName || "").trim();
      if (!groupName) {
        return;
      }

      const projects = getProjects();
      const moved = projects.filter((project) => String(project.group || "").trim() === groupName);
      if (!moved.length) {
        return;
      }

      const remaining = projects.filter((project) => String(project.group || "").trim() !== groupName);
      const targetIndex = targetIndexResolver(remaining);
      if (targetIndex < 0) {
        return;
      }

      const reordered = [...remaining];
      reordered.splice(targetIndex, 0, ...moved);
      await reorderProjectIds(reordered.map((project) => project.id));
      renderApp();
    }

    async function reorderProjectGroupBeforeProject(sourceGroupName, targetProjectId) {
      if (!targetProjectId) {
        await reorderProjectGroup(sourceGroupName, (projects) => projects.length);
        return;
      }

      await reorderProjectGroup(sourceGroupName, (projects) =>
        projects.findIndex((project) => project.id === targetProjectId)
      );
    }

    async function reorderProjectGroupBeforeGroup(sourceGroupName, targetGroupName) {
      if (sourceGroupName === targetGroupName) {
        return;
      }

      await reorderProjectGroup(sourceGroupName, (projects) =>
        projects.findIndex((project) => String(project.group || "").trim() === targetGroupName)
      );
    }

    function bindProjectSidebarEvents() {
      projectList.addEventListener("dragover", (event) => {
        if (!draggedProjectId && !draggedProjectGroupName) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        updateProjectListInsertionPlaceholder(event);
      });

      projectList.addEventListener("dragleave", (event) => {
        if (projectList.contains(event.relatedTarget)) {
          return;
        }

        clearProjectListInsertionPlaceholder();
      });

      projectList.addEventListener("drop", async (event) => {
        if (!projectListInsertionTarget) {
          return;
        }

        event.preventDefault();
        const target = projectListInsertionTarget;
        clearProjectListInsertionPlaceholder();

        if (draggedProjectGroupName) {
          await reorderProjectGroupBeforeProject(draggedProjectGroupName, target.beforeProjectId);
          return;
        }

        const sourceId = draggedProjectId || event.dataTransfer.getData("text/plain");
        if (!sourceId) {
          return;
        }
        if (target.groupName) {
          await moveProjectToGroupInsertion(sourceId, target.groupName, target.beforeProjectId);
          return;
        }
        await moveProjectToUngroupedInsertion(sourceId, target.beforeProjectId);
      });

      projectSearchInput.addEventListener("input", () => {
        projectSearchQuery = projectSearchInput.value;
        renderProjectList();
      });
      projectSearchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !projectSearchInput.value) {
          return;
        }

        event.preventDefault();
        projectSearchInput.value = "";
        projectSearchQuery = "";
        renderProjectList();
      });
    }

    bindProjectSidebarEvents();

    return {
      closeProjectGroupMenu,
      renderProjectList
    };
  }

  (window as unknown as ProjectSidebarGlobal).BoatyardProjectSidebar = {
    create: createProjectSidebar
  };
})();
