import type { TerminalCard, TerminalTab, TerminalTabMenu } from "./terminalTypes.js";

type TerminalTabMenuProject = Record<string, unknown>;

type TerminalTabMenuControllerOptions = {
  clamp: (value: number, min: number, max: number) => number;
  closeTerminalTab: (
    project: TerminalTabMenuProject,
    card: TerminalCard,
    windowId: string
  ) => Promise<void> | void;
  createTerminalTab: (
    project: TerminalTabMenuProject,
    card: TerminalCard,
    insertAfterWindowId: string
  ) => Promise<void> | void;
  editTerminalTabName: (
    project: TerminalTabMenuProject,
    card: TerminalCard,
    tab: TerminalTab,
    tabButton: HTMLButtonElement
  ) => void;
  setTerminalStatus: (card: TerminalCard, message: string) => void;
};

type OpenTerminalTabContextMenuOptions = {
  card: TerminalCard;
  project: TerminalTabMenuProject;
  tab: TerminalTab;
  tabButton: HTMLButtonElement;
  tabList: HTMLElement;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function createTerminalTabMenuController({
  clamp,
  closeTerminalTab,
  createTerminalTab,
  editTerminalTabName,
  setTerminalStatus
}: TerminalTabMenuControllerOptions) {
  let openTerminalTabMenu: TerminalTabMenu | null = null;

  function closeTerminalTabMenu() {
    if (!openTerminalTabMenu) {
      return;
    }

    openTerminalTabMenu.cleanup?.();
    openTerminalTabMenu.remove();
    openTerminalTabMenu = null;
  }

  function openTerminalTabContextMenu(
    event: MouseEvent,
    { project, card, tab, tabButton, tabList }: OpenTerminalTabContextMenuOptions
  ) {
    event.preventDefault();
    event.stopPropagation();
    closeTerminalTabMenu();

    const menu = document.createElement("div") as TerminalTabMenu;
    menu.className = "webapp-tab-menu terminal-tab-context-menu";
    menu.setAttribute("role", "menu");

    const menuWidth = 180;
    const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
    const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 84));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    const renameItem = document.createElement("button");
    renameItem.className = "webapp-tab-menu-item";
    renameItem.type = "button";
    renameItem.setAttribute("role", "menuitem");
    renameItem.textContent = "Rename";
    renameItem.addEventListener("click", () => {
      closeTerminalTabMenu();
      editTerminalTabName(project, card, tab, tabButton);
    });

    const newShellItem = document.createElement("button");
    newShellItem.className = "webapp-tab-menu-item";
    newShellItem.type = "button";
    newShellItem.setAttribute("role", "menuitem");
    newShellItem.textContent = "New shell to the right";
    newShellItem.addEventListener("click", () => {
      closeTerminalTabMenu();
      Promise.resolve(createTerminalTab(project, card, tab.id)).catch((error) => {
        setTerminalStatus(card, `Could not create shell: ${getErrorMessage(error)}`);
      });
    });

    const closeItem = document.createElement("button");
    closeItem.className = "webapp-tab-menu-item danger";
    closeItem.type = "button";
    closeItem.setAttribute("role", "menuitem");
    closeItem.textContent = "Close";
    closeItem.disabled = tabList.querySelectorAll(".terminal-tab[data-window-id]").length <= 1;
    closeItem.addEventListener("click", () => {
      closeTerminalTabMenu();
      Promise.resolve(closeTerminalTab(project, card, tab.id)).catch((error) => {
        setTerminalStatus(card, `Could not close shell: ${getErrorMessage(error)}`);
      });
    });

    menu.append(renameItem, newShellItem, closeItem);
    document.body.append(menu);
    openTerminalTabMenu = menu;

    function onPointerDown(pointerEvent: PointerEvent) {
      if (pointerEvent.target instanceof Node && !menu.contains(pointerEvent.target)) {
        closeTerminalTabMenu();
      }
    }

    function onKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key === "Escape") {
        closeTerminalTabMenu();
      }
    }

    menu.cleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };

    setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
    }, 0);

    menu.querySelector("button")?.focus();
  }

  return Object.freeze({
    closeTerminalTabMenu,
    openTerminalTabContextMenu
  });
}
