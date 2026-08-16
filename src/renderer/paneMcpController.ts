import type { PaneLayoutNode, PaneNode } from "./paneLayoutState.js";
import { buildPaneTypeCatalog } from "./paneTypeCatalog.js";
import type { RendererProject, WebAppDefinition } from "./rendererTypes.js";

export type PaneMcpErrorCode =
  | "INVALID_REQUEST"
  | "LAYOUT_CHANGED"
  | "PANE_NOT_FOUND"
  | "PANE_TYPE_NOT_AVAILABLE"
  | "PROJECT_NOT_FOUND";

export class PaneMcpError extends Error {
  readonly code: PaneMcpErrorCode;

  constructor(code: PaneMcpErrorCode, message: string) {
    super(message);
    this.name = "PaneMcpError";
    this.code = code;
  }
}

type PaneMcpControllerOptions = {
  assignWebAppToPane: (project: RendererProject, pane: PaneNode, webApp: WebAppDefinition) => void;
  findPaneNode: (layout: PaneLayoutNode, paneId: string) => PaneNode | null;
  getGlobalWorkspace: () => RendererProject;
  getProjectById: (projectId: string) => RendererProject | null | undefined;
  getProjectPaneLayout: (project: RendererProject) => PaneLayoutNode;
  getProjectWebApps: (project: RendererProject, paneId: string) => WebAppDefinition[];
  getSelectedWebApp: (
    project: RendererProject,
    paneId: string,
    webApps: WebAppDefinition[]
  ) => WebAppDefinition;
};

type PaneMcpInput = Record<string, unknown>;

function requiredString(input: PaneMcpInput, key: string): string {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value) {
    throw new PaneMcpError("INVALID_REQUEST", `${key} is required.`);
  }
  return value;
}

function getChoiceLabel(webApp: WebAppDefinition): string {
  return String(webApp.label || webApp.id || "");
}

function getPaneTypeId(webApp: WebAppDefinition): string | null {
  const paneTypeId = typeof webApp.paneTypeId === "string" ? webApp.paneTypeId.trim() : "";
  const choiceId = typeof webApp.id === "string" ? webApp.id.trim() : "";
  return paneTypeId || choiceId || null;
}

function hashRevision(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a-${hash.toString(16).padStart(16, "0")}`;
}

export function createPaneMcpController({
  assignWebAppToPane,
  findPaneNode,
  getGlobalWorkspace,
  getProjectById,
  getProjectPaneLayout,
  getProjectWebApps,
  getSelectedWebApp
}: PaneMcpControllerOptions) {
  function resolveProject(projectId: string): RendererProject {
    const project = projectId === "__global__" ? getGlobalWorkspace() : getProjectById(projectId);
    if (!project) {
      throw new PaneMcpError("PROJECT_NOT_FOUND", `Project ${projectId} is not available in this window.`);
    }
    return project;
  }

  function describeLayoutNode(project: RendererProject, node: PaneLayoutNode): Record<string, unknown> {
    if (node.type === "split") {
      return {
        type: "split",
        id: node.id,
        direction: node.direction,
        ratio: node.ratio,
        first: describeLayoutNode(project, node.first),
        second: describeLayoutNode(project, node.second)
      };
    }

    const webApps = getProjectWebApps(project, node.id);
    const selectedWebApp = getSelectedWebApp(project, node.id, webApps);
    return {
      type: "pane",
      id: node.id,
      choiceId: selectedWebApp.id || null,
      paneTypeId: getPaneTypeId(selectedWebApp),
      label: getChoiceLabel(selectedWebApp)
    };
  }

  function describeProjectLayout(project: RendererProject) {
    const layout = describeLayoutNode(project, getProjectPaneLayout(project));
    return {
      projectId: String(project.id || ""),
      projectName: String(project.name || project.slug || project.id || ""),
      revision: hashRevision(layout),
      layout
    };
  }

  function getPaneContext(input: PaneMcpInput) {
    const project = resolveProject(requiredString(input, "projectId"));
    const paneId = requiredString(input, "paneId");
    const layoutDescription = describeProjectLayout(project);
    const layout = getProjectPaneLayout(project);
    const pane = findPaneNode(layout, paneId);
    if (!pane) {
      throw new PaneMcpError("PANE_NOT_FOUND", `Pane ${paneId} is not part of the active layout.`);
    }
    const webApps = getProjectWebApps(project, paneId);
    const selectedWebApp = getSelectedWebApp(project, paneId, webApps);
    return { layoutDescription, pane, paneId, project, selectedWebApp, webApps };
  }

  function getPaneLayout(input: PaneMcpInput) {
    return describeProjectLayout(resolveProject(requiredString(input, "projectId")));
  }

  function listPaneTypes(input: PaneMcpInput) {
    const { layoutDescription, paneId, selectedWebApp, webApps } = getPaneContext(input);
    const selectedChoiceId = String(selectedWebApp.id || "");
    const choices = buildPaneTypeCatalog(webApps).map((group) => ({
      choiceId: String(group.webApp.id || ""),
      paneTypeId: getPaneTypeId(group.webApp),
      label: group.label,
      selectable: group.webApp.menuOnly !== true,
      selected: group.webApp.id === selectedChoiceId,
      children: group.children.map((child) => ({
        choiceId: String(child.webApp.id || ""),
        paneTypeId: getPaneTypeId(child.webApp),
        label: child.label,
        selectable: child.webApp.menuOnly !== true,
        selected: child.webApp.id === selectedChoiceId
      }))
    }));
    return {
      projectId: layoutDescription.projectId,
      paneId,
      revision: layoutDescription.revision,
      selectedChoiceId,
      choices
    };
  }

  function assignPaneType(input: PaneMcpInput) {
    const choiceId = requiredString(input, "choiceId");
    const expectedRevision = typeof input.expectedRevision === "string" ? input.expectedRevision.trim() : "";
    const { layoutDescription, pane, paneId, project, webApps } = getPaneContext(input);
    if (expectedRevision && expectedRevision !== layoutDescription.revision) {
      throw new PaneMcpError(
        "LAYOUT_CHANGED",
        `The active layout changed (expected ${expectedRevision}, current ${layoutDescription.revision}).`
      );
    }

    const selectableChoiceIds = new Set(
      buildPaneTypeCatalog(webApps).flatMap((group) => [
        ...(group.webApp.menuOnly === true ? [] : [String(group.webApp.id || "")]),
        ...group.children
          .filter((child) => child.webApp.menuOnly !== true)
          .map((child) => String(child.webApp.id || ""))
      ])
    );
    const webApp = webApps.find((candidate) => candidate.id === choiceId);
    if (!webApp || !selectableChoiceIds.has(choiceId)) {
      throw new PaneMcpError(
        "PANE_TYPE_NOT_AVAILABLE",
        `Pane choice ${choiceId} is not currently available for pane ${paneId}.`
      );
    }

    assignWebAppToPane(project, pane, webApp);
    return {
      ...describeProjectLayout(project),
      paneId,
      assignedChoiceId: choiceId,
      paneTypeId: getPaneTypeId(webApp)
    };
  }

  function handle(operation: string, input: PaneMcpInput) {
    if (operation === "get_pane_layout") {
      return getPaneLayout(input);
    }
    if (operation === "list_pane_types") {
      return listPaneTypes(input);
    }
    if (operation === "assign_pane_type") {
      return assignPaneType(input);
    }
    throw new PaneMcpError("INVALID_REQUEST", `Unsupported pane operation: ${operation}.`);
  }

  return Object.freeze({
    assignPaneType,
    getPaneLayout,
    handle,
    listPaneTypes
  });
}
