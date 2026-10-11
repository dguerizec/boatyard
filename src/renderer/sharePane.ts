import { appendRemoteConnectionLinks } from "./remoteConnectionLinks.js";
import { toUnknownRecord, type UnknownRecord } from "./rendererRecords.js";
import type { BoatyardBridge } from "./rendererTypes.js";
import type { PaneCleanupHost } from "./paneCleanup.js";

// Keep fresh invitation links available when switching between the popup and pane.
const invitationLinks = new Map<string, string[]>();
type Mode = "remote" | "share";

export function createSharePane(api: BoatyardBridge, compact = false) {
  const root = document.createElement("div") as PaneCleanupHost;
  root.className = "share-pane"; root.dataset.boatyardCleanup = "";
  root.innerHTML = `${compact ? "" : "<h3>Share</h3>"}
    <p data-status role="status">Loading…</p><p class="form-error" role="alert" hidden></p>
    <form data-invite><label class="field"><span>Client name</span><input name="label" maxlength="80" placeholder="Viewer name" autocomplete="off"></label>
      <div class="form-actions"><button class="primary-button" type="submit">Add client</button><button class="secondary-button" type="button" data-stop>Stop sharing</button></div></form>
    <p class="form-hint">Up to 8 Share viewers. One-use links expire after 15 minutes. Raised hands are numbered in arrival order.</p>
    <ul class="remote-client-list" aria-label="Participants"></ul>`;
  const statuses: Record<Mode, UnknownRecord> = { share: {}, remote: {} };
  const revisions = { share: 0, remote: 0 };
  let disposed = false, busy = false, loaded = false;
  const rows = new Map<string, { root: HTMLLIElement; text: HTMLElement; revoke: HTMLButtonElement; urls: HTMLElement; rendered?: string[] }>();
  const form = root.querySelector<HTMLFormElement>("[data-invite]")!;
  const label = form.elements.namedItem("label") as HTMLInputElement;
  const list = root.querySelector<HTMLUListElement>("ul")!;
  const error = root.querySelector<HTMLElement>("[role=alert]")!;
  const stop = root.querySelector<HTMLButtonElement>("[data-stop]")!;
  const showError = (reason: unknown) => { if (!disposed) { error.textContent = reason instanceof Error ? reason.message : String(reason); error.hidden = false; } };
  function apply(mode: Mode, value: UnknownRecord) { if (!disposed) {
    if (mode === "share" && Array.isArray(value.clients)) {
      const invited = new Set(value.clients.map(toUnknownRecord).filter(client => client.state === "invited").map(client => String(client.id)));
      for (const id of invitationLinks.keys()) if (!invited.has(id)) invitationLinks.delete(id);
    }
    statuses[mode] = value; loaded = true; render(); } }
  async function mutate(mode: Mode, action: () => Promise<UnknownRecord>) {
    const revision = revisions[mode];
    const value = await action();
    if (revision === revisions[mode]) apply(mode, value);
  }
  async function run(action: () => Promise<void>) {
    if (busy || disposed) return;
    busy = true; error.hidden = true; render();
    try { await action(); } catch (reason) { showError(reason); }
    finally { busy = false; if (!disposed) render(); }
  }
  function render() {
    const share = statuses.share;
    root.querySelector<HTMLElement>("[data-status]")!.textContent = !loaded ? "Loading…" : share.listening ? `Share listening on port ${share.port} · Screen is read-only` : "Share is stopped.";
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(control => { control.disabled = busy || !loaded; });
    stop.disabled = busy || !share.listening && !share.enabled;
    const ids = new Set<string>();
    for (const mode of ["share", "remote"] as const) {
      const clients = Array.isArray(statuses[mode].clients) ? (statuses[mode].clients as unknown[]).map(toUnknownRecord) : [];
      for (const client of clients) {
        const id = String(client.id), key = `${mode}:${id}`; ids.add(key);
        let row = rows.get(key);
        if (!row) {
          const item = document.createElement("li"), heading = document.createElement("div"), text = document.createElement("span"), revoke = document.createElement("button"), urls = document.createElement("div");
          item.className = "remote-client-row"; item.dataset.clientId = id; heading.className = "remote-client-heading"; urls.className = "remote-urls";
          for (const button of [revoke]) { button.type = "button"; button.className = "secondary-button"; }
          revoke.textContent = "Revoke"; revoke.dataset.clientAction = "revoke"; revoke.hidden = mode !== "share";
          revoke.onclick = () => { void run(async () => { if (!api.revokeShareClient) throw new Error("Client management is unavailable."); await mutate("share", () => api.revokeShareClient!(id)); }); };
          heading.append(text, revoke); item.append(heading, urls); list.append(item);
          row = { root: item, text, revoke, urls }; rows.set(key, row);
        }
        const route = client.route === "direct" ? "Direct" : client.route === "relay" ? "Relayed" : "Checking connection…";
        row.revoke.disabled = busy;
        row.text.textContent = `${client.label} · ${mode === "remote" ? "Remote · " : ""}${client.state === "connected" ? `Connected · ${route}` : client.state === "invited" ? "Invited" : "Signed in"}`;
        const links = client.state === "invited" ? invitationLinks.get(id) : undefined;
        if (row.rendered !== links) { row.urls.replaceChildren(); if (links) appendRemoteConnectionLinks(row.urls, links, api, showError, { hideFragment: true }); row.rendered = links; }
      }
    }
    for (const [id, row] of rows) if (!ids.has(id)) { row.root.remove(); rows.delete(id); }
  }
  form.onsubmit = event => { event.preventDefault(); void run(async () => {
    if (!api.createReadOnlyShareLink || !api.getRemoteStatus) throw new Error("Share is unavailable.");
    const result = await api.createReadOnlyShareLink(label.value);
    if (result.id) invitationLinks.set(result.id, result.urls);
    await mutate("share", () => api.getRemoteStatus!("share")); if (!disposed) label.value = "";
  }); };
  stop.onclick = () => { void run(async () => {
    if (!api.updateRemoteSettings) throw new Error("Share is unavailable.");
    await mutate("share", () => api.updateRemoteSettings!({ enabled: false }, "share"));
  }); };
  const subscriptions = (["share", "remote"] as const).map(mode => {
    const unsubscribe = api.onRemoteStatusChanged?.(value => { revisions[mode]++; apply(mode, value); }, mode);
    void api.getRemoteStatus?.(mode).then(value => { if (!revisions[mode]) apply(mode, value); }).catch(showError);
    return unsubscribe;
  });
  root.boatyardCleanup = () => { disposed = true; subscriptions.forEach(unsubscribe => unsubscribe?.()); };
  render(); return root;
}
