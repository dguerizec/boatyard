import { createWebrtcSettingsForm } from "./webrtcSettings.js";
import { appendRemoteConnectionLinks } from "./remoteConnectionLinks.js";
import type { BoatyardBridge } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type { PaneCleanupHost } from "./paneCleanup.js";

export function createRemoteSettingsForm(boatyard: BoatyardBridge, applyFormControls: (container: HTMLElement) => void, mode: "remote" | "share" = "remote", view: "settings" | "controls" = "settings"): HTMLElement {
  const compact = view === "controls";
  const shell = document.createElement("section") as PaneCleanupHost;
  shell.className = "project-form-page remote-settings";
  shell.dataset.boatyardCleanup = "";
  shell.innerHTML = `<form class="project-form">
    <div class="form-heading"><h3>${mode === "remote" ? "Remote" : "Share"}</h3><p>${mode === "remote" ? "Full access for one controller, protected by a password." : "Read-only access for up to eight simultaneous viewers. Add clients from the Share dialog."}</p></div>
    ${compact ? "" : `${mode === "remote" ? '<label class="switch-row"><span class="switch-copy"><strong>Enable Remote</strong><small>Start with Boatyard and listen on all IPv4 interfaces.</small></span><input type="checkbox" name="enabled"><span class="switch-track" aria-hidden="true"></span></label>' : '<p class="form-hint">Share starts when you add the first client. Saving server settings stops sharing; add a client to start again.</p>'}
    <label>Port<input type="number" name="port" min="1024" max="65535" required></label>
    <label>External URL (optional)<input type="url" name="publicOrigin" placeholder="https://remote.example.com"></label>
    <p class="form-hint">Use the root address of your tunnel. Leave blank for direct LAN access.</p>`}
    ${mode === "remote" ? '<label>Password<input type="password" name="password" autocomplete="new-password" maxlength="1024"></label><p class="form-hint password-hint"></p>' : '<p class="form-hint">No password. Each client signs in once with its own link, valid for 15 minutes.</p>'}
    <p class="form-hint" role="status">Loading…</p><p class="form-error" role="alert" hidden></p>
    <div class="remote-urls"></div>
    <div class="form-actions">${compact ? '<button class="primary-button" type="submit" data-action="start">Start</button>' : `<button class="primary-button" type="submit">Save and apply</button>${mode === "remote" ? '<button class="secondary-button" type="button" data-action="start">Start</button>' : ""}`}<button class="secondary-button" type="button" data-action="stop">Stop</button></div>
  </form>`;
  const form = shell.querySelector("form")!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const status = shell.querySelector<HTMLElement>('[role="status"]')!;
  const error = shell.querySelector<HTMLElement>('[role="alert"]')!;
  const urls = shell.querySelector<HTMLElement>(".remote-urls")!;
  const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")];
  let dirty = false, busy = false, loaded = false, disposed = false, statusRevision = 0;
  let latest: UnknownRecord = {};
  function updateControls() {
    controls.forEach(control => { control.disabled = busy || !loaded; });
    form.querySelector<HTMLButtonElement>('[data-action="stop"]')!.disabled = busy || !loaded || latest.listening !== true && latest.enabled !== true;
  }
  function applyStatus(value: UnknownRecord, replaceDraft = false) {
    if (disposed) return;
    latest = value; loaded = true;
    if (!dirty || replaceDraft) {
      if (!compact) {
        if (mode === "remote") field("enabled").checked = value.enabled === true;
        field("port").value = String(value.port || 47831);
        field("publicOrigin").value = String(value.publicOrigin || "");
      }
      if (replaceDraft && mode === "remote") field("password").value = "";
    }
    const passwordHint = shell.querySelector<HTMLElement>(".password-hint");
    if (passwordHint) passwordHint.textContent = value.hasPassword ? "Password is set. Leave blank to keep it." : "Set a password before starting Remote.";
    status.textContent = value.listening ? `Listening on port ${value.port}${value.readOnly ? " · Read-only" : ""}.` : value.enabled ? "Enabled, but not listening." : "Stopped.";
    error.textContent = String(value.error || ""); error.hidden = !value.error;
    urls.replaceChildren();
    appendRemoteConnectionLinks(urls, Array.isArray(value.urls) ? value.urls.map(String) : [], boatyard, reason => {
      if (!disposed) { error.textContent = String(reason); error.hidden = false; }
    });
    updateControls();
  }
  async function apply(enabled?: boolean) {
    if (busy || !loaded || !form.reportValidity()) return;
    busy = true; updateControls(); error.hidden = true;
    try {
      if (!boatyard.updateRemoteSettings) throw new Error("Remote settings are unavailable.");
      const result = await boatyard.updateRemoteSettings({
        enabled: mode === "remote" ? compact ? true : enabled ?? field("enabled").checked : false,
        ...(!compact ? { port: Number(field("port").value), publicOrigin: field("publicOrigin").value } : {}),
        ...(mode === "remote" ? { password: field("password").value } : {})
      }, mode);
      dirty = false; applyStatus(result, true);
    } catch (e) { error.textContent = e instanceof Error ? e.message : String(e); error.hidden = false; }
    finally { busy = false; if (!disposed) updateControls(); }
  }
  form.addEventListener("input", () => { dirty = true; });
  form.addEventListener("submit", event => { event.preventDefault(); void apply(); });
  const start = form.querySelector<HTMLButtonElement>('[data-action="start"]');
  if (start && !compact) start.onclick = () => { void apply(true); };
  form.querySelector<HTMLButtonElement>('[data-action="stop"]')!.onclick = async () => {
    if (busy || !boatyard.updateRemoteSettings) return;
    busy = true; updateControls();
    try { applyStatus(await boatyard.updateRemoteSettings({ enabled: false }, mode)); if (mode === "remote" && !compact) field("enabled").checked = false; }
    catch (e) { error.textContent = e instanceof Error ? e.message : String(e); error.hidden = false; }
    finally { busy = false; if (!disposed) updateControls(); }
  };
  const unsubscribe = boatyard.onRemoteStatusChanged?.(value => { statusRevision++; applyStatus(value); }, mode);
  shell.boatyardCleanup = () => { disposed = true; unsubscribe?.(); if (mode === "remote") field("password").value = ""; };
  applyFormControls(form); updateControls();
  if (boatyard.getRemoteStatus) {
    void boatyard.getRemoteStatus(mode).then(value => { if (statusRevision === 0) applyStatus(value); }).catch(e => {
      if (!disposed) { error.textContent = e instanceof Error ? e.message : String(e); error.hidden = false; }
    });
  }
  return shell;
}


export function createRemoteAccessSettingsForms(api: BoatyardBridge, applyFormControls: (container: HTMLElement) => void) {
  const container = document.createElement("div");
  container.append(createWebrtcSettingsForm(api, applyFormControls), createRemoteSettingsForm(api, applyFormControls, "remote"), createRemoteSettingsForm(api, applyFormControls, "share"));
  return container;
}
