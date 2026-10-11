import type { RendererPaneLayoutNode, RendererPaneNode, RendererProject } from "./rendererTypes.js";

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

  function getPaneCaptureBounds(project: RendererProject, paneId: string) {
    if (getVisibleWebAppProject()?.id !== project.id || surfaceHiddenPaneIds.has(paneId)) {
      return null;
    }
    const pane = document.querySelector<HTMLElement>(`.webapp-pane[data-pane-id="${CSS.escape(paneId)}"]`);
    if (!pane) {
      return null;
    }
    const rect = pane.getBoundingClientRect();
    const left = Math.ceil(Math.max(0, rect.left));
    const top = Math.ceil(Math.max(0, rect.top));
    const right = Math.floor(Math.min(window.innerWidth, rect.right));
    const bottom = Math.floor(Math.min(window.innerHeight, rect.bottom));
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
      return null;
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
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
    getWebAppByKey,
    persistPaneLayoutForWebApp,
    reset,
    set,
    setSurfaceHiddenPaneIds
  });
}
