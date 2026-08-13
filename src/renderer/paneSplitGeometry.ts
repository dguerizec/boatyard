export type PaneMinimumAxis = "width" | "height";

export type PaneLayoutGeometryNode = {
  type: "pane";
  id: string;
} | PaneSplitGeometryNode;

export type PaneSplitGeometryNode = {
  type: "split";
  id: string;
  direction: string;
  ratio: number;
  first: PaneLayoutGeometryNode;
  second: PaneLayoutGeometryNode;
  expandedChild?: "first" | "second";
};

export type PaneMinimumSizeResolver = (
  pane: Extract<PaneLayoutGeometryNode, { type: "pane" }>,
  axis: PaneMinimumAxis
) => number;

export type PaneSplitGeometryOptions = {
  containerSize: number;
  getPaneMinimumSize: PaneMinimumSizeResolver;
  resizerSize: number;
};

export const DEFAULT_PANE_MIN_SIZE = "200px";
export const DEFAULT_PANE_MIN_SIZE_PX = 200;
const PANE_MINIMUM_LENGTH_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|em)$/i;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getDirectionAxis(direction: string): PaneMinimumAxis {
  return direction === "vertical" ? "width" : "height";
}

export function normalizePaneMinimumLength(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return PANE_MINIMUM_LENGTH_PATTERN.test(normalized) ? normalized : undefined;
}

export function resolvePaneMinimumPixels(
  value: unknown,
  emSize: number,
  fallback = DEFAULT_PANE_MIN_SIZE_PX
) {
  const normalized = normalizePaneMinimumLength(value);
  if (!normalized) {
    return finiteNonNegative(fallback);
  }

  const amount = Number.parseFloat(normalized);
  return normalized.endsWith("em")
    ? amount * (Number.isFinite(emSize) && emSize > 0 ? emSize : 16)
    : amount;
}

export function normalizePaneSplitRatio(value: unknown) {
  const ratio = Number(value);
  return clamp(
    Number.isFinite(ratio) ? ratio : 0.5,
    Number.EPSILON,
    1 - Number.EPSILON
  );
}

export function getPaneLayoutMinimumSize(
  node: PaneLayoutGeometryNode,
  axis: PaneMinimumAxis,
  resizerSize: number,
  getPaneMinimumSize: PaneMinimumSizeResolver
): number {
  if (node.type === "pane") {
    return finiteNonNegative(getPaneMinimumSize(node, axis));
  }

  const first = getPaneLayoutMinimumSize(node.first, axis, resizerSize, getPaneMinimumSize);
  const second = getPaneLayoutMinimumSize(node.second, axis, resizerSize, getPaneMinimumSize);
  return getDirectionAxis(node.direction) === axis
    ? first + finiteNonNegative(resizerSize) + second
    : Math.max(first, second);
}

export function clampPaneSplitRatio(
  ratio: number,
  containerSize: number,
  resizerSize: number,
  firstMinimumSize: number,
  secondMinimumSize: number
) {
  const normalizedRatio = normalizePaneSplitRatio(ratio);
  const size = finiteNonNegative(containerSize);
  if (size <= 0) {
    return normalizedRatio;
  }

  const dividerSize = finiteNonNegative(resizerSize);
  const dividerOffset = dividerSize / 2;
  const firstMinimum = finiteNonNegative(firstMinimumSize);
  const secondMinimum = finiteNonNegative(secondMinimumSize);
  const minimumRatio = (firstMinimum + dividerOffset) / size;
  const maximumRatio = 1 - ((secondMinimum + dividerOffset) / size);
  if (minimumRatio <= maximumRatio) {
    return clamp(normalizedRatio, minimumRatio, maximumRatio);
  }

  const availableSize = Math.max(0, size - dividerSize);
  const totalMinimum = firstMinimum + secondMinimum;
  const firstSize = totalMinimum > 0
    ? availableSize * (firstMinimum / totalMinimum)
    : availableSize / 2;
  return normalizePaneSplitRatio((firstSize + dividerOffset) / size);
}

function getMinimumSize(
  node: PaneLayoutGeometryNode,
  axis: PaneMinimumAxis,
  options: PaneSplitGeometryOptions
) {
  return getPaneLayoutMinimumSize(
    node,
    axis,
    options.resizerSize,
    options.getPaneMinimumSize
  );
}

export function demoteSplitThroughFirstChild(
  splitNode: PaneSplitGeometryNode,
  options: PaneSplitGeometryOptions
) {
  const pivot = splitNode.first;
  if (pivot.type !== "split" || pivot.direction !== splitNode.direction || pivot.expandedChild) {
    return null;
  }

  const axis = getDirectionAxis(splitNode.direction);
  const pivotFirst = pivot.first;
  const pivotSecond = pivot.second;
  const second = splitNode.second;
  const splitRatio = normalizePaneSplitRatio(splitNode.ratio);
  const pivotRatio = normalizePaneSplitRatio(pivot.ratio);
  const resizerOffset = options.resizerSize / 2;
  const splitCenter = splitRatio * options.containerSize;
  const pivotContainerSize = Math.max(1, splitCenter - resizerOffset);
  const pivotCenter = pivotRatio * pivotContainerSize;
  const nextPivotRatio = clampPaneSplitRatio(
    pivotCenter / options.containerSize,
    options.containerSize,
    options.resizerSize,
    getMinimumSize(pivotFirst, axis, options),
    getMinimumSize(pivotSecond, axis, options) + options.resizerSize + getMinimumSize(second, axis, options)
  );
  const nextSplitContainerSize = Math.max(
    1,
    options.containerSize - (nextPivotRatio * options.containerSize) - resizerOffset
  );
  const nextSplitRatio = clampPaneSplitRatio(
    (splitCenter - (nextPivotRatio * options.containerSize) - resizerOffset) / nextSplitContainerSize,
    nextSplitContainerSize,
    options.resizerSize,
    getMinimumSize(pivotSecond, axis, options),
    getMinimumSize(second, axis, options)
  );

  splitNode.first = pivotSecond;
  splitNode.second = second;
  splitNode.ratio = nextSplitRatio;
  pivot.first = pivotFirst;
  pivot.second = splitNode;
  pivot.ratio = nextPivotRatio;
  return {
    replacement: pivot,
    nextContainerSize: nextSplitContainerSize
  };
}

export function demoteSplitThroughSecondChild(
  splitNode: PaneSplitGeometryNode,
  options: PaneSplitGeometryOptions
) {
  const pivot = splitNode.second;
  if (pivot.type !== "split" || pivot.direction !== splitNode.direction || pivot.expandedChild) {
    return null;
  }

  const axis = getDirectionAxis(splitNode.direction);
  const first = splitNode.first;
  const pivotFirst = pivot.first;
  const pivotSecond = pivot.second;
  const splitRatio = normalizePaneSplitRatio(splitNode.ratio);
  const pivotRatio = normalizePaneSplitRatio(pivot.ratio);
  const resizerOffset = options.resizerSize / 2;
  const splitCenter = splitRatio * options.containerSize;
  const pivotContainerSize = Math.max(1, options.containerSize - splitCenter - resizerOffset);
  const pivotCenter = splitCenter + resizerOffset + (pivotRatio * pivotContainerSize);
  const nextPivotRatio = clampPaneSplitRatio(
    pivotCenter / options.containerSize,
    options.containerSize,
    options.resizerSize,
    getMinimumSize(first, axis, options) + options.resizerSize + getMinimumSize(pivotFirst, axis, options),
    getMinimumSize(pivotSecond, axis, options)
  );
  const nextSplitContainerSize = Math.max(1, (nextPivotRatio * options.containerSize) - resizerOffset);
  const nextSplitRatio = clampPaneSplitRatio(
    splitCenter / nextSplitContainerSize,
    nextSplitContainerSize,
    options.resizerSize,
    getMinimumSize(first, axis, options),
    getMinimumSize(pivotFirst, axis, options)
  );

  splitNode.first = first;
  splitNode.second = pivotFirst;
  splitNode.ratio = nextSplitRatio;
  pivot.first = splitNode;
  pivot.second = pivotSecond;
  pivot.ratio = nextPivotRatio;
  return {
    replacement: pivot,
    nextContainerSize: nextSplitContainerSize
  };
}
