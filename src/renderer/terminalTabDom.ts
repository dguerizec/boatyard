import type { TerminalCard } from "./terminalTypes.js";

type TerminalTabDomOptions = {
  createToolIcon: (name: string) => HTMLElement;
};

type TerminalTabDropPosition = {
  targetButton: HTMLElement;
  insertAfter: boolean;
};

export function createTerminalTabDom({ createToolIcon }: TerminalTabDomOptions) {
  function getTerminalTabList(card: TerminalCard | HTMLElement | null | undefined) {
    const terminalCard = card as TerminalCard | null | undefined;
    return terminalCard?.terminalTabsElement || terminalCard?.querySelector<HTMLElement>(".terminal-tabs") || null;
  }

  function getTerminalTabButtons(card: TerminalCard | HTMLElement) {
    return [...(getTerminalTabList(card)?.querySelectorAll<HTMLElement>(".terminal-tab") || [])];
  }

  function updateTerminalTabScrollControls(card: TerminalCard | null | undefined) {
    const controls = card?.terminalTabsScrollControls;
    if (!controls) {
      return;
    }

    const { tabs, leftButton, rightButton } = controls;
    const hasOverflow = tabs.scrollWidth > tabs.clientWidth + 1;
    const atStart = tabs.scrollLeft <= 1;
    const atEnd = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 1;

    leftButton.hidden = !hasOverflow || atStart;
    rightButton.hidden = !hasOverflow || atEnd;
  }

  function scrollTerminalTabs(card: TerminalCard, direction: number) {
    const controls = card?.terminalTabsScrollControls;
    if (!controls) {
      return;
    }

    const amount = Math.max(80, Math.round(controls.tabs.clientWidth * 0.75));
    controls.tabs.scrollBy({
      left: direction * amount,
      behavior: "smooth"
    });
  }

  function createTerminalTabScrollButton(card: TerminalCard, direction: number) {
    const button = document.createElement("button");
    button.className = "terminal-action terminal-tab-scroll-button";
    button.type = "button";
    button.title = direction < 0 ? "Scroll shells left" : "Scroll shells right";
    button.setAttribute("aria-label", button.title);
    button.append(createToolIcon(direction < 0 ? "arrowLeft" : "arrowRight"));
    button.hidden = true;
    button.addEventListener("click", () => scrollTerminalTabs(card, direction));
    return button;
  }

  function createTerminalTabStrip(card: TerminalCard, tabs: HTMLElement) {
    const strip = document.createElement("div");
    strip.className = "terminal-tabs-strip";

    const leftButton = createTerminalTabScrollButton(card, -1);
    const rightButton = createTerminalTabScrollButton(card, 1);
    strip.append(leftButton, tabs, rightButton);

    card.terminalTabsScrollControls = {
      tabs,
      leftButton,
      rightButton
    };

    tabs.addEventListener("scroll", () => updateTerminalTabScrollControls(card));
    tabs.addEventListener("wheel", (event) => {
      if (tabs.scrollWidth <= tabs.clientWidth + 1) {
        return;
      }

      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
      if (!delta) {
        return;
      }

      event.preventDefault();
      tabs.scrollLeft += delta;
      updateTerminalTabScrollControls(card);
    }, { passive: false });

    const resizeObserver = new ResizeObserver(() => updateTerminalTabScrollControls(card));
    resizeObserver.observe(tabs);
    card.terminalTabsResizeObserver = resizeObserver;

    return strip;
  }

  function getRenderedTerminalTabIds(cardOrTabList: TerminalCard | HTMLElement | null | undefined) {
    const tabList = cardOrTabList?.classList?.contains("terminal-tabs")
      ? cardOrTabList
      : getTerminalTabList(cardOrTabList);

    return [...(tabList?.querySelectorAll<HTMLElement>(".terminal-tab") || [])]
      .map((tabButton) => tabButton.dataset.windowId)
      .filter((windowId): windowId is string => Boolean(windowId));
  }

  function clearTerminalTabDropMarkers(tabList: HTMLElement) {
    for (const tabButton of tabList.querySelectorAll(".terminal-tab")) {
      tabButton.classList.remove("drop-before", "drop-after");
    }
  }

  function clearTerminalTabDragState(tabList: HTMLElement) {
    delete tabList.dataset.draggedWindowId;
    for (const tabButton of tabList.querySelectorAll(".terminal-tab")) {
      tabButton.classList.remove("dragging");
    }
    clearTerminalTabDropMarkers(tabList);
  }

  function getReorderedTerminalTabIds(
    tabList: HTMLElement,
    draggedWindowId: string,
    targetWindowId: string,
    insertAfter = false
  ) {
    const tabIds = getRenderedTerminalTabIds(tabList);
    const sourceIndex = tabIds.indexOf(String(draggedWindowId));
    const targetIndex = tabIds.indexOf(String(targetWindowId));

    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
      return null;
    }

    const nextTabIds = [...tabIds];
    const [movedWindowId] = nextTabIds.splice(sourceIndex, 1);
    const targetIndexAfterRemoval = nextTabIds.indexOf(String(targetWindowId));
    nextTabIds.splice(targetIndexAfterRemoval + (insertAfter ? 1 : 0), 0, movedWindowId);

    return nextTabIds;
  }

  function getTerminalTabDropPosition(tabList: HTMLElement, event: DragEvent): TerminalTabDropPosition | null {
    const directTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".terminal-tab[data-window-id]")
      : null;
    if (directTarget && tabList.contains(directTarget)) {
      const rect = directTarget.getBoundingClientRect();
      return {
        targetButton: directTarget,
        insertAfter: event.clientX > rect.left + rect.width / 2
      };
    }

    const tabButtons = [...tabList.querySelectorAll<HTMLElement>(".terminal-tab[data-window-id]")];
    if (!tabButtons.length) {
      return null;
    }

    for (const tabButton of tabButtons) {
      const rect = tabButton.getBoundingClientRect();
      if (event.clientX <= rect.left + rect.width / 2) {
        return {
          targetButton: tabButton,
          insertAfter: false
        };
      }
    }

    return {
      targetButton: tabButtons.at(-1) as HTMLElement,
      insertAfter: true
    };
  }

  function updateTerminalTabDropMarker(
    tabList: HTMLElement,
    dropPosition: TerminalTabDropPosition | null | undefined
  ) {
    clearTerminalTabDropMarkers(tabList);

    if (!dropPosition?.targetButton) {
      return;
    }

    dropPosition.targetButton.classList.toggle("drop-before", !dropPosition.insertAfter);
    dropPosition.targetButton.classList.toggle("drop-after", dropPosition.insertAfter);
  }

  return Object.freeze({
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
  });
}
