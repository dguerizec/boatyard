import type { TerminalCard, TerminalTab, TerminalTabMenu, TerminalWorktree } from "./terminalTypes.js";

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
  createTerminalWorktreeTab: (
    project: TerminalTabMenuProject,
    card: TerminalCard,
    insertAfterWindowId: string | null,
    worktree: TerminalWorktree
  ) => Promise<void> | void;
  editTerminalTabName: (
    project: TerminalTabMenuProject,
    card: TerminalCard,
    tab: TerminalTab,
    tabButton: HTMLButtonElement
  ) => void;
  listTerminalWorktrees: (project: TerminalTabMenuProject) => Promise<TerminalWorktree[]>;
  setTerminalStatus: (card: TerminalCard, message: string) => void;
};

type OpenTerminalWorktreeMenuOptions = {
  card: TerminalCard;
  insertAfterWindowId: string | null;
  project: TerminalTabMenuProject;
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
  createTerminalWorktreeTab,
  editTerminalTabName,
  listTerminalWorktrees,
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

  function createTerminalMenu(event: MouseEvent, className: string, menuWidth: number) {
    event.preventDefault();
    event.stopPropagation();
    closeTerminalTabMenu();

    const menu = document.createElement("div") as TerminalTabMenu;
    menu.className = `webapp-tab-menu ${className}`;
    menu.setAttribute("role", "menu");

    const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
    const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 84));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.maxHeight = `${Math.max(42, window.innerHeight - top - 12)}px`;
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
      if (openTerminalTabMenu !== menu) {
        return;
      }
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
    }, 0);

    return menu;
  }

  function openTerminalTabContextMenu(
    event: MouseEvent,
    { project, card, tab, tabButton, tabList }: OpenTerminalTabContextMenuOptions
  ) {
    const menu = createTerminalMenu(event, "terminal-tab-context-menu", 180);

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
    menu.querySelector("button")?.focus();
  }

  function openTerminalWorktreeMenu(
    event: MouseEvent,
    { project, card, insertAfterWindowId }: OpenTerminalWorktreeMenuOptions
  ) {
    const menu = createTerminalMenu(event, "terminal-worktree-menu", 240);

    const loadingItem = document.createElement("button");
    loadingItem.className = "webapp-tab-menu-item";
    loadingItem.type = "button";
    loadingItem.disabled = true;
    loadingItem.textContent = "Loading worktrees...";
    menu.append(loadingItem);

    listTerminalWorktrees(project).then((worktrees) => {
      if (openTerminalTabMenu !== menu) {
        return;
      }

      menu.replaceChildren();
      if (!worktrees.length) {
        const emptyItem = document.createElement("button");
        emptyItem.className = "webapp-tab-menu-item";
        emptyItem.type = "button";
        emptyItem.disabled = true;
        emptyItem.textContent = "No worktrees found";
        menu.append(emptyItem);
        return;
      }

      for (const worktree of worktrees) {
        const item = document.createElement("button");
        item.className = "webapp-tab-menu-item terminal-worktree-menu-item";
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.title = [worktree.branch || (worktree.detached ? "Detached HEAD" : ""), worktree.path]
          .filter(Boolean)
          .join("\n");

        const name = document.createElement("span");
        name.textContent = worktree.name;
        const branch = document.createElement("small");
        branch.textContent = worktree.branch || (worktree.detached ? "detached" : "");
        item.append(name);
        if (branch.textContent) {
          item.append(branch);
        }
        item.addEventListener("click", () => {
          closeTerminalTabMenu();
          Promise.resolve(createTerminalWorktreeTab(
            project,
            card,
            insertAfterWindowId,
            worktree
          )).catch((error) => {
            setTerminalStatus(card, `Could not create worktree shell: ${getErrorMessage(error)}`);
          });
        });
        menu.append(item);
      }

      menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }).catch((error) => {
      if (openTerminalTabMenu !== menu) {
        return;
      }

      loadingItem.textContent = `Could not load worktrees: ${getErrorMessage(error)}`;
      setTerminalStatus(card, `Could not load worktrees: ${getErrorMessage(error)}`);
    });
  }

  return Object.freeze({
    closeTerminalTabMenu,
    openTerminalTabContextMenu,
    openTerminalWorktreeMenu
  });
}
