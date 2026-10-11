import type { BoatyardBridge } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type { PaneCleanupHost } from "./paneCleanup.js";

export function createWebrtcSettingsForm(api: BoatyardBridge, applyFormControls: (container: HTMLElement) => void): HTMLElement {
  const shell = document.createElement("section") as PaneCleanupHost;
  shell.className = "project-form-page remote-settings";
  shell.dataset.boatyardCleanup = "";
  shell.innerHTML = `<form class="project-form">
    <div class="form-heading"><h3>WebRTC connectivity</h3><p>Shared by Remote and Share. Changes apply to new connections.</p></div>
    <label>Connection provider<select class="form-control" name="provider"><option value="direct">Direct only</option><option value="cloudflare">Cloudflare TURN</option><option value="custom">Custom TURN server</option></select></label>
    <p class="form-hint" data-direct>Without TURN, connections may fail on some networks. No relay fallback is available.</p>
    <div class="webrtc-settings-fields" data-cloudflare><label>TURN key ID<input name="keyId" maxlength="32" autocomplete="off"></label>
      <label>TURN key secret<input type="password" name="apiToken" maxlength="4096" autocomplete="new-password"></label><p class="form-hint" data-secret="apiToken"></p></div>
    <div class="webrtc-settings-fields" data-custom><label>TURN addresses (one per line)<textarea name="urls" rows="3" placeholder="turn:turn.example.com:3478&#10;turns:turn.example.com:5349?transport=tcp"></textarea></label><p class="form-hint">Use # for comments or to disable an address. Comments are preserved when saving.</p>
      <label>Authentication<select class="form-control" name="authentication"><option value="fixed">Fixed username and password</option><option value="temporary">Temporary credentials (coturn shared secret)</option></select></label>
      <div class="webrtc-settings-fields" data-fixed><label>Username<input name="username" maxlength="4096" autocomplete="off"></label><label>Password<input type="password" name="password" maxlength="4096" autocomplete="new-password"></label><p class="form-hint" data-secret="password"></p></div>
      <div class="webrtc-settings-fields" data-temporary><label>Shared secret<input type="password" name="sharedSecret" maxlength="4096" autocomplete="new-password"></label><p class="form-hint" data-secret="sharedSecret"></p><p class="form-hint">Enable use-auth-secret on coturn with the same shared secret. Boatyard generates temporary credentials in its main process.</p></div>
    </div>
    <label class="switch-row" data-relay><span class="switch-copy"><strong>Force TURN relay</strong><small>Use TURN for every new Remote and Share connection, even when a direct route is available. Connections fail if the relay is unavailable.</small></span><input type="checkbox" name="forceRelay"><span class="switch-track" aria-hidden="true"></span></label>
    <p class="form-hint">Permanent provider secrets stay in this installation. Fixed TURN credentials are shared with authenticated peers. Dedicated STUN servers are not added.</p>
    <p class="form-hint" role="status">Loading…</p><p class="form-error" role="alert" hidden></p>
    <div class="form-actions"><button class="primary-button" type="submit">Save</button><button class="secondary-button" type="button" data-test>Test saved connectivity</button></div>
  </form>`;
  const form = shell.querySelector("form")!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const status = shell.querySelector<HTMLElement>('[role="status"]')!;
  const error = shell.querySelector<HTMLElement>('[role="alert"]')!;
  let busy = false, loaded = false, dirty = false, disposed = false, revision = 0;
  let testPeer: RTCPeerConnection | undefined;
  let cancelTest: (() => void) | undefined;
  function visibility() {
    for (const [selector, visible] of [["[data-relay]", field("provider").value !== "direct"], ["[data-direct]", field("provider").value === "direct"], ["[data-cloudflare]", field("provider").value === "cloudflare"], ["[data-custom]", field("provider").value === "custom"], ["[data-fixed]", field("authentication").value === "fixed"], ["[data-temporary]", field("authentication").value === "temporary"]] as const) {
      shell.querySelector<HTMLElement>(selector)!.hidden = !visible;
    }
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea, button").forEach(control => { control.disabled = busy || !loaded; });
    form.querySelector<HTMLButtonElement>("[data-test]")!.disabled = busy || !loaded || dirty;
  }
  function apply(value: UnknownRecord) {
    if (disposed) return;
    loaded = true;
    error.textContent = String(value.error || ""); error.hidden = !value.error;
    if (!dirty) {
      for (const name of ["provider", "keyId", "authentication", "username"]) field(name).value = String(value[name] || "");
      (field("forceRelay") as HTMLInputElement).checked = value.forceRelay === true;
      field("urls").value = Array.isArray(value.urls) ? value.urls.join("\n") : "";
      for (const [name, flag] of [["apiToken", "hasApiToken"], ["password", "hasPassword"], ["sharedSecret", "hasSharedSecret"]]) {
        field(name).value = "";
        shell.querySelector<HTMLElement>(`[data-secret="${name}"]`)!.textContent = value[flag] ? "Secret is set. Leave blank to keep it." : "Enter your own secret.";
      }
    }
    status.textContent = value.overridden ? "BOATYARD_REMOTE_ICE_SERVERS overrides these settings." : dirty ? "Settings changed in another window. Your draft is preserved." : "Ready. Test checks relay allocation from this installation; it does not prove access from every network.";
    visibility();
  }
  function showError(reason: unknown) {
    if (!disposed) { error.textContent = reason instanceof Error ? reason.message : String(reason); error.hidden = false; }
  }
  form.addEventListener("input", () => { dirty = true; visibility(); });
  form.addEventListener("change", () => { dirty = true; visibility(); });
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !loaded) return;
    busy = true; error.hidden = true; visibility();
    try {
      if (!api.updateWebrtcSettings) throw new Error("WebRTC settings are unavailable.");
      const provider = field("provider").value;
      const patch: UnknownRecord = { provider, forceRelay: provider !== "direct" && (field("forceRelay") as HTMLInputElement).checked };
      if (provider === "cloudflare") {
        patch.keyId = field("keyId").value.trim(); patch.apiToken = field("apiToken").value;
      } else if (provider === "custom") {
        patch.urls = field("urls").value.split(/\r?\n/);
        patch.authentication = field("authentication").value;
        for (const name of patch.authentication === "temporary" ? ["sharedSecret"] : ["username", "password"]) patch[name] = field(name).value;
      }
      const value = await api.updateWebrtcSettings(patch);
      dirty = false; apply(value);
    } catch (reason) { showError(reason); }
    finally { busy = false; if (!disposed) visibility(); }
  };
  form.querySelector<HTMLButtonElement>("[data-test]")!.onclick = async () => {
    if (busy || dirty) return;
    busy = true; error.hidden = true; visibility(); status.textContent = "Checking relay allocation…";
    try {
      if (!api.getWebrtcTestServers) throw new Error("WebRTC connectivity test is unavailable.");
      const iceServers = await api.getWebrtcTestServers();
      if (disposed) return;
      if (!iceServers.length) { status.textContent = "Direct only: no TURN relay configured. Test two peers on the intended networks."; return; }
      const peer = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" }); testPeer = peer;
      peer.createDataChannel("connectivity-test");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error("No relay candidate obtained. Check TURN authentication, addresses and firewall.")), 12000);
        const finish = (reason?: Error) => { clearTimeout(timer); cancelTest = undefined; peer.onicecandidate = null; reason ? reject(reason) : resolve(); };
        cancelTest = () => finish(new Error("Connectivity test cancelled."));
        peer.onicecandidate = event => { if (event.candidate?.type === "relay") finish(); };
        void peer.createOffer().then(offer => peer.setLocalDescription(offer)).catch(() => finish(new Error("Could not start the relay test.")));
      });
      if (!disposed) status.textContent = "TURN authenticated and allocated a relay candidate from this installation. Test an external peer to confirm the complete media path.";
    } catch (reason) { showError(reason); }
    finally { testPeer?.close(); testPeer = undefined; busy = false; if (!disposed) visibility(); }
  };
  const unsubscribe = api.onWebrtcSettingsChanged?.(value => { revision++; apply(value); });
  shell.boatyardCleanup = () => { disposed = true; unsubscribe?.(); cancelTest?.(); testPeer?.close(); for (const name of ["apiToken", "password", "sharedSecret"]) field(name).value = ""; };
  applyFormControls(form); visibility();
  void api.getWebrtcSettings?.().then(value => { if (revision === 0) apply(value); }).catch(showError);
  return shell;
}
