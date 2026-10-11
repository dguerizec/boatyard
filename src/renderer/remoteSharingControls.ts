import { createSharePane } from "./sharePane.js";
import { createRemoteSettingsForm } from "./remoteSettings.js";
import { cleanupPaneLayout } from "./paneCleanup.js";
import { positionToolbarDialog } from "./toolbarDialogPosition.js";
import type { BoatyardBridge } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

type ShowDialog = (dialog: HTMLDialogElement, options: { removeOnClose: boolean; freeze: "all"; onClose(): void }) => Promise<unknown>;

export function setupRemoteSharingControls(button: HTMLButtonElement, api: BoatyardBridge, openSettings: () => void,
  showDialog: ShowDialog, mode: "remote" | "share", applyFormControls: (container: HTMLElement) => void = () => {}) {
  let current: UnknownRecord = {}, loaded = false, disposed = false, revision = 0;
  let popup: HTMLDialogElement | null = null;
  const name = mode === "remote" ? "Remote" : "Share";
  function render() {
    button.disabled = !loaded;
    const listening = current.listening === true;
    const connected = listening && typeof current.connectedClients === "number" ? current.connectedClients : 0;
    button.classList.toggle("sharing-active", connected > 0);
    button.classList.toggle("sharing-waiting", listening && connected === 0);
    button.setAttribute("aria-pressed", String(current.listening === true));
    button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-expanded", String(Boolean(popup)));
    button.textContent = connected > 0 ? String(connected) : name;
    button.setAttribute("aria-label", `${name}: ${connected > 0 ? `${connected} connected` : listening ? "waiting for connections" : "stopped"}`);
    if (mode === "share" && current.screenHidden === true) button.setAttribute("aria-label", `${button.getAttribute("aria-label")} Screen hidden.`);
    button.title = button.getAttribute("aria-label")!;
  }
  function apply(value: UnknownRecord) { if (!disposed) { current = value; loaded = true; render(); } }
  const unsubscribe = api.onRemoteStatusChanged?.(value => { revision++; apply(value); }, mode);
  render();
  void api.getRemoteStatus?.(mode).then(value => { if (!revision) apply(value); }).catch(() => {
    if (!disposed) { loaded = true; render(); }
  });
  const click = () => {
    if (!loaded) return;
    if (popup) { popup.close(); return; }
    const dialog = document.createElement("dialog");
    dialog.className = "plugin-settings-dialog remote-sharing-dialog";
    dialog.setAttribute("aria-label", mode === "remote" ? "Remote access" : "Share Boatyard");
    const panel = document.createElement("div"); panel.className = "plugin-settings-dialog-panel";
    const settings = mode === "remote" ? createRemoteSettingsForm(api, applyFormControls, mode, "controls") : null;
    const reposition = () => positionToolbarDialog(dialog, button, 380, screen.availHeight || window.innerHeight);
    reposition(); window.addEventListener("resize", reposition);
    popup = dialog;
    const footer = document.createElement("div"); footer.className = "form-actions";
    const settingsButton = document.createElement("button"), close = document.createElement("button");
    for (const control of [settingsButton, close]) { control.type = "button"; control.className = "secondary-button"; }
    settingsButton.className = "remote-settings-link";
    settingsButton.textContent = "Server settings"; settingsButton.onclick = () => { dialog.close(); openSettings(); };
    close.textContent = "Close"; close.onclick = () => dialog.close(); footer.append(settingsButton, close);
    if (settings) panel.append(settings, footer);
    else {
      panel.append(createSharePane(api, true), footer);
      applyFormControls(panel);
    }
    dialog.append(panel); render();
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    const cleanup = () => {
      window.removeEventListener("resize", reposition);
      cleanupPaneLayout(panel);
      popup = null; render(); if (!disposed) button.focus();
    };
    void showDialog(dialog, { removeOnClose: true, freeze: "all", onClose() {
      cleanup();
    } }).catch(() => { cleanup(); dialog.remove(); });
  };
  button.addEventListener("click", click);
  return () => { disposed = true; unsubscribe?.(); popup?.close(); button.removeEventListener("click", click); };
}
