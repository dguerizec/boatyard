import type { WebContents } from "electron";

type ViewportSize = { width: number; height: number };
const requestedViewports = new WeakMap<WebContents, ViewportSize>();
const activeViewports = new WeakMap<WebContents, string>();
const observedContents = new WeakSet<WebContents>();

function normalizeViewport(value: unknown): ViewportSize | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { width, height } = value as Partial<ViewportSize>;
  if (typeof width !== "number" || typeof height !== "number" ||
      !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

function renderViewport(webContents: WebContents) {
  const viewport = requestedViewports.get(webContents);
  if (!viewport) {
    if (activeViewports.has(webContents)) {
      webContents.disableDeviceEmulation();
      activeViewports.delete(webContents);
    }
    return;
  }
  const signature = JSON.stringify(viewport);
  if (activeViewports.get(webContents) === signature) {
    return;
  }
  webContents.enableDeviceEmulation({
    screenPosition: "desktop",
    screenSize: viewport,
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    viewSize: viewport,
    scale: 1
  });
  activeViewports.set(webContents, signature);
}

export function applyWebAppViewport(webContents: WebContents, value: unknown) {
  const viewport = normalizeViewport(value);
  if (viewport) {
    requestedViewports.set(webContents, viewport);
  } else {
    requestedViewports.delete(webContents);
  }
  if (!observedContents.has(webContents)) {
    observedContents.add(webContents);
    webContents.on("dom-ready", () => {
      // Chromium clears emulation on navigation. Wait for its render view to exist.
      activeViewports.delete(webContents);
      renderViewport(webContents);
    });
  }
  // Calling enableDeviceEmulation before the first document can crash Electron.
  if (!webContents.isDestroyed() && webContents.getURL() && !webContents.isLoadingMainFrame()) {
    renderViewport(webContents);
  }
}
