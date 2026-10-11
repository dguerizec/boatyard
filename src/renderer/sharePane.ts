import { normalizeProjectSearchText, projectMatchesSearch } from "./projectUtils.js";
import { appendRemoteConnectionLinks } from "./remoteConnectionLinks.js";
import { toUnknownRecord, type UnknownRecord } from "./rendererRecords.js";
import type { BoatyardBridge } from "./rendererTypes.js";
import type { PaneCleanupHost } from "./paneCleanup.js";

// Keep fresh invitation links available when switching between the popup and pane.
const invitationLinks = new Map<string, string[]>();
type Mode = "remote" | "share";
let paneSequence = 0;

export function createSharePane(api: BoatyardBridge, compact = false) {
  const root = document.createElement("div") as PaneCleanupHost;
  root.className = "share-pane"; root.dataset.boatyardCleanup = "";
  const paneId = `share-${++paneSequence}`;
  root.innerHTML = `${compact ? "" : "<h3>Share</h3>"}
    <div class="share-screen-controls"><button type="button" class="secondary-button" data-screen title="Hide or show screen (Ctrl+Shift+S)">Hide screen</button>${compact ? "" : '<span class="form-hint">Ctrl+Shift+S</span>'}
    </div>
    <p data-status role="status">Loading…</p><p class="form-error" role="alert" hidden></p>
    <div class="share-tabs" role="tablist" aria-label="Share settings">
      <button type="button" class="secondary-button" role="tab" id="${paneId}-participants-tab" aria-controls="${paneId}-participants" aria-selected="true" data-share-tab="participants">Participants</button>
      <button type="button" class="secondary-button" role="tab" id="${paneId}-projects-tab" aria-controls="${paneId}-projects" aria-selected="false" tabindex="-1" data-share-tab="projects">Shared projects</button>
    </div>
    <section class="share-tab-panel" role="tabpanel" id="${paneId}-participants" aria-labelledby="${paneId}-participants-tab" data-share-panel="participants">
    <form data-invite><label class="field"><span>Client name</span><input name="label" maxlength="80" placeholder="Viewer name" autocomplete="off"></label>
      <div class="form-actions"><button class="primary-button" type="submit">Add client</button><button class="secondary-button" type="button" data-stop>Stop sharing</button></div></form>
    <p class="form-hint">Up to 8 Share viewers. One-use links expire after 15 minutes. Raised hands are numbered in arrival order.</p>
    <ul class="remote-client-list" aria-label="Participants"></ul></section>
    <section class="share-tab-panel" role="tabpanel" id="${paneId}-projects" aria-labelledby="${paneId}-projects-tab" data-share-panel="projects" data-screen-projects hidden>
      <p class="form-hint">Only checked projects are visible. Sharing pauses on other projects and settings. New projects start private.</p>
      <label class="field"><span>Search projects</span><input type="search" data-project-search placeholder="Search projects or groups" autocomplete="off"></label>
      <p class="form-hint">Group toggles apply to all projects in the group, including those hidden by search.</p>
      <div data-project-list></div>
      <p class="form-hint" data-project-empty role="status" hidden>No projects match your search.</p>
    </section>`;
  const statuses: Record<Mode, UnknownRecord> = { share: {}, remote: {} };
  const revisions = { share: 0, remote: 0 };
  let disposed = false, busy = false, loaded = false;
  const rows = new Map<string, { root: HTMLLIElement; text: HTMLElement; revoke: HTMLButtonElement; urls: HTMLElement; rendered?: string[] }>();
  const form = root.querySelector<HTMLFormElement>("[data-invite]")!;
  const label = form.elements.namedItem("label") as HTMLInputElement;
  const list = root.querySelector<HTMLUListElement>("ul")!;
  const error = root.querySelector<HTMLElement>("[role=alert]")!;
  const screen = root.querySelector<HTMLButtonElement>("[data-screen]")!;
  const projectList = root.querySelector<HTMLElement>("[data-project-list]")!;
  const projectSearch = root.querySelector<HTMLInputElement>("[data-project-search]")!;
  let projects: { id: string; name: string; key: string; group?: string }[] = [];
  const projectControls = new Map<string, HTMLInputElement>();
  const groups = new Map<string, { root: HTMLDetailsElement; input: HTMLInputElement; title: HTMLElement; list: HTMLElement; openBeforeSearch?: boolean }>();
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
    screen.textContent = share.screenHidden ? "Show screen" : "Hide screen";
    screen.setAttribute("aria-pressed", String(share.screenHidden === true));
    const shared = Array.isArray(share.sharedProjectIds) ? share.sharedProjectIds : [];
    const groupNames = new Set(projects.map(project => project.group?.trim() || ""));
    for (const groupName of groupNames) {
      if (groups.has(groupName)) continue;
      const section = document.createElement("details"), summary = document.createElement("summary"), input = document.createElement("input"), title = document.createElement("span"), list = document.createElement("div");
      section.className = "share-project-group"; section.dataset.projectGroup = groupName;
      input.type = "checkbox"; input.setAttribute("aria-label", `Share all projects in ${groupName || "Ungrouped"}`);
      input.onclick = event => event.stopPropagation();
      input.onchange = () => {
        const enabled = input.checked;
        const shared = Array.isArray(statuses.share.sharedProjectIds) ? statuses.share.sharedProjectIds : [];
        const ids = projects.filter(project => (project.group?.trim() || "") === groupName ? enabled : shared.includes(project.key)).map(project => project.id);
        saveProjects(ids);
      };
      summary.append(input, title); section.append(summary, list); projectList.append(section);
      groups.set(groupName, { root: section, input, title, list });
    }
    for (const project of projects) {
      let input = projectControls.get(project.id);
      if (!input) {
        const row = document.createElement("label"), text = document.createElement("span");
        row.className = "share-project-row"; text.textContent = project.name;
        input = document.createElement("input"); input.type = "checkbox";
        input.dataset.projectId = project.id;
        input.onchange = () => {
          const ids = projects.filter(value => projectControls.get(value.id)?.checked).map(value => value.id);
          saveProjects(ids);
        };
        row.append(input, text); projectControls.set(project.id, input);
      }
      const group = groups.get(project.group?.trim() || "")!;
      if (input.parentElement!.parentElement !== group.list) group.list.append(input.parentElement!);
      input.nextElementSibling!.textContent = project.name;
      input.checked = shared.includes(project.key);
    }
    for (const [name, group] of groups) {
      if (!groupNames.has(name)) { group.root.remove(); groups.delete(name); continue; }
      const members = projects.filter(project => (project.group?.trim() || "") === name);
      const selected = members.filter(project => shared.includes(project.key)).length;
      group.input.checked = selected === members.length;
      group.input.indeterminate = selected > 0 && selected < members.length;
      group.title.textContent = `${name || "Ungrouped"} (${selected}/${members.length})`;
    }
    filterProjects();
    root.querySelector<HTMLElement>("[data-status]")!.textContent = !loaded ? "Loading…" : share.listening ? `Share listening on port ${share.port} · ${share.screenHidden ? "Screen hidden" : "Screen is read-only"}` : "Share is stopped.";
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input:not([data-project-search]), button:not([role=tab])").forEach(control => { control.disabled = busy || !loaded; });
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
  function filterProjects() {
    const query = normalizeProjectSearchText(projectSearch.value);
    let matches = 0;
    for (const [name, group] of groups) {
      let visible = 0;
      for (const project of projects) {
        if ((project.group?.trim() || "") !== name) continue;
        const matched = projectMatchesSearch({ ...project, group: name || "Ungrouped" }, query);
        projectControls.get(project.id)!.parentElement!.hidden = !matched;
        if (matched) visible++;
      }
      group.root.hidden = visible === 0;
      matches += visible;
      if (query) {
        group.openBeforeSearch ??= group.root.open;
        group.root.open = visible > 0;
      } else if (group.openBeforeSearch !== undefined) {
        group.root.open = group.openBeforeSearch;
        delete group.openBeforeSearch;
      }
    }
    root.querySelector<HTMLElement>("[data-project-empty]")!.hidden = !query || matches > 0;
  }
  projectSearch.oninput = filterProjects;
  function saveProjects(ids: string[]) {
    void run(async () => {
      if (!api.updateShareScreen) throw new Error("Screen controls are unavailable.");
      await mutate("share", () => api.updateShareScreen!({ sharedProjectIds: ids }));
    });
  }
  screen.onclick = () => { const screenHidden = statuses.share.screenHidden !== true; void run(async () => {
    if (!api.updateShareScreen) throw new Error("Screen controls are unavailable.");
    await mutate("share", () => api.updateShareScreen!({ screenHidden }));
  }); };
  let projectsRequest = 0;
  function refreshProjects() {
    const request = ++projectsRequest;
    void api.getShareProjects?.().then(value => {
      if (disposed || request !== projectsRequest) return;
      projects = value;
      const ids = new Set(projects.map(project => project.id));
      for (const [id, input] of projectControls) if (!ids.has(id)) { input.parentElement?.remove(); projectControls.delete(id); }
      render();
    }).catch(showError);
  }
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-share-tab]")];
  function selectTab(tab: HTMLButtonElement) {
    for (const button of tabs) {
      const selected = button === tab;
      button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
      root.querySelector<HTMLElement>(`[data-share-panel="${button.dataset.shareTab}"]`)!.hidden = !selected;
    }
    if (tab.dataset.shareTab === "projects") refreshProjects();
  }
  for (const [index, tab] of tabs.entries()) {
    tab.onclick = () => selectTab(tab);
    tab.onkeydown = event => {
      const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : undefined;
      if (next) { event.preventDefault(); selectTab(next); next.focus(); }
    };
  }
  refreshProjects();
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
