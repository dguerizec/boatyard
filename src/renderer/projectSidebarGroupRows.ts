type SidebarGroupRowProject = {
  id?: string;
};

type SidebarGroupRowViewState = {
  currentProjectId?: string | null;
  currentView?: string;
};

type ProjectSidebarGroupRowsOptions = {
  attachProjectGroupDragHandlers: (element: HTMLElement, groupName: string, projects: SidebarGroupRowProject[]) => void;
  getProjectListWidth: () => number;
  getViewState: () => SidebarGroupRowViewState;
  openProjectGroupContextMenu: (
    event: MouseEvent,
    groupName: string,
    projects: SidebarGroupRowProject[]
  ) => void;
  renderProjectNavBadges: (
    project: SidebarGroupRowProject,
    container: HTMLElement,
    options: { isActiveProject: boolean }
  ) => void;
  setProjectGroupCollapsed: (groupName: string, collapsed: boolean) => Promise<void>;
};

export function createProjectSidebarGroupRows({
  attachProjectGroupDragHandlers,
  getProjectListWidth,
  getViewState,
  openProjectGroupContextMenu,
  renderProjectNavBadges,
  setProjectGroupCollapsed
}: ProjectSidebarGroupRowsOptions) {
  function appendGroupedProjectBadges(projects: SidebarGroupRowProject[], container: HTMLElement) {
    const priority = new Map([
      ["input", 3],
      ["working", 2],
      ["done", 1]
    ]);
    const badgeSummaries = new Map<string, {
      className: string;
      count: number;
      priority: number;
      stateName: string;
      text: string;
      titles: string[];
    }>();

    for (const project of projects) {
      const scratch = document.createElement("div");
      renderProjectNavBadges(project, scratch, { isActiveProject: false });
      for (const badge of scratch.querySelectorAll<HTMLElement>(".project-nav-badge")) {
        const stateName = [...badge.classList].find((className) => priority.has(className)) || "";
        const key = stateName || badge.textContent || badge.className;
        const summary = badgeSummaries.get(key) || {
          className: badge.className,
          text: badge.textContent || "",
          titles: [],
          stateName,
          priority: priority.get(stateName) || 0,
          count: 0
        };
        summary.count += 1;
        if (badge.title || badge.textContent) {
          summary.titles.push(badge.title || badge.textContent || "");
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

  function createGroupButtonContent(
    groupName: string,
    projects: SidebarGroupRowProject[],
    collapsed: boolean,
    tagName: "button" | "div" = "div"
  ) {
    const button = document.createElement(tagName);
    button.className = "project-group-button nav-item";
    if (button instanceof HTMLButtonElement) {
      button.type = "button";
    }

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
    return button;
  }

  function createProjectGroupRow(groupName: string, projects: SidebarGroupRowProject[], collapsed: boolean) {
    const viewState = getViewState();
    const hasActiveProject = projects.some((project) =>
      (viewState.currentView === "project" || viewState.currentView === "project-edit") &&
      project.id === viewState.currentProjectId
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

    const button = createGroupButtonContent(groupName, projects, collapsed, "button");
    button.classList.toggle("active", hasActiveProject);
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    button.addEventListener("click", () => {
      setProjectGroupCollapsed(groupName, !collapsed).catch((error) => {
        console.error("Could not update project group collapse state:", error);
      });
    });
    row.append(button);
    return row;
  }

  function createProjectGroupDragImage(groupName: string, projects: SidebarGroupRowProject[]) {
    const row = document.createElement("div");
    row.className = "project-group-row project-group-drag-image collapsed";
    row.style.width = `${getProjectListWidth()}px`;

    const button = createGroupButtonContent(groupName, projects, true, "div");
    row.append(button);
    return row;
  }

  return Object.freeze({
    createProjectGroupDragImage,
    createProjectGroupRow
  });
}
