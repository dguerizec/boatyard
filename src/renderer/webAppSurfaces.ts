type WebAppBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

  type SurfaceWebApp = {
    backgroundColor?: string;
    key: string;
    url: string;
    restoreUrl?: string;
  };

  type VisibleWebAppEntry = {
    webApp: SurfaceWebApp;
    host: Element | null;
  };

  type WebAppSurfaceSettings = {
    blurWebAppOverlays?: boolean;
  };

  type WebAppSurfaceBridge = {
    freezeWebApps(options?: unknown): Promise<unknown>;
    restoreWebApps(): Promise<unknown>;
  };

  type WebAppSurfacesOptions = {
    boatyard: WebAppSurfaceBridge;
    getFreezeLayerHost(): HTMLElement;
    getSettings(): WebAppSurfaceSettings;
    getVisibleWebAppEntries(): Iterable<VisibleWebAppEntry>;
    invokeWebApp(action: string, payload?: unknown): Promise<unknown>;
    isWebAppAutofillEnabled(webApp: SurfaceWebApp): boolean;
    markWebAppLoaded(key: string): void;
  };

  type OverlayDialogOptions = {
    freeze?: "all" | "overlap" | "none";
    freezeMargin?: number;
    onClose?: (() => void) | null;
    removeOnClose?: boolean;
  };

export function createWebAppSurfaces({
    boatyard,
    getFreezeLayerHost,
    getSettings,
    getVisibleWebAppEntries,
    invokeWebApp,
    isWebAppAutofillEnabled,
    markWebAppLoaded
  }: WebAppSurfacesOptions) {
    let webAppBoundsFrame: number | null = null;
    let frozenWebAppLayer: HTMLElement | null = null;
    let freezeLayerGeneration = 0;

    function getWebAppHostBounds(host: Element | null | undefined): WebAppBounds | null {
      if (!host) {
        return null;
      }

      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      const x = Math.ceil(rect.x);
      const y = Math.ceil(rect.y);
      const right = Math.floor(rect.right);
      const bottom = Math.floor(rect.bottom);
      const wcvInset = 2;

      return {
        x: x + wcvInset,
        y: y + wcvInset,
        width: Math.max(1, right - x - (wcvInset * 2)),
        height: Math.max(1, bottom - y - (wcvInset * 2))
      };
    }

    function normalizePayloadBounds(bounds: unknown): WebAppBounds | null {
      if (!bounds || typeof bounds !== "object") {
        return null;
      }

      const source = bounds as Partial<WebAppBounds>;
      const x = Number(source.x);
      const y = Number(source.y);
      const width = Number(source.width);
      const height = Number(source.height);

      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return null;
      }

      return {
        x,
        y,
        width,
        height
      };
    }

    function inflateRect(rect: WebAppBounds | DOMRectReadOnly, margin = 0): WebAppBounds {
      const value = Math.max(0, Number(margin) || 0);
      return {
        x: rect.x - value,
        y: rect.y - value,
        width: rect.width + value * 2,
        height: rect.height + value * 2
      };
    }

    function rectsIntersect(left: WebAppBounds | DOMRectReadOnly, right: WebAppBounds | DOMRectReadOnly) {
      return left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y;
    }

    function getVisibleWebAppKeysIntersectingRect(
      rect: WebAppBounds | DOMRectReadOnly,
      { margin = 0 }: { margin?: number } = {}
    ) {
      const targetRect = inflateRect(rect, margin);
      const keys: string[] = [];

      for (const { webApp, host } of getVisibleWebAppEntries()) {
        const hostBounds = getWebAppHostBounds(host);
        if (hostBounds && rectsIntersect(targetRect, hostBounds)) {
          keys.push(webApp.key);
        }
      }

      return keys;
    }

    async function syncWebAppView() {
      webAppBoundsFrame = null;
      const entries = [...getVisibleWebAppEntries()];

      if (entries.length === 0) {
        invokeWebApp("hideWebApp");
        return;
      }

      const visibleKeys: string[] = [];
      const showCalls: Promise<unknown>[] = [];

      for (const { webApp, host } of entries) {
        const bounds = getWebAppHostBounds(host);
        if (!bounds) {
          continue;
        }

        visibleKeys.push(webApp.key);
        showCalls.push(invokeWebApp("showWebApp", {
          key: webApp.key,
          url: webApp.url,
          bounds,
          autofillEnabled: isWebAppAutofillEnabled(webApp),
          backgroundColor: webApp.backgroundColor,
          restoreUrl: webApp.restoreUrl
        }));
      }

      await Promise.all(showCalls);
      for (const key of visibleKeys) {
        markWebAppLoaded(key);
      }
      await invokeWebApp("setVisibleWebApps", visibleKeys);
    }

    function queueWebAppSync() {
      if (webAppBoundsFrame !== null) {
        return;
      }

      webAppBoundsFrame = requestAnimationFrame(syncWebAppView);
    }

    async function flushWebAppSync() {
      if (webAppBoundsFrame !== null) {
        cancelAnimationFrame(webAppBoundsFrame);
        webAppBoundsFrame = null;
      }

      await syncWebAppView();
    }

    function clearFrozenWebAppLayer() {
      frozenWebAppLayer?.remove();
      frozenWebAppLayer = null;
    }

    function renderFrozenWebApps(captures: unknown) {
      clearFrozenWebAppLayer();

      if (!Array.isArray(captures) || captures.length === 0) {
        return;
      }

      const layer = document.createElement("div");
      layer.className = "webapp-freeze-layer";
      layer.classList.toggle("blur-disabled", getSettings().blurWebAppOverlays === false);
      layer.setAttribute("aria-hidden", "true");

      for (const capture of captures) {
        if (!capture?.bounds || !capture.dataUrl) {
          continue;
        }

        const image = document.createElement("img");
        image.className = "webapp-freeze-shot";
        image.src = capture.dataUrl;
        image.alt = "";
        image.style.left = `${capture.bounds.x}px`;
        image.style.top = `${capture.bounds.y}px`;
        image.style.width = `${capture.bounds.width}px`;
        image.style.height = `${capture.bounds.height}px`;
        layer.append(image);
      }

      getFreezeLayerHost().append(layer);
      frozenWebAppLayer = layer;
    }

    async function freezeWebAppsForOverlay(options: unknown = undefined) {
      const generation = freezeLayerGeneration;
      try {
        const captures = await boatyard.freezeWebApps(options);
        if (generation !== freezeLayerGeneration) {
          return;
        }
        renderFrozenWebApps(Array.isArray(captures) ? captures : []);
      } catch (error) {
        console.error("Could not freeze webapps:", error);
      }
    }

    async function freezeWebAppsForKeys(keys: unknown[]) {
      const uniqueKeys = [...new Set(keys.map(String).filter(Boolean))];
      await freezeWebAppsForOverlay({ keys: uniqueKeys });
    }

    async function hideWebAppsForKeys(keys: unknown[]) {
      const uniqueKeys = [...new Set(keys.map(String).filter(Boolean))];
      if (uniqueKeys.length === 0) {
        return;
      }

      await boatyard.freezeWebApps({ keys: uniqueKeys });
    }

    async function freezeWebAppsForRect(
      rect: WebAppBounds | DOMRectReadOnly,
      { margin = 0 }: { margin?: number } = {}
    ) {
      await flushWebAppSync();
      const keys = getVisibleWebAppKeysIntersectingRect(rect, { margin });
      await freezeWebAppsForKeys(keys);
    }

    async function hideWebAppsForRect(
      rect: WebAppBounds | DOMRectReadOnly,
      { margin = 0 }: { margin?: number } = {}
    ) {
      await flushWebAppSync();
      const keys = getVisibleWebAppKeysIntersectingRect(rect, { margin });
      await hideWebAppsForKeys(keys);
    }

    function getOverlayDialogFreezeRect(dialog: HTMLDialogElement) {
      const contentRect = dialog.firstElementChild?.getBoundingClientRect();
      if (contentRect && contentRect.width > 0 && contentRect.height > 0) {
        return contentRect;
      }

      return dialog.getBoundingClientRect();
    }

    async function restoreWebAppsAfterOverlay() {
      freezeLayerGeneration += 1;
      clearFrozenWebAppLayer();

      try {
        await boatyard.restoreWebApps();
      } catch (error) {
        console.error("Could not restore webapps:", error);
      }

      queueWebAppSync();
    }

    async function showOverlayDialog(dialog: HTMLDialogElement, {
      freeze = "overlap",
      freezeMargin = 16,
      onClose = null,
      removeOnClose = false
    }: OverlayDialogOptions = {}) {
      let closed = false;
      let didFreeze = false;

      dialog.style.visibility = "hidden";
      if (!dialog.isConnected) {
        document.body.append(dialog);
      }

      dialog.addEventListener("close", () => {
        closed = true;
        if (didFreeze) {
          restoreWebAppsAfterOverlay();
        }
        if (removeOnClose) {
          dialog.remove();
        }
        onClose?.();
      }, { once: true });

      dialog.showModal();

      if (freeze === "all" || freeze === "overlap") {
        await flushWebAppSync();
      }

      if (closed) {
        return false;
      }

      if (freeze === "all") {
        didFreeze = true;
        await freezeWebAppsForOverlay();
      } else if (freeze === "overlap") {
        didFreeze = true;
        const freezeRect = getOverlayDialogFreezeRect(dialog);
        await freezeWebAppsForRect(freezeRect, {
          margin: freezeMargin
        });
      }

      if (closed) {
        return false;
      }

      dialog.style.visibility = "";
      return true;
    }

    return {
      freezeWebAppsForOverlay,
      freezeWebAppsForRect,
      getWebAppHostBounds,
      hideWebAppsForRect,
      normalizePayloadBounds,
      queueWebAppSync,
      restoreWebAppsAfterOverlay,
      showOverlayDialog,
      syncWebAppView
    };
}
