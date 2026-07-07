import { createProjectSidebarGroupMenus } from "./projectSidebarGroupMenus.js";
import { createProjectSidebarGroupRows } from "./projectSidebarGroupRows.js";
import { createProjectSidebarReorderActions } from "./projectSidebarReorderActions.js";
import type { RendererProject } from "./rendererTypes.js";
import type {
  ProjectGroupDragOptions,
  ProjectListInsertionTarget,
  ProjectNavRowOptions,
  ProjectSidebarOptions
} from "./projectSidebarTypes.js";

export function createProjectSidebar({
    elements,
    getViewState,
    getProjects,
    getProjectGroups,
    getProjectGroupsByName,
    getCollapsedProjectGroups,
    getPinnedProjectIds,
    isSidebarCollapsed,
    freezeWebAppsForRect,
    queueWebAppSync,
    restoreWebAppsAfterOverlay,
    normalizeProjectSearchText,
    projectMatchesSearch,
    renderSidebarUpdateNotice,
    renderProjectNavBadges,
    selectProject,
    selectEditProject,
    clamp,
    applyFormControl,
    showOverlayDialog,
    isOnboardingDemoProjectVisible,
    ensureOnboardingDemoProject,
    updateNavigation,
    updateProject,
    reorderProjectIds,
    renderApp
  }: ProjectSidebarOptions) {
    const {
      addProjectButton,
      globalNav,
      globalNavRow,
      globalViewButton,
      pinnedProjects,
      projectCount,
      projectList,
      projectSearchInput,
      sidebarRail,
      sidebarToggleButton
    } = elements;

    let projectSearchQuery = "";
    let draggedProjectId: string | null = null;
    let draggedProjectGroupName: string | null = null;
    let draggedProjectListPointerOffsetY = 0;
    let draggedProjectListGhostHeight = 0;
    let draggedProjectListDragImage: HTMLElement | null = null;
    let projectListInsertionTarget: ProjectListInsertionTarget | null = null;
    let projectListInsertionPlaceholder: HTMLElement | null = null;
    let pendingProjectGroupExpandTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingProjectGroupExpandName = "";
    let pendingProjectGroupCollapseTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingProjectGroupCollapseName = "";
    let sidebarOverlayCloseTimer: ReturnType<typeof setTimeout> | null = null;
    let sidebarOverlayFreezeRequest = 0;
    let sidebarOverlayOpening = false;
    let sidebarOverlayPointer: { x: number; y: number } | null = null;
    const autoExpandedProjectGroups = new Set<string>();
    const {
      moveProjectBeforeProject,
      moveProjectToGroup,
      moveProjectToGroupInsertion,
      moveProjectToUngroupedInsertion,
      reorderProjectGroupBeforeProject
    } = createProjectSidebarReorderActions({
      getProjects,
      renderApp,
      reorderProjectIds,
      updateProject
    });
    const {
      closeProjectGroupMenu,
      openProjectContextMenu,
      openProjectGroupContextMenu,
    } = createProjectSidebarGroupMenus({
      applyFormControl,
      clamp,
      createProjectGroupForProject,
      explodeProjectGroup,
      isProjectPinned,
      setProjectPinned,
      showOverlayDialog,
      updateProjectGroupName
    });
    const {
      createProjectGroupDragImage,
      createProjectGroupRow
    } = createProjectSidebarGroupRows({
      attachProjectGroupDragHandlers,
      getProjectListWidth: () => projectList.getBoundingClientRect().width,
      getViewState,
      openProjectGroupContextMenu,
      renderProjectNavBadges,
      setProjectGroupCollapsed
    });

    function isProjectListElement(element: Element): element is HTMLElement {
      return element instanceof HTMLElement;
    }

    function getNavigationUpdateBase() {
      return {
        view: getViewState().currentView,
        projectId: getViewState().currentProjectId,
        collapsedProjectGroups: [...getCollapsedProjectGroups()],
        pinnedProjectIds: getPinnedProjectIds(),
        sidebarCollapsed: isSidebarCollapsed()
      };
    }

    function applySidebarCollapsedState() {
      const collapsed = isSidebarCollapsed();
      document.body.classList.toggle("sidebar-collapsed", collapsed);
      sidebarToggleButton.classList.toggle("active", collapsed);
      sidebarToggleButton.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
      sidebarToggleButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      queueWebAppSync();
      if (!collapsed) {
        closeSidebarOverlay();
      }
    }

    async function setSidebarCollapsed(collapsed: boolean) {
      await updateNavigation({
        ...getNavigationUpdateBase(),
        sidebarCollapsed: collapsed
      });
      applySidebarCollapsedState();
    }

    function cancelSidebarOverlayClose() {
      if (sidebarOverlayCloseTimer) {
        clearTimeout(sidebarOverlayCloseTimer);
      }
      sidebarOverlayCloseTimer = null;
    }

    function getSidebarOverlayFreezeRect() {
      const sidebar = document.querySelector<HTMLElement>(".sidebar");
      const top = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().bottom || 0;
      const width = sidebar?.offsetWidth || 280;

      return new DOMRect(0, top, width, Math.max(0, window.innerHeight - top));
    }

    function updateSidebarOverlayPointer(event: MouseEvent) {
      sidebarOverlayPointer = {
        x: event.clientX,
        y: event.clientY
      };
    }

    function isPointInsideRect(point: { x: number; y: number } | null, rect: DOMRectReadOnly) {
      if (!point) {
        return false;
      }

      return point.x >= rect.left
        && point.x <= rect.right
        && point.y >= rect.top
        && point.y <= rect.bottom;
    }

    function isSidebarOverlayPointerInside() {
      return isPointInsideRect(sidebarOverlayPointer, getSidebarOverlayFreezeRect());
    }

    async function openSidebarOverlay() {
      if (!isSidebarCollapsed()) {
        return;
      }

      cancelSidebarOverlayClose();
      if (sidebarOverlayOpening || document.body.classList.contains("sidebar-overlay-open")) {
        return;
      }

      const freezeRequest = ++sidebarOverlayFreezeRequest;
      sidebarOverlayOpening = true;
      try {
        await freezeWebAppsForRect(getSidebarOverlayFreezeRect(), {
          margin: 0
        });
        if (freezeRequest !== sidebarOverlayFreezeRequest || !isSidebarCollapsed()) {
          return;
        }
        document.body.classList.add("sidebar-overlay-open");
      } catch (error) {
        console.error("Could not freeze webapps for sidebar overlay:", error);
      } finally {
        if (freezeRequest === sidebarOverlayFreezeRequest) {
          sidebarOverlayOpening = false;
        }
      }
    }

    function closeSidebarOverlay() {
      cancelSidebarOverlayClose();
      const shouldRestoreWebApps = sidebarOverlayOpening || document.body.classList.contains("sidebar-overlay-open");
      sidebarOverlayFreezeRequest += 1;
      sidebarOverlayOpening = false;
      if (document.body.classList.contains("sidebar-overlay-open")) {
        document.body.classList.remove("sidebar-overlay-open");
      }
      if (shouldRestoreWebApps) {
        restoreWebAppsAfterOverlay().catch((error) => {
          console.error("Could not restore webapps after sidebar overlay:", error);
        });
      }
    }

    function scheduleSidebarOverlayClose() {
      cancelSidebarOverlayClose();
      sidebarOverlayCloseTimer = setTimeout(() => {
        if (
          !isSidebarOverlayPointerInside()
          && !document.querySelector(".sidebar:hover, .sidebar:focus-within, .sidebar-rail:hover, .sidebar-rail:focus")
        ) {
          closeSidebarOverlay();
        }
      }, 180);
    }

    function createProjectNavRow(project: RendererProject, options: ProjectNavRowOptions = {}) {
      const projectId = project.id || "";
      const isActiveProject =
        (getViewState().currentView === "project" || getViewState().currentView === "project-edit") && projectId === getViewState().currentProjectId;
      const row = document.createElement("div");
      row.className = "project-nav-row";
      row.classList.toggle("project-nav-row-grouped", options.grouped === true);
      row.classList.toggle("active", isActiveProject);
      row.draggable = Boolean(projectId);
      row.dataset.projectId = projectId;
      row.addEventListener("dragstart", (event) => {
        const dataTransfer = event.dataTransfer;
        if (!projectId || !dataTransfer) {
          event.preventDefault();
          return;
        }
        const rect = row.getBoundingClientRect();
        draggedProjectId = projectId;
        draggedProjectGroupName = null;
        draggedProjectListPointerOffsetY = event.clientY - rect.top;
        draggedProjectListGhostHeight = rect.height;
        row.classList.add("dragging");
        dataTransfer.effectAllowed = "move";
        dataTransfer.setData("text/plain", projectId);
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
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
          cancelPendingProjectGroupCollapse(options.groupName || "");
          updateProjectGroupInsertionPlaceholder(row.parentElement, event, options.groupName || "");
          return;
        }

        if (!draggedProjectId || draggedProjectId === project.id) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
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
            draggedProjectId || event.dataTransfer?.getData("text/plain") || "",
            options.groupName || "",
            target?.beforeProjectId || projectId
          );
          return;
        }

        const sourceId = event.dataTransfer?.getData("text/plain") || draggedProjectId;
        if (!sourceId || sourceId === projectId || !projectId) {
          return;
        }
        await moveProjectBeforeProject(sourceId, projectId);
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
      projectName.textContent = project.name || "";
      titleRow.append(projectName);

      renderProjectNavBadges(project, titleRow, { isActiveProject });

      const projectSlug = document.createElement("small");
      projectSlug.textContent = project.slug || "";
      button.append(titleRow, projectSlug);
      button.addEventListener("click", () => {
        if (projectId) {
          selectProject(projectId);
          closeSidebarOverlay();
        }
      });
      row.append(button);

      const settingsButton = document.createElement("button");
      settingsButton.className = "project-settings-button";
      settingsButton.type = "button";
      settingsButton.title = "Project settings";
      settingsButton.setAttribute("aria-label", `${project.name || "Project"} settings`);
      settingsButton.textContent = "⚙";
      settingsButton.addEventListener("click", () => {
        if (projectId) {
          selectEditProject(projectId);
        }
      });
      row.append(settingsButton);

      return row;
    }

    function isProjectPinned(projectId: string) {
      return getPinnedProjectIds().includes(projectId);
    }

    async function setProjectPinned(projectId: string, pinned: boolean) {
      const currentPinnedProjectIds = getPinnedProjectIds();
      const pinnedProjectIds = pinned
        ? [...currentPinnedProjectIds.filter((id) => id !== projectId), projectId]
        : currentPinnedProjectIds.filter((id) => id !== projectId);

      await updateNavigation({
        ...getNavigationUpdateBase(),
        pinnedProjectIds
      });
      renderPinnedProjects();
      renderProjectList();
    }

    function createPinnedProjectShortcut(project: RendererProject) {
      const projectId = project.id || "";
      const isActiveProject =
        (getViewState().currentView === "project" || getViewState().currentView === "project-edit") && projectId === getViewState().currentProjectId;
      const button = document.createElement("button");
      button.className = "pinned-project-button";
      button.classList.toggle("active", isActiveProject);
      button.type = "button";
      button.title = project.name || "Project";
      button.addEventListener("click", () => {
        if (projectId) {
          selectProject(projectId);
          closeSidebarOverlay();
        }
      });
      button.addEventListener("contextmenu", (event) => {
        openProjectContextMenu(event, project);
      });

      const name = document.createElement("span");
      name.className = "pinned-project-name";
      name.textContent = project.name || project.slug || "Project";
      button.append(name);
      renderProjectNavBadges(project, button, { isActiveProject });
      return button;
    }

    function renderPinnedProjects() {
      const projectById = new Map(getProjects().map((project) => [project.id, project]));
      const pinned = getPinnedProjectIds()
        .map((projectId) => projectById.get(projectId))
        .filter((project): project is RendererProject => Boolean(project));

      pinnedProjects.replaceChildren();
      pinnedProjects.hidden = pinned.length === 0;

      for (const project of pinned) {
        pinnedProjects.append(createPinnedProjectShortcut(project));
      }
    }

    function getProjectListBlocks() {
      return [...projectList.children].filter(isProjectListElement).filter((element) =>
        element !== projectListInsertionPlaceholder &&
        (
          element.classList.contains("project-nav-row") ||
          element.classList.contains("project-group-row") ||
          element.classList.contains("project-group-expanded")
        )
      );
    }

    function getFirstProjectIdForProjectListBlock(block: HTMLElement | null) {
      if (!block) {
        return null;
      }

      if (block.classList.contains("project-nav-row")) {
        return block.dataset.projectId || null;
      }

      const groupName = block.dataset.projectGroup || "";
      return getProjects().find((project) => String(project.group || "").trim() === groupName)?.id || null;
    }

    function getProjectListInsertionTarget(clientY: number): ProjectListInsertionTarget {
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

    function getProjectGroupInsertionTarget(container: HTMLElement, clientY: number, groupName: string): ProjectListInsertionTarget {
      const rows = [...container.children].filter(isProjectListElement).filter((element) =>
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

    function getProjectListDragReferenceY(event: DragEvent) {
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
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
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

        const sourceId = draggedProjectId || event.dataTransfer?.getData("text/plain");
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

    function updateProjectListInsertionPlaceholder(event: DragEvent) {
      if (!draggedProjectId && !draggedProjectGroupName) {
        clearProjectListInsertionPlaceholder();
        return;
      }

      projectListInsertionTarget = getProjectListInsertionTarget(getProjectListDragReferenceY(event));
      const placeholder = ensureProjectListInsertionPlaceholder();
      projectList.insertBefore(placeholder, projectListInsertionTarget.beforeNode);
    }

    function updateProjectGroupInsertionPlaceholder(container: HTMLElement | null, event: DragEvent, groupName: string) {
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

    async function setProjectGroupCollapsed(groupName: string, collapsed: boolean) {
      const collapsedGroups = getCollapsedProjectGroups();
      if (collapsed) {
        collapsedGroups.add(groupName);
        autoExpandedProjectGroups.delete(groupName);
      } else {
        collapsedGroups.delete(groupName);
      }

      await updateNavigation({
        ...getNavigationUpdateBase(),
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

    function scheduleProjectGroupExpand(groupName: string) {
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

    function scheduleProjectGroupCollapse(groupName: string) {
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

    function clearProjectListDragImage() {
      draggedProjectListDragImage?.remove();
      draggedProjectListDragImage = null;
    }

    async function updateProjectGroupName(groupName: string, nextGroupName: string) {
      const currentGroup = String(groupName || "").trim();
      const nextGroup = String(nextGroupName || "").trim();

      if (!currentGroup || !nextGroup || currentGroup === nextGroup) {
        return;
      }

      const projects = getProjects().filter((project) => String(project.group || "").trim() === currentGroup);
      for (const project of projects) {
        if (!project.id) {
          continue;
        }
        await updateProject(project.id, {
          group: nextGroup
        });
      }

      const collapsedGroups = getCollapsedProjectGroups();
      if (collapsedGroups.delete(currentGroup)) {
        collapsedGroups.add(nextGroup);
        await updateNavigation({
          ...getNavigationUpdateBase(),
          collapsedProjectGroups: [...collapsedGroups]
        });
      }

      renderApp();
    }

    async function explodeProjectGroup(groupName: string) {
      const currentGroup = String(groupName || "").trim();
      if (!currentGroup) {
        return;
      }

      const projects = getProjects().filter((project) => String(project.group || "").trim() === currentGroup);
      for (const project of projects) {
        if (!project.id) {
          continue;
        }
        await updateProject(project.id, {
          group: ""
        });
      }

      const collapsedGroups = getCollapsedProjectGroups();
      if (collapsedGroups.delete(currentGroup)) {
        await updateNavigation({
          ...getNavigationUpdateBase(),
          collapsedProjectGroups: [...collapsedGroups]
        });
      }

      renderApp();
    }

    async function createProjectGroupForProject(project: RendererProject, groupName: string) {
      const nextGroup = String(groupName || "").trim();
      if (!project?.id || !nextGroup) {
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

    function attachProjectGroupDragHandlers(
      element: HTMLElement,
      groupName: string,
      projects: RendererProject[],
      options: ProjectGroupDragOptions = {}
    ) {
      element.addEventListener("dragstart", (event) => {
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) {
          event.preventDefault();
          return;
        }
        const rect = element.getBoundingClientRect();
        clearProjectListDragImage();
        draggedProjectId = null;
        draggedProjectGroupName = groupName;
        draggedProjectListPointerOffsetY = event.clientY - rect.top;
        draggedProjectListGhostHeight = rect.height;
        if (options.dragImage === "collapsed-group") {
          const dragImage = createProjectGroupDragImage(groupName, projects);
          document.body.append(dragImage);
          const dragImageRect = dragImage.getBoundingClientRect();
          const offsetY = dragImageRect.height / 2;
          draggedProjectListPointerOffsetY = offsetY;
          draggedProjectListGhostHeight = dragImageRect.height;
          dataTransfer.setDragImage(dragImage, Math.min(24, dragImageRect.width / 2), offsetY);
          draggedProjectListDragImage = dragImage;
        }
        element.classList.add("dragging");
        dataTransfer.effectAllowed = "move";
        dataTransfer.setData("text/plain", `group:${groupName}`);
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
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
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

        const sourceId = draggedProjectId || event.dataTransfer?.getData("text/plain");
        if (!sourceId || projects.some((project) => project.id === sourceId)) {
          return;
        }
        await moveProjectToGroup(sourceId, groupName);
      });
    }

    function createExpandedProjectGroup(groupName: string, projects: RendererProject[]) {
      const group = document.createElement("div");
      group.className = "project-group-expanded";
      group.dataset.projectGroup = groupName;
      group.addEventListener("dragover", (event) => {
        if (draggedProjectGroupName) {
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
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
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
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

        const sourceId = draggedProjectId || event.dataTransfer?.getData("text/plain");
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
      renderPinnedProjects();
      applySidebarCollapsedState();

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
      const renderedGroups = new Set<string>();
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

    function bindProjectSidebarEvents() {
      projectList.addEventListener("dragover", (event) => {
        if (!draggedProjectId && !draggedProjectGroupName) {
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        updateProjectListInsertionPlaceholder(event);
      });

      projectList.addEventListener("dragleave", (event) => {
        if (event.relatedTarget instanceof Node && projectList.contains(event.relatedTarget)) {
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

        const sourceId = draggedProjectId || event.dataTransfer?.getData("text/plain");
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

      sidebarToggleButton.addEventListener("click", () => {
        setSidebarCollapsed(!isSidebarCollapsed()).catch((error) => {
          console.error("Could not update sidebar collapse state:", error);
        });
      });

      sidebarRail.addEventListener("mouseenter", (event) => {
        updateSidebarOverlayPointer(event);
        openSidebarOverlay().catch((error) => {
          console.error("Could not open sidebar overlay:", error);
        });
      });
      sidebarRail.addEventListener("mousemove", updateSidebarOverlayPointer);
      sidebarRail.addEventListener("focus", () => {
        openSidebarOverlay().catch((error) => {
          console.error("Could not open sidebar overlay:", error);
        });
      });
      sidebarRail.addEventListener("pointerdown", (event) => {
        event.preventDefault();
      });
      sidebarRail.addEventListener("click", () => {
        openSidebarOverlay().catch((error) => {
          console.error("Could not open sidebar overlay:", error);
        });
      });
      sidebarRail.addEventListener("mouseleave", scheduleSidebarOverlayClose);
      sidebarRail.addEventListener("blur", scheduleSidebarOverlayClose);

      const sidebar = document.querySelector<HTMLElement>(".sidebar");
      sidebar?.addEventListener("mouseenter", (event) => {
        updateSidebarOverlayPointer(event);
        cancelSidebarOverlayClose();
      });
      sidebar?.addEventListener("mousemove", updateSidebarOverlayPointer);
      sidebar?.addEventListener("mouseleave", (event) => {
        updateSidebarOverlayPointer(event);
        scheduleSidebarOverlayClose();
      });
      sidebar?.addEventListener("focusin", cancelSidebarOverlayClose);
      sidebar?.addEventListener("focusout", scheduleSidebarOverlayClose);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeSidebarOverlay();
        }
      });
    }

    bindProjectSidebarEvents();

    return {
      closeProjectGroupMenu,
      renderPinnedProjects,
      renderProjectList
    };
}
