import type { RendererPaneNode, RendererProject } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type { WidgetLayout, WidgetPane } from "./widgetSurfaceTypes.js";

type PaneLayoutHost = HTMLDivElement & {
  boatyardCleanup?: () => void;
};

type PaneSplitContextMenu = HTMLDivElement & {
  cleanup?: () => void;
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
  getSplitRotationPreview(project: RendererProject, splitId: string): {
    current: unknown;
    rootSplitId: string;
    rotations: Array<{
      highlightedSplitId: string;
      layout: unknown;
      steps: number;
    }>;
  } | null;
  getSplitRotationState(project: RendererProject, splitId: string): { canRotate: boolean };
  getSelectedWebAppForPane(paneId: string): string | undefined;
  getSelectedWebAppForProject(projectId?: string): string | undefined;
  removePaneNode(node: unknown, paneId: string): unknown;
  replacePaneNode(node: unknown, paneId: string, replacement: unknown): unknown;
  rotateSplitTowardRoot(project: RendererProject, splitId: string, steps?: number): boolean;
  rotateSplitWithParent(project: RendererProject, splitId: string): boolean;
  setPaneLayout(projectId: string | undefined, layout: unknown): unknown;
  setSelectedWebAppForPane(paneId: string, webAppId?: string): unknown;
};

type PaneWebApp = UnknownRecord & {
  id: string;
  key?: string;
  kind?: string;
  label?: string;
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
  openWebAppRefreshMenu: (event: MouseEvent, selectedWebApp: PaneWebApp) => void;
  freezeWebAppsForOverlay: (options?: unknown) => Promise<unknown>;
  restoreWebAppsAfterOverlay: () => void | Promise<unknown>;
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
  queueWebAppSync: () => void;
  renderWorkspaceDashboard: (project: RendererProject) => void;
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
    openWebAppRefreshMenu,
    freezeWebAppsForOverlay,
    restoreWebAppsAfterOverlay,
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
    queueWebAppSync,
    renderWorkspaceDashboard,
    persistPaneLayout
  }: PaneLayoutViewOptions) {
    let openPaneSplitMenu: PaneSplitContextMenu | null = null;
    let didFreezePaneSplitMenu = false;

    function clamp(value: number, min: number, max: number) {
      return Math.min(max, Math.max(min, value));
    }

    function closePaneSplitContextMenu() {
      if (!openPaneSplitMenu) {
        return;
      }

      openPaneSplitMenu.cleanup?.();
      openPaneSplitMenu.remove();
      openPaneSplitMenu = null;
      if (didFreezePaneSplitMenu) {
        didFreezePaneSplitMenu = false;
        Promise.resolve(restoreWebAppsAfterOverlay()).catch((error: unknown) => {
          console.error("Could not restore webapps after splitter menu:", error);
        });
      }
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
      renderWorkspaceDashboard(project);
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
      renderWorkspaceDashboard(project);
    }

    function rotateSplitTowardRoot(project: RendererProject, splitId: string, steps: number) {
      if (!paneLayoutState.rotateSplitTowardRoot(project, splitId, steps)) {
        return;
      }

      persistPaneLayout(project);
      renderWorkspaceDashboard(project);
    }

    function createSplitLayoutMenuItem({
      highlightedSplitId,
      layout,
      onClick,
      previewSize,
      project,
      title
    }: {
      highlightedSplitId: string;
      layout: PaneLayoutNode;
      onClick: () => void;
      previewSize: { height: number; width: number };
      project: RendererProject;
      title: string;
    }) {
      const item = document.createElement("button");
      item.className = "pane-split-layout-option";
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.append(createSplitTreePreview(project, layout, title, previewSize, highlightedSplitId));
      item.addEventListener("click", onClick);
      return item;
    }

    function getSplitPreviewSize(splitRect: DOMRect | undefined) {
      const maxWidth = Math.max(120, Math.min(420, window.innerWidth - 48));
      const maxHeight = Math.max(80, Math.min(220, window.innerHeight - 96));
      const minWidth = 96;
      const minHeight = 64;
      if (!splitRect || splitRect.width <= 0 || splitRect.height <= 0) {
        return { height: 96, width: 160 };
      }

      const scale = Math.min(maxWidth / splitRect.width, maxHeight / splitRect.height, 1);
      return {
        height: Math.round(Math.max(minHeight, splitRect.height * scale)),
        width: Math.round(Math.max(minWidth, splitRect.width * scale))
      };
    }

    function getRenderedSplitRect(splitId: string) {
      return [...document.querySelectorAll<HTMLElement>(".webapp-split")]
        .find((candidate) => candidate.dataset.splitId === splitId)
        ?.getBoundingClientRect();
    }

    function createSplitTreePreview(
      _project: RendererProject,
      layout: PaneLayoutNode,
      title: string,
      previewSize: { height: number; width: number },
      highlightedSplitId: string
    ) {
      const preview = document.createElement("section");
      preview.className = "pane-split-tree-preview";

      const titleElement = document.createElement("span");
      titleElement.className = "pane-split-tree-title";
      titleElement.textContent = title;

      const surface = document.createElement("div");
      surface.className = "pane-split-tree-surface";
      surface.style.width = `${previewSize.width}px`;
      surface.style.height = `${previewSize.height}px`;

      function applyBounds(
        element: HTMLElement,
        bounds: { height: number; left: number; top: number; width: number },
        inset = 0
      ) {
        element.style.left = inset === 0 ? `${bounds.left}%` : `calc(${bounds.left}% + ${inset}px)`;
        element.style.top = inset === 0 ? `${bounds.top}%` : `calc(${bounds.top}% + ${inset}px)`;
        element.style.width = inset === 0 ? `${bounds.width}%` : `calc(${bounds.width}% - ${inset * 2}px)`;
        element.style.height = inset === 0 ? `${bounds.height}%` : `calc(${bounds.height}% - ${inset * 2}px)`;
      }

      function createNode(
        node: PaneLayoutNode,
        bounds = { height: 100, left: 0, top: 0, width: 100 },
        inset = 0
      ): HTMLElement {
        if (node.type === "pane") {
          const pane = document.createElement("div");
          pane.className = "pane-split-tree-pane";
          applyBounds(pane, bounds, inset);
          return pane;
        }

        const split = document.createElement("div");
        split.className = `pane-split-tree-node ${node.direction === "horizontal" ? "horizontal" : "vertical"}`;
        split.classList.toggle("target", node.id === highlightedSplitId);
        applyBounds(split, bounds, inset);
        const ratio = clamp(Number(node.ratio) || 0.5, 0.15, 0.85);
        const childInset = 2;
        if (node.direction === "horizontal") {
          split.append(
            createNode(node.first, { height: ratio * 100, left: 0, top: 0, width: 100 }, childInset),
            createNode(node.second, { height: (1 - ratio) * 100, left: 0, top: ratio * 100, width: 100 }, childInset)
          );
        } else {
          split.append(
            createNode(node.first, { height: 100, left: 0, top: 0, width: ratio * 100 }, childInset),
            createNode(node.second, { height: 100, left: ratio * 100, top: 0, width: (1 - ratio) * 100 }, childInset)
          );
        }

        const frame = document.createElement("div");
        frame.className = "pane-split-tree-frame";
        split.append(frame);
        if (node.id === highlightedSplitId) {
          const splitter = document.createElement("div");
          splitter.className = `pane-split-tree-splitter ${node.direction === "horizontal" ? "horizontal" : "vertical"}`;
          if (node.direction === "horizontal") {
            splitter.style.top = `${ratio * 100}%`;
          } else {
            splitter.style.left = `${ratio * 100}%`;
          }
          split.append(splitter);
        }
        return split;
      }

      surface.append(createNode(layout));
      preview.append(titleElement, surface);
      return preview;
    }

    async function openPaneSplitContextMenu(event: MouseEvent, project: RendererProject, splitNode: SplitNode) {
      event.preventDefault();
      event.stopPropagation();
      const sourceElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const splitRect = sourceElement?.parentElement?.getBoundingClientRect();
      closePaneSplitContextMenu();
      closeWebAppTabMenu();

      didFreezePaneSplitMenu = true;
      await freezeWebAppsForOverlay();

      const menu = document.createElement("div") as PaneSplitContextMenu;
      menu.className = "webapp-tab-menu pane-split-context-menu";
      menu.setAttribute("role", "menu");
      const backdrop = document.createElement("div");
      backdrop.className = "pane-split-context-backdrop";
      backdrop.addEventListener("pointerdown", (pointerEvent) => {
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
        closePaneSplitContextMenu();
      });
      backdrop.addEventListener("contextmenu", (contextEvent) => {
        contextEvent.preventDefault();
        contextEvent.stopPropagation();
        closePaneSplitContextMenu();
      });

      const rotationPreview = paneLayoutState.getSplitRotationPreview(project, splitNode.id) as {
        current: PaneLayoutNode;
        rootSplitId: string;
        rotations: Array<{
          highlightedSplitId: string;
          layout: PaneLayoutNode;
          steps: number;
        }>;
      } | null;
      const currentLayout = (rotationPreview?.current || getProjectPaneLayout(project)) as PaneLayoutNode;
      const rootSplitId = rotationPreview?.rootSplitId || (currentLayout.type === "split" ? currentLayout.id : splitNode.id);
      const previewRect = getRenderedSplitRect(rootSplitId) || splitRect;
      const previewSize = getSplitPreviewSize(previewRect);
      const menuChromeWidth = 50;
      const menuWidth = Math.min(window.innerWidth - 24, previewSize.width + menuChromeWidth);
      const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
      const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 48));
      menu.style.width = `${Math.round(menuWidth)}px`;
      menu.style.inlineSize = `${Math.round(menuWidth)}px`;
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;

      const currentItem = createSplitLayoutMenuItem({
        highlightedSplitId: splitNode.id,
        layout: currentLayout,
        onClick: closePaneSplitContextMenu,
        previewSize,
        project,
        title: "Current layout"
      });
      const rotateItems = (rotationPreview?.rotations || []).map((rotation) =>
        createSplitLayoutMenuItem({
          highlightedSplitId: rotation.highlightedSplitId,
          layout: rotation.layout,
          onClick: () => {
            closePaneSplitContextMenu();
            rotateSplitTowardRoot(project, splitNode.id, rotation.steps);
          },
          previewSize,
          project,
          title: rotation.steps === 1 ? "Move up 1 level" : `Move up ${rotation.steps} levels`
        })
      );

      menu.append(currentItem, ...rotateItems);
      document.body.append(backdrop, menu);
      openPaneSplitMenu = menu;

      function onPointerDown(pointerEvent: PointerEvent) {
        if (pointerEvent.target instanceof Node && !menu.contains(pointerEvent.target)) {
          closePaneSplitContextMenu();
        }
      }

      function onKeyDown(keyEvent: KeyboardEvent) {
        if (keyEvent.key === "Escape") {
          closePaneSplitContextMenu();
        }
      }

      menu.cleanup = () => {
        backdrop.remove();
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };

      setTimeout(() => {
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
      }, 0);

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
      renderWorkspaceDashboard(project);
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
      renderWorkspaceDashboard(project);
    }

    function createSplitResizer(project: RendererProject, splitNode: SplitNode) {
      const resizer = document.createElement("div");
      resizer.className = `webapp-split-resizer ${splitNode.direction}`;
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", splitNode.direction === "vertical" ? "vertical" : "horizontal");
      resizer.addEventListener("mouseenter", () => {
        clearPaneExpansionPreview();
        resizer.parentElement?.classList.add("pane-expand-preview");
      });
      resizer.addEventListener("mouseleave", clearPaneExpansionPreview);
      resizer.addEventListener("contextmenu", (event) => {
        openPaneSplitContextMenu(event, project, splitNode).catch((error: unknown) => {
          console.error("Could not open splitter context menu:", error);
        });
      });

      resizer.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const splitElement = resizer.parentElement;
        if (!splitElement) {
          return;
        }
        const parentSplitElement = splitElement;
        const rect = parentSplitElement.getBoundingClientRect();
        const isVertical = splitNode.direction === "vertical";

        function onPointerMove(moveEvent: PointerEvent) {
          const rawRatio = isVertical
            ? (moveEvent.clientX - rect.left) / rect.width
            : (moveEvent.clientY - rect.top) / rect.height;
          splitNode.ratio = Math.min(0.85, Math.max(0.15, rawRatio));
          applySplitRatio(parentSplitElement, splitNode);
          queueWebAppSync();
        }

        function onPointerUp() {
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          persistPaneLayout(project);
        }

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
      });

      return resizer;
    }

    function applySplitRatio(splitElement: HTMLElement, splitNode: PaneLayoutNode) {
      const ratio = Number(splitNode.ratio) || 0.5;
      const firstRatio = Math.round(ratio * 1000) / 10;
      const secondRatio = Math.round((1 - ratio) * 1000) / 10;
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

        const forwardButton = document.createElement("button");
        forwardButton.className = "webapp-tool-button";
        forwardButton.type = "button";
        forwardButton.title = "Go forward";
        forwardButton.setAttribute("aria-label", "Go forward");
        forwardButton.append(createToolIcon("arrowRight"));
        forwardButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "forward"));

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

        tabs.append(
          homeButton,
          backButton,
          forwardButton,
          refreshButton,
          ...(autofillButton ? [autofillButton] : []),
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
        setVisibleWebAppHost(paneNode.id, {
          webApp: selectedWebApp,
          host
        } as VisiblePaneWebAppEntry);
      }

      queueWebAppSync();
      return pane;
    }

    function createPaneLayout(project: RendererProject, node: PaneLayoutNode): HTMLElement {
      if (node.type === "pane") {
        return createWebAppPane(project, node);
      }

      if (node.expandedChild === "first" || node.expandedChild === "second") {
        return createPaneLayout(project, node[node.expandedChild]);
      }

      const split = document.createElement("div");
      split.className = `webapp-split ${node.direction}`;
      split.dataset.splitId = node.id;
      applySplitRatio(split, node);
      split.append(
        createPaneLayout(project, node.first),
        createSplitResizer(project, node),
        createPaneLayout(project, node.second)
      );
      return split;
    }

    return {
      createPaneLayout
    };
}
