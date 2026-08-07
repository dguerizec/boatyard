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
  expansion?: {
    active?: boolean;
    paneIds: string[];
  };
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

type RemovePaneResult = {
  node: PaneLayoutNode | null | undefined;
  removed: boolean;
};

type PaneLayoutStateOptions = {
  updatePaneLayout: (projectId: string, layout: PaneLayoutNode) => Promise<unknown>;
};

type PaneLayoutStateApi = {
  activatePaneExpansion(project: PaneLayoutProject, paneId: string, paneIds: string[]): boolean;
  clearPaneExpansionMemories(project: PaneLayoutProject): void;
  collectPaneNodes(node: PaneLayoutNode | null | undefined, panes?: PaneNode[]): PaneNode[];
  countPaneNodes(node: PaneLayoutNode | null | undefined): number;
  createPaneNode(project: PaneLayoutProject, selectedWebAppId?: string | null): PaneNode;
  createSplitNode(project: PaneLayoutProject, direction: string, first: PaneLayoutNode, selectedWebAppId?: string | null): SplitNode;
  findFirstPaneNode(node: PaneLayoutNode | null | undefined): PaneNode | null;
  findActivePaneExpansions(project: PaneLayoutProject): Array<{ pane: PaneNode; paneIds: string[] }>;
  findPaneNode(node: PaneLayoutNode | null | undefined, paneId: string): PaneNode | null;
  findPaneNodeBySelectedWebApp(node: PaneLayoutNode | null | undefined, webAppId: string): PaneNode | null;
  getPaneExpansionState(project: PaneLayoutProject, paneId: string): { canExpand: boolean; canShrink: boolean };
  getPaneExpansionPaneIds(project: PaneLayoutProject, paneId: string): string[];
  getPaneLayout(projectId?: string): PaneLayoutNode | undefined;
  getProjectPaneLayout(project: PaneLayoutProject): PaneLayoutNode;
  getSelectedWebApp(project: PaneLayoutProject, paneId: string, webApps: PaneLayoutWebApp[]): PaneLayoutWebApp;
  getSelectedWebAppForPane(paneId: string): string | undefined;
  getSelectedWebAppForProject(projectId: string): string | undefined;
  hydratePaneLayouts(persistedLayouts?: Record<string, unknown>): void;
  shrinkPaneExpansion(project: PaneLayoutProject, paneId: string): boolean;
  persistPaneLayout(project: PaneLayoutProject): void;
  removePaneNode(node: PaneLayoutNode | null | undefined, paneId: string): RemovePaneResult;
  replacePaneNode(node: PaneLayoutNode, paneId: string, replacement: PaneLayoutNode): PaneLayoutNode;
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
      const previousLayout = paneLayoutsByProject.get(projectId || "");
      if (previousLayout) {
        const previousPaneIds = collectPaneNodes(previousLayout).map((pane) => pane.id).sort();
        const nextPaneIds = collectPaneNodes(layout).map((pane) => pane.id).sort();
        if (previousPaneIds.join("\n") !== nextPaneIds.join("\n")) {
          clearPaneExpansionData(layout);
        }
      }
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

    function findActivePaneExpansions(project: PaneLayoutProject) {
      return collectPaneNodes(getProjectPaneLayout(project)).flatMap((pane) => (
        pane.expansion?.active === true
          ? [{ pane, paneIds: [...pane.expansion.paneIds] }]
          : []
      ));
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
      const layout = getProjectPaneLayout(project);
      const activeExpansions = findActivePaneExpansions(project);
      const activeExpansion = activeExpansions.find(({ pane }) => pane.id === paneId);
      const isOccupied = activeExpansions.some(({ paneIds }) => paneIds.includes(paneId));
      return {
        canExpand: countPaneNodes(layout) > 1 && !isOccupied,
        canShrink: Boolean(activeExpansion)
      };
    }

    /**
     * @param {PaneLayoutProject} project
     * @param {string} paneId
     * @returns {PaneAncestorPathItem | null}
     */
    function getPaneExpansionTarget(project: PaneLayoutProject, paneId: string) {
      const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
      return [...path].reverse()[0] || null;
    }

    function getPaneExpansionPaneIds(project: PaneLayoutProject, paneId: string) {
      const layout = getProjectPaneLayout(project);
      const pane = findPaneNode(layout, paneId);
      const knownPaneIds = new Set(collectPaneNodes(layout).map((candidate) => candidate.id));
      if (pane?.expansion) {
        const rememberedPaneIds = [...new Set(pane.expansion.paneIds)]
          .filter((candidateId) => knownPaneIds.has(candidateId));
        if (rememberedPaneIds.includes(paneId) && rememberedPaneIds.length > 1) {
          return rememberedPaneIds;
        }
      }

      const target = getPaneExpansionTarget(project, paneId);
      return target
        ? collectPaneNodes(target.node).map((candidate) => candidate.id)
        : [];
    }

    function activatePaneExpansion(project: PaneLayoutProject, paneId: string, paneIds: string[]) {
      const layout = getProjectPaneLayout(project);
      const panes = collectPaneNodes(layout);
      const knownPaneIds = new Set(panes.map((pane) => pane.id));
      const sourcePane = panes.find((pane) => pane.id === paneId);
      const nextPaneIds = [...new Set([paneId, ...paneIds])]
        .filter((candidateId) => knownPaneIds.has(candidateId));
      if (!sourcePane || nextPaneIds.length <= 1) {
        return false;
      }

      const nextPaneIdSet = new Set(nextPaneIds);
      for (const pane of panes) {
        if (pane.expansion?.active && pane.expansion.paneIds.some((candidateId) => nextPaneIdSet.has(candidateId))) {
          delete pane.expansion.active;
        }
      }
      sourcePane.expansion = {
        active: true,
        paneIds: nextPaneIds
      };
      return true;
    }

    function shrinkPaneExpansion(project: PaneLayoutProject, paneId: string) {
      const activeExpansion = findActivePaneExpansions(project)
        .find(({ pane }) => pane.id === paneId);
      if (!activeExpansion?.pane.expansion) {
        return false;
      }

      delete activeExpansion.pane.expansion.active;
      return true;
    }

    function clearExpandedChildren(node: PaneLayoutNode | null | undefined) {
      if (!node || node.type === "pane") {
        return;
      }

      delete node.expandedChild;
      clearExpandedChildren(node.first);
      clearExpandedChildren(node.second);
    }

    function clearPaneExpansionData(layout: PaneLayoutNode) {
      for (const pane of collectPaneNodes(layout)) {
        delete pane.expansion;
      }
      clearExpandedChildren(layout);
    }

    function clearPaneExpansionMemories(project: PaneLayoutProject) {
      clearPaneExpansionData(getProjectPaneLayout(project));
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

    function findNestedLegacyExpansionSource(node: PaneLayoutNode): PaneNode | null {
      if (node.type === "pane") {
        return null;
      }

      if (node.expandedChild === "first" || node.expandedChild === "second") {
        return findLegacyExpansionSource(node[node.expandedChild]);
      }

      return findNestedLegacyExpansionSource(node.first) || findNestedLegacyExpansionSource(node.second);
    }

    function findLegacyExpansionSource(node: PaneLayoutNode): PaneNode {
      if (node.type === "pane") {
        return node;
      }

      return findNestedLegacyExpansionSource(node) || findFirstPaneNode(node) as PaneNode;
    }

    function migrateLegacyPaneExpansion(node: PaneLayoutNode) {
      function findExpandedSplit(candidate: PaneLayoutNode): SplitNode | null {
        if (candidate.type === "pane") {
          return null;
        }

        if (candidate.expandedChild === "first" || candidate.expandedChild === "second") {
          return candidate;
        }

        return findExpandedSplit(candidate.first) || findExpandedSplit(candidate.second);
      }

      const expandedSplit = findExpandedSplit(node);
      if (!expandedSplit || !expandedSplit.expandedChild) {
        return;
      }

      const sourcePane = findLegacyExpansionSource(expandedSplit[expandedSplit.expandedChild]);
      sourcePane.expansion = {
        active: true,
        paneIds: collectPaneNodes(expandedSplit).map((pane) => pane.id)
      };
      clearExpandedChildren(node);
    }

    function sanitizePaneExpansions(node: PaneLayoutNode) {
      const panes = collectPaneNodes(node);
      const knownPaneIds = new Set(panes.map((pane) => pane.id));
      const activePaneIds = new Set<string>();
      for (const pane of panes) {
        if (!pane.expansion) {
          continue;
        }

        const paneIds = [...new Set([pane.id, ...pane.expansion.paneIds])]
          .filter((candidateId) => knownPaneIds.has(candidateId));
        if (paneIds.length <= 1) {
          delete pane.expansion;
          continue;
        }

        pane.expansion.paneIds = paneIds;
        if (!pane.expansion.active) {
          continue;
        }
        if (paneIds.some((candidateId) => activePaneIds.has(candidateId))) {
          delete pane.expansion.active;
          continue;
        }
        for (const candidateId of paneIds) {
          activePaneIds.add(candidateId);
        }
      }
    }

    /**
     * @param {Record<string, unknown>} persistedLayouts
     */
    function hydratePaneLayouts(persistedLayouts: Record<string, unknown> = {}) {
      for (const [projectId, layout] of Object.entries(persistedLayouts)) {
        const paneLayout = layout as PaneLayoutNode;
        migrateLegacyPaneExpansion(paneLayout);
        sanitizePaneExpansions(paneLayout);
        paneLayoutsByProject.set(projectId, paneLayout);
        hydratePaneLayoutSelections(paneLayout);
      }
    }

    return {
      activatePaneExpansion,
      clearPaneExpansionMemories,
      collectPaneNodes,
      countPaneNodes,
      createPaneNode,
      createSplitNode,
      findFirstPaneNode,
      findActivePaneExpansions,
      findPaneNode,
      findPaneNodeBySelectedWebApp,
      getPaneExpansionState,
      getPaneExpansionPaneIds,
      getPaneLayout,
      getProjectPaneLayout,
      getSelectedWebApp,
      getSelectedWebAppForPane: (paneId) => selectedWebAppByPane.get(paneId),
      getSelectedWebAppForProject: (projectId) => selectedWebAppByProject.get(projectId),
      hydratePaneLayouts,
      persistPaneLayout,
      removePaneNode,
      replacePaneNode,
      setPaneLayout,
      shrinkPaneExpansion,
      setSelectedWebAppForPane: (paneId, webAppId) => selectedWebAppByPane.set(paneId, webAppId),
      setSelectedWebAppForProject: (projectId, webAppId) => selectedWebAppByProject.set(projectId, webAppId),
      deleteSelectedWebAppForPane: (paneId) => selectedWebAppByPane.delete(paneId),
      deleteSelectedWebAppForProject: (projectId) => selectedWebAppByProject.delete(projectId)
    };
}
