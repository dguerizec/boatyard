"use strict";

(function () {
  function createPaneLayoutState({ updatePaneLayout }) {
    const selectedWebAppByProject = new Map();
    const paneLayoutsByProject = new Map();
    const selectedWebAppByPane = new Map();
    let nextPaneId = 1;

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

    function getProjectPaneLayout(project) {
      if (!paneLayoutsByProject.has(project.id)) {
        paneLayoutsByProject.set(project.id, createPaneNode(project));
      }

      return paneLayoutsByProject.get(project.id);
    }

    function setPaneLayout(projectId, layout) {
      paneLayoutsByProject.set(projectId, layout);
    }

    function getPaneLayout(projectId) {
      return paneLayoutsByProject.get(projectId);
    }

    function getSelectedWebApp(project, paneId, webApps) {
      const paneNode = findPaneNode(getProjectPaneLayout(project), paneId);
      const selectedId =
        selectedWebAppByPane.get(paneId) ||
        paneNode?.selectedWebAppId ||
        selectedWebAppByProject.get(project.id) ||
        webApps[0].id;
      return webApps.find((webApp) => webApp.id === selectedId) || webApps[0];
    }

    function findFirstPaneNode(node) {
      if (!node) {
        return null;
      }

      if (node.type === "pane") {
        return node;
      }

      return findFirstPaneNode(node.first) || findFirstPaneNode(node.second);
    }

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

    function findPaneNode(node, paneId) {
      if (!node) {
        return null;
      }

      if (node.type === "pane") {
        return node.id === paneId ? node : null;
      }

      return findPaneNode(node.first, paneId) || findPaneNode(node.second, paneId);
    }

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

    function getPaneExpansionState(project, paneId) {
      const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
      return {
        canExpand: path.some(({ node }) => !node.expandedChild),
        canShrink: path.some(({ node, side }) => node.expandedChild === side)
      };
    }

    function getPaneExpansionTarget(project, paneId) {
      const path = getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
      return [...path].reverse().find(({ node }) => !node.expandedChild) || null;
    }

    function countPaneNodes(node) {
      if (!node) {
        return 0;
      }

      if (node.type === "pane") {
        return 1;
      }

      return countPaneNodes(node.first) + countPaneNodes(node.second);
    }

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

    function persistPaneLayout(project) {
      const layout = paneLayoutsByProject.get(project.id);
      if (!layout) {
        return;
      }

      updatePaneLayout(project.id, layout).catch((error) => {
        console.error("Could not persist pane layout:", error);
      });
    }

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

  window.BoatyardPaneLayoutState = Object.freeze({
    create: createPaneLayoutState
  });
})();
