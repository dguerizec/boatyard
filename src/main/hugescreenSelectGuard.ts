/** Native select popups close when their parent window moves. */
export function installHugescreenSelectGuard(document: Document, pause: (paused: boolean) => void): () => void {
  let selected: HTMLSelectElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let openingUntil = 0;
  let observedOpen = false;
  let paused = false;
  const setPaused = (value: boolean) => {
    if (paused === value) return;
    paused = value;
    pause(value);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    selected = null;
    setPaused(false);
  };
  const check = () => {
    if (!selected?.isConnected || selected.disabled) { stop(); return; }
    const open = selected.matches(":open");
    if (open) observedOpen = true;
    setPaused(open || (!observedOpen && performance.now() < openingUntil));
    if (!open && !paused && document.activeElement !== selected) stop();
  };
  const watch = (event: Event, opening: boolean) => {
    const target = event.composedPath().find(node => (node as Element).localName === "select") as HTMLSelectElement | undefined;
    if (!target || target.multiple || target.size > 1 || target.disabled) return;
    if (selected !== target) { observedOpen = false; openingUntil = 0; }
    selected = target;
    if (opening) {
      // Pause before the default action opens the native popup. :open becomes true
      // after event dispatch, so allow a short opening grace period.
      observedOpen = false;
      openingUntil = performance.now() + 150;
      setPaused(true);
    }
    if (!timer) timer = setInterval(check, 16);
  };
  const pointer = (event: PointerEvent) => { if (event.button === 0) watch(event, true); };
  const key = (event: KeyboardEvent) => {
    if ([" ", "Enter", "ArrowDown", "ArrowUp", "F4"].includes(event.key)) watch(event, true);
  };
  const focus = (event: FocusEvent) => watch(event, false);
  document.addEventListener("pointerdown", pointer, { capture: true });
  document.addEventListener("keydown", key, { capture: true });
  document.addEventListener("focusin", focus, { capture: true });
  document.defaultView?.addEventListener("pagehide", stop);
  return () => {
    stop();
    document.removeEventListener("pointerdown", pointer, { capture: true });
    document.removeEventListener("keydown", key, { capture: true });
    document.removeEventListener("focusin", focus, { capture: true });
    document.defaultView?.removeEventListener("pagehide", stop);
  };
}
