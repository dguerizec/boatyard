import type { BoatyardBridge } from "./rendererTypes.js";

type Options = {
  button: HTMLButtonElement;
  api: Pick<BoatyardBridge, "getHugescreen" | "onHugescreenChanged" | "toggleHugescreen" |
    "getHugescreenSettings" | "resizeHugescreen">;
  showDialog(dialog: HTMLDialogElement, options: { removeOnClose: boolean; freeze: "all"; onClose(): void }): Promise<unknown>;
};

export function setupHugescreenControls({ button, api, showDialog }: Options): void {
  let popup: HTMLDialogElement | null = null;
  let stateVersion = 0;
  const update = (active: boolean) => {
    stateVersion++;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    const input = popup?.querySelector<HTMLInputElement>("[name=pan]");
    if (input) input.checked = active;
  };
  api.onHugescreenChanged(update);
  const version = stateVersion;
  void api.getHugescreen().then(active => { if (version === stateVersion) update(active); });

  button.addEventListener("click", () => {
    if (popup) { popup.close(); return; }
    const dialog = document.createElement("dialog");
    dialog.className = "plugin-settings-dialog hugescreen-popup";
    dialog.setAttribute("aria-label", "Hugescreen settings");
    dialog.innerHTML = `
      <form class="plugin-settings-dialog-panel">
        <label class="switch-row">
          <span class="switch-copy"><strong>Pan</strong><small>Double-tap Ctrl to toggle</small></span>
          <input name="pan" type="checkbox" role="switch" disabled>
          <span class="switch-track" aria-hidden="true"></span>
        </label>
        <p class="hugescreen-size-hint">Window size relative to the screen</p>
        <div class="hugescreen-size-fields">
          <label class="field"><span class="hugescreen-slider-label">Width<output for="hugescreen-width" data-value="width">×1.00</output></span><input id="hugescreen-width" name="width" type="range" min="1" max="5" step="0.01" value="1" disabled><span class="hugescreen-slider-scale" aria-hidden="true"><span>×1</span><span>×5</span></span></label>
          <label class="field"><span class="hugescreen-slider-label">Height<output for="hugescreen-height" data-value="height">×1.00</output></span><input id="hugescreen-height" name="height" type="range" min="1" max="5" step="0.01" value="1" disabled><span class="hugescreen-slider-scale" aria-hidden="true"><span>×1</span><span>×5</span></span></label>
        </div>
        <figure class="hugescreen-preview" hidden>
          <svg role="img" aria-label="Boatyard window and centered screen at the same scale" viewBox="0 0 1 1">
            <rect class="hugescreen-preview-window" width="100%" height="100%" />
            <rect class="hugescreen-preview-screen" />
          </svg>
          <figcaption><span>Boatyard window</span><span>Screen</span></figcaption>
        </figure>
        <p class="hugescreen-size-hint" data-availability hidden>Enlarge the window to enable pan.</p>
        <p class="hugescreen-error" role="alert" hidden></p>
        <div class="form-actions">
          <button type="button" class="secondary-button" data-cancel>Cancel</button>
          <button type="submit" class="primary-button" disabled>Apply</button>
        </div>
      </form>`;
    popup = dialog;
    button.setAttribute("aria-expanded", "true");
    const form = dialog.querySelector("form")!;
    const pan = form.elements.namedItem("pan") as HTMLInputElement;
    const width = form.elements.namedItem("width") as HTMLInputElement;
    const height = form.elements.namedItem("height") as HTMLInputElement;
    const apply = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    const cancel = form.querySelector<HTMLButtonElement>("[data-cancel]")!;
    const error = form.querySelector<HTMLElement>("[role=alert]")!;
    const availability = form.querySelector<HTMLElement>("[data-availability]")!;
    const preview = form.querySelector<HTMLElement>(".hugescreen-preview")!;
    const diagram = preview.querySelector("svg")!;
    const screenRect = preview.querySelector(".hugescreen-preview-screen")!;
    let screenSize = { width: 0, height: 0 };
    let minimumSize = { width: 0, height: 0 };
    const updateValues = () => {
      for (const input of [width, height]) {
        const value = input.valueAsNumber.toFixed(2);
        const axis = input.name as "width" | "height";
        const pixels = Math.max(minimumSize[axis], Math.round(input.valueAsNumber * screenSize[axis]));
        form.querySelector<HTMLOutputElement>(`[data-value=${input.name}]`)!.value = `×${value} · ${pixels} px`;
        input.setAttribute("aria-valuetext", `${value} times screen ${input.name}`);
      }
      if (screenSize.width && screenSize.height) {
        const windowWidth = Math.max(minimumSize.width, Math.round(width.valueAsNumber * screenSize.width));
        const windowHeight = Math.max(minimumSize.height, Math.round(height.valueAsNumber * screenSize.height));
        diagram.setAttribute("viewBox", `0 0 ${windowWidth} ${windowHeight}`);
        screenRect.setAttribute("x", String((windowWidth - screenSize.width) / 2));
        screenRect.setAttribute("y", String((windowHeight - screenSize.height) / 2));
        screenRect.setAttribute("width", String(screenSize.width));
        screenRect.setAttribute("height", String(screenSize.height));
        diagram.setAttribute("aria-label", `Boatyard window ${windowWidth} by ${windowHeight} pixels; centered screen ${screenSize.width} by ${screenSize.height} pixels`);
        preview.hidden = false;
        reposition();
      }
    };
    width.addEventListener("input", updateValues);
    height.addEventListener("input", updateValues);
    let pending = false;
    let request = 0;
    const showError = (reason: unknown) => {
      error.textContent = reason instanceof Error ? reason.message : String(reason);
      error.hidden = false;
    };
    const refresh = async (initialize = false) => {
      const token = ++request;
      try {
        const settings = await api.getHugescreenSettings();
        if (popup !== dialog || token !== request) return;
        update(settings.active);
        pan.disabled = pending || !settings.available;
        availability.hidden = settings.available;
        screenSize = { width: settings.screenWidth, height: settings.screenHeight };
        minimumSize = { width: settings.minimumWidth, height: settings.minimumHeight };
        if (initialize) {
          width.value = settings.widthMultiplier.toFixed(2);
          height.value = settings.heightMultiplier.toFixed(2);
          width.disabled = height.disabled = apply.disabled = false;
          (settings.available ? pan : width).focus();
        }
        updateValues();
      } catch (reason) { if (popup === dialog) showError(reason); }
    };
    const reposition = () => {
      const anchor = button.getBoundingClientRect();
      dialog.style.left = `${Math.max(12, anchor.right - Math.min(340, window.innerWidth - 24))}px`;
      dialog.style.top = `${anchor.bottom + 8}px`;
      const visibleHeight = Math.min(window.innerHeight, screenSize.height || window.innerHeight);
      dialog.style.maxHeight = `${Math.max(120, visibleHeight - anchor.bottom - 20)}px`;
    };
    const onResize = () => { reposition(); if (!pending) void refresh(); };
    window.addEventListener("resize", onResize);
    cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", event => { if (pending) event.preventDefault(); });
    dialog.addEventListener("click", event => {
      if (event.target !== dialog || pending) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    pan.addEventListener("change", async () => {
      pan.disabled = true;
      try { update(await api.toggleHugescreen()); }
      catch (reason) { showError(reason); }
      await refresh();
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (pending || !form.reportValidity()) return;
      pending = true;
      error.hidden = true;
      apply.disabled = cancel.disabled = pan.disabled = width.disabled = height.disabled = true;
      try {
        update((await api.resizeHugescreen(width.valueAsNumber, height.valueAsNumber)).active);
        dialog.close();
      } catch (reason) {
        showError(reason);
      } finally {
        pending = false;
        if (popup === dialog) {
          apply.disabled = cancel.disabled = width.disabled = height.disabled = false;
          await refresh();
        }
      }
    });
    reposition();
    void showDialog(dialog, {
      removeOnClose: true,
      freeze: "all",
      onClose: () => {
        popup = null;
        window.removeEventListener("resize", onResize);
        button.setAttribute("aria-expanded", "false");
        button.focus();
      }
    }).then(() => { if (popup === dialog) void refresh(true); }).catch(showError);
  });
}
