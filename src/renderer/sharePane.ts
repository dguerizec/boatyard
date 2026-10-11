import { normalizeProjectSearchText, projectMatchesSearch } from "./projectUtils.js";
import { appendRemoteConnectionLinks } from "./remoteConnectionLinks.js";
import { toUnknownRecord, type UnknownRecord } from "./rendererRecords.js";
import type { BoatyardBridge } from "./rendererTypes.js";
import type { PaneCleanupHost } from "./paneCleanup.js";
import { createToolIcon } from "./toolIcons.js";
function iconAction(button: HTMLButtonElement, icon: string, label: string) {
  button.classList.add("share-icon-button");
  button.title = label; button.setAttribute("aria-label", label);
  if (button.dataset.icon === icon && button.dataset.label === label) return;
  button.dataset.icon = icon; button.dataset.label = label;
  const text = document.createElement("span"); text.className = "sr-only"; text.textContent = label;
  button.replaceChildren(createToolIcon(icon), text);
}

type Mode = "remote" | "share";
let paneSequence = 0;

export function createSharePane(api: BoatyardBridge, compact = false) {
  const root = document.createElement("div") as PaneCleanupHost;
  root.className = "share-pane"; root.dataset.boatyardCleanup = "";
  const paneId = `share-${++paneSequence}`;
  root.innerHTML = `${compact ? "" : "<h3>Share</h3>"}
    <p class="form-error" role="alert" hidden></p>
    <div class="share-tabs" role="tablist" aria-label="Share session">
      <button type="button" class="secondary-button" role="tab" id="${paneId}-session-tab" aria-controls="${paneId}-session" aria-selected="true" data-share-tab="session">Session</button>
      <button type="button" class="secondary-button" role="tab" id="${paneId}-setup-tab" aria-controls="${paneId}-setup" aria-selected="false" tabindex="-1" data-share-tab="setup">Setup</button>
      <button type="button" class="secondary-button" role="tab" id="${paneId}-projects-tab" aria-controls="${paneId}-projects" aria-selected="false" tabindex="-1" data-share-tab="projects">Shared projects</button>
    </div>
    <section class="share-tab-panel" role="tabpanel" id="${paneId}-session" aria-labelledby="${paneId}-session-tab" data-share-panel="session">
    <div class="share-screen-controls"><button type="button" class="secondary-button" data-screen title="Hide or show screen (Ctrl+Shift+S)">Hide screen</button>${compact ? "" : '<span class="form-hint">Ctrl+Shift+S</span>'}</div>
    <section data-join-queue hidden><h4>Join requests</h4><ul class="remote-join-requests" aria-label="Join requests"></ul></section>
    <h4>Connected participants</h4><p class="form-hint" data-session-empty>No connected participants. Create invitations in Setup.</p>
    <ul class="remote-client-list" aria-label="Connected participants"></ul>
    </section>
    <section class="share-tab-panel" role="tabpanel" id="${paneId}-setup" aria-labelledby="${paneId}-setup-tab" data-share-panel="setup" hidden>
    <p data-status role="status">Loading…</p>
    <div class="form-actions"><button class="primary-button" type="button" data-start>Start sharing</button><button class="secondary-button" type="button" data-stop>Stop sharing</button></div>
    <section class="share-admission" aria-label="Joining options"><h4>Joining options</h4>
      <div class="share-group-options">
        <label class="switch-row"><span class="switch-copy">Group code</span><input type="checkbox" role="switch" data-group-enabled><span class="switch-track" aria-hidden="true"></span></label>
        <label class="switch-row"><span class="switch-copy">Require approval</span><input type="checkbox" role="switch" data-group-approval><span class="switch-track" aria-hidden="true"></span></label>
      </div>
      <label class="switch-row"><span class="switch-copy">Ask to join without a code</span><input type="checkbox" role="switch" data-join-requests><span class="switch-track" aria-hidden="true"></span></label>
      <div class="remote-urls" data-admission-links></div>
      <p class="form-hint">Each admitted participant receives a personal code. Codes are hidden here to keep them out of the shared screen; copy them to send an invitation.</p>
    </section>
    <form data-invite><label class="field"><span>Participant name (optional)</span><input name="label" maxlength="80" placeholder="Participant enters their name" autocomplete="off"></label>
      <div class="form-actions"><button class="primary-button" type="submit">Add participant</button></div></form>
    <p class="form-hint">Personal codes last until sharing stops.</p>
    <h4>Invitations</h4><ul class="remote-client-list" data-invitations aria-label="Participant invitations"></ul></section>
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
  const rows = new Map<string, { root: HTMLLIElement; text: HTMLElement; revoke: HTMLButtonElement; urls: HTMLElement; rendered?: string }>();
  const form = root.querySelector<HTMLFormElement>("[data-invite]")!;
  const label = form.elements.namedItem("label") as HTMLInputElement;
  const list = root.querySelector<HTMLUListElement>('[data-share-panel="session"] .remote-client-list')!;
  const invitations = root.querySelector<HTMLUListElement>("[data-invitations]")!;
  const error = root.querySelector<HTMLElement>("[role=alert]")!;
  const screen = root.querySelector<HTMLButtonElement>("[data-screen]")!;
  const projectList = root.querySelector<HTMLElement>("[data-project-list]")!;
  const projectSearch = root.querySelector<HTMLInputElement>("[data-project-search]")!;
  let projects: { id: string; name: string; key: string; group?: string }[] = [];
  const projectControls = new Map<string, HTMLInputElement>();
  const groups = new Map<string, { root: HTMLDetailsElement; input: HTMLInputElement; title: HTMLElement; list: HTMLElement; openBeforeSearch?: boolean }>();
  const stop = root.querySelector<HTMLButtonElement>("[data-stop]")!;
  const start = root.querySelector<HTMLButtonElement>("[data-start]")!;
  const showError = (reason: unknown) => { if (!disposed) { error.textContent = reason instanceof Error ? reason.message : String(reason); error.hidden = false; } };
  function apply(mode: Mode, value: UnknownRecord) { if (!disposed) { statuses[mode] = value; loaded = true; render(); } }
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
  const groupEnabled = root.querySelector<HTMLInputElement>("[data-group-enabled]")!;
  const groupApproval = root.querySelector<HTMLInputElement>("[data-group-approval]")!;
  const joinRequests = root.querySelector<HTMLInputElement>("[data-join-requests]")!;
  const requestRows = new Map<string, HTMLLIElement>();
  let admissionLinksKey = "";
  for (const [input, key] of [[groupEnabled, "groupEnabled"], [groupApproval, "groupApprovalRequired"], [joinRequests, "allowJoinRequests"]] as const) {
    input.onchange = () => { const checked = input.checked; void run(async () => {
      if (!api.configureShareAccess) throw new Error("Share admission controls are unavailable.");
      const patch = { [key]: checked, ...(checked && key === "groupEnabled" ? { allowJoinRequests: false } : checked && key === "allowJoinRequests" ? { groupEnabled: false } : {}) };
      await mutate("share", () => api.configureShareAccess!(patch));
    }); };
  }
  function renderAdmission(share: UnknownRecord) {
    const access = toUnknownRecord(share.shareAccess);
    groupEnabled.checked = access.groupEnabled === true; groupApproval.checked = access.groupApprovalRequired !== false;
    joinRequests.checked = access.allowJoinRequests === true; groupApproval.disabled = busy || !groupEnabled.checked;
    const values = groupEnabled.checked ? access.groupUrls : joinRequests.checked ? share.urls : [];
    const urls = Array.isArray(values) ? values.map(String) : [];
    const code = groupEnabled.checked ? String(access.groupCode || "") : "";
    const linksKey = JSON.stringify([urls, code]);
    const container = root.querySelector<HTMLElement>("[data-admission-links]")!;
    container.hidden = !urls.length;
    if (linksKey !== admissionLinksKey) {
      const previous = container.querySelector("select")?.selectedOptions[0]?.textContent;
      container.replaceChildren();
      appendRemoteConnectionLinks(container, urls, api, showError, { hideFragment: true, code, showCodeButton: true });
      const select = container.querySelector("select");
      const selected = select && [...select.options].find(option => option.textContent === previous);
      if (select && selected) { select.value = selected.value; select.dispatchEvent(new Event("change")); }
      admissionLinksKey = linksKey;
    }
    const copyCode = container.querySelector<HTMLButtonElement>("[data-copy-code]");
    if (copyCode) copyCode.disabled = busy || !code;
    const requests = Array.isArray(access.requests) ? access.requests.map(toUnknownRecord) : [];
    root.querySelector<HTMLElement>("[data-join-queue]")!.hidden = !requests.length;
    const ids = new Set<string>();
    for (const request of requests) {
      const id = String(request.id); ids.add(id);
      let row = requestRows.get(id);
      if (!row) {
        row = document.createElement("li"); row.className = "remote-client-heading"; row.dataset.requestId = id;
        const text = document.createElement("span"); row.append(text);
        for (const accepted of [true, false]) {
          const button = document.createElement("button"); button.type = "button"; button.className = "secondary-button";
          button.textContent = accepted ? "Accept" : "Decline";
          button.onclick = () => { void run(async () => {
            if (!api.decideShareJoinRequest) throw new Error("Join approval is unavailable.");
            await mutate("share", () => api.decideShareJoinRequest!(id, accepted));
          }); }; row.append(button);
        }
        root.querySelector(".remote-join-requests")!.append(row); requestRows.set(id, row);
      }
      row.querySelector("span")!.textContent = `${request.label} wants to join`;
      row.querySelectorAll("button").forEach(button => { button.disabled = busy; });
    }
    for (const [id, row] of requestRows) if (!ids.has(id)) { row.remove(); requestRows.delete(id); }
  }
  function render() {
    const share = statuses.share;
    iconAction(screen, share.screenHidden ? "eyeOff" : "eye", `${share.screenHidden ? "Show screen" : "Hide screen"} (Ctrl+Shift+S)`);
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
    renderAdmission(share);
    stop.disabled = busy || !share.listening && !share.enabled;
    start.hidden = share.listening === true;
    stop.hidden = !share.listening && !share.enabled;
    const connected = Number(share.connectedClients || 0) + Number(statuses.remote.connectedClients || 0);
    root.querySelector<HTMLElement>("[data-session-empty]")!.hidden = connected > 0;
    const ids = new Set<string>();
    for (const mode of ["share", "remote"] as const) {
      const clients = Array.isArray(statuses[mode].clients) ? (statuses[mode].clients as unknown[]).map(toUnknownRecord) : [];
      for (const client of clients) {
        const id = String(client.id), connected = client.state === "connected";
        for (const invitation of mode === "share" ? [false, true] : [false]) {
          if (!invitation && !connected) continue;
          const key = `${mode}:${id}:${invitation}`; ids.add(key);
          let row = rows.get(key);
          if (!row) {
            const item = document.createElement("li"), heading = document.createElement("div"), text = document.createElement("span"), revoke = document.createElement("button"), urls = document.createElement("div");
            item.className = "remote-client-row"; item.dataset.clientId = id; heading.className = "remote-client-heading"; urls.className = "remote-urls";
            revoke.type = "button"; revoke.className = "secondary-button"; revoke.dataset.clientAction = "revoke";
            revoke.onclick = () => { void run(async () => { if (!api.revokeShareClient) throw new Error("Client management is unavailable."); await mutate("share", () => api.revokeShareClient!(id)); }); };
            heading.append(text, revoke); item.append(heading, urls); (invitation ? invitations : list).append(item);
            row = { root: item, text, revoke, urls }; rows.set(key, row);
          }
          const route = client.route === "direct" ? "Direct" : client.route === "relay" ? "Relayed" : "Checking connection…";
          row.text.textContent = `${client.label || "Unnamed participant"} · ${mode === "remote" ? "Remote · " : ""}${client.state === "connected" ? `Connected · ${route}` : client.state === "invited" ? "Invited" : "Signed in"}`;
          row.revoke.replaceChildren(createToolIcon("trash")); row.revoke.title = `Revoke: ${client.label || "Unnamed participant"}`; row.revoke.setAttribute("aria-label", row.revoke.title);
          row.revoke.disabled = busy; row.revoke.hidden = !invitation;
          row.urls.hidden = !invitation;
          const links = invitation && Array.isArray(client.urls) ? client.urls.map(String) : [];
          const rendered = JSON.stringify([links, client.code]);
          if (invitation && row.rendered !== rendered) { row.urls.replaceChildren(); appendRemoteConnectionLinks(row.urls, links, api, showError, { hideFragment: true, code: String(client.code || "") }); row.rendered = rendered; }
        }
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
    await api.createReadOnlyShareLink(label.value);
    await mutate("share", () => api.getRemoteStatus!("share")); if (!disposed) label.value = "";
  }); };
  stop.onclick = () => { void run(async () => {
    if (!api.updateRemoteSettings) throw new Error("Share is unavailable.");
    await mutate("share", () => api.updateRemoteSettings!({ enabled: false }, "share"));
  }); };
  start.onclick = () => { void run(async () => {
    if (!api.updateRemoteSettings) throw new Error("Share is unavailable.");
    await mutate("share", () => api.updateRemoteSettings!({ enabled: true }, "share"));
  }); };
  const subscriptions = (["share", "remote"] as const).map(mode => {
    const unsubscribe = api.onRemoteStatusChanged?.(value => { revisions[mode]++; apply(mode, value); }, mode);
    void api.getRemoteStatus?.(mode).then(value => { if (!revisions[mode]) apply(mode, value); }).catch(showError);
    return unsubscribe;
  });
  root.boatyardCleanup = () => { disposed = true; subscriptions.forEach(unsubscribe => unsubscribe?.()); };
  render(); return root;
}
