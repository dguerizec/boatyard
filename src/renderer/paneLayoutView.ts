import type { RendererPaneNode, RendererProject } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type { WidgetLayout, WidgetPane } from "./widgetSurfaceTypes.js";

type PaneLayoutHost = HTMLDivElement & {
  boatyardCleanup?: () => void;
};

type PaneSplitSide = "first" | "second";

type PaneNode = UnknownRecord & {
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

type PaneAncestorPathItem = {
  node: PaneLayoutNode;
  side: PaneSplitSide;
};

type PaneLayoutStateApi = {
  countPaneNodes(node: unknown): number;
  createSplitNode(
    project: RendererProject,
    direction: string,
    first: unknown,
    selectedWebAppId?: string
  ): unknown;
  deleteSelectedWebAppForPane(paneId: string): unknown;
  findPaneNode(node: unknown, paneId: string): unknown;
  getPaneAncestorPath(node: unknown, paneId: string): unknown;
  getPaneExpansionState(project: RendererProject, paneId: string): { canExpand: boolean; canShrink: boolean };
  getPaneExpansionTarget(project: RendererProject, paneId: string): unknown;
  getSelectedWebAppForPane(paneId: string): string | undefined;
  getSelectedWebAppForProject(projectId?: string): string | undefined;
  removePaneNode(node: unknown, paneId: string): unknown;
  replacePaneNode(node: unknown, paneId: string, replacement: unknown): unknown;
  setPaneLayout(projectId: string | undefined, layout: unknown): unknown;
  setSelectedWebAppForPane(paneId: string, webAppId?: string): unknown;
};

type PaneWebApp = UnknownRecord & {
  id: string;
  key?: string;
  kind?: string;
  label?: string;
  mobileDev?: boolean;
  pluginPane?: {
    pluginId: string;
    render(host: HTMLElement, props: UnknownRecord): unknown;
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
  isGlobalWorkspace: (project: RendererProject) => boolean;
  getProjectPluginConfig: (projectId: string | undefined, pluginId: string) => UnknownRecord;
  getGlobalPluginConfig: (pluginId: string) => UnknownRecord;
  getAllProjectPluginConfig: (project: RendererProject) => UnknownRecord;
  openProjectWebApp: (projectId: string | undefined, webAppId: string, url: string) => unknown;
  setVisibleWebAppHost: (paneId: string, entry: VisiblePaneWebAppEntry) => void;
  resetVisibleWebAppHosts: () => void;
  queueWebAppSync: () => void;
  persistPaneLayout: (project: RendererProject) => void;
};

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
    isGlobalWorkspace,
    getProjectPluginConfig,
    getGlobalPluginConfig,
    getAllProjectPluginConfig,
    openProjectWebApp,
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

    function clamp(value: number, min: number, max: number) {
      return Math.min(max, Math.max(min, value));
    }

    function getMobileDevViewportKey(webApp: PaneWebApp) {
      return webApp.id || webApp.key || "";
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

    function clearPaneExpansionPreview() {
      document.querySelectorAll(".webapp-split.pane-expand-preview").forEach((split) => {
        split.classList.remove("pane-expand-preview");
      });
    }

    function previewPaneExpansion(project: RendererProject, paneId: string, enabled: boolean) {
      clearPaneExpansionPreview();

      if (!enabled) {
        return;
      }

      const target = paneLayoutState.getPaneExpansionTarget(project, paneId) as PaneAncestorPathItem | null;
      if (!target) {
        return;
      }

      const split = [...document.querySelectorAll<HTMLElement>(".webapp-split")]
        .find((candidate) => candidate.dataset.splitId === target.node.id);
      if (split) {
        split.classList.add("pane-expand-preview");
      }
    }

    function expandPane(project: RendererProject, paneId: string) {
      const target = paneLayoutState.getPaneExpansionTarget(project, paneId) as PaneAncestorPathItem | null;

      if (!target) {
        return;
      }

      target.node.expandedChild = target.side;
      persistPaneLayout(project);
      renderPaneLayoutPreservingPanes(project);
    }

    function shrinkPane(project: RendererProject, paneId: string) {
      const path = (paneLayoutState.getPaneAncestorPath(
        getProjectPaneLayout(project),
        paneId
      ) || []) as PaneAncestorPathItem[];
      const target = path.find(({ node, side }: PaneAncestorPathItem) => node.expandedChild === side);

      if (!target) {
        return;
      }

      delete target.node.expandedChild;
      persistPaneLayout(project);
      renderPaneLayoutPreservingPanes(project);
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

    function syncReusedPaneActions(project: RendererProject, paneNode: PaneNode, pane: HTMLElement) {
      const expansionState = paneLayoutState.getPaneExpansionState(project, paneNode.id);
      const expandPaneButton = getPaneActionButton(pane, "expand", "Expand pane");
      const shrinkPaneButton = getPaneActionButton(pane, "shrink", "Shrink pane");
      const closePaneButton = getPaneActionButton(pane, "close", "Close pane");

      if (expandPaneButton) {
        expandPaneButton.disabled = !expansionState.canExpand;
      }

      if (shrinkPaneButton) {
        shrinkPaneButton.disabled = !expansionState.canShrink;
        shrinkPaneButton.classList.toggle("active", expansionState.canShrink);
      }

      if (closePaneButton) {
        closePaneButton.disabled = paneLayoutState.countPaneNodes(getProjectPaneLayout(project)) <= 1;
      }
    }

    function reuseWebAppPane(project: RendererProject, paneNode: PaneNode, reusablePanes?: PaneElementReuseMap) {
      if (!reusablePanes) {
        return null;
      }

      const pane = reusablePanes.get(paneNode.id);
      if (!pane) {
        return null;
      }

      const webApps = getProjectWebApps(project, paneNode.id).map((webApp) => webApp as PaneWebApp);
      const selectedWebApp = getSelectedWebApp(project, paneNode.id, webApps) as PaneWebApp;
      if (
        pane.dataset.webAppId !== selectedWebApp.id ||
        pane.dataset.webAppKind !== selectedWebApp.kind ||
        pane.dataset.mobileDev !== String(isMobileDevViewportEnabled(selectedWebApp)) ||
        pane.dataset.webAppMenuSignature !== getWebAppMenuSignature(webApps)
      ) {
        return null;
      }

      reusablePanes.delete(paneNode.id);
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

    function renderPaneLayoutPreservingPanes(project: RendererProject) {
      const reusablePanes = collectReusablePaneElements();
      resetVisibleWebAppHosts();
      const paneLayoutElement = createPaneLayout(project, getProjectPaneLayout(project) as PaneLayoutNode, reusablePanes);
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
      tabPickerButton.textContent = isWidgetPane ? "Widgets" : selectedWebApp.label || "";
      tabPickerButton.addEventListener("click", () => {
        const isOpen = isWebAppTabMenuOpen();
        tabPickerButton.setAttribute("aria-expanded", String(!isOpen));

        if (isOpen) {
          closeWebAppTabMenu();
        } else {
          openWebAppTabMenuFromButton(tabPickerButton, project, paneNode, selectedWebApp, webApps);
        }
      });

      tabs.append(tabPickerButton);

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

      const expansionState = paneLayoutState.getPaneExpansionState(project, paneNode.id);
      const expandPaneButton = document.createElement("button");
      expandPaneButton.className = "webapp-tool-button";
      expandPaneButton.type = "button";
      expandPaneButton.dataset.paneAction = "expand";
      expandPaneButton.title = "Expand pane";
      expandPaneButton.setAttribute("aria-label", "Expand pane");
      expandPaneButton.append(createToolIcon("expandPane"));
      expandPaneButton.disabled = !expansionState.canExpand;
      expandPaneButton.addEventListener("mouseenter", () => previewPaneExpansion(project, paneNode.id, !expandPaneButton.disabled));
      expandPaneButton.addEventListener("mouseleave", clearPaneExpansionPreview);
      expandPaneButton.addEventListener("focus", () => previewPaneExpansion(project, paneNode.id, !expandPaneButton.disabled));
      expandPaneButton.addEventListener("blur", clearPaneExpansionPreview);
      expandPaneButton.addEventListener("click", () => expandPane(project, paneNode.id));

      const shrinkPaneButton = document.createElement("button");
      shrinkPaneButton.className = "webapp-tool-button";
      shrinkPaneButton.type = "button";
      shrinkPaneButton.dataset.paneAction = "shrink";
      shrinkPaneButton.title = "Shrink pane";
      shrinkPaneButton.setAttribute("aria-label", "Shrink pane");
      shrinkPaneButton.append(createToolIcon("shrinkPane"));
      shrinkPaneButton.disabled = !expansionState.canShrink;
      shrinkPaneButton.classList.toggle("active", expansionState.canShrink);
      shrinkPaneButton.addEventListener("click", () => shrinkPane(project, paneNode.id));

      const verticalSplitButton = document.createElement("button");
      verticalSplitButton.className = "webapp-tool-button split-vertical";
      verticalSplitButton.type = "button";
      verticalSplitButton.title = "Split vertically";
      verticalSplitButton.setAttribute("aria-label", "Split vertically");
      verticalSplitButton.append(createToolIcon("splitVertical"));
      verticalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "vertical"));

      const horizontalSplitButton = document.createElement("button");
      horizontalSplitButton.className = "webapp-tool-button split-horizontal";
      horizontalSplitButton.type = "button";
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
      closePaneButton.disabled = paneLayoutState.countPaneNodes(getProjectPaneLayout(project)) <= 1;
      closePaneButton.addEventListener("click", () => closePane(project, paneNode.id));

      actions.append(expandPaneButton, shrinkPaneButton, verticalSplitButton, horizontalSplitButton, closePaneButton);
      header.append(tabs, actions);

      const host = document.createElement("div") as PaneLayoutHost;
      host.className = `webapp-host${isTerminalPane ? " terminal-pane-host" : ""}`;
      host.setAttribute("role", "region");
      host.setAttribute("aria-label", `${project.name} ${selectedWebApp.label}`);

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
        const pluginPane = selectedWebApp.pluginPane;
        if (!pluginPane) {
          host.textContent = "Plugin pane is unavailable.";
          queueWebAppSync();
          return pane;
        }
        const cleanup = pluginPane.render(host, {
          project,
          projectId: project.id,
          projectConfig: isGlobalWorkspace(project) ? {} : getProjectPluginConfig(project.id, pluginPane.pluginId),
          globalPluginConfig: getGlobalPluginConfig(pluginPane.pluginId),
          allProjectPluginConfig: getAllProjectPluginConfig(project),
          openProjectWebApp(webAppId: string, url = "") {
            return openProjectWebApp(project.id, webAppId, url);
          }
        });
        if (typeof cleanup === "function") {
          host.boatyardCleanup = cleanup as () => void;
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

    function createPaneLayout(project: RendererProject, node: PaneLayoutNode, reusablePanes?: PaneElementReuseMap): HTMLElement {
      if (node.type === "pane") {
        return reuseWebAppPane(project, node, reusablePanes) || createWebAppPane(project, node);
      }

      if (node.expandedChild === "first" || node.expandedChild === "second") {
        return createPaneLayout(project, node[node.expandedChild], reusablePanes);
      }

      const split = document.createElement("div");
      split.className = `webapp-split ${node.direction}`;
      split.dataset.splitId = node.id;
      applySplitRatio(split, node);
      split.append(
        createPaneLayout(project, node.first, reusablePanes),
        createSplitResizer(project, node),
        createPaneLayout(project, node.second, reusablePanes)
      );
      return split;
    }

    return {
      createPaneLayout,
      renderPaneLayoutPreservingPanes
    };
}
