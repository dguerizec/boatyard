// @ts-check
"use strict";

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} WebAppBounds
 * @typedef {{ key: string, url: string, restoreUrl?: string }} SurfaceWebApp
 * @typedef {{ webApp: SurfaceWebApp, host: Element | null }} VisibleWebAppEntry
 * @typedef {{ bounds?: WebAppBounds, dataUrl?: string }} FrozenWebAppCapture
 * @typedef {{ blurWebAppOverlays?: boolean }} WebAppSurfaceSettings
 * @typedef {{
 *   freezeWebApps(options?: unknown): Promise<FrozenWebAppCapture[]>,
 *   restoreWebApps(): Promise<unknown>
 * }} WebAppSurfaceBridge
 * @typedef {{
 *   boatyard: WebAppSurfaceBridge,
 *   getSettings(): WebAppSurfaceSettings,
 *   getVisibleWebAppEntries(): Iterable<VisibleWebAppEntry>,
 *   invokeWebApp(action: string, payload?: unknown): Promise<unknown>,
 *   isWebAppAutofillEnabled(webApp: SurfaceWebApp): boolean,
 *   markWebAppLoaded(key: string): void
 * }} WebAppSurfacesOptions
 * @typedef {{
 *   freeze?: "all" | "overlap" | "none",
 *   freezeMargin?: number,
 *   onClose?: (() => void) | null,
 *   removeOnClose?: boolean
 * }} OverlayDialogOptions
 * @typedef {{
 *   freezeWebAppsForOverlay(options?: unknown): Promise<void>,
 *   getWebAppHostBounds(host: Element | null | undefined): WebAppBounds | null,
 *   normalizePayloadBounds(bounds: unknown): WebAppBounds | null,
 *   queueWebAppSync(): void,
 *   restoreWebAppsAfterOverlay(): Promise<void>,
 *   showOverlayDialog(dialog: HTMLDialogElement, options?: OverlayDialogOptions): Promise<boolean>,
 *   syncWebAppView(): Promise<void>
 * }} WebAppSurfacesApi
 */

(function () {
  /**
   * @param {WebAppSurfacesOptions} options
   * @returns {WebAppSurfacesApi}
   */
  function createWebAppSurfaces({
    boatyard,
    getSettings,
    getVisibleWebAppEntries,
    invokeWebApp,
    isWebAppAutofillEnabled,
    markWebAppLoaded
  }) {
    /** @type {number | null} */
    let webAppBoundsFrame = null;
    /** @type {HTMLElement | null} */
    let frozenWebAppLayer = null;

    /**
     * @param {Element | null | undefined} host
     * @returns {WebAppBounds | null}
     */
    function getWebAppHostBounds(host) {
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

    /**
     * @param {unknown} bounds
     * @returns {WebAppBounds | null}
     */
    function normalizePayloadBounds(bounds) {
      if (!bounds || typeof bounds !== "object") {
        return null;
      }

      const source = /** @type {Partial<WebAppBounds>} */ (bounds);
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

    /**
     * @param {WebAppBounds | DOMRectReadOnly} rect
     * @param {number} margin
     * @returns {WebAppBounds}
     */
    function inflateRect(rect, margin = 0) {
      const value = Math.max(0, Number(margin) || 0);
      return {
        x: rect.x - value,
        y: rect.y - value,
        width: rect.width + value * 2,
        height: rect.height + value * 2
      };
    }

    /**
     * @param {WebAppBounds | DOMRectReadOnly} left
     * @param {WebAppBounds | DOMRectReadOnly} right
     * @returns {boolean}
     */
    function rectsIntersect(left, right) {
      return left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y;
    }

    /**
     * @param {WebAppBounds | DOMRectReadOnly} rect
     * @param {{ margin?: number }} options
     * @returns {string[]}
     */
    function getVisibleWebAppKeysIntersectingRect(rect, { margin = 0 } = {}) {
      const targetRect = inflateRect(rect, margin);
      const keys = [];

      for (const { webApp, host } of getVisibleWebAppEntries()) {
        const hostBounds = getWebAppHostBounds(host);
        if (hostBounds && rectsIntersect(targetRect, hostBounds)) {
          keys.push(webApp.key);
        }
      }

      return keys;
    }

    /**
     * @returns {Promise<void>}
     */
    async function syncWebAppView() {
      webAppBoundsFrame = null;
      const entries = [...getVisibleWebAppEntries()];

      if (entries.length === 0) {
        invokeWebApp("hideWebApp");
        return;
      }

      const visibleKeys = [];
      const showCalls = [];

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
          restoreUrl: webApp.restoreUrl
        }));
      }

      await Promise.all(showCalls);
      for (const key of visibleKeys) {
        markWebAppLoaded(key);
      }
      await invokeWebApp("setVisibleWebApps", visibleKeys);
    }

    /**
     * @returns {void}
     */
    function queueWebAppSync() {
      if (webAppBoundsFrame !== null) {
        return;
      }

      webAppBoundsFrame = requestAnimationFrame(syncWebAppView);
    }

    /**
     * @returns {Promise<void>}
     */
    async function flushWebAppSync() {
      if (webAppBoundsFrame !== null) {
        cancelAnimationFrame(webAppBoundsFrame);
        webAppBoundsFrame = null;
      }

      await syncWebAppView();
    }

    /**
     * @returns {void}
     */
    function clearFrozenWebAppLayer() {
      frozenWebAppLayer?.remove();
      frozenWebAppLayer = null;
    }

    /**
     * @param {unknown} captures
     * @returns {void}
     */
    function renderFrozenWebApps(captures) {
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

      document.body.append(layer);
      frozenWebAppLayer = layer;
    }

    /**
     * @param {unknown} options
     * @returns {Promise<void>}
     */
    async function freezeWebAppsForOverlay(options = undefined) {
      try {
        const captures = await boatyard.freezeWebApps(options);
        renderFrozenWebApps(captures);
      } catch (error) {
        console.error("Could not freeze webapps:", error);
      }
    }

    /**
     * @param {unknown[]} keys
     * @returns {Promise<void>}
     */
    async function freezeWebAppsForKeys(keys) {
      const uniqueKeys = [...new Set(keys.map(String).filter(Boolean))];
      await freezeWebAppsForOverlay({ keys: uniqueKeys });
    }

    /**
     * @param {WebAppBounds | DOMRectReadOnly} rect
     * @param {{ margin?: number }} options
     * @returns {Promise<void>}
     */
    async function freezeWebAppsForRect(rect, { margin = 0 } = {}) {
      const keys = getVisibleWebAppKeysIntersectingRect(rect, { margin });
      await freezeWebAppsForKeys(keys);
    }

    /**
     * @param {HTMLDialogElement} dialog
     * @returns {DOMRect}
     */
    function getOverlayDialogFreezeRect(dialog) {
      const contentRect = dialog.firstElementChild?.getBoundingClientRect();
      if (contentRect?.width > 0 && contentRect.height > 0) {
        return contentRect;
      }

      return dialog.getBoundingClientRect();
    }

    /**
     * @returns {Promise<void>}
     */
    async function restoreWebAppsAfterOverlay() {
      clearFrozenWebAppLayer();

      try {
        await boatyard.restoreWebApps();
      } catch (error) {
        console.error("Could not restore webapps:", error);
      }

      queueWebAppSync();
    }

    /**
     * @param {HTMLDialogElement} dialog
     * @param {OverlayDialogOptions} options
     * @returns {Promise<boolean>}
     */
    async function showOverlayDialog(dialog, {
      freeze = "overlap",
      freezeMargin = 16,
      onClose = null,
      removeOnClose = false
    } = {}) {
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
        await freezeWebAppsForRect(getOverlayDialogFreezeRect(dialog), {
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
      getWebAppHostBounds,
      normalizePayloadBounds,
      queueWebAppSync,
      restoreWebAppsAfterOverlay,
      showOverlayDialog,
      syncWebAppView
    };
  }

  /** @type {Window & { BoatyardWebAppSurfaces?: { create: typeof createWebAppSurfaces } }} */
  const globalScope = window;
  globalScope.BoatyardWebAppSurfaces = Object.freeze({
    create: createWebAppSurfaces
  });
})();
