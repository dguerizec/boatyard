type WidgetGridSize = {
  columns: number;
  rows: number;
};

  type WidgetGridPosition = {
    x: number;
    y: number;
  };

  type WidgetDefinition = {
    id: string;
    name: string;
    title?: string;
    category?: string;
    defaultVisible?: boolean;
    pluginId?: string;
    layout?: {
      default?: Partial<WidgetGridSize>;
      min?: Partial<WidgetGridSize>;
      max?: Partial<WidgetGridSize>;
    };
    create?: (project: unknown, props: unknown) => unknown;
    createElement?: (project: unknown, props: unknown) => HTMLElement;
  };

  type WidgetLayout = {
    order: string[];
    hidden: string[];
    sizes: Record<string, WidgetGridSize>;
    positions: Record<string, WidgetGridPosition>;
    locked: boolean;
  };

  type PersistedWidgetLayout = Partial<WidgetLayout> & {
    panes?: Record<string, PersistedWidgetLayout>;
  };

  type WidgetPane = {
    id: string;
    label?: string;
  };

  type WidgetProject = {
    id: string;
    widgetPanes?: WidgetPane[];
  };

  type WidgetMenuElement = HTMLDivElement & {
    cleanup?: () => void;
  };

  type WidgetRailAction = {
    label: string;
    icon: string;
    menu?: boolean;
    disabled?: boolean;
    onClick?: (event: MouseEvent) => void;
  };

const globalScope: WidgetSurfacesGlobal = window;

export function createWidgetSurfaces({
    boatyard,
    getState,
    getProjectPluginConfig,
    getGlobalPluginConfig,
    isGlobalWorkspace,
    openProjectWebApp,
    createCard,
    createToolIcon,
    renderWorkspaceDashboard,
    dashboardGrid,
    clamp,
    minWidgetRailWidth,
    defaultWidgetPaneId,
    widgetGridMinColumnWidth,
    widgetGridMaxColumnWidth,
    widgetGridRowHeight,
    widgetGridGap,
    widgetGridScrollGuard,
    legacyWidgetIds
  }) {
    const widgetLayoutsByProject = new Map<string, PersistedWidgetLayout>();
    let openWidgetAddMenu: WidgetMenuElement | null = null;
    let draggedWidgetId = null;
    let draggedWidgetPointerOffset = { x: 0, y: 0 };

    function getInstalledWidgets(filter = {}) {
      return globalScope.BoatyardWidgetRegistry.list(filter);
    }
    
    function getProjectWidgetDefinitions(project = null) {
      return getInstalledWidgets({ scope: isGlobalWorkspace(project) ? "global" : "project" });
    }
    
    function normalizeWidgetId(widgetId) {
      const id = String(widgetId || "").trim();
      const mappedId = legacyWidgetIds.get(id) || id;
      return globalScope.BoatyardWidgetRegistry?.resolveId(mappedId) || mappedId;
    }
    
    function getLegacyWidgetAliases() {
      return [
        ...[...legacyWidgetIds.entries()].map(([alias, targetId]) => ({ alias, targetId })),
        ...(globalScope.BoatyardWidgetRegistry?.listAliases?.() || [])
      ];
    }
    
    function getMigratedWidgetEntry(entries = {}, widgetId) {
      if (!entries || typeof entries !== "object") {
        return null;
      }
    
      if (entries[widgetId]) {
        return entries[widgetId];
      }
    
      for (const { alias, targetId } of getLegacyWidgetAliases()) {
        if (targetId === widgetId && entries[alias]) {
          return entries[alias];
        }
      }
    
      return null;
    }
    
    function getProjectWidgetPanes(project) {
      const panes = Array.isArray(project.widgetPanes) ? project.widgetPanes : [];
      return panes.length
        ? panes
        : [{
            id: defaultWidgetPaneId,
            label: "Widgets"
          }];
    }
    
    function getPersistedWidgetPaneLayout(project, widgetPaneId = defaultWidgetPaneId) {
      const persistedProjectLayout = widgetLayoutsByProject.get(project.id) || {};
      if (persistedProjectLayout.panes && typeof persistedProjectLayout.panes === "object") {
        return persistedProjectLayout.panes[widgetPaneId] || {};
      }
    
      return widgetPaneId === defaultWidgetPaneId ? persistedProjectLayout : {};
    }
    
    function hasPersistedWidgetPaneLayout(project, widgetPaneId = defaultWidgetPaneId) {
      const persistedProjectLayout = widgetLayoutsByProject.get(project.id) || {};
      if (persistedProjectLayout.panes && typeof persistedProjectLayout.panes === "object") {
        return Boolean(persistedProjectLayout.panes[widgetPaneId]);
      }
    
      return widgetPaneId === defaultWidgetPaneId && Object.keys(persistedProjectLayout).length > 0;
    }
    
    function setWidgetPaneLayout(project, widgetPaneId, layout) {
      const persistedProjectLayout = widgetLayoutsByProject.get(project.id) || {};
      const panes = persistedProjectLayout.panes && typeof persistedProjectLayout.panes === "object"
        ? persistedProjectLayout.panes
        : {
            [defaultWidgetPaneId]: persistedProjectLayout
          };
    
      widgetLayoutsByProject.set(project.id, {
        panes: {
          ...panes,
          [widgetPaneId]: layout
        }
      });
    }
    
    function normalizeWidgetLayoutForProject(project, columnCount = null, widgetPaneId = defaultWidgetPaneId) {
      const persisted = getPersistedWidgetPaneLayout(project, widgetPaneId);
      const widgetDefinitions = getProjectWidgetDefinitions(project);
      const knownIds = widgetDefinitions.map((definition) => definition.id);
      const knownIdSet = new Set(knownIds);
      const definitionsById = new Map(widgetDefinitions.map((definition) => [definition.id, definition]));
      const startsEmpty = widgetPaneId !== defaultWidgetPaneId && !hasPersistedWidgetPaneLayout(project, widgetPaneId);
      const persistedOrderIdSet = new Set(Array.isArray(persisted.order)
        ? persisted.order.map(normalizeWidgetId).filter((id) => knownIdSet.has(id))
        : []);
      const hidden = Array.isArray(persisted.hidden)
        ? persisted.hidden
            .map(normalizeWidgetId)
            .filter((id, index, ids) => knownIdSet.has(id) && ids.indexOf(id) === index)
        : startsEmpty ? [...knownIds] : [];
    
      for (const definition of widgetDefinitions) {
        if (
          definition.defaultVisible === false &&
          !persistedOrderIdSet.has(definition.id) &&
          !hidden.includes(definition.id)
        ) {
          hidden.push(definition.id);
        }
      }
    
      const hiddenIdSet = new Set(hidden);
      const seenIds = new Set();
      const order = Array.isArray(persisted.order)
        ? persisted.order
            .map(normalizeWidgetId)
            .filter((id) => {
              if (!knownIdSet.has(id) || hiddenIdSet.has(id) || seenIds.has(id)) {
                return false;
              }
    
              seenIds.add(id);
              return true;
            })
        : [];
    
      for (const id of knownIds) {
        if (!seenIds.has(id) && !hiddenIdSet.has(id)) {
          order.push(id);
        }
      }
      const sizes = {};
      const positions = {};
    
      for (const id of order) {
        const definition = definitionsById.get(id);
        const size = clampWidgetGridSize(definition, getMigratedWidgetEntry(persisted.sizes, id));
        sizes[id] = columnCount ? fitWidgetSizeToGrid(size, columnCount) : size;
      }
    
      for (const id of order) {
        const persistedPosition = normalizeWidgetGridPosition(getMigratedWidgetEntry(persisted.positions, id));
        const position = persistedPosition && isWidgetAreaAvailable({
          widgetId: id,
          position: persistedPosition,
          size: sizes[id],
          positions,
          sizes,
          columnCount
        })
          ? persistedPosition
          : findAvailableWidgetPosition({
              widgetId: id,
              size: sizes[id],
              positions,
              sizes,
              columnCount
            });
    
        positions[id] = position;
      }
    
      return {
        order,
        hidden,
        sizes,
        positions,
        locked: persisted.locked !== false
      };
    }
    
    function getWidgetLayoutSpec(definition) {
      const layout = definition.layout || {};
      const defaultSize = layout.default || { columns: 1, rows: 2 };
      const minSize = layout.min || { columns: 1, rows: 1 };
      const maxSize = layout.max || {};
    
      return {
        default: defaultSize,
        min: minSize,
        max: {
          columns: Number.isFinite(Number(maxSize.columns)) ? Number(maxSize.columns) : Number.POSITIVE_INFINITY,
          rows: Number.isFinite(Number(maxSize.rows)) ? Number(maxSize.rows) : Number.POSITIVE_INFINITY
        }
      };
    }
    
    function clampWidgetGridSize(definition, size = undefined) {
      const spec = getWidgetLayoutSpec(definition);
      const source = size && typeof size === "object" ? size : spec.default;
      const columns = Number(source.columns);
      const rows = Number(source.rows);
    
      return {
        columns: clamp(
          Number.isFinite(columns) ? Math.round(columns) : spec.default.columns,
          spec.min.columns,
          spec.max.columns
        ),
        rows: clamp(
          Number.isFinite(rows) ? Math.round(rows) : spec.default.rows,
          spec.min.rows,
          spec.max.rows
        )
      };
    }
    
    function getWidgetGridColumnCount(widgetRailWidth) {
      const width = Math.max(1, Math.round(widgetRailWidth || 0));
    
      return Math.max(1, Math.floor(width / widgetGridMinColumnWidth));
    }
    
    function getWidgetRailColumnCount(widgetRail) {
      const stored = Number(widgetRail?.dataset.widgetGridColumns);
      if (Number.isFinite(stored) && stored > 0) {
        return Math.round(stored);
      }
    
      return getWidgetGridColumnCount(widgetRail?.getBoundingClientRect().width || widgetGridMaxColumnWidth);
    }
    
    function getWidgetGridTrackSpec(widgetRail) {
      if (!widgetRail) {
        return {
          rowHeight: widgetGridRowHeight,
          rowCount: 1
        };
      }
    
      const styles = window.getComputedStyle(widgetRail);
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const availableHeight = Math.max(
        widgetGridRowHeight,
        widgetRail.clientHeight - paddingTop - paddingBottom - widgetGridScrollGuard
      );
      const rowCount = Math.max(
        1,
        Math.floor((availableHeight + widgetGridGap) / (widgetGridRowHeight + widgetGridGap))
      );
      const rowHeight = Math.max(
        1,
        (availableHeight - widgetGridGap * Math.max(0, rowCount - 1)) / rowCount
      );
    
      return { rowHeight, rowCount };
    }
    
    function fitWidgetSizeToGrid(size, columnCount) {
      return {
        columns: Math.min(columnCount, size.columns),
        rows: size.rows
      };
    }
    
    function applyWidgetGridLayout(widgetRail, project, columnCount, widgetPaneId = defaultWidgetPaneId) {
      const layout = getProjectWidgetLayout(project, columnCount, widgetPaneId);
      const trackSpec = getWidgetGridTrackSpec(widgetRail);
      widgetRail.dataset.widgetGridColumns = String(columnCount);
      widgetRail.dataset.widgetGridRows = String(trackSpec.rowCount);
      widgetRail.dataset.widgetGridRowHeight = String(trackSpec.rowHeight);
      widgetRail.style.setProperty("--widget-grid-columns", String(columnCount));
      widgetRail.style.setProperty("--widget-grid-row-height", `${trackSpec.rowHeight}px`);
    
      for (const card of widgetRail.querySelectorAll(".widget-card")) {
        const widgetId = card.dataset.widgetId;
        const size = layout.sizes[widgetId];
        const position = layout.positions[widgetId];
    
        if (!size || !position) {
          continue;
        }
    
        card.style.gridColumn = `${position.x + 1} / span ${size.columns}`;
        card.style.gridRow = `${position.y + 1} / span ${size.rows}`;
      }
    }
    
    function normalizeWidgetGridPosition(position) {
      if (!position || typeof position !== "object") {
        return null;
      }
    
      const x = Number(position.x);
      const y = Number(position.y);
    
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
    
      return {
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y))
      };
    }
    
    function doWidgetAreasOverlap(leftPosition, leftSize, rightPosition, rightSize) {
      return leftPosition.x < rightPosition.x + rightSize.columns &&
        leftPosition.x + leftSize.columns > rightPosition.x &&
        leftPosition.y < rightPosition.y + rightSize.rows &&
        leftPosition.y + leftSize.rows > rightPosition.y;
    }
    
    function isWidgetAreaAvailable({ widgetId, position, size, positions, sizes, columnCount }) {
      if (columnCount && position.x + size.columns > columnCount) {
        return false;
      }
    
      return Object.entries(positions).every(([otherId, otherPosition]) => {
        if (otherId === widgetId) {
          return true;
        }
    
        return !doWidgetAreasOverlap(position, size, otherPosition, sizes[otherId]);
      });
    }
    
    function findAvailableWidgetPosition({ widgetId, size, positions, sizes, columnCount }) {
      const columns = Math.max(1, columnCount || size.columns);
    
      for (let y = 0; y < 200; y += 1) {
        for (let x = 0; x <= columns - size.columns; x += 1) {
          const position = { x, y };
    
          if (isWidgetAreaAvailable({ widgetId, position, size, positions, sizes, columnCount: columns })) {
            return position;
          }
        }
      }
    
      return {
        x: 0,
        y: Object.entries(positions).reduce((maxY, [id, position]) => (
          Math.max(maxY, (position as WidgetGridPosition).y + sizes[id].rows)
        ), 0)
      };
    }
    
    function getProjectWidgetLayout(project, columnCount = null, widgetPaneId = defaultWidgetPaneId) {
      const layout = normalizeWidgetLayoutForProject(project, columnCount, widgetPaneId);
      setWidgetPaneLayout(project, widgetPaneId, layout);
      return layout;
    }
    
    function getOrderedWidgetDefinitions(project, layout) {
      const definitionsById = new Map(getProjectWidgetDefinitions(project).map((definition) => [definition.id, definition]));
      return layout.order
        .map((id) => definitionsById.get(id))
        .filter(Boolean);
    }
    
    function getWidgetDefinition(project, widgetId) {
      return getProjectWidgetDefinitions(project).find((definition) => definition.id === widgetId) || null;
    }
    
    function persistWidgetLayout(project) {
      const layout = widgetLayoutsByProject.get(project.id);
      if (!layout) {
        return Promise.resolve(null);
      }
    
      return boatyard.updateWidgetLayout(project.id, layout).catch((error) => {
        console.error("Could not persist widget layout:", error);
        return null;
      });
    }
    
    async function toggleWidgetLayoutLock(project, widgetPaneId = defaultWidgetPaneId) {
      const layout = getProjectWidgetLayout(project, null, widgetPaneId);
      setWidgetPaneLayout(project, widgetPaneId, {
        ...layout,
        locked: !layout.locked
      });
      await persistWidgetLayout(project);
      renderWorkspaceDashboard(project);
    }
    
    async function removeProjectWidget(project, widgetId, columnCount, widgetPaneId = defaultWidgetPaneId) {
      const definition = getWidgetDefinition(project, widgetId);
    
      if (!definition) {
        return false;
      }
    
      const layout = getProjectWidgetLayout(project, columnCount, widgetPaneId);
      const hidden = [...new Set([...layout.hidden, widgetId])];
      const sizes = { ...layout.sizes };
      const positions = { ...layout.positions };
      delete sizes[widgetId];
      delete positions[widgetId];
    
      setWidgetPaneLayout(project, widgetPaneId, {
        ...layout,
        order: layout.order.filter((id) => id !== widgetId),
        hidden,
        sizes,
        positions
      });
      await persistWidgetLayout(project);
      renderWorkspaceDashboard(project);
      return true;
    }
    
    async function addProjectWidget(project, widgetId, columnCount, widgetPaneId = defaultWidgetPaneId) {
      const definition = getWidgetDefinition(project, widgetId);
    
      if (!definition) {
        return false;
      }
    
      const layout = getProjectWidgetLayout(project, columnCount, widgetPaneId);
      const size = fitWidgetSizeToGrid(clampWidgetGridSize(definition), columnCount);
      const hidden = layout.hidden.filter((id) => id !== widgetId);
      const positions = { ...layout.positions };
      const sizes = {
        ...layout.sizes,
        [widgetId]: size
      };
      positions[widgetId] = findAvailableWidgetPosition({
        widgetId,
        size,
        positions,
        sizes,
        columnCount
      });
    
      setWidgetPaneLayout(project, widgetPaneId, {
        ...layout,
        order: [...layout.order.filter((id) => id !== widgetId), widgetId],
        hidden,
        sizes,
        positions
      });
      await persistWidgetLayout(project);
      renderWorkspaceDashboard(project);
      return true;
    }
    
    function getWidgetGridPositionFromPointer(event, rail, columnCount, size, pointerOffset = { x: 0, y: 0 }) {
      const rect = rail.getBoundingClientRect();
      const styles = window.getComputedStyle(rail);
      const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const rowHeight = Number(rail.dataset.widgetGridRowHeight) || widgetGridRowHeight;
      const contentWidth = Math.max(1, rail.clientWidth - paddingLeft - paddingRight);
      const columnWidth = (contentWidth - widgetGridGap * (columnCount - 1)) / columnCount;
      const ghostLeft = event.clientX - pointerOffset.x;
      const ghostTop = event.clientY - pointerOffset.y;
      const columnStep = columnWidth + widgetGridGap;
      const rowStep = rowHeight + widgetGridGap;
      const x = Math.floor((ghostLeft - rect.left - paddingLeft + columnStep / 2) / columnStep);
      const y = Math.floor(
        (ghostTop - rect.top - paddingTop + rowStep / 2) /
          rowStep
      );
    
      return {
        x: clamp(x, 0, Math.max(0, columnCount - size.columns)),
        y: Math.max(0, y)
      };
    }
    
    function ensureWidgetDropPreview(widgetRail) {
      let preview = widgetRail.querySelector(".widget-drop-preview");
    
      if (!preview) {
        preview = document.createElement("div");
        preview.className = "widget-drop-preview";
        preview.setAttribute("aria-hidden", "true");
        widgetRail.append(preview);
      }
    
      return preview;
    }
    
    function updateWidgetDropPreview(widgetRail, position, size, available) {
      const preview = ensureWidgetDropPreview(widgetRail);
      preview.classList.toggle("blocked", !available);
      preview.style.gridColumn = `${position.x + 1} / span ${size.columns}`;
      preview.style.gridRow = `${position.y + 1} / span ${size.rows}`;
    }
    
    function clearWidgetDropPreview(widgetRail) {
      if (!widgetRail) {
        return;
      }
    
      widgetRail.querySelector(".widget-drop-preview")?.remove();
      delete widgetRail.dataset.dropState;
    }
    
    async function moveWidgetToGridPosition(project, widgetId, position, columnCount, widgetPaneId = defaultWidgetPaneId) {
      const definition = getWidgetDefinition(project, widgetId);
    
      if (!definition) {
        return false;
      }
    
      const layout = getProjectWidgetLayout(project, columnCount, widgetPaneId);
      const size = layout.sizes[widgetId];
    
      if (!isWidgetAreaAvailable({
        widgetId,
        position,
        size,
        positions: layout.positions,
        sizes: layout.sizes,
        columnCount
      })) {
        return false;
      }
    
      setWidgetPaneLayout(project, widgetPaneId, {
        ...layout,
        positions: {
          ...layout.positions,
          [widgetId]: position
        }
      });
      await persistWidgetLayout(project);
      renderWorkspaceDashboard(project);
      return true;
    }
    
    function attachWidgetGridDropHandlers(widgetRail, project, columnCount, widgetPaneId = defaultWidgetPaneId) {
      widgetRail.addEventListener("dragover", (event) => {
        if (!draggedWidgetId) {
          return;
        }
    
        const currentColumnCount = getWidgetRailColumnCount(widgetRail) || columnCount;
        const layout = getProjectWidgetLayout(project, currentColumnCount, widgetPaneId);
        const size = layout.sizes[draggedWidgetId];
        if (!size) {
          return;
        }
    
        event.preventDefault();
        const position = getWidgetGridPositionFromPointer(event, widgetRail, currentColumnCount, size, draggedWidgetPointerOffset);
        const available = isWidgetAreaAvailable({
          widgetId: draggedWidgetId,
          position,
          size,
          positions: layout.positions,
          sizes: layout.sizes,
          columnCount: currentColumnCount
        });
    
        event.dataTransfer.dropEffect = available ? "move" : "none";
        widgetRail.dataset.dropState = available ? "available" : "blocked";
        updateWidgetDropPreview(widgetRail, position, size, available);
      });
    
      widgetRail.addEventListener("dragleave", (event) => {
        if (!widgetRail.contains(event.relatedTarget)) {
          clearWidgetDropPreview(widgetRail);
        }
      });
    
      widgetRail.addEventListener("drop", async (event) => {
        const widgetId = event.dataTransfer.getData("text/plain") || draggedWidgetId;
        const currentColumnCount = getWidgetRailColumnCount(widgetRail) || columnCount;
        const layout = getProjectWidgetLayout(project, currentColumnCount, widgetPaneId);
        const size = layout.sizes[widgetId];
        clearWidgetDropPreview(widgetRail);
    
        if (!widgetId || !size) {
          return;
        }
    
        event.preventDefault();
        const position = getWidgetGridPositionFromPointer(event, widgetRail, currentColumnCount, size, draggedWidgetPointerOffset);
        await moveWidgetToGridPosition(project, widgetId, position, currentColumnCount, widgetPaneId);
      });
    }
    
    function createProjectWidget(project, definition, layout, columnCount, widgetPaneId = defaultWidgetPaneId) {
      const globalScope = isGlobalWorkspace(project);
      const props = {
        projectId: project.id,
        project,
        widgetPaneId,
        pluginConfig: definition.pluginId && !globalScope ? getProjectPluginConfig(project.id, definition.pluginId) : {},
        globalPluginConfig: definition.pluginId ? getGlobalPluginConfig(definition.pluginId) : {},
        allProjectPluginConfig: globalScope ? {} : getState().pluginConfig?.projects?.[project.id] || {},
        openProjectWebApp(webAppId, url = "") {
          return openProjectWebApp(project.id, webAppId, url);
        }
      };
      const card = definition.createElement ? definition.createElement(project, props) : createCard(definition.create(project, props));
      const size = fitWidgetSizeToGrid(layout.sizes[definition.id], columnCount);
      const position = layout.positions[definition.id] || { x: 0, y: 0 };
      card.dataset.widgetId = definition.id;
      card.style.gridColumn = `${position.x + 1} / span ${size.columns}`;
      card.style.gridRow = `${position.y + 1} / span ${size.rows}`;
    
      if (!layout.locked) {
        card.draggable = true;
        card.addEventListener("dragstart", (event) => {
          draggedWidgetId = definition.id;
          const rect = card.getBoundingClientRect();
          draggedWidgetPointerOffset = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
          };
          card.classList.add("dragging");
          card.closest(".project-widget-rail")?.classList.add("dragging-widget");
          card.closest(".webapp-pane")?.classList.add("dragging-widget");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", definition.id);
        });
        card.addEventListener("dragend", () => {
          draggedWidgetId = null;
          draggedWidgetPointerOffset = { x: 0, y: 0 };
          card.classList.remove("dragging");
          card.closest(".project-widget-rail")?.classList.remove("dragging-widget");
          card.closest(".webapp-pane")?.classList.remove("dragging-widget");
          for (const item of dashboardGrid.querySelectorAll(".widget-card")) {
            item.classList.remove("drag-over");
          }
          for (const dropzone of document.querySelectorAll(".widget-trash-dropzone")) {
            dropzone.classList.remove("drag-over");
          }
          for (const rail of dashboardGrid.querySelectorAll(".project-widget-rail")) {
            clearWidgetDropPreview(rail);
          }
        });
    
        const resizeDirections = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];
        for (const direction of resizeDirections) {
          const resizeHandle = document.createElement("button");
          resizeHandle.className = `widget-resize-handle ${direction}`;
          resizeHandle.type = "button";
          resizeHandle.draggable = false;
          resizeHandle.title = "Resize widget";
          resizeHandle.setAttribute("aria-label", `Resize ${definition.name} ${direction}`);
          resizeHandle.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const rail = (event.currentTarget as HTMLElement).closest(".project-widget-rail");
            const currentColumnCount = getWidgetRailColumnCount(rail) || columnCount;
            const currentLayout = getProjectWidgetLayout(project, currentColumnCount, widgetPaneId);
            const currentSize = currentLayout.sizes[definition.id] || size;
            startWidgetResize(event, project, definition, currentLayout, currentSize, currentColumnCount, direction, widgetPaneId);
          });
          card.append(resizeHandle);
        }
      }
    
      return card;
    }
    
    function startWidgetResize(event, project, definition, layout, startSize, columnCount, direction, widgetPaneId = defaultWidgetPaneId) {
      const spec = getWidgetLayoutSpec(definition);
      const startX = event.clientX;
      const startY = event.clientY;
      const startPosition = layout.positions[definition.id] || { x: 0, y: 0 };
      const handle = event.currentTarget;
      const card = event.currentTarget.closest(".widget-card");
      const rail = event.currentTarget.closest(".project-widget-rail");
      const railWidth = rail?.getBoundingClientRect().width || widgetGridMinColumnWidth;
      const columnWidth = (railWidth - widgetGridGap * (columnCount - 1)) / columnCount;
      const columnStep = Math.max(1, columnWidth + widgetGridGap);
      const trackSpec = getWidgetGridTrackSpec(rail);
      const rowStep = trackSpec.rowHeight + widgetGridGap;
      const maxColumns = Math.min(columnCount, spec.max.columns);
      const canResizeNorth = direction.includes("n");
      const canResizeEast = direction.includes("e");
      const canResizeSouth = direction.includes("s");
      const canResizeWest = direction.includes("w");
      let lastGeometryKey = `${startPosition.x}:${startPosition.y}:${startSize.columns}:${startSize.rows}`;
      handle.classList.add("resizing");
      card?.classList.add("resizing-widget");
    
      function getNextGeometry(deltaColumns, deltaRows) {
        let nextX = startPosition.x;
        let nextY = startPosition.y;
        let nextColumns = startSize.columns;
        let nextRows = startSize.rows;
    
        if (canResizeWest) {
          const right = startPosition.x + startSize.columns;
          nextX = clamp(startPosition.x + deltaColumns, Math.max(0, right - maxColumns), right - spec.min.columns);
          nextColumns = right - nextX;
        } else if (canResizeEast) {
          nextColumns = clamp(
            startSize.columns + deltaColumns,
            spec.min.columns,
            Math.min(maxColumns, columnCount - startPosition.x)
          );
        }
    
        if (canResizeNorth) {
          const bottom = startPosition.y + startSize.rows;
          const maxRows = Math.max(spec.min.rows, Math.min(spec.max.rows, trackSpec.rowCount));
          nextY = clamp(startPosition.y + deltaRows, Math.max(0, bottom - maxRows), bottom - spec.min.rows);
          nextRows = bottom - nextY;
        } else if (canResizeSouth) {
          const maxRows = Math.max(spec.min.rows, Math.min(spec.max.rows, trackSpec.rowCount - startPosition.y));
          nextRows = clamp(startSize.rows + deltaRows, spec.min.rows, maxRows);
        }
    
        return {
          position: {
            x: nextX,
            y: nextY
          },
          size: {
            columns: nextColumns,
            rows: nextRows
          }
        };
      }
    
      function onPointerMove(moveEvent) {
        const deltaColumns = Math.round((moveEvent.clientX - startX) / columnStep);
        const deltaRows = Math.round((moveEvent.clientY - startY) / rowStep);
        const nextGeometry = getNextGeometry(deltaColumns, deltaRows);
        const nextGeometryKey = [
          nextGeometry.position.x,
          nextGeometry.position.y,
          nextGeometry.size.columns,
          nextGeometry.size.rows
        ].join(":");
    
        if (nextGeometryKey === lastGeometryKey) {
          return;
        }
    
        const nextSizes = {
          ...layout.sizes,
          [definition.id]: nextGeometry.size
        };
        const nextPositions = {
          ...layout.positions,
          [definition.id]: nextGeometry.position
        };
    
        if (!isWidgetAreaAvailable({
          widgetId: definition.id,
          position: nextGeometry.position,
          size: nextGeometry.size,
          positions: nextPositions,
          sizes: nextSizes,
          columnCount
        })) {
          return;
        }
    
        lastGeometryKey = nextGeometryKey;
        setWidgetPaneLayout(project, widgetPaneId, {
          ...layout,
          positions: nextPositions,
          sizes: nextSizes
        });
    
        if (card) {
          card.style.gridColumn = `${nextGeometry.position.x + 1} / span ${nextGeometry.size.columns}`;
          card.style.gridRow = `${nextGeometry.position.y + 1} / span ${nextGeometry.size.rows}`;
        }
      }
    
      async function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        handle.classList.remove("resizing");
        card?.classList.remove("resizing-widget");
        await persistWidgetLayout(project);
      }
    
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, { once: true });
    }
    
    function closeWidgetAddMenu() {
      if (!openWidgetAddMenu) {
        return;
      }
    
      openWidgetAddMenu.cleanup?.();
      openWidgetAddMenu.remove();
      openWidgetAddMenu = null;
    }

    function openWidgetAddMenuFromButton(button, project, layout, columnCount, widgetPaneId = defaultWidgetPaneId) {
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
          addProjectWidget(project, definition.id, columnCount, widgetPaneId).catch((error) => {
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
    
    function getWidgetRailFromControl(control) {
      return control.closest(".project-widget-rail") || control.closest(".webapp-pane")?.querySelector(".project-widget-rail") || null;
    }
    
    function createWidgetTrashDropzone(project, columnCount, widgetPaneId = defaultWidgetPaneId) {
      const dropzone = document.createElement("div");
      dropzone.className = "widget-trash-dropzone";
      dropzone.setAttribute("role", "button");
      dropzone.setAttribute("aria-label", "Remove dragged widget");
      dropzone.title = "Drop a widget here to remove it";
      dropzone.append(createToolIcon("trash"));
    
      dropzone.addEventListener("dragover", (event) => {
        if (!draggedWidgetId) {
          return;
        }
    
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        clearWidgetDropPreview(getWidgetRailFromControl(dropzone));
        dropzone.classList.add("drag-over");
      });
    
      dropzone.addEventListener("dragleave", (event) => {
        if (!dropzone.contains(event.relatedTarget as Node | null)) {
          dropzone.classList.remove("drag-over");
        }
      });
    
      dropzone.addEventListener("drop", async (event) => {
        const widgetId = event.dataTransfer.getData("text/plain") || draggedWidgetId;
    
        if (!widgetId) {
          return;
        }
    
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.remove("drag-over");
        clearWidgetDropPreview(getWidgetRailFromControl(dropzone));
        draggedWidgetId = null;
        const rail = getWidgetRailFromControl(dropzone);
        await removeProjectWidget(project, widgetId, getWidgetRailColumnCount(rail) || columnCount, widgetPaneId);
      });
    
      return dropzone;
    }
    
    function createWidgetPaneActions(project, widgetPane, layout, columnCount) {
      const actions = document.createElement("div");
      actions.className = "widget-rail-actions";
    
      const createActionButton = (action) => {
        const button = document.createElement("button");
        button.className = "widget-rail-action";
        button.type = "button";
        button.title = action.label;
        button.setAttribute("aria-label", action.label);
        button.disabled = action.disabled === true;
        button.append(createToolIcon(action.icon));
        if (action.menu) {
          button.setAttribute("aria-haspopup", "menu");
          button.setAttribute("aria-expanded", "false");
        }
        if (action.onClick) {
          button.addEventListener("click", action.onClick);
        }
        return button;
      };
    
      const actionConfigs: WidgetRailAction[] = [
        {
          label: layout.locked ? "Unlock widget layout" : "Lock widget layout",
          icon: layout.locked ? "pencil" : "lock",
          onClick: () => toggleWidgetLayoutLock(project, widgetPane.id)
        }
      ];
    
      const trashDropzone = !layout.locked ? createWidgetTrashDropzone(project, columnCount, widgetPane.id) : null;
    
      if (!layout.locked) {
        actionConfigs.unshift({
          label: "Add widget",
          icon: "plus",
          menu: true,
          disabled: !layout.hidden.length,
          onClick: (event) => {
            const rail = getWidgetRailFromControl(event.currentTarget as HTMLElement);
            const currentColumnCount = getWidgetRailColumnCount(rail) || columnCount;
            const currentLayout = getProjectWidgetLayout(project, currentColumnCount, widgetPane.id);
            openWidgetAddMenuFromButton(event.currentTarget as HTMLElement, project, currentLayout, currentColumnCount, widgetPane.id);
          }
        });
      }
    
      if (trashDropzone) {
        actions.append(trashDropzone);
      }
    
      for (const action of actionConfigs) {
        actions.append(createActionButton(action));
      }
    
      return actions;
    }

    function createWidgetPaneSurface(project, widgetPane) {
      const rail = document.createElement("div");
      rail.className = "project-widget-rail";
      const fallbackWidth = Math.max(minWidgetRailWidth, Math.round((dashboardGrid.getBoundingClientRect().width || window.innerWidth) / 2));
      const widgetGridColumns = getWidgetGridColumnCount(fallbackWidth);
      const widgetLayout = getProjectWidgetLayout(project, widgetGridColumns, widgetPane.id);
    
      rail.classList.toggle("editing", !widgetLayout.locked);
      rail.dataset.widgetGridColumns = String(widgetGridColumns);
      rail.style.setProperty("--widget-grid-columns", String(widgetGridColumns));
      rail.style.setProperty("--widget-grid-row-height", `${widgetGridRowHeight}px`);
    
      rail.append(
        ...getOrderedWidgetDefinitions(project, widgetLayout).map((definition) => (
          createProjectWidget(project, definition, widgetLayout, widgetGridColumns, widgetPane.id)
        ))
      );
      attachWidgetGridDropHandlers(rail, project, widgetGridColumns, widgetPane.id);
    
      const resizeObserver = new ResizeObserver(() => {
        if (!rail.isConnected) {
          resizeObserver.disconnect();
          return;
        }
    
        const width = rail.getBoundingClientRect().width || fallbackWidth;
        applyWidgetGridLayout(rail, project, getWidgetGridColumnCount(width), widgetPane.id);
      });
      resizeObserver.observe(rail);
    
      requestAnimationFrame(() => {
        const width = rail.getBoundingClientRect().width || fallbackWidth;
        applyWidgetGridLayout(rail, project, getWidgetGridColumnCount(width), widgetPane.id);
      });
    
      return rail;
    }

    function hydrateWidgetLayouts() {
      widgetLayoutsByProject.clear();
      const persistedLayouts = getState().widgetLayouts || {};

      for (const [projectId, layout] of Object.entries(persistedLayouts)) {
        widgetLayoutsByProject.set(projectId, layout);
      }
    }

    return {
      applyWidgetGridLayout,
      closeWidgetAddMenu,
      createProjectWidget,
      createWidgetPaneActions,
      createWidgetPaneSurface,
      getInstalledWidgets,
      getOrderedWidgetDefinitions,
      getProjectWidgetDefinitions,
      getProjectWidgetLayout,
      getProjectWidgetPanes,
      getWidgetGridColumnCount,
      getWidgetRailColumnCount,
      hydrateWidgetLayouts
    };
}
