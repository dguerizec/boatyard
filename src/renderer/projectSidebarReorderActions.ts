import type { UnknownRecord } from "./rendererRecords.js";
import type { RendererProject } from "./rendererTypes.js";

type ProjectSidebarReorderActionsOptions = {
  getProjects: () => RendererProject[];
  renderApp: () => void;
  reorderProjectIds: (projectIds: string[]) => Promise<unknown>;
  updateProject: (projectId: string, values: UnknownRecord) => Promise<unknown>;
};

function isProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function getProjectIdList(projects: RendererProject[]) {
  return projects.map((project) => project.id).filter(isProjectId);
}

export function createProjectSidebarReorderActions({
  getProjects,
  renderApp,
  reorderProjectIds,
  updateProject
}: ProjectSidebarReorderActionsOptions) {
  async function reorderProjects(sourceId: string, targetId: string) {
    const projects = getProjects();
    const sourceIndex = projects.findIndex((project) => project.id === sourceId);
    const targetIndex = projects.findIndex((project) => project.id === targetId);

    if (sourceIndex === -1 || targetIndex === -1) {
      return;
    }

    const reordered = [...projects];
    const [moved] = reordered.splice(sourceIndex, 1);
    if (!moved) {
      return;
    }
    reordered.splice(targetIndex, 0, moved);
    await reorderProjectIds(getProjectIdList(reordered));
    renderApp();
  }

  async function moveProjectBeforeProject(sourceId: string, targetId: string) {
    const projects = getProjects();
    const source = projects.find((project) => project.id === sourceId);
    const target = projects.find((project) => project.id === targetId);

    if (!source?.id || !target?.id || source.id === target.id) {
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

  async function moveProjectToGroup(sourceId: string, targetGroupName: string) {
    const groupName = String(targetGroupName || "").trim();
    const projects = getProjects();
    const source = projects.find((project) => project.id === sourceId);
    const groupProjects = projects.filter((project) => String(project.group || "").trim() === groupName);

    if (!source?.id || !groupName || groupProjects.some((project) => project.id === source.id)) {
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
    await reorderProjectIds(getProjectIdList(reordered));
    renderApp();
  }

  async function moveProjectToGroupInsertion(sourceId: string, targetGroupName: string, beforeProjectId: string | null = null) {
    const groupName = String(targetGroupName || "").trim();
    const projects = getProjects();
    const source = projects.find((project) => project.id === sourceId);

    if (!source?.id || !groupName) {
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
    await reorderProjectIds(getProjectIdList(reordered));
    renderApp();
  }

  async function moveProjectToUngroupedInsertion(sourceId: string, beforeProjectId: string | null = null) {
    const projects = getProjects();
    const source = projects.find((project) => project.id === sourceId);

    if (!source?.id) {
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
    await reorderProjectIds(getProjectIdList(reordered));
    renderApp();
  }

  async function reorderProjectGroup(sourceGroupName: string, targetIndexResolver: (projects: RendererProject[]) => number) {
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
    await reorderProjectIds(getProjectIdList(reordered));
    renderApp();
  }

  async function reorderProjectGroupBeforeProject(sourceGroupName: string, targetProjectId: string | null) {
    if (!targetProjectId) {
      await reorderProjectGroup(sourceGroupName, (projects) => projects.length);
      return;
    }

    await reorderProjectGroup(sourceGroupName, (projects) =>
      projects.findIndex((project) => project.id === targetProjectId)
    );
  }

  return Object.freeze({
    moveProjectBeforeProject,
    moveProjectToGroup,
    moveProjectToGroupInsertion,
    moveProjectToUngroupedInsertion,
    reorderProjectGroupBeforeProject
  });
}
