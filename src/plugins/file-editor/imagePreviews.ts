import { createImageView, validImageViewState, type ImageViewState } from "./imageView";

/** Keep decoded images and their view state for the lifetime of their tabs. */
export function createImagePreviews(key: string, callbacks: {
  onLoading: () => void; onLoad: (image: HTMLImageElement) => void; onError: () => void;
  onReload: (path: string) => Promise<void>;
}) {
  const host = document.createElement("div");
  host.className = "file-editor-images";
  const views = new Map<string, ReturnType<typeof createImageView>>();
  const approved = new Set<string>();
  const positions = new Map<string, ImageViewState>();
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  let pixelated = false;
  let current: ReturnType<typeof createImageView> | undefined;
  try {
    pixelated = localStorage.getItem(`${key}:pixelated`) === "true";
    const paths: unknown = JSON.parse(localStorage.getItem(`${key}:approved-images`) || "[]");
    if (Array.isArray(paths)) for (const path of paths) if (typeof path === "string") approved.add(path);
    const saved: unknown = JSON.parse(localStorage.getItem(`${key}:image-positions`) || "{}");
    if (saved && typeof saved === "object") for (const [path, state] of Object.entries(saved)) {
      if (validImageViewState(state)) positions.set(path, state);
    }
  } catch { /* Image previews remain usable without stored preferences. */ }
  function persistApprovals() {
    try { localStorage.setItem(`${key}:approved-images`, JSON.stringify([...approved])); } catch { /* Optional preference. */ }
  }
  function persistPositions() {
    clearTimeout(positionTimer);
    try { localStorage.setItem(`${key}:image-positions`, JSON.stringify(Object.fromEntries(positions))); } catch { /* Optional preference. */ }
  }
  function flushPositions() {
    for (const view of views.values()) view.saveState();
    persistPositions();
  }
  window.addEventListener("pagehide", flushPositions);
  return {
    host,
    setSource(src: string, path: string, size: number, force = false) {
      if (current) { current.saveState(); current.host.hidden = true; }
      let view = views.get(path);
      if (!view) {
        const created = createImageView(() => { if (current === created) callbacks.onLoading(); }, {
          pixelated, approved: approved.has(path),
          state: positions.get(path),
          onState: (state) => {
            const previous = positions.get(path);
            if (previous && previous.fit === state.fit && previous.scale === state.scale
              && previous.left === state.left && previous.top === state.top) return;
            positions.set(path, state);
            clearTimeout(positionTimer);
            positionTimer = setTimeout(persistPositions, 100);
          },
          onReload: () => callbacks.onReload(path),
          onApprove: () => { approved.add(path); persistApprovals(); },
          onPixelated: (enabled) => {
            pixelated = enabled;
            for (const cached of views.values()) cached.setPixelated(enabled);
            try { localStorage.setItem(`${key}:pixelated`, String(enabled)); } catch { /* Optional preference. */ }
          },
          onLoad: (image) => { if (current === created) callbacks.onLoad(image); },
          onError: () => { if (current === created) callbacks.onError(); }
        });
        view = created;
        views.set(path, view);
        host.append(view.host);
      }
      current = view;
      view.host.hidden = false;
      return view.setSource(src, path, size, force);
    },
    clear() { if (current) { current.saveState(); current.host.hidden = true; } current = undefined; },
    retain(paths: readonly string[]) {
      const opened = new Set(paths);
      for (const [path, view] of views) if (!opened.has(path)) {
        if (current === view) current = undefined;
        view.cleanup(); view.host.remove(); views.delete(path);
      }
      let changed = false;
      for (const path of approved) if (!opened.has(path)) { approved.delete(path); changed = true; }
      if (changed) persistApprovals();
      let positionsChanged = false;
      for (const path of positions.keys()) if (!opened.has(path)) { positions.delete(path); positionsChanged = true; }
      if (positionsChanged) persistPositions();
    },
    cleanup() {
      current = undefined;
      for (const view of views.values()) view.cleanup();
      persistPositions();
      window.removeEventListener("pagehide", flushPositions);
      views.clear(); host.replaceChildren();
    }
  };
}
