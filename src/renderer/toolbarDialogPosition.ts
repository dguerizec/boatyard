/** Position a compact dialog below its toolbar button, inside the visible area. */
export function positionToolbarDialog(dialog: HTMLDialogElement, button: HTMLElement, width: number, visibleHeight = window.innerHeight): void {
  const anchor = button.getBoundingClientRect();
  const size = Math.min(width, window.innerWidth - 24);
  dialog.style.left = `${Math.max(12, Math.min(anchor.right - size, window.innerWidth - size - 12))}px`;
  dialog.style.top = `${anchor.bottom + 8}px`;
  dialog.style.maxHeight = `${Math.max(120, Math.min(window.innerHeight, visibleHeight) - anchor.bottom - 20)}px`;
}
