type PaneLayoutProject = {
  id?: string;
};

type PaneLayoutWebApp = {
  id: string;
};

type PaneLayoutTransientWebApp = Record<string, unknown> & {
  id?: string;
  label?: unknown;
  parentLabel?: string;
  parentWebAppId?: string;
  url?: string;
};

export type PaneNode = {
  type: "pane";
  id: string;
  selectedWebAppId?: string | null;
  transientWebApp?: PaneLayoutTransientWebApp;
};

export type SplitNode = {
  type: "split";
  id: string;
  direction: string;
  ratio: number;
  first: PaneLayoutNode;
  second: PaneLayoutNode;
  expandedChild?: "first" | "second" | "" | null;
};

export type PaneLayoutNode = PaneNode | SplitNode;

type PaneAncestorPathItem = {
  node: SplitNode;
  side: "first" | "second";
};

type SplitAncestorPathItem = {
  node: SplitNode;
  side: "first" | "second";
};

type SplitRotationTarget = {
  parent: SplitNode;
  pivot: SplitNode;
  side: "first" | "second";
};

type SplitRotationPreview = {
  current: PaneLayoutNode;
  replacementSplitId: string;
  rootSplitId: string;
  rotated: PaneLayoutNode;
};

type RemovePaneResult = {
  node: PaneLayoutNode | null | undefined;
  removed: boolean;
};

type PaneLayoutStateOptions = {
  updatePaneLayout: (projectId: string, layout: PaneLayoutNode) => Promise<unknown>;
};

type PaneLayoutStateApi = {
  collectPaneNodes(node: PaneLayoutNode | null | undefined, panes?: PaneNode[]): PaneNode[];
  countPaneNodes(node: PaneLayoutNode | null | undefined): number;
  createPaneNode(project: PaneLayoutProject, selectedWebAppId?: string | null): PaneNode;
  createSplitNode(project: PaneLayoutProject, direction: string, first: PaneLayoutNode, selectedWebAppId?: string | null): SplitNode;
  findFirstPaneNode(node: PaneLayoutNode | null | undefined): PaneNode | null;
  findPaneNode(node: PaneLayoutNode | null | undefined, paneId: string): PaneNode | null;
  findPaneNodeBySelectedWebApp(node: PaneLayoutNode | null | undefined, webAppId: string): PaneNode | null;
  getPaneExpansionState(project: PaneLayoutProject, paneId: string): { canExpand: boolean; canShrink: boolean };
  getPaneExpansionTarget(project: PaneLayoutProject, paneId: string): PaneAncestorPathItem | null;
  getPaneAncestorPath(node: PaneLayoutNode | null | undefined, paneId: string, path?: PaneAncestorPathItem[]): PaneAncestorPathItem[] | null;
  getSplitRotationPreview(project: PaneLayoutProject, splitId: string): SplitRotationPreview | null;
  getSplitRotationState(project: PaneLayoutProject, splitId: string): { canRotate: boolean };
  getPaneLayout(projectId?: string): PaneLayoutNode | undefined;
  getProjectPaneLayout(project: PaneLayoutProject): PaneLayoutNode;
  getSelectedWebApp(project: PaneLayoutProject, paneId: string, webApps: PaneLayoutWebApp[]): PaneLayoutWebApp;
  getSelectedWebAppForPane(paneId: string): string | undefined;
  getSelectedWebAppForProject(projectId: string): string | undefined;
  hydratePaneLayouts(persistedLayouts?: Record<string, unknown>): void;
  persistPaneLayout(project: PaneLayoutProject): void;
  removePaneNode(node: PaneLayoutNode | null | undefined, paneId: string): RemovePaneResult;
  replacePaneNode(node: PaneLayoutNode, paneId: string, replacement: PaneLayoutNode): PaneLayoutNode;
  rotateSplitWithParent(project: PaneLayoutProject, splitId: string): boolean;
  setPaneLayout(projectId: string | undefined, layout: PaneLayoutNode): void;
  setSelectedWebAppForPane(paneId: string, webAppId: string): Map<string, string>;
  setSelectedWebAppForProject(projectId: string, webAppId: string): Map<string, string>;
  deleteSelectedWebAppForPane(paneId: string): boolean;
  deleteSelectedWebAppForProject(projectId: string): boolean;
};

export function createPaneLayoutState({ updatePaneLayout }: PaneLayoutStateOptions): PaneLayoutStateApi {
    const selectedWebAppByProject = new Map<string, string>();
    const paneLayoutsByProject = new Map<string, PaneLayoutNode>();
    const selectedWebAppByPane = new Map<string, string>();
    let nextPaneId = 1;

    function getProjectPaneLayoutKey(project: PaneLayoutProject): string {
      return project.id || "";
    }

    function clampSplitRatio(value: number) {
      return Math.min(0.85, Math.max(0.15, value));
    }

    function clonePaneLayoutNode(node: PaneLayoutNode): PaneLayoutNode {
      if (node.type === "pane") {
        return {
          ...node
        };
      }

      return {
        ...node,
        first: clonePaneLayoutNode(node.first),
        second: clonePaneLayoutNode(node.second)
      };
    }

    /**
     * @param {PaneLayoutProject} project
     * @param {string | null} selectedWebAppId
     * @returns {PaneNode}
     */
    function createPaneNode(project: PaneLayoutProject, selectedWebAppId: string | null = null): PaneNode {
      const id = `${getProjectPaneLayoutKey(project)}:pane:${nextPaneId}`;
      nextPaneId += 1;

      if (selectedWebAppId) {
        selectedWebAppByPane.set(id, selectedWebAppId);
      }

      return {
        type: "pane",
        id,
        selectedWebAppId: selectedWebAppId || null
      };
    }

    /**
     * @param {PaneLayoutProject} project
     * @returns {PaneLayoutNode}
     */
    function getProjectPaneLayout(project: PaneLayoutProject) {
      const projectId = getProjectPaneLayoutKey(project);
      if (!paneLayoutsByProject.has(projectId)) {
        paneLayoutsByProject.set(projectId, createPaneNode(project));
      }

      return paneLayoutsByProject.get(projectId) as PaneLayoutNode;
    }

    /**
     * @param {string} projectId
     * @param {PaneLayoutNode} layout
     */
    function setPaneLayout(projectId: string | undefined, layout: PaneLayoutNode) {
      paneLayoutsByProject.set(projectId || "", layout);
    }

    /**
     * @param {string} projectId
     * @returns {PaneLayoutNode | undefined}
     */
    function getPaneLayout(projectId: string | undefined) {
      return paneLayoutsByProject.get(projectId || "");
    }

    /**
     * @param {PaneLayoutProject} project
     * @param {string} paneId
     * @param {PaneLayoutWebApp[]} webApps
     * @returns {PaneLayoutWebApp}
     */
    function getSelectedWebApp(project: PaneLayoutProject, paneId: string, webApps: PaneLayoutWebApp[]) {
      const paneNode = findPaneNode(getProjectPaneLayout(project), paneId);
      const selectedId =
        selectedWebAppByPane.get(paneId) ||
        paneNode?.selectedWebAppId ||
        selectedWebAppByProject.get(getProjectPaneLayoutKey(project)) ||
        webApps[0].id;
      return webApps.find((webApp) => webApp.id === selectedId) || webApps[0];
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @returns {PaneNode | null}
     */
    function findFirstPaneNode(node: PaneLayoutNode | null | undefined): PaneNode | null {
      if (!node) {
        return null;
      }

      if (node.type === "pane") {
        return node;
      }

      return findFirstPaneNode(node.first) || findFirstPaneNode(node.second);
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @param {PaneNode[]} panes
     * @returns {PaneNode[]}
     */
    function collectPaneNodes(node: PaneLayoutNode | null | undefined, panes: PaneNode[] = []) {
      if (!node) {
        return panes;
      }

      if (node.type === "pane") {
        panes.push(node);
        return panes;
      }

      collectPaneNodes(node.first, panes);
      collectPaneNodes(node.second, panes);
      return panes;
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @param {string} webAppId
     * @returns {PaneNode | null}
     */
    function findPaneNodeBySelectedWebApp(node: PaneLayoutNode | null | undefined, webAppId: string): PaneNode | null {
      if (!node) {
        return null;
      }

      if (node.type === "pane") {
        const selectedWebAppId =
          selectedWebAppByPane.get(node.id) ||
          node.selectedWebAppId ||
          null;
        return selectedWebAppId === webAppId ? node : null;
      }

      return findPaneNodeBySelectedWebApp(node.first, webAppId) || findPaneNodeBySelectedWebApp(node.second, webAppId);
    }

    /**
     * @param {PaneLayoutProject} project
     * @param {string} direction
     * @param {PaneLayoutNode} first
     * @param {string | null} selectedWebAppId
     * @returns {SplitNode}
     */
    function createSplitNode(
      project: PaneLayoutProject,
      direction: string,
      first: PaneLayoutNode,
      selectedWebAppId: string | null = null
    ): SplitNode {
      return {
        type: "split",
        id: `${getProjectPaneLayoutKey(project)}:split:${nextPaneId++}`,
        direction,
        ratio: 0.5,
        first,
        second: createPaneNode(project, selectedWebAppId)
      };
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @param {string} paneId
     * @returns {PaneNode | null}
     */
    function findPaneNode(node: PaneLayoutNode | null | undefined, paneId: string): PaneNode | null {
      if (!node) {
        return null;
      }

      if (node.type === "pane") {
        return node.id === paneId ? node : null;
      }

      return findPaneNode(node.first, paneId) || findPaneNode(node.second, paneId);
    }

    /**
     * @param {PaneLayoutNode} node
     * @param {string} paneId
     * @param {PaneLayoutNode} replacement
     * @returns {PaneLayoutNode}
     */
    function replacePaneNode(node: PaneLayoutNode, paneId: string, replacement: PaneLayoutNode): PaneLayoutNode {
      if (node.type === "pane") {
        return node.id === paneId ? replacement : node;
      }

      return {
        ...node,
        first: replacePaneNode(node.first, paneId, replacement),
        second: replacePaneNode(node.second, paneId, replacement)
      };
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @param {string} paneId
     * @param {PaneAncestorPathItem[]} path
     * @returns {PaneAncestorPathItem[] | null}
     */
    function getPaneAncestorPath(
      node: PaneLayoutNode | null | undefined,
      paneId: string,
      path: PaneAncestorPathItem[] = []
    ): PaneAncestorPathItem[] | null {
      if (!node) {
        return null;
      }

      if (node.type === "pane") {
        return node.id === paneId ? path : null;
      }

      return getPaneAncestorPath(node.first, paneId, [
        ...path,
        {
          node,
          side: "first"
        }
      ]) || getPaneAncestorPath(node.second, paneId, [
        ...path,
        {
          node,
          side: "second"
        }
      ]);
    }

    /**
     * @param {PaneLayoutProject} project
     * @param {string} paneId
     * @returns {{ canExpand: boolean, canShrink: boolean }}
     */
    function getPaneExpansionState(project: PaneLayoutProject, paneId: string) {
      const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
      return {
        canExpand: path.some(({ node }) => !node.expandedChild),
        canShrink: path.some(({ node, side }) => node.expandedChild === side)
      };
    }

    /**
     * @param {PaneLayoutProject} project
     * @param {string} paneId
     * @returns {PaneAncestorPathItem | null}
     */
    function getPaneExpansionTarget(project: PaneLayoutProject, paneId: string) {
      const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
      return [...path].reverse().find(({ node }) => !node.expandedChild) || null;
    }

    function getSplitAncestorPath(
      node: PaneLayoutNode | null | undefined,
      splitId: string,
      path: SplitAncestorPathItem[] = []
    ): SplitAncestorPathItem[] | null {
      if (!node || node.type === "pane") {
        return null;
      }

      if (node.id === splitId) {
        return path;
      }

      return getSplitAncestorPath(node.first, splitId, [
        ...path,
        {
          node,
          side: "first"
        }
      ]) || getSplitAncestorPath(node.second, splitId, [
        ...path,
        {
          node,
          side: "second"
        }
      ]);
    }

    function getSplitRotationTargetForLayout(layout: PaneLayoutNode, splitId: string): SplitRotationTarget | null {
      const path = getSplitAncestorPath(layout, splitId) || [];
      const parentEntry = path[path.length - 1];
      if (!parentEntry) {
        return null;
      }

      const parent = parentEntry.node;
      const pivot = parent[parentEntry.side];
      if (pivot.type !== "split" || pivot.direction !== parent.direction) {
        return null;
      }

      return {
        parent,
        pivot,
        side: parentEntry.side
      };
    }

    function getSplitRotationTarget(project: PaneLayoutProject, splitId: string): SplitRotationTarget | null {
      return getSplitRotationTargetForLayout(getProjectPaneLayout(project), splitId);
    }

    function getSplitRotationState(project: PaneLayoutProject, splitId: string) {
      return {
        canRotate: Boolean(getSplitRotationTarget(project, splitId))
      };
    }

    function applySplitRotation(target: SplitRotationTarget) {
      const { parent, pivot, side } = target;
      const parentRatio = clampSplitRatio(Number(parent.ratio) || 0.5);
      const pivotRatio = clampSplitRatio(Number(pivot.ratio) || 0.5);

      if (side === "second") {
        const first = parent.first;
        const pivotFirst = pivot.first;
        const pivotSecond = pivot.second;
        const nextParentRatio = clampSplitRatio(parentRatio + ((1 - parentRatio) * pivotRatio));
        const nextPivotRatio = clampSplitRatio(parentRatio / nextParentRatio);

        parent.first = pivot;
        parent.second = pivotSecond;
        parent.ratio = nextParentRatio;
        pivot.first = first;
        pivot.second = pivotFirst;
        pivot.ratio = nextPivotRatio;
      } else {
        const pivotFirst = pivot.first;
        const pivotSecond = pivot.second;
        const second = parent.second;
        const nextParentRatio = clampSplitRatio(parentRatio * pivotRatio);
        const nextPivotRatio = clampSplitRatio((parentRatio * (1 - pivotRatio)) / (1 - nextParentRatio));

        parent.first = pivotFirst;
        parent.second = pivot;
        parent.ratio = nextParentRatio;
        pivot.first = pivotSecond;
        pivot.second = second;
        pivot.ratio = nextPivotRatio;
      }
    }

    function getSplitRotationPreview(project: PaneLayoutProject, splitId: string): SplitRotationPreview | null {
      const layout = getProjectPaneLayout(project);
      const target = getSplitRotationTargetForLayout(layout, splitId);
      if (!target) {
        return null;
      }

      const current = clonePaneLayoutNode(layout);
      const rotated = clonePaneLayoutNode(layout);
      if (current.type !== "split" || rotated.type !== "split") {
        return null;
      }

      const rotatedTarget = getSplitRotationTargetForLayout(rotated, splitId);
      if (!rotatedTarget) {
        return null;
      }

      applySplitRotation(rotatedTarget);

      return {
        current,
        replacementSplitId: target.parent.id,
        rootSplitId: current.id,
        rotated
      };
    }

    function rotateSplitWithParent(project: PaneLayoutProject, splitId: string) {
      const target = getSplitRotationTarget(project, splitId);
      if (!target) {
        return false;
      }

      applySplitRotation(target);
      return true;
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @returns {number}
     */
    function countPaneNodes(node: PaneLayoutNode | null | undefined): number {
      if (!node) {
        return 0;
      }

      if (node.type === "pane") {
        return 1;
      }

      return countPaneNodes(node.first) + countPaneNodes(node.second);
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @param {string} paneId
     * @returns {RemovePaneResult}
     */
    function removePaneNode(node: PaneLayoutNode | null | undefined, paneId: string): RemovePaneResult {
      if (!node || node.type === "pane") {
        return {
          node,
          removed: false
        };
      }

      if (node.first.type === "pane" && node.first.id === paneId) {
        return {
          node: node.second,
          removed: true
        };
      }

      if (node.second.type === "pane" && node.second.id === paneId) {
        return {
          node: node.first,
          removed: true
        };
      }

      const firstResult = removePaneNode(node.first, paneId);
      if (firstResult.removed) {
        if (!firstResult.node) {
          return {
            node: node.second,
            removed: true
          };
        }

        return {
          node: {
            ...node,
            first: firstResult.node
          },
          removed: true
        };
      }

      const secondResult = removePaneNode(node.second, paneId);
      if (secondResult.removed) {
        if (!secondResult.node) {
          return {
            node: node.first,
            removed: true
          };
        }

        return {
          node: {
            ...node,
            second: secondResult.node
          },
          removed: true
        };
      }

      return {
        node,
        removed: false
      };
    }

    /**
     * @param {PaneLayoutProject} project
     */
    function persistPaneLayout(project: PaneLayoutProject) {
      const projectId = getProjectPaneLayoutKey(project);
      const layout = paneLayoutsByProject.get(projectId);
      if (!layout) {
        return;
      }

      updatePaneLayout(projectId, layout).catch((error) => {
        console.error("Could not persist pane layout:", error);
      });
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     */
    function hydratePaneLayoutSelections(node: PaneLayoutNode | null | undefined) {
      if (!node) {
        return;
      }

      if (node.type === "pane") {
        if (node.selectedWebAppId) {
          selectedWebAppByPane.set(node.id, node.selectedWebAppId);
        }

        const idMatch = node.id.match(/:pane:(\d+)$/);
        if (idMatch) {
          nextPaneId = Math.max(nextPaneId, Number(idMatch[1]) + 1);
        }
        return;
      }

      const splitMatch = node.id.match(/:split:(\d+)$/);
      if (splitMatch) {
        nextPaneId = Math.max(nextPaneId, Number(splitMatch[1]) + 1);
      }
      hydratePaneLayoutSelections(node.first);
      hydratePaneLayoutSelections(node.second);
    }

    /**
     * @param {Record<string, unknown>} persistedLayouts
     */
    function hydratePaneLayouts(persistedLayouts: Record<string, unknown> = {}) {
      for (const [projectId, layout] of Object.entries(persistedLayouts)) {
        const paneLayout = layout as PaneLayoutNode;
        paneLayoutsByProject.set(projectId, paneLayout);
        hydratePaneLayoutSelections(paneLayout);
      }
    }

    return {
      collectPaneNodes,
      countPaneNodes,
      createPaneNode,
      createSplitNode,
      findFirstPaneNode,
      findPaneNode,
      findPaneNodeBySelectedWebApp,
      getPaneExpansionState,
      getPaneExpansionTarget,
      getPaneAncestorPath,
      getSplitRotationPreview,
      getSplitRotationState,
      getPaneLayout,
      getProjectPaneLayout,
      getSelectedWebApp,
      getSelectedWebAppForPane: (paneId) => selectedWebAppByPane.get(paneId),
      getSelectedWebAppForProject: (projectId) => selectedWebAppByProject.get(projectId),
      hydratePaneLayouts,
      persistPaneLayout,
      removePaneNode,
      replacePaneNode,
      rotateSplitWithParent,
      setPaneLayout,
      setSelectedWebAppForPane: (paneId, webAppId) => selectedWebAppByPane.set(paneId, webAppId),
      setSelectedWebAppForProject: (projectId, webAppId) => selectedWebAppByProject.set(projectId, webAppId),
      deleteSelectedWebAppForPane: (paneId) => selectedWebAppByPane.delete(paneId),
      deleteSelectedWebAppForProject: (projectId) => selectedWebAppByProject.delete(projectId)
    };
}
