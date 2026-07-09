import type { UnknownRecord } from "./rendererRecords.js";

type TopbarWidgetDefinition = {
  id: string;
  name: string;
  title?: string;
  scopes?: string[];
  pluginId?: string;
  createCompact?: unknown;
  createElement?: unknown;
  create?: unknown;
};

type TopbarWidgetFactory = (project: null, props: UnknownRecord) => HTMLElement;

type TopbarWidgetRegistry = {
  list(filter?: { scope?: string }): TopbarWidgetDefinition[];
  get(id: unknown): TopbarWidgetDefinition | null;
};

type TopbarFreezeScope = {
  freezeForMainRect(rect: DOMRectReadOnly, options?: { margin?: number }): Promise<void>;
  restore(): Promise<void>;
};

type TopbarWidgetsOptions = {
  container: HTMLElement;
  topbar: HTMLElement;
  getWidgetRegistry: () => TopbarWidgetRegistry | null;
  getTopbarWidgetOrder: () => string[];
  getGlobalPluginConfig: (pluginId: string) => UnknownRecord;
  updateTopbarWidgets: (order: string[]) => Promise<{ order?: string[] } | undefined>;
  onOrderPersisted: (order: string[]) => void;
  createFreezeScope: () => TopbarFreezeScope;
};

type TopbarOverlay = {
  element: HTMLElement;
  freezeScope: TopbarFreezeScope;
  anchor: HTMLElement | null;
  kind: "popover" | "menu";
  cleanup: () => void;
};

export function createTopbarWidgets({
  container,
  topbar,
  getWidgetRegistry,
  getTopbarWidgetOrder,
  getGlobalPluginConfig,
  updateTopbarWidgets,
  onOrderPersisted,
  createFreezeScope
}: TopbarWidgetsOptions) {
  let openOverlay: TopbarOverlay | null = null;

  function createWidgetProps(definition: TopbarWidgetDefinition, chip: HTMLElement | null = null): UnknownRecord {
    return {
      projectId: "",
      project: null,
      widgetPaneId: "topbar",
      pluginConfig: {},
      allProjectPluginConfig: {},
      globalPluginConfig: definition.pluginId ? getGlobalPluginConfig(definition.pluginId) : {},
      closeContextMenu: closeOverlay,
      openContextMenu: (menu: HTMLElement, event: MouseEvent) => {
        event.preventDefault();
        menu.classList.add("topbar-widget-overlay");
        openOverlayElement(menu, chip, "menu", (element) => {
          const margin = 12;
          const rect = element.getBoundingClientRect();
          element.style.top = `${Math.round(
            Math.max(margin, Math.min(event.clientY, window.innerHeight - rect.height - margin))
          )}px`;
          element.style.left = `${Math.round(
            Math.max(margin, Math.min(event.clientX, window.innerWidth - rect.width - margin))
          )}px`;
        });
      },
      openProjectWebApp: () => undefined
    };
  }

  function listTopbarWidgets(): TopbarWidgetDefinition[] {
    const registry = getWidgetRegistry();
    if (!registry) {
      return [];
    }

    return registry.list({ scope: "topbar" })
      .filter((definition) => typeof definition.createCompact === "function");
  }

  function closeOverlay() {
    if (!openOverlay) {
      return;
    }

    const overlay = openOverlay;
    openOverlay = null;
    overlay.cleanup();
    overlay.element.remove();
    void overlay.freezeScope.restore();
  }

  function openOverlayElement(
    element: HTMLElement,
    anchor: HTMLElement | null,
    kind: "popover" | "menu",
    position: (element: HTMLElement) => void = (target) => positionOverlay(target, anchor)
  ) {
    closeOverlay();

    element.style.visibility = "hidden";
    document.body.append(element);

    const handlePointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (element.contains(target) || anchor?.contains(target))) {
        return;
      }
      closeOverlay();
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeydown);

    const freezeScope = createFreezeScope();
    openOverlay = {
      element,
      freezeScope,
      anchor,
      kind,
      cleanup: () => {
        document.removeEventListener("pointerdown", handlePointerDown, true);
        window.removeEventListener("keydown", handleKeydown);
      }
    };

    requestAnimationFrame(() => {
      if (openOverlay?.element !== element) {
        return;
      }

      position(element);
      element.style.visibility = "";
      void freezeScope.freezeForMainRect(getTopbarOverlayFreezeRect(element), { margin: 8 });
    });
  }

  function getTopbarOverlayFreezeRect(element: HTMLElement): DOMRect {
    const elementRect = element.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    const top = Math.min(elementRect.top, topbarRect.bottom);
    return new DOMRect(
      elementRect.left,
      top,
      elementRect.width,
      Math.max(1, window.innerHeight - top)
    );
  }

  function positionOverlay(element: HTMLElement, anchor: HTMLElement | null) {
    const margin = 12;
    const rect = element.getBoundingClientRect();
    const anchorRect = anchor?.getBoundingClientRect() || topbar.getBoundingClientRect();
    const left = Math.max(
      margin,
      Math.min(anchorRect.left, window.innerWidth - rect.width - margin)
    );

    element.style.top = `${Math.round(anchorRect.bottom + 6)}px`;
    element.style.left = `${Math.round(left)}px`;
  }

  function toggleWidgetPopover(chip: HTMLElement, definition: TopbarWidgetDefinition) {
    if (openOverlay?.anchor === chip) {
      closeOverlay();
      return;
    }

    const popover = document.createElement("div");
    popover.className = "topbar-widget-popover";
    popover.dataset.widgetId = definition.id;

    try {
      const props = createWidgetProps(definition, chip);
      let content: HTMLElement | null = null;
      if (typeof definition.createElement === "function") {
        content = (definition.createElement as TopbarWidgetFactory)(null, props);
      } else if (typeof definition.create === "function") {
        const created = (definition.create as TopbarWidgetFactory)(null, props);
        if (created instanceof HTMLElement) {
          content = created;
        }
      }

      if (!content) {
        return;
      }

      popover.append(content);
    } catch (error) {
      console.error(`Could not open topbar widget ${definition.id}:`, error);
      return;
    }

    openOverlayElement(popover, chip, "popover");
  }

  async function toggleTopbarWidget(widgetId: string) {
    const currentOrder = getTopbarWidgetOrder();
    const nextOrder = currentOrder.includes(widgetId)
      ? currentOrder.filter((id) => id !== widgetId)
      : [...currentOrder, widgetId];

    try {
      const persisted = await updateTopbarWidgets(nextOrder);
      const order = Array.isArray(persisted?.order) ? persisted.order : nextOrder;
      onOrderPersisted(order);
    } catch (error) {
      console.error("Could not update topbar widgets:", error);
    }

    render();
  }

  function openTopbarWidgetMenu(event: MouseEvent) {
    event.preventDefault();

    const menu = document.createElement("div");
    menu.className = "topbar-widget-menu";
    menu.setAttribute("role", "menu");

    const heading = document.createElement("p");
    heading.className = "topbar-widget-menu-heading";
    heading.textContent = "Top bar widgets";
    menu.append(heading);

    const widgets = listTopbarWidgets();
    if (!widgets.length) {
      const empty = document.createElement("p");
      empty.className = "topbar-widget-menu-empty";
      empty.textContent = "No top bar widgets available.";
      menu.append(empty);
    }

    for (const definition of widgets) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "topbar-widget-menu-item";
      item.setAttribute("role", "menuitemcheckbox");

      const check = document.createElement("span");
      check.className = "topbar-widget-menu-check";

      const label = document.createElement("span");
      label.textContent = definition.title || definition.name;

      const syncChecked = () => {
        const enabled = getTopbarWidgetOrder().includes(definition.id);
        item.setAttribute("aria-checked", enabled ? "true" : "false");
        check.textContent = enabled ? "✓" : "";
      };
      syncChecked();

      item.append(check, label);
      item.addEventListener("click", async () => {
        await toggleTopbarWidget(definition.id);
        syncChecked();
      });
      menu.append(item);
    }

    openOverlayElement(menu, null, "menu", (element) => {
      const margin = 12;
      const rect = element.getBoundingClientRect();
      const topbarRect = topbar.getBoundingClientRect();
      element.style.top = `${Math.round(topbarRect.bottom + 6)}px`;
      element.style.left = `${Math.round(
        Math.max(margin, Math.min(event.clientX, window.innerWidth - rect.width - margin))
      )}px`;
    });
  }

  function render() {
    if (openOverlay?.kind === "popover") {
      closeOverlay();
    }

    const registry = getWidgetRegistry();
    const chips: HTMLElement[] = [];

    if (registry) {
      for (const widgetId of getTopbarWidgetOrder()) {
        const definition = registry.get(widgetId);
        if (!definition || typeof definition.createCompact !== "function") {
          continue;
        }
        if (!definition.scopes?.includes("topbar")) {
          continue;
        }

        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "topbar-widget-chip";
        chip.dataset.widgetId = definition.id;
        chip.title = definition.title || definition.name;

        try {
          chip.append((definition.createCompact as TopbarWidgetFactory)(null, createWidgetProps(definition, chip)));
        } catch (error) {
          console.error(`Could not render topbar widget ${definition.id}:`, error);
          continue;
        }

        chip.addEventListener("click", () => toggleWidgetPopover(chip, definition));
        chips.push(chip);
      }
    }

    container.replaceChildren(...chips);
    container.hidden = chips.length === 0;
  }

  topbar.addEventListener("contextmenu", (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".topbar-widget-popover, .topbar-widget-menu")) {
      return;
    }

    openTopbarWidgetMenu(event);
  });

  return {
    render,
    closeOverlay
  };
}
