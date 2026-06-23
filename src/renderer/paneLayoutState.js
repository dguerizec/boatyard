// @ts-check
"use strict";

/**
 * @typedef {{ id: string }} PaneLayoutProject
 * @typedef {{ id: string }} PaneLayoutWebApp
 * @typedef {{ type: "pane", id: string, selectedWebAppId?: string | null }} PaneNode
 * @typedef {{ type: "split", id: string, direction: string, ratio: number, first: PaneLayoutNode, second: PaneLayoutNode, expandedChild?: "first" | "second" | "" | null }} SplitNode
 * @typedef {PaneNode | SplitNode} PaneLayoutNode
 * @typedef {{ node: SplitNode, side: "first" | "second" }} PaneAncestorPathItem
 * @typedef {{ node: PaneLayoutNode | null, removed: boolean }} RemovePaneResult
 * @typedef {{ updatePaneLayout: (projectId: string, layout: PaneLayoutNode) => Promise<unknown> }} PaneLayoutStateOptions
 * @typedef {{
 *   collectPaneNodes(node: PaneLayoutNode | null | undefined, panes?: PaneNode[]): PaneNode[],
 *   countPaneNodes(node: PaneLayoutNode | null | undefined): number,
 *   createPaneNode(project: PaneLayoutProject, selectedWebAppId?: string | null): PaneNode,
 *   createSplitNode(project: PaneLayoutProject, direction: string, first: PaneLayoutNode, selectedWebAppId?: string | null): SplitNode,
 *   findFirstPaneNode(node: PaneLayoutNode | null | undefined): PaneNode | null,
 *   findPaneNode(node: PaneLayoutNode | null | undefined, paneId: string): PaneNode | null,
 *   findPaneNodeBySelectedWebApp(node: PaneLayoutNode | null | undefined, webAppId: string): PaneNode | null,
 *   getPaneExpansionState(project: PaneLayoutProject, paneId: string): { canExpand: boolean, canShrink: boolean },
 *   getPaneExpansionTarget(project: PaneLayoutProject, paneId: string): PaneAncestorPathItem | null,
 *   getPaneAncestorPath(node: PaneLayoutNode | null | undefined, paneId: string, path?: PaneAncestorPathItem[]): PaneAncestorPathItem[] | null,
 *   getPaneLayout(projectId: string): PaneLayoutNode | undefined,
 *   getProjectPaneLayout(project: PaneLayoutProject): PaneLayoutNode,
 *   getSelectedWebApp(project: PaneLayoutProject, paneId: string, webApps: PaneLayoutWebApp[]): PaneLayoutWebApp,
 *   getSelectedWebAppForPane(paneId: string): string | undefined,
 *   getSelectedWebAppForProject(projectId: string): string | undefined,
 *   hydratePaneLayouts(persistedLayouts?: Record<string, PaneLayoutNode>): void,
 *   persistPaneLayout(project: PaneLayoutProject): void,
 *   removePaneNode(node: PaneLayoutNode | null | undefined, paneId: string): RemovePaneResult,
 *   replacePaneNode(node: PaneLayoutNode, paneId: string, replacement: PaneLayoutNode): PaneLayoutNode,
 *   setPaneLayout(projectId: string, layout: PaneLayoutNode): void,
 *   setSelectedWebAppForPane(paneId: string, webAppId: string): Map<string, string>,
 *   setSelectedWebAppForProject(projectId: string, webAppId: string): Map<string, string>,
 *   deleteSelectedWebAppForPane(paneId: string): boolean,
 *   deleteSelectedWebAppForProject(projectId: string): boolean
 * }} PaneLayoutStateApi
 */

(function () {
  /**
   * @param {PaneLayoutStateOptions} options
   * @returns {PaneLayoutStateApi}
   */
  function createPaneLayoutState({ updatePaneLayout }) {
    /** @type {Map<string, string>} */
    const selectedWebAppByProject = new Map();
    /** @type {Map<string, PaneLayoutNode>} */
    const paneLayoutsByProject = new Map();
    /** @type {Map<string, string>} */
    const selectedWebAppByPane = new Map();
    let nextPaneId = 1;

    /**
     * @param {PaneLayoutProject} project
     * @param {string | null} selectedWebAppId
     * @returns {PaneNode}
     */
    function createPaneNode(project, selectedWebAppId = null) {
      const id = `${project.id}:pane:${nextPaneId}`;
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
    function getProjectPaneLayout(project) {
      if (!paneLayoutsByProject.has(project.id)) {
        paneLayoutsByProject.set(project.id, createPaneNode(project));
      }

      return paneLayoutsByProject.get(project.id);
    }

    /**
     * @param {string} projectId
     * @param {PaneLayoutNode} layout
     */
    function setPaneLayout(projectId, layout) {
      paneLayoutsByProject.set(projectId, layout);
    }

    /**
     * @param {string} projectId
     * @returns {PaneLayoutNode | undefined}
     */
    function getPaneLayout(projectId) {
      return paneLayoutsByProject.get(projectId);
    }

    /**
     * @param {PaneLayoutProject} project
     * @param {string} paneId
     * @param {PaneLayoutWebApp[]} webApps
     * @returns {PaneLayoutWebApp}
     */
    function getSelectedWebApp(project, paneId, webApps) {
      const paneNode = findPaneNode(getProjectPaneLayout(project), paneId);
      const selectedId =
        selectedWebAppByPane.get(paneId) ||
        paneNode?.selectedWebAppId ||
        selectedWebAppByProject.get(project.id) ||
        webApps[0].id;
      return webApps.find((webApp) => webApp.id === selectedId) || webApps[0];
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @returns {PaneNode | null}
     */
    function findFirstPaneNode(node) {
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
    function collectPaneNodes(node, panes = []) {
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
    function findPaneNodeBySelectedWebApp(node, webAppId) {
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
    function createSplitNode(project, direction, first, selectedWebAppId = null) {
      return {
        type: "split",
        id: `${project.id}:split:${nextPaneId++}`,
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
    function findPaneNode(node, paneId) {
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
    function replacePaneNode(node, paneId, replacement) {
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
    function getPaneAncestorPath(node, paneId, path = []) {
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
    function getPaneExpansionState(project, paneId) {
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
    function getPaneExpansionTarget(project, paneId) {
      const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
      return [...path].reverse().find(({ node }) => !node.expandedChild) || null;
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     * @returns {number}
     */
    function countPaneNodes(node) {
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
    function removePaneNode(node, paneId) {
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
    function persistPaneLayout(project) {
      const layout = paneLayoutsByProject.get(project.id);
      if (!layout) {
        return;
      }

      updatePaneLayout(project.id, layout).catch((error) => {
        console.error("Could not persist pane layout:", error);
      });
    }

    /**
     * @param {PaneLayoutNode | null | undefined} node
     */
    function hydratePaneLayoutSelections(node) {
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
     * @param {Record<string, PaneLayoutNode>} persistedLayouts
     */
    function hydratePaneLayouts(persistedLayouts = {}) {
      for (const [projectId, layout] of Object.entries(persistedLayouts)) {
        paneLayoutsByProject.set(projectId, layout);
        hydratePaneLayoutSelections(layout);
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
      setSelectedWebAppForPane: (paneId, webAppId) => selectedWebAppByPane.set(paneId, webAppId),
      setSelectedWebAppForProject: (projectId, webAppId) => selectedWebAppByProject.set(projectId, webAppId),
      deleteSelectedWebAppForPane: (paneId) => selectedWebAppByPane.delete(paneId),
      deleteSelectedWebAppForProject: (projectId) => selectedWebAppByProject.delete(projectId)
    };
  }

  /** @type {Window & { BoatyardPaneLayoutState?: { create: typeof createPaneLayoutState } }} */
  const globalScope = window;
  globalScope.BoatyardPaneLayoutState = Object.freeze({
    create: createPaneLayoutState
  });
})();
