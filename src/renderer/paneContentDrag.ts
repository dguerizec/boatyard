/** Drop shields also cover iframes; native web views are frozen by the caller. */
export function startPaneContentDrag(
  event: DragEvent,
  targets: Array<{ element: HTMLElement; drop: () => void }>,
  freeze: { freeze(): unknown; restore(): unknown }
): () => void {
  if (!event.dataTransfer || !targets.length) {
    event.preventDefault();
    return () => {};
  }
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-boatyard-pane-content", "preview");
  const shields: HTMLElement[] = [];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    shields.forEach((shield) => shield.remove());
    document.removeEventListener("dragend", finish);
    document.removeEventListener("drop", finish);
    window.removeEventListener("blur", finish);
    window.removeEventListener("resize", finish);
    void freeze.restore();
  };
  for (const target of targets) {
    const rect = target.element.getBoundingClientRect();
    const shield = document.createElement("div");
    shield.className = "pane-content-drop-target";
    shield.textContent = "Drop to open preview";
    Object.assign(shield.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    shield.addEventListener("dragover", (drag) => {
      drag.preventDefault();
      if (drag.dataTransfer) drag.dataTransfer.dropEffect = "copy";
      shield.classList.add("active");
    });
    shield.addEventListener("dragleave", () => shield.classList.remove("active"));
    shield.addEventListener("drop", (drop) => {
      drop.preventDefault();
      drop.stopPropagation();
      finish();
      target.drop();
    });
    shields.push(shield);
  }
  // Adding elements under the pointer during dragstart can cancel native dragging.
  requestAnimationFrame(() => {
    if (finished) return;
    document.body.append(...shields);
    void freeze.freeze();
  });
  document.addEventListener("dragend", finish);
  document.addEventListener("drop", finish);
  window.addEventListener("blur", finish);
  window.addEventListener("resize", finish);
  return finish;
}
