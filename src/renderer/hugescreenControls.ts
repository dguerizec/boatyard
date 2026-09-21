import type { BoatyardBridge } from "./rendererTypes.js";

type Options = {
  button: HTMLButtonElement;
  api: Pick<BoatyardBridge, "getHugescreen" | "onHugescreenChanged" | "toggleHugescreen" |
    "getHugescreenSettings" | "resizeHugescreen">;
  showDialog(dialog: HTMLDialogElement, options: { removeOnClose: boolean; onClose(): void }): Promise<unknown>;
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
          <label class="field"><span>Width ×</span><input name="width" type="number" min="0.5" max="4" step="0.01" required disabled></label>
          <label class="field"><span>Height ×</span><input name="height" type="number" min="0.5" max="4" step="0.01" required disabled></label>
        </div>
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
        if (initialize) {
          width.value = settings.widthMultiplier.toFixed(2);
          height.value = settings.heightMultiplier.toFixed(2);
          width.disabled = height.disabled = apply.disabled = false;
          (settings.available ? pan : width).focus();
        }
      } catch (reason) { if (popup === dialog) showError(reason); }
    };
    const reposition = () => {
      const anchor = button.getBoundingClientRect();
      dialog.style.left = `${Math.max(12, anchor.right - Math.min(340, window.innerWidth - 24))}px`;
      dialog.style.top = `${anchor.bottom + 8}px`;
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
      onClose: () => {
        popup = null;
        window.removeEventListener("resize", onResize);
        button.setAttribute("aria-expanded", "false");
        button.focus();
      }
    }).then(() => { if (popup === dialog) void refresh(true); }).catch(showError);
  });
}
