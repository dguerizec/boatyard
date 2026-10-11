import type { RendererPaneLayoutNode, RendererPaneNode, RendererProject } from "./rendererTypes.js";

export type PaneVisibility = {
  visible: boolean;
  reason: "visible" | "inactive_project" | "covered" | "not_rendered" | "outside_viewport" | "invalid_bounds";
};

type VisibleWebAppEntry = {
  host: HTMLElement;
  webApp: {
    id?: string;
    key: string;
    url: string;
  };
  [key: string]: unknown;
};

type VisibleWebAppTrackerOptions = {
  findPaneNode: (layout: RendererPaneLayoutNode | null | undefined, paneId?: string) => RendererPaneNode | null;
  getCurrentWebAppUrl: (webApp: VisibleWebAppEntry["webApp"]) => string | undefined;
  getPaneLayout: (project: RendererProject) => RendererPaneLayoutNode;
  getVisibleWebAppProject: () => RendererProject | null;
  isOnboardingTourActive: () => boolean;
  persistPaneLayout: (project: RendererProject) => void;
};

export function createVisibleWebAppTracker({
  findPaneNode,
  getCurrentWebAppUrl,
  getPaneLayout,
  getVisibleWebAppProject,
  isOnboardingTourActive,
  persistPaneLayout
}: VisibleWebAppTrackerOptions) {
  let visibleWebAppHosts = new Map<string, VisibleWebAppEntry>();
  let surfaceHiddenPaneIds = new Set<string>();

  function reset() {
    visibleWebAppHosts = new Map();
    surfaceHiddenPaneIds = new Set();
  }

  function set(paneId: string, entry: VisibleWebAppEntry) {
    visibleWebAppHosts.set(paneId, entry);
  }

  function getEntries() {
    return [...visibleWebAppHosts.entries()]
      .filter(([paneId]) => !surfaceHiddenPaneIds.has(paneId))
      .map(([paneId, entry]) => ({
        ...entry,
        paneId
      }));
  }

  function setSurfaceHiddenPaneIds(paneIds: Iterable<string>) {
    surfaceHiddenPaneIds = new Set(paneIds);
  }

  function resolvePanePresentation(project: RendererProject, paneId: string) {
    const hidden = (reason: PaneVisibility["reason"]) => ({
      bounds: null,
      visibility: { visible: false, reason } as PaneVisibility
    });
    if (getVisibleWebAppProject()?.id !== project.id) {
      return hidden("inactive_project");
    }
    if (surfaceHiddenPaneIds.has(paneId)) {
      return hidden("covered");
    }
    const pane = document.querySelector<HTMLElement>(`.webapp-pane[data-pane-id="${CSS.escape(paneId)}"]`);
    if (!pane) {
      return hidden("not_rendered");
    }
    const rect = pane.getBoundingClientRect();
    const left = Math.ceil(Math.max(0, rect.left));
    const top = Math.ceil(Math.max(0, rect.top));
    const right = Math.floor(Math.min(window.innerWidth, rect.right));
    const bottom = Math.floor(Math.min(window.innerHeight, rect.bottom));
    if (![left, top, right, bottom].every(Number.isFinite)) {
      return hidden("invalid_bounds");
    }
    if (right <= left || bottom <= top) {
      return hidden("outside_viewport");
    }
    return {
      bounds: { x: left, y: top, width: right - left, height: bottom - top },
      visibility: { visible: true, reason: "visible" } as PaneVisibility
    };
  }

  function getPaneCaptureBounds(project: RendererProject, paneId: string) {
    return resolvePanePresentation(project, paneId).bounds;
  }

  function getPaneVisibility(project: RendererProject, paneId: string): PaneVisibility {
    return resolvePanePresentation(project, paneId).visibility;
  }

  function getWebAppByKey(key: string) {
    for (const { webApp } of visibleWebAppHosts.values()) {
      if (webApp.key === key) {
        return webApp;
      }
    }

    return null;
  }

  function getEntryByKey(key: string) {
    for (const [paneId, entry] of visibleWebAppHosts.entries()) {
      if (entry.webApp.key === key) {
        return {
          ...entry,
          paneId
        };
      }
    }

    return null;
  }

  function getEntryByUrl(url: string) {
    if (!url) {
      return null;
    }

    for (const [paneId, entry] of visibleWebAppHosts.entries()) {
      if (getCurrentWebAppUrl(entry.webApp) === url || entry.webApp.url === url) {
        return {
          ...entry,
          paneId
        };
      }
    }

    return null;
  }

  function persistPaneLayoutForWebApp(key: string, url = "") {
    if (isOnboardingTourActive()) {
      return;
    }

    const sourceEntry = getEntryByKey(key);
    const project = sourceEntry ? getVisibleWebAppProject() : null;
    if (project && sourceEntry) {
      const paneNode = findPaneNode(getPaneLayout(project), sourceEntry.paneId);
      if (paneNode && paneNode.transientWebApp?.id === sourceEntry.webApp.id && url) {
        paneNode.transientWebApp = {
          ...paneNode.transientWebApp,
          url
        };
      }
      persistPaneLayout(project);
    }
  }

  return Object.freeze({
    getEntries,
    getEntryByKey,
    getEntryByUrl,
    getPaneCaptureBounds,
    getPaneVisibility,
    getWebAppByKey,
    persistPaneLayoutForWebApp,
    reset,
    set,
    setSurfaceHiddenPaneIds
  });
}
