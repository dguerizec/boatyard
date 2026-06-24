import type { RendererProject } from "./rendererTypes.js";
import type { WidgetLayout, WidgetMenuElement } from "./widgetSurfaceTypes.js";
import type { WidgetElementDefinition } from "./widgetSurfaceRuntimeTypes.js";

type WidgetAddMenuOptions = {
  addProjectWidget(
    project: RendererProject,
    widgetId: string,
    columnCount: number,
    widgetPaneId?: string
  ): Promise<unknown>;
  defaultWidgetPaneId: string;
  getProjectWidgetDefinitions(project: RendererProject): WidgetElementDefinition[];
};

export function createWidgetAddMenu({
  addProjectWidget,
  defaultWidgetPaneId,
  getProjectWidgetDefinitions
}: WidgetAddMenuOptions) {
  let openWidgetAddMenu: WidgetMenuElement | null = null;

  function closeWidgetAddMenu() {
    if (!openWidgetAddMenu) {
      return;
    }

    openWidgetAddMenu.cleanup?.();
    openWidgetAddMenu.remove();
    openWidgetAddMenu = null;
  }

  function openWidgetAddMenuFromButton(
    button: HTMLElement,
    project: RendererProject,
    layout: WidgetLayout,
    columnCount: number,
    widgetPaneId = defaultWidgetPaneId
  ) {
    closeWidgetAddMenu();

    const rect = button.getBoundingClientRect();
    const menu = document.createElement("div") as WidgetMenuElement;
    menu.className = "widget-add-menu";
    menu.setAttribute("role", "menu");
    menu.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - 292))}px`;
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;

    const hiddenDefinitions = getProjectWidgetDefinitions(project)
      .filter((definition) => layout.hidden.includes(definition.id));

    for (const definition of hiddenDefinitions) {
      const item = document.createElement("button");
      item.className = "widget-add-menu-item";
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.innerHTML = `<strong>${definition.name}</strong><small>${definition.category || "Widget"}</small>`;
      item.addEventListener("click", () => {
        closeWidgetAddMenu();
        addProjectWidget(project, definition.id, columnCount, widgetPaneId).catch((error: unknown) => {
          console.error("Could not add widget:", error);
        });
      });
      menu.append(item);
    }

    document.body.append(menu);
    openWidgetAddMenu = menu;
    button.setAttribute("aria-expanded", "true");

    function onPointerDown(event: PointerEvent) {
      if (!menu.contains(event.target as Node) && event.target !== button) {
        closeWidgetAddMenu();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeWidgetAddMenu();
      }
    }

    menu.cleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      button.setAttribute("aria-expanded", "false");
    };

    setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
    }, 0);

    menu.querySelector("button")?.focus();
  }

  return Object.freeze({
    closeWidgetAddMenu,
    openWidgetAddMenuFromButton
  });
}
