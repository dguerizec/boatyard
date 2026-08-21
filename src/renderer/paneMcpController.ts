import type { PaneLayoutNode, PaneNode } from "./paneLayoutState.js";
import { buildPaneTypeCatalog } from "./paneTypeCatalog.js";
import type { RendererProject, WebAppDefinition } from "./rendererTypes.js";

export type PaneMcpErrorCode =
  | "INVALID_REQUEST"
  | "LAYOUT_CHANGED"
  | "PANE_NAVIGATION_NOT_AVAILABLE"
  | "PANE_NOT_FOUND"
  | "PANE_NOT_VISIBLE"
  | "PANE_TYPE_NOT_AVAILABLE"
  | "PANE_VIEWPORT_NOT_AVAILABLE"
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
  assignWebAppToPane: (
    project: RendererProject,
    pane: PaneNode,
    webApp: WebAppDefinition,
    options?: { render?: boolean }
  ) => void;
  findPaneNode: (layout: PaneLayoutNode, paneId: string) => PaneNode | null;
  getCurrentWebAppUrl: (webApp: WebAppDefinition) => string | undefined;
  getGlobalWorkspace: () => RendererProject;
  getMobileDevViewport: (webApp: WebAppDefinition) => PaneMobileViewport | null;
  getPaneCaptureBounds?: (project: RendererProject, paneId: string) => PaneCaptureBounds | null;
  getProjectById: (projectId: string) => RendererProject | null | undefined;
  getProjectPaneLayout: (project: RendererProject) => PaneLayoutNode;
  getProjectWebApps: (project: RendererProject, paneId: string) => WebAppDefinition[];
  getSelectedWebApp: (
    project: RendererProject,
    paneId: string,
    webApps: WebAppDefinition[]
  ) => WebAppDefinition;
  navigateWebApp: (key: string, action: string, url: string) => Promise<boolean>;
  normalizeAddressInput: (value: string) => string;
  setCurrentWebAppUrl: (key: string, url: string) => void;
  updateMobileDevViewport: (
    project: RendererProject,
    paneId: string,
    webApp: WebAppDefinition,
    update: PaneMobileViewportUpdate
  ) => PaneMobileViewport | null;
};

type PaneMcpInput = Record<string, unknown>;

type PaneMobileViewport = {
  enabled: boolean;
  height: number;
  width: number;
};

type PaneMobileViewportUpdate = {
  enabled?: boolean;
  height?: number;
  width?: number;
};

type PaneCaptureBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const NAVIGATION_ACTIONS = {
  back: "back",
  forward: "forward",
  hard_refresh: "hard-refresh",
  home: "home",
  open: "open",
  refresh: "refresh"
} as const;

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

function getExpectedRevision(input: PaneMcpInput): string {
  return typeof input.expectedRevision === "string" ? input.expectedRevision.trim() : "";
}

function getViewportUpdate(input: PaneMcpInput): PaneMobileViewportUpdate | null {
  if (input.viewport === undefined) {
    return null;
  }
  if (!input.viewport || typeof input.viewport !== "object" || Array.isArray(input.viewport)) {
    throw new PaneMcpError("INVALID_REQUEST", "viewport must be an object.");
  }
  const source = input.viewport as PaneMcpInput;
  const update: PaneMobileViewportUpdate = {};
  if (Object.hasOwn(source, "enabled")) {
    if (typeof source.enabled !== "boolean") {
      throw new PaneMcpError("INVALID_REQUEST", "viewport.enabled must be a boolean.");
    }
    update.enabled = source.enabled;
  }
  for (const key of ["height", "width"] as const) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }
    const value = source[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 160 || value > 8192) {
      throw new PaneMcpError("INVALID_REQUEST", `viewport.${key} must be an integer from 160 to 8192.`);
    }
    update[key] = Number(value);
  }
  if (Object.keys(update).length === 0) {
    throw new PaneMcpError("INVALID_REQUEST", "viewport must change enabled, height, or width.");
  }
  return update;
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
  getCurrentWebAppUrl,
  getGlobalWorkspace,
  getMobileDevViewport,
  getPaneCaptureBounds,
  getProjectById,
  getProjectPaneLayout,
  getProjectWebApps,
  getSelectedWebApp,
  navigateWebApp,
  normalizeAddressInput,
  setCurrentWebAppUrl,
  updateMobileDevViewport
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
    const key = String(selectedWebApp.key || "");
    const homeUrl = String(selectedWebApp.url || "");
    return {
      type: "pane",
      id: node.id,
      choiceId: selectedWebApp.id || null,
      paneTypeId: getPaneTypeId(selectedWebApp),
      label: getChoiceLabel(selectedWebApp),
      viewport: getMobileDevViewport(selectedWebApp),
      navigation: {
        available: Boolean(key && homeUrl),
        currentUrl: key && homeUrl ? getCurrentWebAppUrl(selectedWebApp) || homeUrl : null,
        homeUrl: homeUrl || null
      }
    };
  }

  function describeRevisionNode(project: RendererProject, node: PaneLayoutNode): Record<string, unknown> {
    if (node.type === "split") {
      return {
        type: "split",
        id: node.id,
        direction: node.direction,
        ratio: node.ratio,
        first: describeRevisionNode(project, node.first),
        second: describeRevisionNode(project, node.second)
      };
    }
    const webApps = getProjectWebApps(project, node.id);
    const selectedWebApp = getSelectedWebApp(project, node.id, webApps);
    return {
      type: "pane",
      id: node.id,
      choiceId: selectedWebApp.id || null
    };
  }

  function describeProjectLayout(project: RendererProject) {
    const paneLayout = getProjectPaneLayout(project);
    const layout = describeLayoutNode(project, paneLayout);
    return {
      projectId: String(project.id || ""),
      projectName: String(project.name || project.slug || project.id || ""),
      revision: hashRevision(describeRevisionNode(project, paneLayout)),
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
      capabilities: {
        navigation: Boolean(group.webApp.key && group.webApp.url),
        viewport: group.webApp.mobileDev === true
      },
      children: group.children.map((child) => ({
        choiceId: String(child.webApp.id || ""),
        paneTypeId: getPaneTypeId(child.webApp),
        label: child.label,
        selectable: child.webApp.menuOnly !== true,
        selected: child.webApp.id === selectedChoiceId,
        capabilities: {
          navigation: Boolean(child.webApp.key && child.webApp.url),
          viewport: child.webApp.mobileDev === true
        }
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

  function getPaneCaptureTarget(input: PaneMcpInput) {
    const { layoutDescription, paneId, project } = getPaneContext(input);
    assertExpectedRevision(input, layoutDescription.revision);
    const bounds = getPaneCaptureBounds?.(project, paneId) || null;
    if (!bounds) {
      throw new PaneMcpError(
        "PANE_NOT_VISIBLE",
        `Pane ${paneId} is not currently visible in the selected Boatyard window.`
      );
    }
    return {
      projectId: layoutDescription.projectId,
      paneId,
      revision: layoutDescription.revision,
      bounds
    };
  }

  function assertExpectedRevision(input: PaneMcpInput, currentRevision: string) {
    const expectedRevision = getExpectedRevision(input);
    if (expectedRevision && expectedRevision !== currentRevision) {
      throw new PaneMcpError(
        "LAYOUT_CHANGED",
        `The active layout changed (expected ${expectedRevision}, current ${currentRevision}).`
      );
    }
  }

  function resolveSelectableWebApp(webApps: WebAppDefinition[], paneId: string, choiceId: string) {
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
    return webApp;
  }

  function updatePane(input: PaneMcpInput) {
    const choiceId = typeof input.choiceId === "string" ? input.choiceId.trim() : "";
    const viewportUpdate = getViewportUpdate(input);
    if (!choiceId && !viewportUpdate) {
      throw new PaneMcpError("INVALID_REQUEST", "update_pane requires choiceId or viewport.");
    }
    const { layoutDescription, pane, paneId, project, selectedWebApp, webApps } = getPaneContext(input);
    assertExpectedRevision(input, layoutDescription.revision);
    const targetWebApp = choiceId
      ? resolveSelectableWebApp(webApps, paneId, choiceId)
      : selectedWebApp;
    if (viewportUpdate && targetWebApp.mobileDev !== true) {
      throw new PaneMcpError(
        "PANE_VIEWPORT_NOT_AVAILABLE",
        `Pane choice ${String(targetWebApp.id || "")} does not provide a mobile viewport.`
      );
    }

    if (choiceId && targetWebApp.id !== selectedWebApp.id) {
      assignWebAppToPane(project, pane, targetWebApp, { render: !viewportUpdate });
    }
    const viewport = viewportUpdate
      ? updateMobileDevViewport(project, paneId, targetWebApp, viewportUpdate)
      : getMobileDevViewport(targetWebApp);
    return {
      ...describeProjectLayout(project),
      paneId,
      updatedChoiceId: String(targetWebApp.id || ""),
      paneTypeId: getPaneTypeId(targetWebApp),
      viewport
    };
  }

  async function navigatePane(input: PaneMcpInput) {
    const action = requiredString(input, "action") as keyof typeof NAVIGATION_ACTIONS;
    const runtimeAction = NAVIGATION_ACTIONS[action];
    if (!runtimeAction) {
      throw new PaneMcpError("INVALID_REQUEST", `Unsupported navigation action: ${action}.`);
    }
    const { layoutDescription, paneId, project, selectedWebApp } = getPaneContext(input);
    assertExpectedRevision(input, layoutDescription.revision);
    const key = String(selectedWebApp.key || "");
    const homeUrl = String(selectedWebApp.url || "");
    if (!key || !homeUrl) {
      throw new PaneMcpError(
        "PANE_NAVIGATION_NOT_AVAILABLE",
        `Pane choice ${String(selectedWebApp.id || "")} does not provide web navigation.`
      );
    }

    let targetUrl = "";
    if (action === "open") {
      try {
        targetUrl = normalizeAddressInput(requiredString(input, "url"));
      } catch (error) {
        throw new PaneMcpError(
          "INVALID_REQUEST",
          error instanceof Error ? error.message : "url is invalid."
        );
      }
    } else if (action === "home") {
      targetUrl = homeUrl;
    }
    const navigated = await navigateWebApp(key, runtimeAction, targetUrl);
    if (!navigated) {
      throw new PaneMcpError(
        "PANE_NAVIGATION_NOT_AVAILABLE",
        `Navigation action ${action} is not currently available in pane ${paneId}.`
      );
    }
    if (targetUrl) {
      setCurrentWebAppUrl(key, targetUrl);
    }
    return {
      ...describeProjectLayout(project),
      paneId,
      action,
      navigated: true
    };
  }

  async function handle(operation: string, input: PaneMcpInput) {
    if (operation === "get_pane_layout") {
      return getPaneLayout(input);
    }
    if (operation === "list_pane_types") {
      return listPaneTypes(input);
    }
    if (operation === "get_pane_capture_bounds") {
      return getPaneCaptureTarget(input);
    }
    if (operation === "update_pane") {
      return updatePane(input);
    }
    if (operation === "navigate_pane") {
      return navigatePane(input);
    }
    throw new PaneMcpError("INVALID_REQUEST", `Unsupported pane operation: ${operation}.`);
  }

  return Object.freeze({
    getPaneLayout,
    getPaneCaptureTarget,
    handle,
    listPaneTypes,
    navigatePane,
    updatePane
  });
}
