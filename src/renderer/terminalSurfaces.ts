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

const globalScope: TerminalSurfacesGlobal = window;

export function createTerminalSurfaces({
    boatyard,
    getProjectById,
    getState,
    createToolIcon,
    clamp,
    defaultWidgetPaneId
  }) {
    const terminalWidgetsBySurface = new Map();
    const terminalWidgetsByTerminal = new Map();
    const terminalTabSyncTimers = new Map();
    const terminalTabOrdersByProject = new Map<string, string[]>();
    let nextTerminalSurfaceId = 1;
    let pendingTerminalCloseFocus = null;
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
    } = createTerminalTabDom({ createToolIcon });
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

    function getTerminalSurfaceId(card) {
      if (!card.dataset.terminalSurfaceId) {
        card.dataset.terminalSurfaceId = `terminal-surface-${nextTerminalSurfaceId}`;
        nextTerminalSurfaceId += 1;
      }

      return card.dataset.terminalSurfaceId;
    }

    function detachTerminalSurface(surfaceId) {
      const session = terminalWidgetsBySurface.get(surfaceId);

      if (!session) {
        return;
      }

      if (session.terminalId) {
        boatyard.detachTerminal(session.terminalId).catch((error) => {
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

    function detachProjectTerminal(projectId) {
      for (const [surfaceId, session] of terminalWidgetsBySurface.entries()) {
        if (session.projectId === projectId) {
          detachTerminalSurface(surfaceId);
        }
      }
    }

    function detachInactiveProjectTerminals(activeProjectId = null) {
      for (const [surfaceId, session] of terminalWidgetsBySurface.entries()) {
        if (session.projectId !== activeProjectId) {
          detachTerminalSurface(surfaceId);
        }
      }
    }

    function setTerminalStatus(card, message) {
      const status = card.querySelector(".terminal-status");
      if (status) {
        status.replaceChildren(document.createTextNode(message));
      }
    }

    function rememberTerminalTabOrder(projectId, orderedWindowIds) {
      const normalizedProjectId = String(projectId);
      const normalizedWindowIds = orderedWindowIds.map((windowId) => String(windowId));
      terminalTabOrdersByProject.set(normalizedProjectId, normalizedWindowIds);

      return normalizedWindowIds;
    }

    function persistTerminalTabOrder(projectId, orderedWindowIds) {
      const normalizedProjectId = String(projectId);
      const normalizedWindowIds = rememberTerminalTabOrder(normalizedProjectId, orderedWindowIds);
      getState().terminalTabOrders = {
        ...(getState().terminalTabOrders || {}),
        [normalizedProjectId]: normalizedWindowIds
      };

      if (!boatyard.updateTerminalTabOrder) {
        return;
      }

      boatyard.updateTerminalTabOrder(normalizedProjectId, normalizedWindowIds).catch((error) => {
        console.error("Could not persist terminal tab order:", error);
      });
    }

    function getOrderedTerminalTabs(projectId, tabs: TerminalTab[]) {
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

    function getTerminalReplacementWindowId(card, removedWindowId, remainingTabs) {
      const remainingTabIds = remainingTabs
        .map((tab) => tab.id)
        .filter((tabId) => tabId !== String(removedWindowId));
      const removedIndex = getRenderedTerminalTabIds(card).indexOf(String(removedWindowId));

      if (removedIndex === -1 || !remainingTabIds.length) {
        return null;
      }

      return remainingTabIds[Math.min(removedIndex, remainingTabIds.length - 1)] || null;
    }

    function markTerminalCloseFocus(surfaceId, windowId) {
      pendingTerminalCloseFocus = {
        surfaceId,
        windowId: String(windowId),
        timestamp: Date.now()
      };
    }

    function shouldFocusAfterTerminalExit(surfaceId, windowId) {
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

    function shouldRefreshTerminalTabs(session, tabs) {
      const tabIds = tabs.map((tab) => tab.id);
      const renderedTabIds = getRenderedTerminalTabIds(session.card);

      return !tabIds.includes(session.activeWindowId)
        || tabIds.length !== renderedTabIds.length
        || tabIds.some((tabId, index) => tabId !== renderedTabIds[index]);
    }

    async function syncTerminalTabsForSurface(surfaceId, followupsRemaining = 0) {
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
        setTerminalStatus(session.card, `Could not refresh shells: ${error.message}`);
      }

      if (followupsRemaining > 0 && terminalWidgetsBySurface.has(surfaceId)) {
        scheduleTerminalSurfaceTabSync(surfaceId, followupsRemaining - 1, TERMINAL_TAB_SYNC_FOLLOWUP_DELAY_MS);
      }
    }

    function scheduleTerminalSurfaceTabSync(surfaceId, followupsRemaining = 0, delay = TERMINAL_TAB_SYNC_DELAY_MS) {
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

    function scheduleTerminalTabSync(terminalId, followupsRemaining = 0) {
      const terminalSession = terminalWidgetsByTerminal.get(terminalId);
      if (!terminalSession) {
        return;
      }

      scheduleTerminalSurfaceTabSync(terminalSession.surfaceId, followupsRemaining);
    }

    function scheduleTerminalOutputTabSync(terminalId) {
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

    async function refreshProjectTerminalTabLabels(project) {
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

    async function renameTerminalTab(project, tab, nextName) {
      const currentName = tab.name || `shell ${tab.index}`;
      const normalizedName = nextName.trim();
      if (!normalizedName || normalizedName === currentName) {
        return;
      }

      await boatyard.renameTerminalTab(project.id, tab.id, normalizedName);
      await refreshProjectTerminalTabLabels(project);
    }

    function editTerminalTabName(project, card, tab, tabButton) {
      const currentName = tab.name || `shell ${tab.index}`;
      const editor = document.createElement("input");
      editor.className = "terminal-tab terminal-tab-editor";
      editor.type = "text";
      editor.value = currentName;
      editor.dataset.windowId = tab.id;
      editor.setAttribute("aria-label", "Shell name");

      let finished = false;
      const finish = async (shouldSave) => {
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
          setTerminalStatus(card, `Could not rename shell: ${error.message}`);
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

    function getTerminalSurfaceSession(card) {
      return terminalWidgetsBySurface.get(getTerminalSurfaceId(card)) || null;
    }

    function getPersistedTerminalWindowId(projectId, surfaceKey) {
      return getState().terminalSelections?.[projectId]?.[surfaceKey] || null;
    }

    function rememberTerminalSelection(projectId, surfaceKey, windowId) {
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

    function persistTerminalSelection(projectId, surfaceKey, windowId) {
      if (!surfaceKey || !boatyard.updateTerminalSelection) {
        return;
      }

      rememberTerminalSelection(projectId, surfaceKey, windowId);

      boatyard.updateTerminalSelection(projectId, surfaceKey, windowId)
        .then((selections) => {
          if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
            return;
          }

          const normalizedProjectId = String(projectId || "").trim();
          getState().terminalSelections = {
            ...(getState().terminalSelections || {})
          };
          if (Object.keys(selections).length) {
            getState().terminalSelections[normalizedProjectId] = selections;
          } else {
            delete getState().terminalSelections[normalizedProjectId];
          }
        })
        .catch((error) => {
          console.error("Could not persist terminal selection:", error);
        });
    }

    async function selectTerminalTab(project, card, tab) {
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

    function selectAdjacentTerminalTab(project, card, direction) {
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

      selectTerminalTab(project, card, { id: nextWindowId }).catch((error) => {
        setTerminalStatus(card, `Could not switch shell: ${error.message}`);
      });
    }

    function handleTerminalTabShortcut(project, card, event) {
      if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const direction = event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : 0;

      if (!direction || event.target?.closest?.(".terminal-tab-editor")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      selectAdjacentTerminalTab(project, card, direction);
    }

    function bindTerminalTabDropHandlers(project, card, tabList) {
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

      tabList.ondragleave = (event) => {
        if (!event.relatedTarget || !tabList.contains(event.relatedTarget)) {
          clearTerminalTabDropMarkers(tabList);
        }
      };

      tabList.ondrop = async (event) => {
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
          persistTerminalTabOrder(project.id, nextTabIds);
          const tabs = getOrderedTerminalTabs(project.id, await listTerminalTabs(project.id));
          await refreshTerminalTabs(project, card, activeWindowId, tabs, { focus: true });
        } catch (error) {
          setTerminalStatus(card, `Could not move shell: ${error.message}`);
        }
      };
    }

    function attachTerminalTabDragHandlers(card, tab, tabButton, tabList) {
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

    async function refreshTerminalTabs(project, card, activeWindowId = null, knownTabs = null, { focus = false } = {}) {
      const tabList = getTerminalTabList(card);
      if (!tabList) {
        setTerminalStatus(card, "Terminal tabs unavailable.");
        return;
      }

      tabList.innerHTML = "";
      bindTerminalTabDropHandlers(project, card, tabList);

      try {
        const tabs = getOrderedTerminalTabs(project.id, Array.isArray(knownTabs)
          ? knownTabs
          : await listTerminalTabs(project.id));
        const preferredWindowId = activeWindowId || getPersistedTerminalWindowId(project.id, card.dataset.terminalStorageKey);
        const selectedTab = tabs.find((tab) => tab.id === preferredWindowId) || tabs[0];

        for (const tab of tabs) {
          const tabButton = document.createElement("button");
          tabButton.className = "terminal-tab";
          tabButton.classList.toggle("active", tab.id === selectedTab?.id);
          tabButton.type = "button";
          tabButton.dataset.windowId = tab.id;
          tabButton.textContent = tab.name || `shell ${tab.index}`;
          tabButton.title = "Double-click to rename shell";
          attachTerminalTabDragHandlers(card, tab, tabButton, tabList);
          tabButton.addEventListener("click", () => {
            selectTerminalTab(project, card, tab).catch((error) => {
              setTerminalStatus(card, `Could not switch shell: ${error.message}`);
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
          persistTerminalSelection(project.id, card.dataset.terminalStorageKey, selectedTab.id);
        }
      } catch (error) {
        setTerminalStatus(card, `Terminal unavailable: ${error.message}`);
      }
    }

    async function refreshTerminalSurfaceAfterClosedTab(project, card, closedWindowId, knownTabs, { focus = false } = {}) {
      const orderedTabs = getOrderedTerminalTabs(project.id, knownTabs);
      const activeWindowId = closedWindowId
        ? getTerminalReplacementWindowId(card, closedWindowId, orderedTabs)
        : null;

      await refreshTerminalTabs(project, card, activeWindowId, orderedTabs, { focus });
    }

    async function createTerminalTab(project, card, insertAfterWindowId = null) {
      const tab = await boatyard.createTerminalTab(project.id, "shell");
      let tabs = await listTerminalTabs(project.id);

      if (insertAfterWindowId) {
        const renderedTabIds = getRenderedTerminalTabIds(card).filter((windowId) => windowId !== tab.id);
        const targetIndex = renderedTabIds.indexOf(String(insertAfterWindowId));
        const nextTabIds = [...renderedTabIds];
        nextTabIds.splice(targetIndex === -1 ? nextTabIds.length : targetIndex + 1, 0, tab.id);
        persistTerminalTabOrder(project.id, nextTabIds);
        tabs = getOrderedTerminalTabs(project.id, tabs);
      }

      await refreshTerminalTabs(project, card, tab.id, tabs, { focus: true });
    }

    async function closeTerminalTab(project, card, windowId) {
      const normalizedWindowId = String(windowId || "");
      if (!normalizedWindowId) {
        return;
      }

      const surfaceId = getTerminalSurfaceId(card);
      const session = terminalWidgetsBySurface.get(surfaceId);
      const activeWindowId = session?.activeWindowId || "";

      try {
        const allTabs = await listTerminalTabs(project.id);
        if (allTabs.length <= 1) {
          return;
        }

        if (activeWindowId === normalizedWindowId) {
          markTerminalCloseFocus(surfaceId, normalizedWindowId);
        }

        const remainingTabs = (await boatyard.closeTerminalTab(project.id, normalizedWindowId))
          .filter((tab) => tab.id !== normalizedWindowId);
        const nextActiveWindowId = activeWindowId === normalizedWindowId
          ? getTerminalReplacementWindowId(card, normalizedWindowId, remainingTabs)
          : activeWindowId;
        await refreshTerminalTabs(project, card, nextActiveWindowId, remainingTabs, {
          focus: activeWindowId === normalizedWindowId
        });
      } catch (error) {
        setTerminalStatus(card, `Could not close shell: ${error.message}`);
      }
    }

    async function attachTerminalTab(project, card, windowId, { focus = false } = {}) {
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
      const viewport = card.querySelector(".terminal-viewport");
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

      const attachResult = await boatyard.attachTerminal(project.id, windowId, lastFitSize);
      const disposable = term.onData((data) => {
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
      let resizeAnimationFrame = null;
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
        projectId: project.id,
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
        projectId: project.id,
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

    function createTerminalSurface(project, {
      tagName = "article",
      className = "widget-card terminal-widget",
      storageKey = "widget:default",
      tabsContainer = null,
      actionsContainer = null
    } = {}) {
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

    function createTerminalWidget(project, props: { widgetPaneId?: string } = {}) {
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

    function handleTerminalData({ terminalId, data }) {
      const session = terminalWidgetsByTerminal.get(terminalId);
      if (session) {
        session.term.write(data);
      }
      scheduleTerminalOutputTabSync(terminalId);
    }

    async function handleTerminalExit({ terminalId, projectId, windowId }) {
      const session = terminalWidgetsByTerminal.get(terminalId);
      if (!session) {
        return;
      }

      terminalWidgetsByTerminal.delete(terminalId);
      const surfaceSession = terminalWidgetsBySurface.get(session.surfaceId);
      if (!surfaceSession || surfaceSession.terminalId !== terminalId) {
        return;
      }

      const exitedProjectId = projectId || surfaceSession.projectId;
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
        setTerminalStatus(surfaceSession.card, `Could not refresh shells: ${error.message}`);
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
