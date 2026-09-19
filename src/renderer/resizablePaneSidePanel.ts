import type { WebAppPaneSidePanel } from "./rendererTypes.js";
import { clampPaneSidePanelWidth, resizePaneSidePanelWidth } from "./paneSidePanel.js";
import { attachPanePointerResize } from "./panePointerResize.js";

export function createResizablePaneSidePanel(
  host: HTMLElement,
  sidePanel: WebAppPaneSidePanel,
  state: { open: boolean; width: number },
  { onPersist = () => {}, onResize = () => {} }: { onPersist?: () => void; onResize?: () => void } = {}
) {
  const shell = document.createElement("div");
  shell.className = "webapp-side-panel-shell";
  shell.dataset.position = sidePanel.position;

  const viewport = document.createElement("div");
  viewport.className = "webapp-side-panel-viewport";

  const panel = document.createElement("aside");
  panel.className = "webapp-side-panel";
  panel.setAttribute("aria-label", sidePanel.title);

  const separator = document.createElement("div");
  separator.className = "webapp-side-panel-separator";
  separator.tabIndex = 0;
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-label", `Resize ${sidePanel.title}`);
  separator.setAttribute("aria-orientation", "vertical");

  if (sidePanel.position === "right") {
    shell.append(viewport, separator, panel);
  } else {
    shell.append(panel, separator, viewport);
  }
  host.append(shell);

  function applySize({ clampToHost = true } = {}) {
    const containerWidth = shell.getBoundingClientRect().width;
    const appliedWidth = clampToHost && containerWidth > 0
      ? clampPaneSidePanelWidth(state.width, containerWidth, sidePanel)
      : state.width;
    panel.hidden = !state.open;
    separator.hidden = !state.open;
    panel.style.width = state.open ? `${appliedWidth}px` : "0px";
    shell.dataset.open = String(state.open);
    separator.setAttribute("aria-valuemin", String(sidePanel.minWidth));
    separator.setAttribute("aria-valuemax", String(sidePanel.maxWidth));
    separator.setAttribute("aria-valuenow", String(appliedWidth));
  }

  let startWidth = panel.getBoundingClientRect().width || state.width;
  const cleanupPointerResize = attachPanePointerResize(separator, {
    canStart() {
      startWidth = panel.getBoundingClientRect().width || state.width;
      return state.open;
    },
    onMove(moveEvent, origin) {
      state.width = resizePaneSidePanelWidth({
        clientX: moveEvent.clientX,
        containerWidth: shell.getBoundingClientRect().width,
        position: sidePanel.position,
        sidePanel,
        startClientX: origin.clientX,
        startWidth
      });
      applySize({ clampToHost: false });
      onResize();
    },
    onCommit() {
      onPersist();
      onResize();
    }
  });

  const handleSeparatorKeyDown = (event: KeyboardEvent) => {
    if (!state.open || !["ArrowLeft", "ArrowRight"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const panelDirection = sidePanel.position === "right" ? -direction : direction;
    state.width = clampPaneSidePanelWidth(
      state.width + panelDirection * 16,
      shell.getBoundingClientRect().width,
      sidePanel
    );
    applySize({ clampToHost: false });
    onPersist();
    onResize();
  };
  separator.addEventListener("keydown", handleSeparatorKeyDown);

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      applySize();
      onResize();
    });
    resizeObserver.observe(shell);
  }

  applySize({ clampToHost: false });
  const initialFrame = window.requestAnimationFrame(() => {
    applySize();
    onResize();
  });

  return {
    cleanup() {
      window.cancelAnimationFrame(initialFrame);
      resizeObserver?.disconnect();
      cleanupPointerResize();
      separator.removeEventListener("keydown", handleSeparatorKeyDown);
    },
    panel,
    sync() {
      applySize();
      onPersist();
      onResize();
    },
    viewport
  };
}
