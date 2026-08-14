export type WidgetOverlayFreezeScope = {
  freezeForMainRect(rect: DOMRectReadOnly, options?: { margin?: number }): Promise<void>;
  restore(): Promise<void>;
};

export type WidgetOverlayController = {
  freeze(element: Element, options?: { margin?: number }): Promise<void>;
  restore(): Promise<void>;
};

export function createWidgetOverlayController(
  freezeScope: WidgetOverlayFreezeScope
): WidgetOverlayController {
  return {
    freeze(element, options) {
      return freezeScope.freezeForMainRect(element.getBoundingClientRect(), options);
    },
    restore() {
      return freezeScope.restore();
    }
  };
}
