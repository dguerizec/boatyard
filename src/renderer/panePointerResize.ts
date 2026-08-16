export type PanePointerResizeOrigin = {
  clientX: number;
  clientY: number;
};

type PanePointerResizeOptions = {
  canStart?: (event: PointerEvent) => boolean;
  onCommit?: () => void;
  onMove: (event: PointerEvent, origin: PanePointerResizeOrigin) => void;
};

export function attachPanePointerResize(
  handle: HTMLElement,
  { canStart, onCommit, onMove }: PanePointerResizeOptions
): () => void {
  let activePointerId: number | null = null;
  let removeDocumentListeners: (() => void) | null = null;

  function finish(pointerId: number, commit: boolean) {
    if (activePointerId !== pointerId) {
      return;
    }
    try {
      handle.releasePointerCapture(pointerId);
    } catch {
      // The handle may have been detached while the surrounding pane changed.
    }
    activePointerId = null;
    removeDocumentListeners?.();
    removeDocumentListeners = null;
    if (commit) {
      onCommit?.();
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (activePointerId !== null || event.button !== 0 || canStart?.(event) === false) {
      return;
    }

    event.preventDefault();
    activePointerId = event.pointerId;
    handle.setPointerCapture(event.pointerId);
    const origin = { clientX: event.clientX, clientY: event.clientY };
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === activePointerId) {
        onMove(moveEvent, origin);
      }
    };
    const onPointerUp = (upEvent: PointerEvent) => finish(upEvent.pointerId, true);
    const onPointerCancel = (cancelEvent: PointerEvent) => finish(cancelEvent.pointerId, true);
    removeDocumentListeners = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
  };

  handle.addEventListener("pointerdown", onPointerDown);
  return () => {
    if (activePointerId !== null) {
      finish(activePointerId, false);
    }
    handle.removeEventListener("pointerdown", onPointerDown);
  };
}
