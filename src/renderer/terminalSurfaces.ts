import { createTerminalTabDom } from "./terminalTabDom.js";
import { createTerminalTabMenuController } from "./terminalTabMenu.js";
import { createTerminalSelectionBridge } from "./terminalSelectionBridge.js";
import {
  fitTerminal,
  getFitAddonConstructor,
  getTerminalFitSize,
  getXtermConstructor
} from "./terminalXtermRuntime.js";
import type { TerminalCard, TerminalTab } from "./terminalTypes.js";
import type { BoatyardBridge, RendererProject, RendererState } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

const globalScope: TerminalSurfacesGlobal = window;

type TerminalSurfacesBridge = BoatyardBridge & {
  attachTerminal(projectId: string, windowId: string, size: unknown): Promise<{
    tab: TerminalTab;
    terminalId: string;
  }>;
  closeTerminalTab(projectId: string, windowId: string): Promise<TerminalTab[]>;
  createTerminalTab(projectId: string, name: string): Promise<TerminalTab>;
  detachTerminal(terminalId: string): Promise<unknown>;
  listTerminalTabs(projectId: string): Promise<unknown>;
  readTerminalSelection: () => Promise<string>;
  renameTerminalTab(projectId: string, windowId: string, name: string): Promise<unknown>;
  resizeTerminal(terminalId: string, size: unknown): Promise<unknown> | unknown;
  updateTerminalSelection?: (
    projectId: string,
    surfaceKey: string,
    windowId: string
  ) => Promise<UnknownRecord>;
  updateTerminalTabOrder?: (projectId: string, windowIds: string[]) => Promise<unknown>;
  writeTerminal(terminalId: string, data: string): Promise<unknown> | unknown;
  writeTerminalSelection: (selection: string) => Promise<unknown>;
};

type TerminalState = RendererState & {
  terminalSelections?: Record<string, Record<string, string>>;
  terminalTabOrders?: Record<string, string[]>;
};

type TerminalSurfacesOptions = {
  boatyard: TerminalSurfacesBridge;
  getProjectById: (projectId?: string) => RendererProject | null;
  getState: () => TerminalState;
  createToolIcon: (name: string) => Node;
  clamp: (value: number, min: number, max: number) => number;
  defaultWidgetPaneId: string;
};

type TerminalSurfaceSession = {
  activeWindowId: string;
  card: TerminalCard;
  disposables?: Array<{ dispose?: () => void }>;
  fitAddon?: FitAddonInstance;
  lastOutputTabSyncAt?: number;
  projectId: string;
  removeMiddleClickPaste?: () => void;
  resizeObserver?: ResizeObserver;
  surfaceId: string;
  tabsResizeObserver?: ResizeObserver;
  term?: XtermTerminal;
  terminalId?: string;
};

type TerminalOutputSession = {
  lastOutputTabSyncAt: number;
  projectId: string;
  surfaceId: string;
  term: XtermTerminal;
};

type TerminalTabSyncTimer = {
  followupsRemaining: number;
  timer: ReturnType<typeof setTimeout>;
};

type TerminalCloseFocus = {
  surfaceId: string;
  timestamp: number;
  windowId: string;
};

type TerminalSurfaceOptions = {
  actionsContainer?: HTMLElement | null;
  className?: string;
  storageKey?: string;
  tabsContainer?: HTMLElement | null;
  tagName?: keyof HTMLElementTagNameMap;
};

type TerminalExitPayload = {
  projectId?: unknown;
  terminalId?: unknown;
  windowId?: unknown;
};

type TerminalDataPayload = {
  data?: unknown;
  terminalId?: unknown;
};

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createTerminalSurfaces({
    boatyard,
    getProjectById,
    getState,
    createToolIcon,
    clamp,
    defaultWidgetPaneId
  }: TerminalSurfacesOptions) {
    const terminalWidgetsBySurface = new Map<string, TerminalSurfaceSession>();
    const terminalWidgetsByTerminal = new Map<string, TerminalOutputSession>();
    const terminalTabSyncTimers = new Map<string, TerminalTabSyncTimer>();
    const terminalTabOrdersByProject = new Map<string, string[]>();
    let nextTerminalSurfaceId = 1;
    let pendingTerminalCloseFocus: TerminalCloseFocus | null = null;
    const TERMINAL_TAB_SYNC_DELAY_MS = 150;
    const TERMINAL_TAB_SYNC_FOLLOWUP_DELAY_MS = 250;
    const TERMINAL_OUTPUT_TAB_SYNC_THROTTLE_MS = 2000;
    const TERMINAL_CLOSE_FOCUS_TTL_MS = 3000;
    const {
      clearTerminalTabDragState,
      clearTerminalTabDropMarkers,
      createTerminalTabStrip,
      getRenderedTerminalTabIds,
      getReorderedTerminalTabIds,
      getTerminalTabButtons,
      getTerminalTabDropPosition,
      getTerminalTabList,
      updateTerminalTabDropMarker,
      updateTerminalTabScrollControls
    } = createTerminalTabDom({
      createToolIcon: (name: string) => createToolIcon(name) as HTMLElement
    });
    const {
      closeTerminalTabMenu,
      openTerminalTabContextMenu
    } = createTerminalTabMenuController({
      clamp,
      closeTerminalTab,
      createTerminalTab,
      editTerminalTabName,
      setTerminalStatus
    });

    function nextAnimationFrame() {
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function normalizeTerminalTab(value: unknown): TerminalTab | null {
      const source = isRecord(value) ? value : {};
      const id = String(source.id || "").trim();
      const index = Number(source.index);

      if (!id) {
        return null;
      }

      return {
        id,
        index: Number.isFinite(index) ? index : undefined,
        name: String(source.name || "").trim() || undefined
      };
    }

    async function listTerminalTabs(projectId: string): Promise<TerminalTab[]> {
      const tabs = await boatyard.listTerminalTabs(projectId);
      return Array.isArray(tabs)
        ? tabs.map(normalizeTerminalTab).filter((tab): tab is TerminalTab => Boolean(tab))
        : [];
    }

    function getTerminalSurfaceId(card: TerminalCard) {
      if (!card.dataset.terminalSurfaceId) {
        card.dataset.terminalSurfaceId = `terminal-surface-${nextTerminalSurfaceId}`;
        nextTerminalSurfaceId += 1;
      }

      return card.dataset.terminalSurfaceId;
    }

    function detachTerminalSurface(surfaceId: string) {
      const session = terminalWidgetsBySurface.get(surfaceId);

      if (!session) {
        return;
      }

      if (session.terminalId) {
        boatyard.detachTerminal(session.terminalId).catch((error: unknown) => {
          console.error("Could not detach terminal:", error);
        });
        terminalWidgetsByTerminal.delete(session.terminalId);
      }

      for (const disposable of session.disposables || []) {
        disposable?.dispose?.();
      }
      session.removeMiddleClickPaste?.();
      session.resizeObserver?.disconnect();
      session.tabsResizeObserver?.disconnect();
      session.term?.dispose();
      clearTimeout(terminalTabSyncTimers.get(surfaceId)?.timer);
      terminalTabSyncTimers.delete(surfaceId);
      terminalWidgetsBySurface.delete(surfaceId);
    }

    function detachProjectTerminal(projectId: string) {
      for (const [surfaceId, session] of terminalWidgetsBySurface.entries()) {
        if (session.projectId === projectId) {
          detachTerminalSurface(surfaceId);
        }
      }
    }

    function detachInactiveProjectTerminals(activeProjectId: string | null = null) {
      for (const [surfaceId, session] of terminalWidgetsBySurface.entries()) {
        if (session.projectId !== activeProjectId) {
          detachTerminalSurface(surfaceId);
        }
      }
    }

    function setTerminalStatus(card: TerminalCard, message: string) {
      const status = card.querySelector(".terminal-status");
      if (status) {
        status.replaceChildren(document.createTextNode(message));
      }
    }

    function rememberTerminalTabOrder(projectId: string, orderedWindowIds: unknown[]) {
      const normalizedProjectId = String(projectId);
      const normalizedWindowIds = orderedWindowIds.map((windowId: unknown) => String(windowId));
      terminalTabOrdersByProject.set(normalizedProjectId, normalizedWindowIds);

      return normalizedWindowIds;
    }

    function persistTerminalTabOrder(projectId: string, orderedWindowIds: unknown[]) {
      const normalizedProjectId = String(projectId);
      const normalizedWindowIds = rememberTerminalTabOrder(normalizedProjectId, orderedWindowIds);
      getState().terminalTabOrders = {
        ...(getState().terminalTabOrders || {}),
        [normalizedProjectId]: normalizedWindowIds
      };

      if (!boatyard.updateTerminalTabOrder) {
        return;
      }

      boatyard.updateTerminalTabOrder(normalizedProjectId, normalizedWindowIds).catch((error: unknown) => {
        console.error("Could not persist terminal tab order:", error);
      });
    }

    function getOrderedTerminalTabs(projectId: string, tabs: TerminalTab[]) {
      const order = terminalTabOrdersByProject.get(String(projectId));
      if (!order?.length) {
        rememberTerminalTabOrder(projectId, tabs.map((tab) => tab.id));
        return tabs;
      }

      const orderIndexes = new Map(order.map((windowId, index) => [windowId, index]));
      const orderedTabs = [...tabs].sort((left, right) => {
        const leftIndex = orderIndexes.get(left.id);
        const rightIndex = orderIndexes.get(right.id);

        if (leftIndex === undefined && rightIndex === undefined) {
          return left.index - right.index;
        }
        if (leftIndex === undefined) {
          return 1;
        }
        if (rightIndex === undefined) {
          return -1;
        }

        return leftIndex - rightIndex;
      });
      rememberTerminalTabOrder(projectId, orderedTabs.map((tab) => tab.id));
      return orderedTabs;
    }

    function getTerminalReplacementWindowId(
      card: TerminalCard,
      removedWindowId: unknown,
      remainingTabs: TerminalTab[]
    ) {
      const remainingTabIds = remainingTabs
        .map((tab: TerminalTab) => tab.id)
        .filter((tabId: string) => tabId !== String(removedWindowId));
      const removedIndex = getRenderedTerminalTabIds(card).indexOf(String(removedWindowId));

      if (removedIndex === -1 || !remainingTabIds.length) {
        return null;
      }

      return remainingTabIds[Math.min(removedIndex, remainingTabIds.length - 1)] || null;
    }

    function markTerminalCloseFocus(surfaceId: string, windowId: unknown) {
      pendingTerminalCloseFocus = {
        surfaceId,
        windowId: String(windowId),
        timestamp: Date.now()
      };
    }

    function shouldFocusAfterTerminalExit(surfaceId: string, windowId: unknown) {
      if (!pendingTerminalCloseFocus) {
        return true;
      }

      const isFresh = Date.now() - pendingTerminalCloseFocus.timestamp <= TERMINAL_CLOSE_FOCUS_TTL_MS;
      const shouldFocus = isFresh &&
        pendingTerminalCloseFocus.surfaceId === surfaceId &&
        pendingTerminalCloseFocus.windowId === String(windowId);

      if (!isFresh || shouldFocus) {
        pendingTerminalCloseFocus = null;
      }

      return shouldFocus;
    }

    function shouldRefreshTerminalTabs(session: TerminalSurfaceSession, tabs: TerminalTab[]) {
      const tabIds = tabs.map((tab: TerminalTab) => tab.id);
      const renderedTabIds = getRenderedTerminalTabIds(session.card);

      return !tabIds.includes(session.activeWindowId)
        || tabIds.length !== renderedTabIds.length
        || tabIds.some((tabId, index) => tabId !== renderedTabIds[index]);
    }

    async function syncTerminalTabsForSurface(surfaceId: string, followupsRemaining = 0) {
      terminalTabSyncTimers.delete(surfaceId);
      const session = terminalWidgetsBySurface.get(surfaceId);
      if (!session?.card?.isConnected) {
        return;
      }

      const project = getProjectById(session.projectId);
      if (!project) {
        return;
      }

      try {
        const tabs = getOrderedTerminalTabs(project.id, await listTerminalTabs(project.id));
        if (shouldRefreshTerminalTabs(session, tabs)) {
          const closedWindowId = tabs.some((tab) => tab.id === session.activeWindowId)
            ? null
            : session.activeWindowId;
          await refreshTerminalSurfaceAfterClosedTab(project, session.card, closedWindowId, tabs, {
            focus: session.activeWindowId === closedWindowId
          });
          return;
        }
      } catch (error) {
        setTerminalStatus(session.card, `Could not refresh shells: ${asErrorMessage(error)}`);
      }

      if (followupsRemaining > 0 && terminalWidgetsBySurface.has(surfaceId)) {
        scheduleTerminalSurfaceTabSync(surfaceId, followupsRemaining - 1, TERMINAL_TAB_SYNC_FOLLOWUP_DELAY_MS);
      }
    }

    function scheduleTerminalSurfaceTabSync(
      surfaceId: string,
      followupsRemaining = 0,
      delay = TERMINAL_TAB_SYNC_DELAY_MS
    ) {
      const scheduled = terminalTabSyncTimers.get(surfaceId);
      if (scheduled) {
        scheduled.followupsRemaining = Math.max(scheduled.followupsRemaining, followupsRemaining);
        return;
      }

      const scheduledSync = {
        followupsRemaining,
        timer: setTimeout(() => {
          syncTerminalTabsForSurface(surfaceId, scheduledSync.followupsRemaining);
        }, delay)
      };
      terminalTabSyncTimers.set(surfaceId, scheduledSync);
    }

    function scheduleTerminalTabSync(terminalId: string, followupsRemaining = 0) {
      const terminalSession = terminalWidgetsByTerminal.get(terminalId);
      if (!terminalSession) {
        return;
      }

      scheduleTerminalSurfaceTabSync(terminalSession.surfaceId, followupsRemaining);
    }

    function scheduleTerminalOutputTabSync(terminalId: string) {
      const terminalSession = terminalWidgetsByTerminal.get(terminalId);
      if (!terminalSession) {
        return;
      }

      const now = Date.now();
      if (now - (terminalSession.lastOutputTabSyncAt || 0) < TERMINAL_OUTPUT_TAB_SYNC_THROTTLE_MS) {
        return;
      }

      terminalSession.lastOutputTabSyncAt = now;
      scheduleTerminalSurfaceTabSync(terminalSession.surfaceId);
    }

    async function refreshProjectTerminalTabLabels(project: RendererProject) {
      const tabs = getOrderedTerminalTabs(project.id, await listTerminalTabs(project.id));
      const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));

      for (const session of terminalWidgetsBySurface.values()) {
        if (session.projectId !== project.id || !session.card?.isConnected) {
          continue;
        }

        for (const tabButton of getTerminalTabButtons(session.card)) {
          if (tabButton.classList.contains("terminal-tab-editor")) {
            continue;
          }

          const tab = tabsById.get(tabButton.dataset.windowId);
          if (tab) {
            tabButton.textContent = tab.name || `shell ${tab.index}`;
          }
          tabButton.classList.toggle("active", tabButton.dataset.windowId === session.activeWindowId);
        }
      }
    }

    async function renameTerminalTab(project: RendererProject, tab: TerminalTab, nextName: unknown) {
      const currentName = tab.name || `shell ${tab.index}`;
      const normalizedName = String(nextName || "").trim();
      if (!normalizedName || normalizedName === currentName) {
        return;
      }

      await boatyard.renameTerminalTab(project.id || "", tab.id, normalizedName);
      await refreshProjectTerminalTabLabels(project);
    }

    function editTerminalTabName(
      project: RendererProject,
      card: TerminalCard,
      tab: TerminalTab,
      tabButton: HTMLButtonElement
    ) {
      const currentName = tab.name || `shell ${tab.index}`;
      const editor = document.createElement("input");
      editor.className = "terminal-tab terminal-tab-editor";
      editor.type = "text";
      editor.value = currentName;
      editor.dataset.windowId = tab.id;
      editor.setAttribute("aria-label", "Shell name");

      let finished = false;
      const finish = async (shouldSave: boolean) => {
        if (finished) {
          return;
        }
        finished = true;

        const nextName = editor.value;
        editor.replaceWith(tabButton);
        if (!shouldSave) {
          return;
        }

        try {
          await renameTerminalTab(project, tab, nextName);
        } catch (error) {
          setTerminalStatus(card, `Could not rename shell: ${asErrorMessage(error)}`);
        }
      };

      editor.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      });
      editor.addEventListener("blur", () => finish(true));

      tabButton.replaceWith(editor);
      editor.focus();
      editor.select();
    }

    function getTerminalSurfaceSession(card: TerminalCard) {
      return terminalWidgetsBySurface.get(getTerminalSurfaceId(card)) || null;
    }

    function getPersistedTerminalWindowId(projectId: string | undefined, surfaceKey: string | undefined) {
      return getState().terminalSelections?.[projectId]?.[surfaceKey] || null;
    }

    function rememberTerminalSelection(projectId: unknown, surfaceKey: unknown, windowId: unknown) {
      const normalizedProjectId = String(projectId || "").trim();
      const normalizedSurfaceKey = String(surfaceKey || "").trim();
      const normalizedWindowId = String(windowId || "").trim();
      if (!normalizedProjectId || !normalizedSurfaceKey) {
        return;
      }

      getState().terminalSelections = {
        ...(getState().terminalSelections || {})
      };

      if (!normalizedWindowId) {
        if (getState().terminalSelections[normalizedProjectId]) {
          delete getState().terminalSelections[normalizedProjectId][normalizedSurfaceKey];
          if (!Object.keys(getState().terminalSelections[normalizedProjectId]).length) {
            delete getState().terminalSelections[normalizedProjectId];
          }
        }
        return;
      }

      getState().terminalSelections[normalizedProjectId] = {
        ...(getState().terminalSelections[normalizedProjectId] || {}),
        [normalizedSurfaceKey]: normalizedWindowId
      };
    }

    function persistTerminalSelection(projectId: unknown, surfaceKey: unknown, windowId: unknown) {
      if (!surfaceKey || !boatyard.updateTerminalSelection) {
        return;
      }

      rememberTerminalSelection(projectId, surfaceKey, windowId);

      const normalizedProjectId = String(projectId || "").trim();
      const normalizedSurfaceKey = String(surfaceKey || "").trim();
      const normalizedWindowId = String(windowId || "").trim();
      boatyard.updateTerminalSelection(normalizedProjectId, normalizedSurfaceKey, normalizedWindowId)
        .then((selections: UnknownRecord) => {
          if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
            return;
          }

          getState().terminalSelections = {
            ...(getState().terminalSelections || {})
          };
          if (Object.keys(selections).length) {
            getState().terminalSelections[normalizedProjectId] = selections as Record<string, string>;
          } else {
            delete getState().terminalSelections[normalizedProjectId];
          }
        })
        .catch((error: unknown) => {
          console.error("Could not persist terminal selection:", error);
        });
    }

    async function selectTerminalTab(project: RendererProject, card: TerminalCard, tab: TerminalTab) {
      const session = getTerminalSurfaceSession(card);
      const pendingWindowId = card.dataset.pendingTerminalWindowId;
      if (session?.activeWindowId === tab.id) {
        persistTerminalSelection(project.id, card.dataset.terminalStorageKey, tab.id);
        session.term?.focus();
        return;
      }

      if (pendingWindowId === tab.id) {
        return;
      }

      card.dataset.pendingTerminalWindowId = tab.id;
      try {
        await attachTerminalTab(project, card, tab.id, { focus: true });
        persistTerminalSelection(project.id, card.dataset.terminalStorageKey, tab.id);
      } finally {
        if (card.dataset.pendingTerminalWindowId === tab.id) {
          delete card.dataset.pendingTerminalWindowId;
        }
      }
    }

    function selectAdjacentTerminalTab(project: RendererProject, card: TerminalCard, direction: number) {
      const tabList = getTerminalTabList(card);
      if (tabList?.querySelector(".terminal-tab-editor")) {
        return;
      }

      const tabButtons = [...(tabList?.querySelectorAll<HTMLElement>(".terminal-tab[data-window-id]") || [])];
      if (tabButtons.length <= 1) {
        return;
      }

      const session = getTerminalSurfaceSession(card);
      const activeWindowId = session?.activeWindowId || tabButtons.find((tabButton) => tabButton.classList.contains("active"))?.dataset.windowId;
      const activeIndex = Math.max(0, tabButtons.findIndex((tabButton) => tabButton.dataset.windowId === activeWindowId));
      const nextIndex = (activeIndex + direction + tabButtons.length) % tabButtons.length;
      const nextWindowId = tabButtons[nextIndex]?.dataset.windowId;

      if (!nextWindowId || nextWindowId === activeWindowId) {
        return;
      }

      selectTerminalTab(project, card, { id: nextWindowId }).catch((error: unknown) => {
        setTerminalStatus(card, `Could not switch shell: ${asErrorMessage(error)}`);
      });
    }

    function handleTerminalTabShortcut(project: RendererProject, card: TerminalCard, event: KeyboardEvent) {
      if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const direction = event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : 0;

      const target = event.target instanceof Element ? event.target : null;
      if (!direction || target?.closest?.(".terminal-tab-editor")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      selectAdjacentTerminalTab(project, card, direction);
    }

    function bindTerminalTabDropHandlers(project: RendererProject, card: TerminalCard, tabList: HTMLElement) {
      tabList.ondragover = (event) => {
        const draggedWindowId = tabList.dataset.draggedWindowId;
        if (!draggedWindowId) {
          return;
        }

        const dropPosition = getTerminalTabDropPosition(tabList, event);
        if (!dropPosition || dropPosition.targetButton.dataset.windowId === draggedWindowId) {
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        updateTerminalTabDropMarker(tabList, dropPosition);
      };

      tabList.ondragleave = (event: DragEvent) => {
        if (!event.relatedTarget || !tabList.contains(event.relatedTarget as Node)) {
          clearTerminalTabDropMarkers(tabList);
        }
      };

      tabList.ondrop = async (event: DragEvent) => {
        const draggedWindowId = tabList.dataset.draggedWindowId || event.dataTransfer?.getData("text/plain");
        if (!draggedWindowId) {
          return;
        }

        event.preventDefault();
        const dropPosition = getTerminalTabDropPosition(tabList, event);
        const targetWindowId = dropPosition?.targetButton?.dataset.windowId;
        const nextTabIds = targetWindowId
          ? getReorderedTerminalTabIds(tabList, draggedWindowId, targetWindowId, dropPosition.insertAfter)
          : null;
        clearTerminalTabDragState(tabList);

        if (!nextTabIds) {
          return;
        }

        const session = getTerminalSurfaceSession(card);
        const activeWindowId = session?.activeWindowId || draggedWindowId;

        try {
          persistTerminalTabOrder(project.id || "", nextTabIds);
          const tabs = getOrderedTerminalTabs(project.id || "", await listTerminalTabs(project.id || ""));
          await refreshTerminalTabs(project, card, activeWindowId, tabs, { focus: true });
        } catch (error) {
          setTerminalStatus(card, `Could not move shell: ${asErrorMessage(error)}`);
        }
      };
    }

    function attachTerminalTabDragHandlers(
      tab: TerminalTab,
      tabButton: HTMLButtonElement,
      tabList: HTMLElement
    ) {
      tabButton.draggable = true;

      tabButton.addEventListener("dragstart", (event) => {
        if (tabList.querySelector(".terminal-tab-editor")) {
          event.preventDefault();
          return;
        }

        tabList.dataset.draggedWindowId = tab.id;
        tabButton.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", tab.id);
        }
      });

      tabButton.addEventListener("dragend", () => {
        tabButton.classList.remove("dragging");
        clearTerminalTabDragState(tabList);
      });
    }

    async function refreshTerminalTabs(
      project: RendererProject,
      card: TerminalCard,
      activeWindowId: string | null = null,
      knownTabs: TerminalTab[] | null = null,
      { focus = false }: { focus?: boolean } = {}
    ) {
      const tabList = getTerminalTabList(card);
      if (!tabList) {
        setTerminalStatus(card, "Terminal tabs unavailable.");
        return;
      }

      tabList.innerHTML = "";
      bindTerminalTabDropHandlers(project, card, tabList);

      try {
        const projectId = project.id || "";
        const tabs = getOrderedTerminalTabs(projectId, Array.isArray(knownTabs)
          ? knownTabs
          : await listTerminalTabs(projectId));
        const preferredWindowId = activeWindowId || getPersistedTerminalWindowId(projectId, card.dataset.terminalStorageKey);
        const selectedTab = tabs.find((tab) => tab.id === preferredWindowId) || tabs[0];

        for (const tab of tabs) {
          const tabButton = document.createElement("button");
          tabButton.className = "terminal-tab";
          tabButton.classList.toggle("active", tab.id === selectedTab?.id);
          tabButton.type = "button";
          tabButton.dataset.windowId = tab.id;
          tabButton.textContent = tab.name || `shell ${tab.index}`;
          tabButton.title = "Double-click to rename shell";
          attachTerminalTabDragHandlers(tab, tabButton, tabList);
          tabButton.addEventListener("click", () => {
            selectTerminalTab(project, card, tab).catch((error: unknown) => {
              setTerminalStatus(card, `Could not switch shell: ${asErrorMessage(error)}`);
            });
          });
          tabButton.addEventListener("dblclick", (event) => {
            event.preventDefault();
            event.stopPropagation();
            editTerminalTabName(project, card, tab, tabButton);
          });
          tabButton.addEventListener("contextmenu", (event) => {
            openTerminalTabContextMenu(event, { project, card, tab, tabButton, tabList });
          });
          tabList.append(tabButton);
        }

        tabList.querySelector(".terminal-tab.active")?.scrollIntoView({
          block: "nearest",
          inline: "nearest"
        });
        requestAnimationFrame(() => updateTerminalTabScrollControls(card));

        if (selectedTab) {
          if (!card.isConnected) {
            return;
          }

          await attachTerminalTab(project, card, selectedTab.id, { focus });
          persistTerminalSelection(projectId, card.dataset.terminalStorageKey, selectedTab.id);
        }
      } catch (error) {
        setTerminalStatus(card, `Terminal unavailable: ${asErrorMessage(error)}`);
      }
    }

    async function refreshTerminalSurfaceAfterClosedTab(
      project: RendererProject,
      card: TerminalCard,
      closedWindowId: unknown,
      knownTabs: TerminalTab[],
      { focus = false }: { focus?: boolean } = {}
    ) {
      const orderedTabs = getOrderedTerminalTabs(project.id || "", knownTabs);
      const activeWindowId = closedWindowId
        ? getTerminalReplacementWindowId(card, closedWindowId, orderedTabs)
        : null;

      await refreshTerminalTabs(project, card, activeWindowId, orderedTabs, { focus });
    }

    async function createTerminalTab(
      project: RendererProject,
      card: TerminalCard,
      insertAfterWindowId: string | null = null
    ) {
      const projectId = project.id || "";
      const tab = await boatyard.createTerminalTab(projectId, "shell");
      let tabs = await listTerminalTabs(projectId);

      if (insertAfterWindowId) {
        const renderedTabIds = getRenderedTerminalTabIds(card).filter((windowId) => windowId !== tab.id);
        const targetIndex = renderedTabIds.indexOf(String(insertAfterWindowId));
        const nextTabIds = [...renderedTabIds];
        nextTabIds.splice(targetIndex === -1 ? nextTabIds.length : targetIndex + 1, 0, tab.id);
        persistTerminalTabOrder(projectId, nextTabIds);
        tabs = getOrderedTerminalTabs(projectId, tabs);
      }

      await refreshTerminalTabs(project, card, tab.id, tabs, { focus: true });
    }

    async function closeTerminalTab(project: RendererProject, card: TerminalCard, windowId: unknown) {
      const normalizedWindowId = String(windowId || "");
      if (!normalizedWindowId) {
        return;
      }

      const surfaceId = getTerminalSurfaceId(card);
      const session = terminalWidgetsBySurface.get(surfaceId);
      const activeWindowId = session?.activeWindowId || "";

      try {
        const projectId = project.id || "";
        const allTabs = await listTerminalTabs(projectId);
        if (allTabs.length <= 1) {
          return;
        }

        if (activeWindowId === normalizedWindowId) {
          markTerminalCloseFocus(surfaceId, normalizedWindowId);
        }

        const remainingTabs = (await boatyard.closeTerminalTab(projectId, normalizedWindowId))
          .filter((tab: TerminalTab) => tab.id !== normalizedWindowId);
        const nextActiveWindowId = activeWindowId === normalizedWindowId
          ? getTerminalReplacementWindowId(card, normalizedWindowId, remainingTabs)
          : activeWindowId;
        await refreshTerminalTabs(project, card, nextActiveWindowId, remainingTabs, {
          focus: activeWindowId === normalizedWindowId
        });
      } catch (error) {
        setTerminalStatus(card, `Could not close shell: ${asErrorMessage(error)}`);
      }
    }

    async function attachTerminalTab(
      project: RendererProject,
      card: TerminalCard,
      windowId: string,
      { focus = false }: { focus?: boolean } = {}
    ) {
      if (!card.isConnected) {
        return;
      }

      const TerminalConstructor = getXtermConstructor(globalScope);
      const FitAddonConstructor = getFitAddonConstructor(globalScope);

      if (!TerminalConstructor || !FitAddonConstructor) {
        setTerminalStatus(card, "Terminal renderer unavailable.");
        return;
      }

      const surfaceId = getTerminalSurfaceId(card);
      detachTerminalSurface(surfaceId);
      const viewport = card.querySelector<HTMLElement>(".terminal-viewport");
      if (!viewport) {
        setTerminalStatus(card, "Terminal viewport unavailable.");
        return;
      }
      viewport.innerHTML = "";
      setTerminalStatus(card, "Attaching...");

      const term = new TerminalConstructor({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        theme: {
          background: "#080c11",
          foreground: "#d7dde5",
          cursor: "#41b883"
        }
      });
      const fitAddon = new FitAddonConstructor();
      term.loadAddon(fitAddon);
      term.open(viewport);
      await nextAnimationFrame();
      let lastFitSize = fitTerminal(term, fitAddon);

      const projectId = project.id || "";
      const attachResult = await boatyard.attachTerminal(projectId, windowId, lastFitSize);
      const disposable = term.onData((data: string) => {
        if (data.includes("\x04")) {
          markTerminalCloseFocus(surfaceId, attachResult.tab.id);
        }

        boatyard.writeTerminal(attachResult.terminalId, data);
        scheduleTerminalTabSync(attachResult.terminalId, /[\x04\r\n]/.test(data) ? 3 : 0);
      });
      const selectionBridge = createTerminalSelectionBridge({
        boatyard,
        term,
        viewport,
        getSession: () => terminalWidgetsBySurface.get(surfaceId),
        scheduleTerminalTabSync
      });
      let resizeAnimationFrame: number | null = null;
      const resizeObserver = new ResizeObserver(() => {
        if (resizeAnimationFrame) {
          return;
        }

        resizeAnimationFrame = requestAnimationFrame(() => {
          resizeAnimationFrame = null;
          const size = getTerminalFitSize(term, fitAddon);
          if (size.cols === lastFitSize.cols && size.rows === lastFitSize.rows) {
            return;
          }

          fitAddon.fit();
          lastFitSize = size;
          boatyard.resizeTerminal(attachResult.terminalId, size);
        });
      });
      resizeObserver.observe(viewport);
      terminalWidgetsBySurface.set(surfaceId, {
        surfaceId,
        projectId,
        card,
        terminalId: attachResult.terminalId,
        activeWindowId: attachResult.tab.id,
        term,
        fitAddon,
        disposables: [
          disposable,
          ...selectionBridge.disposables,
          {
            dispose: () => {
              if (resizeAnimationFrame) {
                cancelAnimationFrame(resizeAnimationFrame);
              }
            }
          }
        ],
        removeMiddleClickPaste: selectionBridge.removeEventListeners,
        resizeObserver,
        tabsResizeObserver: card.terminalTabsResizeObserver
      });
      terminalWidgetsByTerminal.set(attachResult.terminalId, {
        projectId,
        surfaceId,
        term,
        lastOutputTabSyncAt: 0
      });
      setTerminalStatus(card, attachResult.tab.name || "attached");

      for (const tabButton of getTerminalTabButtons(card)) {
        tabButton.classList.toggle("active", tabButton.dataset.windowId === attachResult.tab.id);
      }

      if (focus) {
        term.focus();
      }
    }

    function createTerminalSurface(project: RendererProject, {
      tagName = "article",
      className = "widget-card terminal-widget",
      storageKey = "widget:default",
      tabsContainer = null,
      actionsContainer = null
    }: TerminalSurfaceOptions = {}) {
      const card = document.createElement(tagName) as TerminalCard;
      card.className = className;
      card.dataset.terminalStorageKey = storageKey;

      const header = document.createElement("div");
      header.className = "terminal-widget-header";

      const title = document.createElement("div");
      title.className = "terminal-widget-title";
      title.innerHTML = "<span>Terminal</span><small>tmux</small>";

      const actions = document.createElement("div");
      actions.className = "terminal-widget-actions";

      const tabs = document.createElement("div");
      tabs.className = tabsContainer ? "terminal-tabs terminal-pane-tabs" : "terminal-tabs";
      card.terminalTabsElement = tabs;
      const tabStrip = createTerminalTabStrip(card, tabs);

      const addButton = document.createElement("button");
      addButton.className = "terminal-action";
      addButton.type = "button";
      addButton.title = "New shell";
      addButton.setAttribute("aria-label", "New shell");
      addButton.textContent = "+";
      addButton.addEventListener("click", async () => {
        const activeWindowId = getTerminalSurfaceSession(card)?.activeWindowId || null;
        await createTerminalTab(project, card, activeWindowId);
      });

      if (tabsContainer || actionsContainer) {
        tabsContainer?.append(addButton, tabStrip);
      } else {
        actions.append(addButton);
        header.append(title, tabStrip, actions);
      }

      const viewport = document.createElement("div");
      viewport.className = "terminal-viewport";

      const status = document.createElement("p");
      status.className = "terminal-status";
      status.textContent = "Loading tmux session...";

      card.addEventListener("keydown", (event) => {
        handleTerminalTabShortcut(project, card, event);
      }, true);

      if (!tabsContainer && !actionsContainer) {
        card.append(header);
      }

      card.append(viewport, status);
      queueMicrotask(() => {
        refreshTerminalTabs(project, card);
      });
      return card;
    }

    function createTerminalWidget(project: RendererProject, props: { widgetPaneId?: string } = {}) {
      return createTerminalSurface(project, {
        storageKey: `widget:${props.widgetPaneId || defaultWidgetPaneId}`
      });
    }

    function hydrateTerminalTabOrders() {
      terminalTabOrdersByProject.clear();
      const persistedOrders = getState().terminalTabOrders || {};

      for (const [projectId, windowIds] of Object.entries(persistedOrders)) {
        if (Array.isArray(windowIds)) {
          rememberTerminalTabOrder(projectId, windowIds);
        }
      }
    }

    function handleTerminalData({ terminalId, data }: TerminalDataPayload) {
      const normalizedTerminalId = String(terminalId || "");
      const session = terminalWidgetsByTerminal.get(normalizedTerminalId);
      if (session) {
        session.term.write(String(data || ""));
      }
      scheduleTerminalOutputTabSync(normalizedTerminalId);
    }

    async function handleTerminalExit({ terminalId, projectId, windowId }: TerminalExitPayload) {
      const normalizedTerminalId = String(terminalId || "");
      const session = terminalWidgetsByTerminal.get(normalizedTerminalId);
      if (!session) {
        return;
      }

      terminalWidgetsByTerminal.delete(normalizedTerminalId);
      const surfaceSession = terminalWidgetsBySurface.get(session.surfaceId);
      if (!surfaceSession || surfaceSession.terminalId !== normalizedTerminalId) {
        return;
      }

      const exitedProjectId = String(projectId || surfaceSession.projectId);
      const exitedWindowId = windowId || surfaceSession.activeWindowId;
      if (!exitedProjectId || !exitedWindowId) {
        terminalWidgetsBySurface.delete(session.surfaceId);
        return;
      }

      const project = getProjectById(exitedProjectId);
      if (!project) {
        terminalWidgetsBySurface.delete(session.surfaceId);
        return;
      }

      try {
        const tabs = await listTerminalTabs(project.id);
        await refreshTerminalSurfaceAfterClosedTab(project, surfaceSession.card, exitedWindowId, tabs, {
          focus: shouldFocusAfterTerminalExit(session.surfaceId, exitedWindowId)
        });
      } catch (error) {
        setTerminalStatus(surfaceSession.card, `Could not refresh shells: ${asErrorMessage(error)}`);
      }
    }

    return {
      closeTerminalTabMenu,
      createTerminalSurface,
      createTerminalWidget,
      detachInactiveProjectTerminals,
      detachProjectTerminal,
      handleTerminalData,
      handleTerminalExit,
      hydrateTerminalTabOrders
    };
}
