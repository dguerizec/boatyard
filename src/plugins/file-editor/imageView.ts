import { createImageSurface } from "./imageSurface";

export const AUTOMATIC_IMAGE_BYTES = 20 * 1024 * 1024;
export type ImageViewState = { fit: boolean; scale: number; left: number; top: number };
export function validImageViewState(value: unknown): value is ImageViewState {
  if (!value || typeof value !== "object") return false;
  const state = value as ImageViewState;
  return typeof state.fit === "boolean" && Number.isFinite(state.scale) && state.scale > 0 && state.scale <= 16
    && Number.isFinite(state.left) && state.left >= 0 && Number.isFinite(state.top) && state.top >= 0;
}

/** A shared viewer for disk images and unsaved image bytes. */
export function createImageView(onLoading: () => void, options: {
  pixelated?: boolean; approved?: boolean; onPixelated?: (enabled: boolean) => void;
  onApprove?: () => void; onLoad?: (image: HTMLImageElement) => void; onError?: () => void;
  state?: ImageViewState; onState?: (state: ImageViewState) => void; onReload?: () => Promise<void>;
} = {}) {
  const host = document.createElement("div");
  host.className = "file-editor-image";
  const toolbar = document.createElement("div");
  toolbar.className = "file-editor-toolbar file-editor-image-tools";
  const viewport = document.createElement("div");
  viewport.className = "file-editor-image-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Image preview. Scroll to zoom, drag to pan, F to fit, 0 for actual size.");
  const stage = document.createElement("div");
  stage.className = "file-editor-image-stage";
  const image = document.createElement("img");
  image.draggable = false;
  const surface = createImageSurface();
  surface.canvas.hidden = true;
  stage.append(image, surface.canvas);
  viewport.append(stage);
  const confirmation = document.createElement("div");
  confirmation.className = "file-editor-image-confirmation";
  const message = document.createElement("p");
  const zoomLabel = document.createElement("output");
  zoomLabel.setAttribute("aria-label", "Image zoom");
  let scale = options.state?.scale ?? 1;
  let fit = options.state?.fit ?? true;
  let position = { left: options.state?.left ?? 0, top: options.state?.top ?? 0 };
  let loaded = false;
  let failed = false;
  let source = "";
  let approved = Boolean(options.approved);
  let pending: { src: string; path: string } | undefined;
  let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
  let width = 0, height = 0;
  let naturalWidth = 0, naturalHeight = 0;
  let inputFrame: number | undefined;
  let wheelFactor = 1;
  let wheelPoint: { x: number; y: number } | undefined;
  let panPosition: { left: number; top: number } | undefined;
  let tiled = false;
  let loadVersion = 0;

  function drawSurface() {
    if (!loaded || !tiled || host.hidden || !width || !height) return;
    const bounds = geometry();
    surface.draw(width, height, scale, bounds.x - viewport.scrollLeft, bounds.y - viewport.scrollTop,
      pixels.getAttribute("aria-pressed") === "true");
  }

  function geometry(nextScale = scale) {
    const imageWidth = naturalWidth * nextScale, imageHeight = naturalHeight * nextScale;
    const stageWidth = Math.max(width, imageWidth + 32), stageHeight = Math.max(height, imageHeight + 32);
    return { stageWidth, stageHeight, x: (stageWidth - imageWidth) / 2, y: (stageHeight - imageHeight) / 2 };
  }

  function control(label: string, action: () => void, parent = toolbar) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", action);
    parent.append(button);
    return button;
  }
  function render() {
    if (!loaded || !width || !height || host.hidden) return;
    if (fit) scale = Math.min(1, Math.max(1, width - 32) / naturalWidth, Math.max(1, height - 32) / naturalHeight);
    const bounds = geometry();
    // Keep the decoded image's layout size fixed; only its compositor transform changes.
    image.style.transform = `translate3d(${bounds.x}px, ${bounds.y}px, 0) scale(${scale})`;
    stage.style.width = `${bounds.stageWidth}px`;
    stage.style.height = `${bounds.stageHeight}px`;
    zoomLabel.textContent = `${Math.round(scale * 1000) / 10}%`;
    fitButton.setAttribute("aria-pressed", String(fit));
    viewport.scrollLeft = fit ? 0 : position.left;
    viewport.scrollTop = fit ? 0 : position.top;
    drawSurface();
    saveState(false);
  }
  function saveState(flush = true) {
    if (flush) flushInput();
    if (!loaded || !width || !height || host.hidden) return;
    // Lifecycle calls can arrive after an ancestor has been hidden or detached.
    if (flush && (!host.isConnected || !viewport.clientWidth || !viewport.clientHeight)) return;
    position = { left: viewport.scrollLeft, top: viewport.scrollTop };
    options.onState?.({ fit, scale, ...position });
  }
  function zoom(next: number, x = width / 2, y = height / 2) {
    if (!loaded) return;
    const previous = geometry();
    const pointX = (position.left + x - previous.x) / scale;
    const pointY = (position.top + y - previous.y) / scale;
    scale = Math.max(0.001, Math.min(16, next));
    fit = false;
    const nextBounds = geometry();
    position = {
      left: Math.max(0, Math.min(nextBounds.stageWidth - width, nextBounds.x + pointX * scale - x)),
      top: Math.max(0, Math.min(nextBounds.stageHeight - height, nextBounds.y + pointY * scale - y))
    };
    render();
  }
  function flushInput() {
    if (inputFrame !== undefined) cancelAnimationFrame(inputFrame);
    inputFrame = undefined;
    const point = wheelPoint, factor = wheelFactor, pan = panPosition;
    wheelPoint = undefined; wheelFactor = 1; panPosition = undefined;
    if (point) {
      const bounds = viewport.getBoundingClientRect();
      zoom(scale * factor, point.x - bounds.left, point.y - bounds.top);
    } else if (pan) {
      viewport.scrollLeft = pan.left; viewport.scrollTop = pan.top;
      saveState(false);
      drawSurface();
    }
  }
  function queueInput() {
    inputFrame ??= requestAnimationFrame(flushInput);
  }
  const fitButton = control("Fit", () => { flushInput(); fit = true; render(); viewport.scrollTo(0, 0); });
  control("100%", () => { flushInput(); zoom(1); });
  control("Zoom out", () => { flushInput(); zoom(scale / 1.5); });
  control("Zoom in", () => { flushInput(); zoom(scale * 1.5); });
  toolbar.append(zoomLabel);
  const reload = control("Reload", () => {
    if (!options.onReload || reload.disabled) return;
    reload.disabled = true;
    void options.onReload().finally(() => { reload.disabled = false; });
  });
  reload.hidden = !options.onReload;
  const pixels = control("Pixelated", () => {
    const enabled = pixels.getAttribute("aria-pressed") !== "true";
    setPixelated(enabled);
    options.onPixelated?.(enabled);
  });
  function setPixelated(enabled: boolean) {
    pixels.setAttribute("aria-pressed", String(enabled));
    image.style.imageRendering = enabled ? "pixelated" : "auto";
    drawSurface();
  }
  setPixelated(Boolean(options.pixelated));
  confirmation.append(message);
  control("Open large image", () => { approved = true; options.onApprove?.(); loadPending(); }, confirmation);
  host.append(toolbar, confirmation, viewport);
  confirmation.hidden = true;
  toolbar.hidden = true;

  function loadPending() {
    if (!pending) return;
    confirmation.hidden = true;
    viewport.hidden = false;
    image.alt = pending.path;
    image.hidden = true;
    image.src = pending.src;
    pending = undefined;
    onLoading();
  }
  function clear() {
    saveState();
    loadVersion++;
    surface.clear(); surface.canvas.hidden = true;
    tiled = false; image.hidden = false; stage.classList.remove("tiled");
    pending = undefined;
    loaded = false;
    failed = false;
    source = "";
    image.removeAttribute("src");
    image.style.width = image.style.height = "";
    stage.style.width = stage.style.height = "";
    toolbar.hidden = true;
    confirmation.hidden = true;
    zoomLabel.textContent = "";
  }
  image.addEventListener("load", () => { void finishLoad(); });
  async function finishLoad() {
    const version = ++loadVersion;
    naturalWidth = image.naturalWidth; naturalHeight = image.naturalHeight;
    // Small images retain native rendering, including animation. Large surfaces use pinned tiles.
    tiled = naturalWidth * naturalHeight > 16 * 1024 * 1024;
    image.hidden = tiled;
    if (tiled) {
      stage.classList.add("tiled");
      try {
        if (!await surface.prepare(image) || version !== loadVersion) return;
      } catch {
        if (version !== loadVersion) return;
        loaded = false; failed = true;
        toolbar.hidden = !options.onReload; options.onError?.(); return;
      }
      surface.canvas.hidden = false;
    }
    loaded = true;
    toolbar.hidden = false;
    image.style.width = `${naturalWidth}px`; image.style.height = `${naturalHeight}px`;
    width = viewport.clientWidth; height = viewport.clientHeight;
    render();
    options.onLoad?.(image);
  }
  image.addEventListener("error", () => {
    loaded = false; failed = true;
    toolbar.hidden = !options.onReload;
    options.onError?.();
  });
  viewport.addEventListener("wheel", (event) => {
    if (!loaded) return;
    event.preventDefault();
    wheelFactor *= Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.005);
    wheelPoint = { x: event.clientX, y: event.clientY };
    queueInput();
  }, { passive: false });
  viewport.addEventListener("scroll", () => { saveState(false); drawSurface(); });
  viewport.addEventListener("pointerdown", (event) => {
    if (!loaded || event.button !== 0) return;
    event.preventDefault();
    saveState();
    viewport.focus();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("panning");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    panPosition = { left: drag.left + drag.x - event.clientX, top: drag.top + drag.y - event.clientY };
    queueInput();
  });
  viewport.addEventListener("lostpointercapture", () => { flushInput(); drag = undefined; viewport.classList.remove("panning"); });
  viewport.addEventListener("pointerup", (event) => {
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  });
  viewport.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!["+", "=", "-", "0", "f"].includes(event.key.toLowerCase())) return;
    flushInput();
    if (event.key === "+" || event.key === "=") zoom(scale * 1.5);
    else if (event.key === "-") zoom(scale / 1.5);
    else if (event.key === "0") zoom(1);
    else if (event.key.toLowerCase() === "f") fitButton.click();
    else return;
    event.preventDefault();
  });
  const resize = new ResizeObserver(() => {
    // Geometry reads are confined to resize/load and one wheel anchor per animation frame.
    width = viewport.clientWidth; height = viewport.clientHeight;
    render();
  });
  resize.observe(viewport);
  return {
    host, image, clear, setPixelated, saveState,
    setSource(src: string, path: string, size: number, force = false): boolean {
      if (source === src && !force) {
        if (loaded) {
          width = viewport.clientWidth; height = viewport.clientHeight;
          render();
          options.onLoad?.(image);
        }
        else if (failed) options.onError?.();
        return Boolean(pending);
      }
      clear();
      source = src;
      const url = force && src.startsWith("file:") ? new URL(src) : undefined;
      url?.searchParams.set("reload", crypto.randomUUID());
      pending = { src: url?.href ?? src, path };
      const requiresConfirmation = size > AUTOMATIC_IMAGE_BYTES && !approved;
      viewport.hidden = requiresConfirmation;
      confirmation.hidden = !requiresConfirmation;
      message.textContent = `This image is ${(size / 1024 / 1024).toFixed(1)} MiB, above the 20 MiB automatic preview limit. Opening it may use substantial memory. Load it?`;
      if (!requiresConfirmation) loadPending();
      return requiresConfirmation;
    },
    cleanup() { resize.disconnect(); clear(); }
  };
}
