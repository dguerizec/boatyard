import type { RendererPaneNode, RendererProject } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type { WidgetLayout, WidgetPane } from "./widgetSurfaceTypes.js";
import { createPaneIconLabel, shouldUseIconOnlyPaneTab } from "./paneIcons.js";
import {
  resolvePaneExpansionPaneIds,
  type PaneExpansionRect
} from "./paneExpansionGeometry.js";

type PaneLayoutHost = HTMLDivElement & {
  boatyardCleanup?: () => void;
};

type PaneSplitSide = "first" | "second";

type PaneNode = UnknownRecord & {
  expansion?: {
    active?: boolean;
    paneIds: string[];
  };
  id: string;
  selectedWebAppId?: string | null;
  type: "pane";
};

type SplitNode = UnknownRecord & {
  direction: string;
  expandedChild?: PaneSplitSide;
  first: PaneLayoutNode;
  id: string;
  ratio: number;
  second: PaneLayoutNode;
  type: "split";
};

type PaneLayoutNode = PaneNode | SplitNode;

type PaneLayoutStateApi = {
  activatePaneExpansion(project: RendererProject, paneId: string, paneIds: string[]): boolean;
  clearPaneExpansionMemories(project: RendererProject): void;
  countPaneNodes(node: unknown): number;
  createSplitNode(
    project: RendererProject,
    direction: string,
    first: unknown,
    selectedWebAppId?: string
  ): unknown;
  deleteSelectedWebAppForPane(paneId: string): unknown;
  findActivePaneExpansions(project: RendererProject): Array<{ pane: PaneNode; paneIds: string[] }>;
  findPaneNode(node: unknown, paneId: string): unknown;
  findPaneNodeBySelectedWebApp(node: unknown, webAppId: string): unknown;
  getPaneExpansionPaneIds(project: RendererProject, paneId: string): string[];
  getPaneExpansionState(project: RendererProject, paneId: string): { canExpand: boolean; canShrink: boolean };
  getSelectedWebAppForPane(paneId: string): string | undefined;
  getSelectedWebAppForProject(projectId?: string): string | undefined;
  removePaneNode(node: unknown, paneId: string): unknown;
  replacePaneNode(node: unknown, paneId: string, replacement: unknown): unknown;
  setPaneLayout(projectId: string | undefined, layout: unknown): unknown;
  setSelectedWebAppForPane(paneId: string, webAppId?: string): unknown;
  shrinkPaneExpansion(project: RendererProject, paneId: string): boolean;
};

type PaneWebApp = UnknownRecord & {
  icon?: string;
  iconOnly?: boolean;
  iconUrl?: string;
  id: string;
  key?: string;
  kind?: string;
  label?: string;
  mobileDev?: boolean;
  pluginPane?: {
    pluginId: string;
    render(host: HTMLElement, props: UnknownRecord): unknown;
    renderHeaderActions?(container: HTMLElement, props: UnknownRecord): unknown;
  };
  url?: string;
  widgetPane?: WidgetPane;
};

type VisiblePaneWebAppEntry = {
  host: HTMLElement;
  webApp: {
    id?: string;
    key: string;
    url: string;
  };
};

type PaneElementReuseMap = Map<string, HTMLElement>;

type PaneReuseOptions = {
  allowWebAppMenuChanges?: boolean;
};

type PaneReuseState = {
  mobileDev?: string;
  webAppId?: string;
  webAppKind?: string;
  webAppMenuSignature?: string;
};

type MobileDevViewportBookmark = {
  height: number;
  width: number;
};

type MobileDevViewportState = {
  bookmarks: MobileDevViewportBookmark[];
  enabled: boolean;
  height: number;
  width: number;
};

type PaneLayoutViewOptions = {
  minWidgetRailWidth: number;
  webAppSplitResizerSize: number;
  dashboardGrid: HTMLElement;
  createToolIcon: (iconName: string) => Node;
  paneLayoutState: PaneLayoutStateApi;
  getProjectWebApps: (project: RendererProject, paneId?: string) => unknown[];
  getProjectPaneLayout: (project: RendererProject) => unknown;
  getSelectedWebApp: (project: RendererProject, paneId: string, webApps: unknown[]) => unknown;
  getProjectWidgetLayout: (project: RendererProject, columns: number | null, widgetPaneId?: string) => WidgetLayout;
  getWidgetGridColumnCount: (width: number | null) => number;
  createWidgetPaneActions: (
    project: RendererProject,
    widgetPane: WidgetPane,
    widgetLayout: WidgetLayout,
    columns: number | null
  ) => HTMLElement;
  createWidgetPaneSurface: (project: RendererProject, widgetPane: WidgetPane) => HTMLElement;
  createWidgetPaneTabs: (
    project: RendererProject,
    paneNode: RendererPaneNode,
    selectedWebApp: PaneWebApp,
    webApps: PaneWebApp[],
    options: UnknownRecord
  ) => HTMLElement;
  isWebAppTabMenuOpen: () => boolean;
  closeWebAppTabMenu: () => void;
  openWebAppTabMenuFromButton: (
    button: HTMLButtonElement,
    project: RendererProject,
    paneNode: RendererPaneNode,
    selectedWebApp: PaneWebApp,
    webApps: PaneWebApp[]
  ) => void;
  openWebAppHomeMenu: (
    event: MouseEvent,
    project: RendererProject,
    paneNode: RendererPaneNode,
    selectedWebApp: PaneWebApp
  ) => void;
  openWebAppNavigationHistoryMenu: (event: MouseEvent, selectedWebApp: PaneWebApp, direction: "back" | "forward") => void;
  openWebAppRefreshMenu: (event: MouseEvent, selectedWebApp: PaneWebApp) => void;
  openWebAppUrlFieldMenu: (
    event: MouseEvent,
    project: RendererProject,
    selectedWebApp: PaneWebApp,
    url: string
  ) => void;
  createTerminalSurface: (project: RendererProject, options: UnknownRecord) => HTMLElement;
  invokeWebApp: (action: string, ...payload: unknown[]) => Promise<unknown>;
  isPasswordManagerEnabled: () => boolean;
  isWebAppAutofillEnabled: (webApp: PaneWebApp) => boolean;
  syncWebAppAutofillButton: (button: HTMLButtonElement, enabled: boolean) => void;
  toggleWebAppAutofill: (webApp: PaneWebApp, button: HTMLButtonElement) => Promise<unknown>;
  getCurrentWebAppUrl: (webApp: PaneWebApp) => string | undefined;
  setCurrentWebAppUrl: (key: string, url: string) => void;
  normalizeAddressInput: (value: string) => string;
  isCompactPaneTabs: () => boolean;
  isGlobalWorkspace: (project: RendererProject) => boolean;
  getProjectPluginConfig: (projectId: string | undefined, pluginId: string) => UnknownRecord;
  getGlobalPluginConfig: (pluginId: string) => UnknownRecord;
  getAllProjectPluginConfig: (project: RendererProject) => UnknownRecord;
  openProjectWebApp: (projectId: string | undefined, webAppId: string, url: string) => unknown;
  setHiddenWebAppPaneIds: (paneIds: Iterable<string>) => void;
  setVisibleWebAppHost: (paneId: string, entry: VisiblePaneWebAppEntry) => void;
  resetVisibleWebAppHosts: () => void;
  queueWebAppSync: () => void;
  persistPaneLayout: (project: RendererProject) => void;
};

export function canReusePaneElement(
  current: PaneReuseState,
  next: PaneReuseState,
  options: PaneReuseOptions = {}
) {
  return current.webAppId === next.webAppId &&
    current.webAppKind === next.webAppKind &&
    current.mobileDev === next.mobileDev &&
    (
      options.allowWebAppMenuChanges === true ||
      current.webAppMenuSignature === next.webAppMenuSignature
    );
}

export function createPaneLayoutView({
    minWidgetRailWidth,
    webAppSplitResizerSize,
    dashboardGrid,
    createToolIcon,
    paneLayoutState,
    getProjectWebApps,
    getProjectPaneLayout,
    getSelectedWebApp,
    getProjectWidgetLayout,
    getWidgetGridColumnCount,
    createWidgetPaneActions,
    createWidgetPaneSurface,
    createWidgetPaneTabs,
    isWebAppTabMenuOpen,
    closeWebAppTabMenu,
    openWebAppTabMenuFromButton,
    openWebAppHomeMenu,
    openWebAppNavigationHistoryMenu,
    openWebAppRefreshMenu,
    openWebAppUrlFieldMenu,
    createTerminalSurface,
    invokeWebApp,
    isPasswordManagerEnabled,
    isWebAppAutofillEnabled,
    syncWebAppAutofillButton,
    toggleWebAppAutofill,
    getCurrentWebAppUrl,
    setCurrentWebAppUrl,
    normalizeAddressInput,
    isCompactPaneTabs,
    isGlobalWorkspace,
    getProjectPluginConfig,
    getGlobalPluginConfig,
    getAllProjectPluginConfig,
    openProjectWebApp,
    setHiddenWebAppPaneIds,
    setVisibleWebAppHost,
    resetVisibleWebAppHosts,
    queueWebAppSync,
    persistPaneLayout
  }: PaneLayoutViewOptions) {
    const mobileDevViewports = new Map<string, MobileDevViewportState>();
    const mobileDevStoragePrefix = "boatyard.mobile-dev-viewport:";
    const mobileDevRulerWidth = 32;
    const mobileDevRulerHeight = 24;
    const mobileDevHostPadding = 20;
    let activeExpansionsCleanup: (() => void) | null = null;
    let isPaintingPaneExpansion = false;
    let suppressExpansionClickUntil = 0;

    function clamp(value: number, min: number, max: number) {
      return Math.min(max, Math.max(min, value));
    }

    function getMobileDevViewportKey(webApp: PaneWebApp) {
      return webApp.id || webApp.key || "";
    }

    function getProjectWebAppState(project: RendererProject, webAppId: string) {
      const paneNode = paneLayoutState.findPaneNodeBySelectedWebApp(
        getProjectPaneLayout(project),
        webAppId
      ) as PaneNode | null;
      if (!paneNode) {
        return null;
      }
      const webApp = (getProjectWebApps(project, paneNode.id) as PaneWebApp[])
        .find((candidate) => candidate.id === webAppId);
      if (!webApp) {
        return null;
      }
      return {
        key: webApp.key || "",
        url: getCurrentWebAppUrl(webApp) || webApp.url || ""
      };
    }

    function normalizeMobileDevBookmark(value: unknown): MobileDevViewportBookmark | null {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }

      const record = value as UnknownRecord;
      const width = Math.round(Number(record.width));
      const height = Math.round(Number(record.height));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 160 || height < 160) {
        return null;
      }

      return { width, height };
    }

    function readPersistedMobileDevViewportState(key: string): Partial<MobileDevViewportState> {
      try {
        const raw = window.localStorage?.getItem(`${mobileDevStoragePrefix}${key}`);
        if (!raw) {
          return {};
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return {};
        }

        const record = parsed as UnknownRecord;
        const bookmarks = Array.isArray(record.bookmarks)
          ? record.bookmarks.map(normalizeMobileDevBookmark).filter((bookmark): bookmark is MobileDevViewportBookmark => Boolean(bookmark))
          : [];
        const width = Math.round(Number(record.width));
        const height = Math.round(Number(record.height));
        return {
          bookmarks,
          enabled: record.enabled === true,
          ...(Number.isFinite(width) && width >= 160 ? { width } : {}),
          ...(Number.isFinite(height) && height >= 160 ? { height } : {})
        };
      } catch {
        return {};
      }
    }

    function persistMobileDevViewportState(key: string, state: MobileDevViewportState) {
      try {
        window.localStorage?.setItem(`${mobileDevStoragePrefix}${key}`, JSON.stringify({
          bookmarks: state.bookmarks,
          enabled: state.enabled,
          height: state.height,
          width: state.width
        }));
      } catch {
        // Viewport bookmarks are a convenience and can stay in memory if storage is unavailable.
      }
    }

    function getMobileDevViewportState(webApp: PaneWebApp) {
      const key = getMobileDevViewportKey(webApp);
      const existing = mobileDevViewports.get(key);
      if (existing) {
        return existing;
      }

      const persisted = readPersistedMobileDevViewportState(key);
      const state = {
        bookmarks: persisted.bookmarks || [],
        enabled: persisted.enabled === true,
        height: persisted.height || 844,
        width: persisted.width || 390
      };
      mobileDevViewports.set(key, state);
      return state;
    }

    function isMobileDevViewportEnabled(webApp: PaneWebApp) {
      return webApp.mobileDev === true && getMobileDevViewportState(webApp).enabled;
    }

    function getPaneElements() {
      return [...dashboardGrid.querySelectorAll<HTMLElement>(".webapp-pane[data-pane-id]")];
    }

    function getPaneExpansionRects(): PaneExpansionRect[] {
      const paneRects = getPaneElements().flatMap((pane) => {
        if (!pane.dataset.paneId || pane.classList.contains("pane-expanded")) {
          return [];
        }

        const rect = pane.getBoundingClientRect();
        return [{
          bottom: rect.bottom,
          id: pane.dataset.paneId,
          left: rect.left,
          right: rect.right,
          top: rect.top
        }];
      });
      const placeholderRects = [...dashboardGrid.querySelectorAll<HTMLElement>(
        ".pane-expansion-placeholder[data-pane-id]"
      )].flatMap((placeholder) => {
        if (!placeholder.dataset.paneId) {
          return [];
        }

        const rect = placeholder.getBoundingClientRect();
        return [{
          bottom: rect.bottom,
          id: placeholder.dataset.paneId,
          left: rect.left,
          right: rect.right,
          top: rect.top
        }];
      });
      return [...paneRects, ...placeholderRects];
    }

    function findPaneElement(paneId: string) {
      return getPaneElements().find((pane) => pane.dataset.paneId === paneId) || null;
    }

    function clearPaneExpansionPreview() {
      for (const pane of getPaneElements()) {
        pane.classList.remove("pane-expand-preview");
      }
    }

    function resolvePaneExpansionSelection(paneIds: Iterable<string>) {
      return resolvePaneExpansionPaneIds(getPaneExpansionRects(), paneIds);
    }

    function showPaneExpansionPreview(project: RendererProject, paneIds: Iterable<string>) {
      clearPaneExpansionPreview();
      const selectedPaneIds = new Set(resolvePaneExpansionSelection(paneIds));
      for (const pane of getPaneElements()) {
        pane.classList.toggle("pane-expand-preview", Boolean(
          pane.dataset.paneId && selectedPaneIds.has(pane.dataset.paneId)
        ));
      }
      for (const activeExpansion of paneLayoutState.findActivePaneExpansions(project)) {
        if (!activeExpansion.paneIds.some((paneId) => selectedPaneIds.has(paneId))) {
          continue;
        }

        findPaneElement(activeExpansion.pane.id)?.classList.add("pane-expand-preview");
      }
      return [...selectedPaneIds];
    }

    function previewPaneExpansion(project: RendererProject, paneId: string, enabled: boolean) {
      clearPaneExpansionPreview();
      if (!enabled || isPaintingPaneExpansion) {
        return;
      }

      showPaneExpansionPreview(project, paneLayoutState.getPaneExpansionPaneIds(project, paneId));
    }

    function clearActivePaneExpansionPresentation() {
      activeExpansionsCleanup?.();
      activeExpansionsCleanup = null;
    }

    function applyActivePaneExpansionPresentation(project: RendererProject) {
      clearActivePaneExpansionPresentation();
      const activeExpansions = paneLayoutState.findActivePaneExpansions(project);
      if (!activeExpansions.length) {
        return;
      }

      const presentations = activeExpansions.flatMap((activeExpansion) => {
        const expandedPane = findPaneElement(activeExpansion.pane.id);
        const coveredPanes = activeExpansion.paneIds
          .map((paneId) => findPaneElement(paneId))
          .filter((pane): pane is HTMLElement => Boolean(pane));
        if (!expandedPane || coveredPanes.length <= 1) {
          return [];
        }

        const placeholder = document.createElement("div");
        placeholder.className = "pane-expansion-placeholder";
        placeholder.dataset.paneId = expandedPane.dataset.paneId;
        expandedPane.before(placeholder);
        expandedPane.classList.add("pane-expanded");
        return [{
          activeExpansion,
          coveredPanes,
          expandedPane,
          placeholder
        }];
      });
      if (!presentations.length) {
        return;
      }
      dashboardGrid.classList.add("pane-expansion-active");
      setHiddenWebAppPaneIds(new Set(presentations.flatMap(({ activeExpansion }) => (
        activeExpansion.paneIds.filter((paneId) => paneId !== activeExpansion.pane.id)
      ))));

      function updateExpandedPaneBounds() {
        for (const { coveredPanes, expandedPane, placeholder } of presentations) {
          if (!expandedPane.isConnected || !placeholder.isConnected) {
            continue;
          }

          const rects = coveredPanes.map((pane) => (
            pane === expandedPane ? placeholder : pane
          ).getBoundingClientRect());
          expandedPane.style.left = `${Math.min(...rects.map((rect) => rect.left))}px`;
          expandedPane.style.top = `${Math.min(...rects.map((rect) => rect.top))}px`;
          expandedPane.style.width = `${Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left))}px`;
          expandedPane.style.height = `${Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top))}px`;
        }
        queueWebAppSync();
      }

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(updateExpandedPaneBounds);
      }
      resizeObserver?.observe(dashboardGrid);
      for (const { coveredPanes, expandedPane, placeholder } of presentations) {
        resizeObserver?.observe(placeholder);
        for (const pane of coveredPanes) {
          if (pane !== expandedPane) {
            resizeObserver?.observe(pane);
          }
        }
      }
      window.addEventListener("resize", updateExpandedPaneBounds);
      window.addEventListener("scroll", updateExpandedPaneBounds, true);
      updateExpandedPaneBounds();

      activeExpansionsCleanup = () => {
        resizeObserver?.disconnect();
        window.removeEventListener("resize", updateExpandedPaneBounds);
        window.removeEventListener("scroll", updateExpandedPaneBounds, true);
        setHiddenWebAppPaneIds([]);
        dashboardGrid.classList.remove("pane-expansion-active");
        for (const { expandedPane, placeholder } of presentations) {
          expandedPane.classList.remove("pane-expanded");
          expandedPane.style.left = "";
          expandedPane.style.top = "";
          expandedPane.style.width = "";
          expandedPane.style.height = "";
          placeholder.remove();
        }
        queueWebAppSync();
      };
    }

    function scheduleActivePaneExpansionPresentation(project: RendererProject) {
      window.requestAnimationFrame(() => {
        applyActivePaneExpansionPresentation(project);
        syncVisiblePaneActions(project);
      });
    }

    function activatePaneExpansion(project: RendererProject, paneId: string, paneIds: Iterable<string>) {
      const resolvedPaneIds = resolvePaneExpansionSelection(paneIds);
      if (!paneLayoutState.activatePaneExpansion(project, paneId, resolvedPaneIds)) {
        return false;
      }

      clearPaneExpansionPreview();
      persistPaneLayout(project);
      applyActivePaneExpansionPresentation(project);
      syncVisiblePaneActions(project);
      return true;
    }

    function shrinkPane(project: RendererProject, paneId: string) {
      if (!paneLayoutState.shrinkPaneExpansion(project, paneId)) {
        return;
      }

      applyActivePaneExpansionPresentation(project);
      persistPaneLayout(project);
      syncVisiblePaneActions(project);
    }

    function togglePaneExpansion(project: RendererProject, paneId: string) {
      const expansionState = paneLayoutState.getPaneExpansionState(project, paneId);
      if (expansionState.canShrink) {
        shrinkPane(project, paneId);
        return;
      }

      if (expansionState.canExpand) {
        activatePaneExpansion(project, paneId, paneLayoutState.getPaneExpansionPaneIds(project, paneId));
      }
    }

    function isPointInsideRect(
      event: PointerEvent,
      rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">
    ) {
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
    }

    function findPaneIdAtPoint(event: PointerEvent) {
      return getPaneExpansionRects().find((rect) => isPointInsideRect(event, rect))?.id || "";
    }

    function startPaneExpansionBrush(
      event: PointerEvent,
      project: RendererProject,
      paneId: string,
      button: HTMLButtonElement
    ) {
      const expansionState = paneLayoutState.getPaneExpansionState(project, paneId);
      if (event.button !== 0 || button.disabled || expansionState.canShrink) {
        return;
      }

      const touchedPaneIds = new Set([paneId]);
      let coveredPaneIds = showPaneExpansionPreview(project, touchedPaneIds);
      let didDrag = false;
      let didLeaveButton = false;
      let isResetting = false;
      let wasCancelled = false;
      const startX = event.clientX;
      const startY = event.clientY;
      isPaintingPaneExpansion = true;
      button.classList.add("painting");
      button.setAttribute("aria-pressed", "true");
      button.setPointerCapture?.(event.pointerId);

      function cleanup() {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerCancel);
        document.removeEventListener("keydown", onKeyDown);
        if (button.hasPointerCapture?.(event.pointerId)) {
          button.releasePointerCapture(event.pointerId);
        }
        button.classList.remove("painting");
        button.classList.remove("reset-target");
        const paneNode = paneLayoutState.findPaneNode(getProjectPaneLayout(project), paneId) as PaneNode | null;
        if (paneNode) {
          syncPaneExpansionButton(project, paneNode, button);
        }
        isPaintingPaneExpansion = false;
        clearPaneExpansionPreview();
      }

      function resetSelection() {
        touchedPaneIds.clear();
        touchedPaneIds.add(paneId);
        coveredPaneIds = showPaneExpansionPreview(project, touchedPaneIds);
      }

      function onPointerMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== event.pointerId || wasCancelled) {
          return;
        }

        if (!didDrag) {
          const movedX = Math.abs(moveEvent.clientX - startX);
          const movedY = Math.abs(moveEvent.clientY - startY);
          if (movedX < 4 && movedY < 4) {
            return;
          }
          didDrag = true;
        }

        const isOverButton = isPointInsideRect(moveEvent, button.getBoundingClientRect());
        if (!isOverButton) {
          if (!didLeaveButton) {
            button.classList.add("reset-target");
            button.title = "Reset pane selection";
            button.setAttribute("aria-label", "Reset pane selection");
            button.replaceChildren(createToolIcon("refresh"));
          }
          didLeaveButton = true;
          isResetting = false;
        } else if (didLeaveButton && !isResetting) {
          resetSelection();
          isResetting = true;
          return;
        }

        const touchedPaneId = findPaneIdAtPoint(moveEvent);
        if (touchedPaneId && !touchedPaneIds.has(touchedPaneId)) {
          touchedPaneIds.add(touchedPaneId);
          coveredPaneIds = showPaneExpansionPreview(project, touchedPaneIds);
        }
      }

      function onPointerUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== event.pointerId) {
          return;
        }

        cleanup();
        if (wasCancelled) {
          suppressExpansionClickUntil = Date.now() + 250;
          return;
        }
        if (!didDrag) {
          suppressExpansionClickUntil = Date.now() + 250;
          togglePaneExpansion(project, paneId);
          return;
        }

        suppressExpansionClickUntil = Date.now() + 250;
        activatePaneExpansion(project, paneId, coveredPaneIds);
      }

      function onPointerCancel(cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId !== event.pointerId) {
          return;
        }

        suppressExpansionClickUntil = Date.now() + 250;
        cleanup();
      }

      function onKeyDown(keyEvent: KeyboardEvent) {
        if (keyEvent.key !== "Escape") {
          return;
        }

        keyEvent.preventDefault();
        wasCancelled = true;
        resetSelection();
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("keydown", onKeyDown);
        button.classList.remove("painting");
        button.classList.remove("reset-target");
        const paneNode = paneLayoutState.findPaneNode(getProjectPaneLayout(project), paneId) as PaneNode | null;
        if (paneNode) {
          syncPaneExpansionButton(project, paneNode, button);
        }
        isPaintingPaneExpansion = false;
        clearPaneExpansionPreview();
      }

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerCancel);
      document.addEventListener("keydown", onKeyDown);
    }

    function splitPane(project: RendererProject, paneId: string, direction: string) {
      const layout = getProjectPaneLayout(project);
      const currentPaneNode = paneLayoutState.findPaneNode(layout, paneId) as PaneNode | null;
      if (!currentPaneNode) {
        return;
      }

      const webApps = getProjectWebApps(project, paneId).map((webApp) => webApp as PaneWebApp);
      const currentWebAppId =
        paneLayoutState.getSelectedWebAppForPane(paneId) ||
        paneLayoutState.getSelectedWebAppForProject(project.id) ||
        webApps[0]?.id;
      const nextWebAppId =
        webApps.find((webApp: PaneWebApp) => webApp.id === "manual")?.id ||
        webApps.find((webApp: PaneWebApp) => webApp.id !== currentWebAppId)?.id ||
        currentWebAppId;
      paneLayoutState.clearPaneExpansionMemories(project);
      const replacement = paneLayoutState.createSplitNode(
        project,
        direction,
        { ...currentPaneNode, selectedWebAppId: currentWebAppId },
        nextWebAppId
      ) as PaneLayoutNode & { first: PaneLayoutNode };
      replacement.first.selectedWebAppId = currentWebAppId;
      paneLayoutState.setPaneLayout(project.id, paneLayoutState.replacePaneNode(layout, paneId, replacement));
      paneLayoutState.setSelectedWebAppForPane(paneId, currentWebAppId);
      persistPaneLayout(project);
      renderPaneLayoutPreservingPanes(project);
    }

    function closePane(project: RendererProject, paneId: string) {
      const layout = getProjectPaneLayout(project);

      if (paneLayoutState.countPaneNodes(layout) <= 1) {
        return;
      }

      const result = paneLayoutState.removePaneNode(layout, paneId) as { node: PaneLayoutNode; removed: boolean };
      if (!result.removed) {
        return;
      }

      paneLayoutState.clearPaneExpansionMemories(project);
      paneLayoutState.deleteSelectedWebAppForPane(paneId);
      paneLayoutState.setPaneLayout(project.id, result.node);
      persistPaneLayout(project);
      renderPaneLayoutPreservingPanes(project);
    }

    function findSplitParent(
      node: PaneLayoutNode,
      splitId: string
    ): { node: SplitNode; side: PaneSplitSide } | null {
      if (node.type === "pane") {
        return null;
      }

      if (node.first.type === "split" && node.first.id === splitId) {
        return { node, side: "first" };
      }

      if (node.second.type === "split" && node.second.id === splitId) {
        return { node, side: "second" };
      }

      return findSplitParent(node.first, splitId) || findSplitParent(node.second, splitId);
    }

    function demoteSplitThroughFirstChild(splitNode: SplitNode, containerSize: number) {
      const pivot = splitNode.first;
      if (pivot.type !== "split" || pivot.direction !== splitNode.direction || pivot.expandedChild) {
        return null;
      }

      const pivotFirst = pivot.first;
      const pivotSecond = pivot.second;
      const second = splitNode.second;
      const splitRatio = clamp(Number(splitNode.ratio) || 0.5, 0.15, 0.85);
      const pivotRatio = clamp(Number(pivot.ratio) || 0.5, 0.15, 0.85);
      const resizerOffset = webAppSplitResizerSize / 2;
      const splitCenter = splitRatio * containerSize;
      const pivotContainerSize = Math.max(1, splitCenter - resizerOffset);
      const pivotCenter = pivotRatio * pivotContainerSize;
      const nextPivotRatio = clamp(pivotCenter / containerSize, 0.15, 0.85);
      const nextSplitContainerSize = Math.max(1, containerSize - (nextPivotRatio * containerSize) - resizerOffset);
      const nextSplitRatio = clamp(
        (splitCenter - (nextPivotRatio * containerSize) - resizerOffset) / nextSplitContainerSize,
        0.15,
        0.85
      );

      splitNode.first = pivotSecond;
      splitNode.second = second;
      splitNode.ratio = nextSplitRatio;
      pivot.first = pivotFirst;
      pivot.second = splitNode;
      pivot.ratio = nextPivotRatio;
      return {
        replacement: pivot,
        nextContainerSize: nextSplitContainerSize
      };
    }

    function demoteSplitThroughSecondChild(splitNode: SplitNode, containerSize: number) {
      const pivot = splitNode.second;
      if (pivot.type !== "split" || pivot.direction !== splitNode.direction || pivot.expandedChild) {
        return null;
      }

      const first = splitNode.first;
      const pivotFirst = pivot.first;
      const pivotSecond = pivot.second;
      const splitRatio = clamp(Number(splitNode.ratio) || 0.5, 0.15, 0.85);
      const pivotRatio = clamp(Number(pivot.ratio) || 0.5, 0.15, 0.85);
      const resizerOffset = webAppSplitResizerSize / 2;
      const splitCenter = splitRatio * containerSize;
      const pivotContainerSize = Math.max(1, containerSize - splitCenter - resizerOffset);
      const pivotCenter = splitCenter + resizerOffset + (pivotRatio * pivotContainerSize);
      const nextPivotRatio = clamp(pivotCenter / containerSize, 0.15, 0.85);
      const nextSplitContainerSize = Math.max(1, (nextPivotRatio * containerSize) - resizerOffset);
      const nextSplitRatio = clamp(splitCenter / nextSplitContainerSize, 0.15, 0.85);

      splitNode.first = first;
      splitNode.second = pivotFirst;
      splitNode.ratio = nextSplitRatio;
      pivot.first = splitNode;
      pivot.second = pivotSecond;
      pivot.ratio = nextPivotRatio;
      return {
        replacement: pivot,
        nextContainerSize: nextSplitContainerSize
      };
    }

    function normalizeSplitForResize(project: RendererProject, splitNode: SplitNode, splitElement: HTMLElement) {
      let layout = getProjectPaneLayout(project) as PaneLayoutNode;
      let didNormalize = false;
      let containerSize = splitNode.direction === "vertical"
        ? splitElement.getBoundingClientRect().width
        : splitElement.getBoundingClientRect().height;
      const maxRotations = Math.max(1, paneLayoutState.countPaneNodes(layout) - 1);

      for (let index = 0; index < maxRotations; index += 1) {
        const parent = layout.type === "split" && layout.id === splitNode.id
          ? null
          : findSplitParent(layout, splitNode.id);
        const replacement =
          demoteSplitThroughFirstChild(splitNode, containerSize) ||
          demoteSplitThroughSecondChild(splitNode, containerSize);
        if (!replacement) {
          break;
        }

        if (parent) {
          parent.node[parent.side] = replacement.replacement;
        } else {
          layout = replacement.replacement;
        }
        containerSize = replacement.nextContainerSize;
        didNormalize = true;
      }

      if (didNormalize) {
        paneLayoutState.setPaneLayout(project.id, layout);
      }
      return didNormalize;
    }

    function collectReusablePaneElements() {
      const panes = new Map<string, HTMLElement>();
      dashboardGrid.querySelectorAll<HTMLElement>(".webapp-pane[data-pane-id]").forEach((pane) => {
        if (pane.dataset.paneId) {
          panes.set(pane.dataset.paneId, pane);
        }
      });
      return panes;
    }

    function getDirectPaneHost(pane: HTMLElement) {
      return Array.from(pane.children)
        .find((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("webapp-host")) || null;
    }

    function getVisiblePaneHost(pane: HTMLElement, selectedWebApp: PaneWebApp) {
      const directHost = getDirectPaneHost(pane);
      if (!directHost) {
        return null;
      }

      if (!isMobileDevViewportEnabled(selectedWebApp)) {
        return directHost;
      }

      return directHost.querySelector<HTMLElement>(".webapp-mobile-dev-viewport") || directHost;
    }

    function getWebAppMenuSignature(webApps: PaneWebApp[]) {
      return JSON.stringify(webApps.map((webApp) => ({
        id: webApp.id || "",
        kind: webApp.kind || "",
        label: String(webApp.label || ""),
        parentWebAppId: webApp.parentWebAppId || "",
        url: webApp.url || ""
      })));
    }

    function getPaneActionButton(pane: HTMLElement, action: string, label: string) {
      return pane.querySelector<HTMLButtonElement>(
        `button[data-pane-action="${action}"], button[aria-label="${label}"]`
      );
    }

    function syncPaneExpansionButton(project: RendererProject, paneNode: PaneNode, button: HTMLButtonElement) {
      const expansionState = paneLayoutState.getPaneExpansionState(project, paneNode.id);
      const isShrink = expansionState.canShrink;
      const label = isShrink ? "Shrink pane" : "Expand pane";
      button.dataset.paneAction = "toggle-expand";
      button.dataset.paneExpansionMode = isShrink ? "shrink" : "expand";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(isShrink));
      button.disabled = isShrink ? false : !expansionState.canExpand;
      button.classList.toggle("active", isShrink);
      button.replaceChildren(createToolIcon(isShrink ? "shrinkPane" : "expandPane"));
    }

    function syncReusedPaneActions(project: RendererProject, paneNode: PaneNode, pane: HTMLElement) {
      const hasActiveExpansions = paneLayoutState.findActivePaneExpansions(project).length > 0;
      const expansionButton = getPaneActionButton(pane, "toggle-expand", "Expand pane") ||
        getPaneActionButton(pane, "shrink", "Shrink pane");
      const verticalSplitButton = getPaneActionButton(pane, "split-vertical", "Split vertically");
      const horizontalSplitButton = getPaneActionButton(pane, "split-horizontal", "Split horizontally");
      const closePaneButton = getPaneActionButton(pane, "close", "Close pane");

      if (expansionButton) {
        syncPaneExpansionButton(project, paneNode, expansionButton);
      }

      if (verticalSplitButton) {
        verticalSplitButton.disabled = hasActiveExpansions;
      }

      if (horizontalSplitButton) {
        horizontalSplitButton.disabled = hasActiveExpansions;
      }

      if (closePaneButton) {
        closePaneButton.disabled = hasActiveExpansions ||
          paneLayoutState.countPaneNodes(getProjectPaneLayout(project)) <= 1;
      }
    }

    function syncVisiblePaneActions(project: RendererProject) {
      for (const pane of getPaneElements()) {
        const paneId = pane.dataset.paneId;
        const paneNode = paneId
          ? paneLayoutState.findPaneNode(getProjectPaneLayout(project), paneId) as PaneNode | null
          : null;
        if (paneNode) {
          syncReusedPaneActions(project, paneNode, pane);
        }
      }
    }

    function reuseWebAppPane(
      project: RendererProject,
      paneNode: PaneNode,
      reusablePanes?: PaneElementReuseMap,
      options: PaneReuseOptions = {}
    ) {
      if (!reusablePanes) {
        return null;
      }

      const pane = reusablePanes.get(paneNode.id);
      if (!pane) {
        return null;
      }

      const webApps = getProjectWebApps(project, paneNode.id).map((webApp) => webApp as PaneWebApp);
      const selectedWebApp = getSelectedWebApp(project, paneNode.id, webApps) as PaneWebApp;
      const nextMenuSignature = getWebAppMenuSignature(webApps);
      if (!canReusePaneElement(pane.dataset, {
        mobileDev: String(isMobileDevViewportEnabled(selectedWebApp)),
        webAppId: selectedWebApp.id,
        webAppKind: selectedWebApp.kind,
        webAppMenuSignature: nextMenuSignature
      }, options)) {
        return null;
      }

      reusablePanes.delete(paneNode.id);
      pane.dataset.webAppMenuSignature = nextMenuSignature;
      syncReusedPaneActions(project, paneNode, pane);
      if (!["dom", "terminal", "widgets"].includes(selectedWebApp.kind || "")) {
        const host = getVisiblePaneHost(pane, selectedWebApp);
        if (host) {
          setVisibleWebAppHost(paneNode.id, {
            webApp: selectedWebApp,
            host
          } as VisiblePaneWebAppEntry);
        }
      }
      queueWebAppSync();
      return pane;
    }

    function renderPaneLayoutPreservingPanes(project: RendererProject, options: PaneReuseOptions = {}) {
      const reusablePanes = collectReusablePaneElements();
      resetVisibleWebAppHosts();
      const paneLayoutElement = createPaneLayout(
        project,
        getProjectPaneLayout(project) as PaneLayoutNode,
        reusablePanes,
        options
      );
      const currentPaneLayoutElement = dashboardGrid.lastElementChild;
      if (!currentPaneLayoutElement) {
        dashboardGrid.append(paneLayoutElement);
        return;
      }

      currentPaneLayoutElement.replaceWith(paneLayoutElement);
    }

    function createSplitResizer(project: RendererProject, splitNode: SplitNode) {
      const resizer = document.createElement("div");
      resizer.className = `webapp-split-resizer ${splitNode.direction}`;
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", splitNode.direction === "vertical" ? "vertical" : "horizontal");

      resizer.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const splitElement = resizer.parentElement;
        if (!splitElement) {
          return;
        }
        const isVertical = splitNode.direction === "vertical";
        const startX = event.clientX;
        const startY = event.clientY;
        let parentSplitElement = splitElement;
        let rect = parentSplitElement.getBoundingClientRect();
        let didStartDrag = false;

        function startDrag() {
          didStartDrag = true;
          if (!normalizeSplitForResize(project, splitNode, parentSplitElement)) {
            return true;
          }

          renderPaneLayoutPreservingPanes(project);
          const normalizedSplitElement = document.querySelector<HTMLElement>(
            `.webapp-split[data-split-id="${CSS.escape(splitNode.id)}"]`
          );
          if (!normalizedSplitElement) {
            return false;
          }

          parentSplitElement = normalizedSplitElement;
          rect = parentSplitElement.getBoundingClientRect();
          return true;
        }

        function onPointerMove(moveEvent: PointerEvent) {
          if (!didStartDrag) {
            const movedX = Math.abs(moveEvent.clientX - startX);
            const movedY = Math.abs(moveEvent.clientY - startY);
            if (movedX < 2 && movedY < 2) {
              return;
            }
            if (!startDrag()) {
              onPointerUp();
              return;
            }
          }

          const rawRatio = isVertical
            ? (moveEvent.clientX - rect.left) / rect.width
            : (moveEvent.clientY - rect.top) / rect.height;
          splitNode.ratio = clamp(rawRatio, 0.15, 0.85);
          applySplitRatio(parentSplitElement, splitNode);
          queueWebAppSync();
        }

        function onPointerUp() {
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          if (didStartDrag) {
            persistPaneLayout(project);
          }
        }

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
      });

      return resizer;
    }

    function fitMobileDevViewportToHost(host: HTMLElement, state: MobileDevViewportState) {
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const maxWidth = Math.max(160, Math.floor(rect.width - mobileDevHostPadding - mobileDevRulerWidth - 2));
      const maxHeight = Math.max(160, Math.floor(rect.height - mobileDevHostPadding - mobileDevRulerHeight - 2));
      state.width = clamp(state.width, 160, maxWidth);
      state.height = clamp(state.height, 160, maxHeight);
    }

    function updateMobileDevViewportSize(
      state: MobileDevViewportState,
      viewport: HTMLElement,
      widthLabel: HTMLElement,
      heightLabel: HTMLElement
    ) {
      viewport.style.width = `${state.width}px`;
      viewport.style.height = `${state.height}px`;
      widthLabel.textContent = `${state.width}px`;
      heightLabel.textContent = `${state.height}px`;
    }

    function isMobileDevBookmarkActive(state: MobileDevViewportState, bookmark: MobileDevViewportBookmark) {
      return bookmark.width === state.width && bookmark.height === state.height;
    }

    function renderMobileDevBookmarks(
      key: string,
      state: MobileDevViewportState,
      bookmarkList: HTMLElement,
      viewport: HTMLElement,
      widthLabel: HTMLElement,
      heightLabel: HTMLElement
    ) {
      bookmarkList.replaceChildren();

      for (const bookmark of state.bookmarks) {
        const button = document.createElement("button");
        button.className = "webapp-mobile-dev-bookmark";
        button.type = "button";
        button.textContent = `${bookmark.width}x${bookmark.height}`;
        button.classList.toggle("active", isMobileDevBookmarkActive(state, bookmark));
        button.title = `Use ${bookmark.width}x${bookmark.height}`;
        button.addEventListener("click", () => {
          state.width = bookmark.width;
          state.height = bookmark.height;
          updateMobileDevViewportSize(state, viewport, widthLabel, heightLabel);
          persistMobileDevViewportState(key, state);
          renderMobileDevBookmarks(key, state, bookmarkList, viewport, widthLabel, heightLabel);
          queueWebAppSync();
        });
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          state.bookmarks = state.bookmarks.filter((candidate) => (
            candidate.width !== bookmark.width || candidate.height !== bookmark.height
          ));
          persistMobileDevViewportState(key, state);
          renderMobileDevBookmarks(key, state, bookmarkList, viewport, widthLabel, heightLabel);
        });
        bookmarkList.append(button);
      }

      const addButton = document.createElement("button");
      addButton.className = "webapp-mobile-dev-bookmark add";
      addButton.type = "button";
      addButton.title = "Bookmark current size";
      addButton.setAttribute("aria-label", "Bookmark current size");
      addButton.append(createToolIcon("plus"));
      addButton.addEventListener("click", () => {
        const exists = state.bookmarks.some((bookmark) => isMobileDevBookmarkActive(state, bookmark));
        if (!exists) {
          state.bookmarks = [...state.bookmarks, { width: state.width, height: state.height }].slice(-8);
          persistMobileDevViewportState(key, state);
          renderMobileDevBookmarks(key, state, bookmarkList, viewport, widthLabel, heightLabel);
        }
      });
      bookmarkList.append(addButton);
    }

    function attachMobileDevResizeHandle(
      handle: HTMLElement,
      key: string,
      axis: "x" | "y",
      host: HTMLElement,
      state: MobileDevViewportState,
      viewport: HTMLElement,
      widthLabel: HTMLElement,
      heightLabel: HTMLElement
    ) {
      handle.addEventListener("pointerdown", (event) => {
        if (event.target instanceof Element && event.target.closest("button")) {
          return;
        }

        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = state.width;
        const startHeight = state.height;

        function onPointerMove(moveEvent: PointerEvent) {
          const rect = host.getBoundingClientRect();
          const maxWidth = Math.max(160, Math.floor(rect.width - mobileDevHostPadding - mobileDevRulerWidth - 2));
          const maxHeight = Math.max(160, Math.floor(rect.height - mobileDevHostPadding - mobileDevRulerHeight - 2));
          if (axis === "x") {
            state.width = clamp(Math.round(startWidth + moveEvent.clientX - startX), 160, maxWidth);
          } else {
            state.height = clamp(Math.round(startHeight + moveEvent.clientY - startY), 160, maxHeight);
          }
          updateMobileDevViewportSize(state, viewport, widthLabel, heightLabel);
          queueWebAppSync();
        }

        function onPointerUp(upEvent: PointerEvent) {
          handle.releasePointerCapture(upEvent.pointerId);
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          persistMobileDevViewportState(key, state);
          queueWebAppSync();
        }

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
      });
    }

    function createMobileDevViewport(host: HTMLElement, selectedWebApp: PaneWebApp) {
      const key = getMobileDevViewportKey(selectedWebApp);
      const state = getMobileDevViewportState(selectedWebApp);
      fitMobileDevViewportToHost(host, state);

      host.classList.add("mobile-dev-host");
      const bookmarkList = document.createElement("div");
      bookmarkList.className = "webapp-mobile-dev-bookmarks";

      const shell = document.createElement("div");
      shell.className = "webapp-mobile-dev-shell";

      const topRuler = document.createElement("div");
      topRuler.className = "webapp-mobile-dev-ruler top";
      const widthLabel = document.createElement("span");
      topRuler.append(widthLabel);

      const leftRuler = document.createElement("div");
      leftRuler.className = "webapp-mobile-dev-ruler left";
      const heightLabel = document.createElement("span");
      leftRuler.append(heightLabel);

      const viewport = document.createElement("div");
      viewport.className = "webapp-mobile-dev-viewport";

      const rightHandle = document.createElement("div");
      rightHandle.className = "webapp-mobile-dev-boundary right";
      rightHandle.setAttribute("role", "separator");
      rightHandle.setAttribute("aria-orientation", "vertical");

      const bottomHandle = document.createElement("div");
      bottomHandle.className = "webapp-mobile-dev-boundary bottom";
      bottomHandle.setAttribute("role", "separator");
      bottomHandle.setAttribute("aria-orientation", "horizontal");

      viewport.append(rightHandle, bottomHandle);
      shell.append(topRuler, leftRuler, viewport);
      host.append(bookmarkList, shell);
      updateMobileDevViewportSize(state, viewport, widthLabel, heightLabel);
      renderMobileDevBookmarks(key, state, bookmarkList, viewport, widthLabel, heightLabel);
      attachMobileDevResizeHandle(topRuler, key, "x", host, state, viewport, widthLabel, heightLabel);
      attachMobileDevResizeHandle(leftRuler, key, "y", host, state, viewport, widthLabel, heightLabel);
      attachMobileDevResizeHandle(rightHandle, key, "x", host, state, viewport, widthLabel, heightLabel);
      attachMobileDevResizeHandle(bottomHandle, key, "y", host, state, viewport, widthLabel, heightLabel);
      window.requestAnimationFrame(() => {
        fitMobileDevViewportToHost(host, state);
        updateMobileDevViewportSize(state, viewport, widthLabel, heightLabel);
        persistMobileDevViewportState(key, state);
        renderMobileDevBookmarks(key, state, bookmarkList, viewport, widthLabel, heightLabel);
        queueWebAppSync();
      });

      return viewport;
    }

    function applySplitRatio(splitElement: HTMLElement, splitNode: PaneLayoutNode) {
      const ratio = Number(splitNode.ratio) || 0.5;
      const firstRatio = ratio * 100;
      const secondRatio = (1 - ratio) * 100;
      const resizerOffset = webAppSplitResizerSize / 2;
      const first = `minmax(0, calc(${firstRatio}% - ${resizerOffset}px))`;
      const second = `minmax(0, calc(${secondRatio}% - ${resizerOffset}px))`;
      const resizer = `${webAppSplitResizerSize}px`;

      if (splitNode.direction === "vertical") {
        splitElement.style.gridTemplateColumns = `${first} ${resizer} ${second}`;
        splitElement.style.gridTemplateRows = "";
      } else {
        splitElement.style.gridTemplateColumns = "";
        splitElement.style.gridTemplateRows = `${first} ${resizer} ${second}`;
      }
    }

    function createWebAppPane(project: RendererProject, paneNode: PaneNode) {
      const webApps = getProjectWebApps(project, paneNode.id).map((webApp) => webApp as PaneWebApp);
      const selectedWebApp = getSelectedWebApp(project, paneNode.id, webApps) as PaneWebApp;
      const isTerminalPane = selectedWebApp.kind === "terminal";
      const isWidgetPane = selectedWebApp.kind === "widgets";
      const isDomPane = selectedWebApp.kind === "dom";
      const pluginPane = isDomPane ? selectedWebApp.pluginPane : undefined;
      const widgetPane = isWidgetPane ? selectedWebApp.widgetPane : undefined;
      const widgetFallbackWidth = isWidgetPane
        ? Math.max(minWidgetRailWidth, Math.round((dashboardGrid.getBoundingClientRect().width || window.innerWidth) / 2))
        : null;
      const widgetGridColumns = widgetPane ? getWidgetGridColumnCount(widgetFallbackWidth) : null;
      const widgetLayout = widgetPane ? getProjectWidgetLayout(project, widgetGridColumns, widgetPane.id) : null;
      const isWidgetEditing = Boolean(isWidgetPane && widgetLayout && !widgetLayout.locked);
      const pane = document.createElement("section");
      pane.className = "webapp-pane";
      pane.classList.toggle("widget-pane", isWidgetPane);
      pane.classList.toggle("editing", isWidgetEditing);
      pane.dataset.paneId = paneNode.id;
      if (selectedWebApp.id) {
        pane.dataset.webAppId = selectedWebApp.id;
      }
      if (selectedWebApp.kind) {
        pane.dataset.webAppKind = selectedWebApp.kind;
      }
      pane.dataset.mobileDev = String(isMobileDevViewportEnabled(selectedWebApp));
      pane.dataset.webAppMenuSignature = getWebAppMenuSignature(webApps);

      const host = document.createElement("div") as PaneLayoutHost;
      host.className = `webapp-host${isTerminalPane ? " terminal-pane-host" : ""}`;
      host.setAttribute("role", "region");
      host.setAttribute("aria-label", `${project.name} ${selectedWebApp.label}`);
      const pluginPaneProps = pluginPane ? {
        project,
        projectId: project.id,
        paneId: paneNode.id,
        projectConfig: isGlobalWorkspace(project) ? {} : getProjectPluginConfig(project.id, pluginPane.pluginId),
        globalPluginConfig: getGlobalPluginConfig(pluginPane.pluginId),
        allProjectPluginConfig: getAllProjectPluginConfig(project),
        getProjectWebAppState(webAppId: string) {
          return getProjectWebAppState(project, webAppId);
        },
        host,
        openProjectWebApp(webAppId: string, url = "") {
          return openProjectWebApp(project.id, webAppId, url);
        }
      } : null;
      const pluginPaneCleanupCallbacks: Array<() => void> = [];

      const header = document.createElement("div");
      header.className = "webapp-pane-header";

      const tabs = document.createElement("div");
      tabs.className = "webapp-tabs";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Project webapps");

      const tabPickerButton = document.createElement("button");
      tabPickerButton.className = "webapp-tab webapp-tab-picker";
      tabPickerButton.type = "button";
      tabPickerButton.setAttribute("role", "tab");
      tabPickerButton.setAttribute("aria-selected", "true");
      tabPickerButton.setAttribute("aria-haspopup", "menu");
      tabPickerButton.setAttribute("aria-expanded", "false");
      const tabLabel = isWidgetPane ? "Widgets" : String(selectedWebApp.label || "");
      const iconOnly = shouldUseIconOnlyPaneTab(isCompactPaneTabs(), selectedWebApp.iconOnly);
      tabPickerButton.classList.toggle("icon-only", iconOnly);
      tabPickerButton.setAttribute("aria-label", tabLabel);
      if (iconOnly) {
        tabPickerButton.title = tabLabel;
      }
      tabPickerButton.append(createPaneIconLabel(selectedWebApp, tabLabel));
      tabPickerButton.addEventListener("click", () => {
        const isOpen = isWebAppTabMenuOpen();
        tabPickerButton.setAttribute("aria-expanded", String(!isOpen));

        if (isOpen) {
          closeWebAppTabMenu();
        } else {
          const currentWebApps = getProjectWebApps(project, paneNode.id)
            .map((webApp) => webApp as PaneWebApp);
          const currentSelectedWebApp = getSelectedWebApp(project, paneNode.id, currentWebApps) as PaneWebApp;
          openWebAppTabMenuFromButton(
            tabPickerButton,
            project,
            paneNode,
            currentSelectedWebApp,
            currentWebApps
          );
        }
      });

      tabs.append(tabPickerButton);

      if (pluginPane?.renderHeaderActions && pluginPaneProps) {
        const headerActions = document.createElement("div");
        headerActions.className = "plugin-pane-header-actions";
        const cleanup = pluginPane.renderHeaderActions(headerActions, pluginPaneProps);
        if (typeof cleanup === "function") {
          pluginPaneCleanupCallbacks.push(cleanup as () => void);
        }
        if (headerActions.childNodes.length) {
          tabs.append(headerActions);
        }
      }

      if (isWidgetPane) {
        tabs.append(createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, {
          editing: isWidgetEditing
        }));
      }

      if (!isTerminalPane && !isWidgetPane && !isDomPane) {
        const homeButton = document.createElement("button");
        homeButton.className = "webapp-tool-button";
        homeButton.type = "button";
        homeButton.title = "Go home";
        homeButton.setAttribute("aria-label", "Go home");
        homeButton.append(createToolIcon("home"));
        homeButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "home", selectedWebApp.url));
        homeButton.addEventListener("contextmenu", (event) => {
          openWebAppHomeMenu(event, project, paneNode, selectedWebApp);
        });

        const backButton = document.createElement("button");
        backButton.className = "webapp-tool-button";
        backButton.type = "button";
        backButton.title = "Go back";
        backButton.setAttribute("aria-label", "Go back");
        backButton.append(createToolIcon("arrowLeft"));
        backButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "back"));
        backButton.addEventListener("contextmenu", (event) => {
          openWebAppNavigationHistoryMenu(event, selectedWebApp, "back");
        });

        const forwardButton = document.createElement("button");
        forwardButton.className = "webapp-tool-button";
        forwardButton.type = "button";
        forwardButton.title = "Go forward";
        forwardButton.setAttribute("aria-label", "Go forward");
        forwardButton.append(createToolIcon("arrowRight"));
        forwardButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "forward"));
        forwardButton.addEventListener("contextmenu", (event) => {
          openWebAppNavigationHistoryMenu(event, selectedWebApp, "forward");
        });

        const refreshButton = document.createElement("button");
        refreshButton.className = "webapp-tool-button";
        refreshButton.type = "button";
        refreshButton.title = "Refresh";
        refreshButton.setAttribute("aria-label", "Refresh");
        refreshButton.append(createToolIcon("refresh"));
        refreshButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "refresh"));
        refreshButton.addEventListener("contextmenu", (event) => {
          openWebAppRefreshMenu(event, selectedWebApp);
        });

        const autofillButton = isPasswordManagerEnabled() ? document.createElement("button") : null;
        if (autofillButton) {
          autofillButton.className = "webapp-tool-button autofill";
          autofillButton.type = "button";
          autofillButton.dataset.webappKey = selectedWebApp.key || "";
          autofillButton.title = "Autofill credentials";
          autofillButton.setAttribute("aria-label", "Autofill credentials");
          autofillButton.append(createToolIcon("key"));
          syncWebAppAutofillButton(autofillButton, isWebAppAutofillEnabled(selectedWebApp));
          autofillButton.addEventListener("click", () => {
            toggleWebAppAutofill(selectedWebApp, autofillButton).catch((error: unknown) => {
              console.error("Could not update webapp autofill:", error);
            });
          });
        }

        const mobileDevButton = selectedWebApp.mobileDev === true ? document.createElement("button") : null;
        if (mobileDevButton) {
          mobileDevButton.className = "webapp-tool-button";
          mobileDevButton.type = "button";
          mobileDevButton.title = "Toggle mobile viewport";
          mobileDevButton.setAttribute("aria-label", "Toggle mobile viewport");
          mobileDevButton.classList.toggle("active", isMobileDevViewportEnabled(selectedWebApp));
          mobileDevButton.append(createToolIcon("smartphone"));
          mobileDevButton.addEventListener("click", () => {
            const state = getMobileDevViewportState(selectedWebApp);
            state.enabled = !state.enabled;
            persistMobileDevViewportState(getMobileDevViewportKey(selectedWebApp), state);
            renderPaneLayoutPreservingPanes(project);
          });
        }

        const activeUrl = document.createElement("input");
        activeUrl.className = "webapp-url";
        activeUrl.type = "text";
        activeUrl.autocomplete = "off";
        activeUrl.spellcheck = false;
        activeUrl.value = getCurrentWebAppUrl(selectedWebApp) || "";
        activeUrl.dataset.webappKey = selectedWebApp.key || "";
        activeUrl.setAttribute("aria-label", "Current webapp URL");
        activeUrl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();

            try {
              const nextUrl = normalizeAddressInput(activeUrl.value);
              setCurrentWebAppUrl(selectedWebApp.key || "", nextUrl);
              activeUrl.value = nextUrl;
              invokeWebApp("navigateWebApp", selectedWebApp.key, "open", nextUrl);
            } catch {
              activeUrl.value = getCurrentWebAppUrl(selectedWebApp) || "";
            }
          } else if (event.key === "Escape") {
            activeUrl.value = getCurrentWebAppUrl(selectedWebApp) || "";
            activeUrl.blur();
          }
        });
        activeUrl.addEventListener("contextmenu", (event) => {
          openWebAppUrlFieldMenu(event, project, selectedWebApp, activeUrl.value);
        });

        tabs.append(
          homeButton,
          backButton,
          forwardButton,
          refreshButton,
          ...(autofillButton ? [autofillButton] : []),
          ...(mobileDevButton ? [mobileDevButton] : []),
          activeUrl
        );
      }

      const actions = document.createElement("div");
      actions.className = "webapp-actions";

      if (widgetPane && widgetLayout) {
        actions.append(createWidgetPaneActions(project, widgetPane, widgetLayout, widgetGridColumns));
      }

      const terminalPaneTabs = isTerminalPane ? document.createElement("div") : null;
      if (terminalPaneTabs) {
        terminalPaneTabs.className = "pane-terminal-tabs-slot";
        tabs.append(terminalPaneTabs);
      }

      const expansionButton = document.createElement("button");
      expansionButton.className = "webapp-tool-button pane-expansion-button";
      expansionButton.type = "button";
      syncPaneExpansionButton(project, paneNode, expansionButton);
      expansionButton.addEventListener("mouseenter", () => {
        if (expansionButton.dataset.paneExpansionMode === "expand") {
          previewPaneExpansion(project, paneNode.id, !expansionButton.disabled);
        }
      });
      expansionButton.addEventListener("mouseleave", () => {
        if (!isPaintingPaneExpansion) {
          clearPaneExpansionPreview();
        }
      });
      expansionButton.addEventListener("focus", () => {
        if (expansionButton.dataset.paneExpansionMode === "expand") {
          previewPaneExpansion(project, paneNode.id, !expansionButton.disabled);
        }
      });
      expansionButton.addEventListener("blur", () => {
        if (!isPaintingPaneExpansion) {
          clearPaneExpansionPreview();
        }
      });
      expansionButton.addEventListener("pointerdown", (event) => {
        startPaneExpansionBrush(event, project, paneNode.id, expansionButton);
      });
      expansionButton.addEventListener("click", () => {
        if (Date.now() < suppressExpansionClickUntil) {
          return;
        }
        togglePaneExpansion(project, paneNode.id);
      });

      const verticalSplitButton = document.createElement("button");
      verticalSplitButton.className = "webapp-tool-button split-vertical";
      verticalSplitButton.type = "button";
      verticalSplitButton.dataset.paneAction = "split-vertical";
      verticalSplitButton.title = "Split vertically";
      verticalSplitButton.setAttribute("aria-label", "Split vertically");
      verticalSplitButton.append(createToolIcon("splitVertical"));
      verticalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "vertical"));

      const horizontalSplitButton = document.createElement("button");
      horizontalSplitButton.className = "webapp-tool-button split-horizontal";
      horizontalSplitButton.type = "button";
      horizontalSplitButton.dataset.paneAction = "split-horizontal";
      horizontalSplitButton.title = "Split horizontally";
      horizontalSplitButton.setAttribute("aria-label", "Split horizontally");
      horizontalSplitButton.append(createToolIcon("splitHorizontal"));
      horizontalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "horizontal"));

      const closePaneButton = document.createElement("button");
      closePaneButton.className = "webapp-tool-button danger";
      closePaneButton.type = "button";
      closePaneButton.dataset.paneAction = "close";
      closePaneButton.title = "Close pane";
      closePaneButton.setAttribute("aria-label", "Close pane");
      closePaneButton.append(createToolIcon("close"));
      const hasActiveExpansions = paneLayoutState.findActivePaneExpansions(project).length > 0;
      verticalSplitButton.disabled = hasActiveExpansions;
      horizontalSplitButton.disabled = hasActiveExpansions;
      closePaneButton.disabled = hasActiveExpansions ||
        paneLayoutState.countPaneNodes(getProjectPaneLayout(project)) <= 1;
      closePaneButton.addEventListener("click", () => closePane(project, paneNode.id));

      actions.append(expansionButton, verticalSplitButton, horizontalSplitButton, closePaneButton);
      header.append(tabs, actions);

      pane.append(header, host);

      if (isTerminalPane) {
        host.append(createTerminalSurface(project, {
          tagName: "div",
          className: "terminal-pane-surface terminal-widget",
          storageKey: `pane:${paneNode.id}`,
          tabsContainer: terminalPaneTabs
        }));
      } else if (widgetPane) {
        host.append(createWidgetPaneSurface(project, widgetPane));
      } else if (isDomPane) {
        if (!pluginPane || !pluginPaneProps) {
          host.textContent = "Plugin pane is unavailable.";
          queueWebAppSync();
          return pane;
        }
        const cleanup = pluginPane.render(host, pluginPaneProps);
        if (typeof cleanup === "function") {
          pluginPaneCleanupCallbacks.push(cleanup as () => void);
        }
        if (pluginPaneCleanupCallbacks.length) {
          host.boatyardCleanup = () => {
            for (const callback of pluginPaneCleanupCallbacks) {
              callback();
            }
          };
        }
      } else {
        const visibleHost = isMobileDevViewportEnabled(selectedWebApp)
          ? createMobileDevViewport(host, selectedWebApp)
          : host;
        setVisibleWebAppHost(paneNode.id, {
          webApp: selectedWebApp,
          host: visibleHost
        } as VisiblePaneWebAppEntry);
      }

      queueWebAppSync();
      return pane;
    }

    function createPaneLayout(
      project: RendererProject,
      node: PaneLayoutNode,
      reusablePanes?: PaneElementReuseMap,
      options: PaneReuseOptions = {},
      isNested = false
    ): HTMLElement {
      if (!isNested) {
        clearPaneExpansionPreview();
        clearActivePaneExpansionPresentation();
      }

      if (node.type === "pane") {
        const pane = reuseWebAppPane(project, node, reusablePanes, options) || createWebAppPane(project, node);
        if (!isNested) {
          scheduleActivePaneExpansionPresentation(project);
        }
        return pane;
      }

      const split = document.createElement("div");
      split.className = `webapp-split ${node.direction}`;
      split.dataset.splitId = node.id;
      applySplitRatio(split, node);
      split.append(
        createPaneLayout(project, node.first, reusablePanes, options, true),
        createSplitResizer(project, node),
        createPaneLayout(project, node.second, reusablePanes, options, true)
      );
      if (!isNested) {
        scheduleActivePaneExpansionPresentation(project);
      }
      return split;
    }

    return {
      createPaneLayout,
      renderPaneLayoutPreservingPanes
    };
}
