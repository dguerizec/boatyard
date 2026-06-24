import type {
  WidgetDefinition,
  WidgetGridPosition,
  WidgetGridSize
} from "./widgetSurfaceTypes";

type ClampFn = (value: number, min: number, max: number) => number;

type WidgetGridTrackOptions = {
  gap: number;
  rowHeight: number;
  scrollGuard: number;
};

type WidgetAreaInput = {
  columnCount?: number | null;
  position: WidgetGridPosition;
  positions: Record<string, WidgetGridPosition>;
  size: WidgetGridSize;
  sizes: Record<string, WidgetGridSize>;
  widgetId: string;
};

export function getWidgetLayoutSpec(definition: WidgetDefinition) {
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

export function clampWidgetGridSize(definition: WidgetDefinition, size: unknown, clamp: ClampFn): WidgetGridSize {
  const spec = getWidgetLayoutSpec(definition);
  const source = size && typeof size === "object" ? size as Partial<WidgetGridSize> : spec.default;
  const columns = Number(source.columns);
  const rows = Number(source.rows);
  const defaultColumns = spec.default.columns ?? 1;
  const defaultRows = spec.default.rows ?? 2;
  const minColumns = spec.min.columns ?? 1;
  const minRows = spec.min.rows ?? 1;

  return {
    columns: clamp(
      Number.isFinite(columns) ? Math.round(columns) : defaultColumns,
      minColumns,
      spec.max.columns
    ),
    rows: clamp(
      Number.isFinite(rows) ? Math.round(rows) : defaultRows,
      minRows,
      spec.max.rows
    )
  };
}

export function getWidgetGridColumnCount(widgetRailWidth: unknown, widgetGridMinColumnWidth: number) {
  const width = Math.max(1, Math.round(Number(widgetRailWidth) || 0));

  return Math.max(1, Math.floor(width / widgetGridMinColumnWidth));
}

export function getWidgetGridTrackSpec(widgetRail: HTMLElement | null, {
  gap,
  rowHeight,
  scrollGuard
}: WidgetGridTrackOptions) {
  if (!widgetRail) {
    return {
      rowHeight,
      rowCount: 1
    };
  }

  const styles = window.getComputedStyle(widgetRail);
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const availableHeight = Math.max(
    rowHeight,
    widgetRail.clientHeight - paddingTop - paddingBottom - scrollGuard
  );
  const rowCount = Math.max(
    1,
    Math.floor((availableHeight + gap) / (rowHeight + gap))
  );
  const computedRowHeight = Math.max(
    1,
    (availableHeight - gap * Math.max(0, rowCount - 1)) / rowCount
  );

  return { rowHeight: computedRowHeight, rowCount };
}

export function fitWidgetSizeToGrid(size: WidgetGridSize, columnCount: number): WidgetGridSize {
  return {
    columns: Math.min(columnCount, size.columns),
    rows: size.rows
  };
}

export function normalizeWidgetGridPosition(position: unknown): WidgetGridPosition | null {
  if (!position || typeof position !== "object") {
    return null;
  }

  const source = position as Partial<WidgetGridPosition>;
  const x = Number(source.x);
  const y = Number(source.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y))
  };
}

function doWidgetAreasOverlap(
  leftPosition: WidgetGridPosition,
  leftSize: WidgetGridSize,
  rightPosition: WidgetGridPosition,
  rightSize: WidgetGridSize
) {
  return leftPosition.x < rightPosition.x + rightSize.columns &&
    leftPosition.x + leftSize.columns > rightPosition.x &&
    leftPosition.y < rightPosition.y + rightSize.rows &&
    leftPosition.y + leftSize.rows > rightPosition.y;
}

export function isWidgetAreaAvailable({ widgetId, position, size, positions, sizes, columnCount }: WidgetAreaInput) {
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

export function findAvailableWidgetPosition({ widgetId, size, positions, sizes, columnCount }: Omit<WidgetAreaInput, "position">) {
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
      Math.max(maxY, position.y + sizes[id].rows)
    ), 0)
  };
}
