import { createShareChat } from "./shareChat.js";
import { normalizeProjectSearchText, projectMatchesSearch } from "./projectUtils.js";
import { appendRemoteConnectionLinks } from "./remoteConnectionLinks.js";
import { toUnknownRecord, type UnknownRecord } from "./rendererRecords.js";
import type { BoatyardBridge } from "./rendererTypes.js";
import type { PaneCleanupHost } from "./paneCleanup.js";
import { createToolIcon } from "./toolIcons.js";
import type { RemoteAudioMode } from "../shared/remoteAudio.js";
import type { ShareTab } from "../shared/shareSidebar.js";

export type ShareSidebarPin = {
  isPinned(): boolean;
  toggle(): void;
  subscribe(callback: () => void): () => void;
};
type SharePaneOptions = {
  openUrl?: (payload: UnknownRecord) => unknown;
  sidebarPin?: ShareSidebarPin;
  hideTabs?: boolean;
  onTabChanged?: (tab: ShareTab) => void;
  onAlertsChanged?: (alerts: { requests: number; hands: number; messages: number }) => void;
};
export type SharePaneHost = PaneCleanupHost & {
  selectShareTab(tab: ShareTab, section?: "requests" | "hands"): void;
  setShareVisible(visible: boolean): void;
};

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

export function createSharePane(api: BoatyardBridge, compact = false, options: SharePaneOptions = {}) {
  const root = document.createElement("div") as unknown as SharePaneHost;
  let paneVisible = true, selectedTab: ShareTab = "session";
  const alerts = { requests: 0, hands: 0, messages: 0 };
  root.className = "share-pane"; root.dataset.boatyardCleanup = "";
  const paneId = `share-${++paneSequence}`;
  root.innerHTML = `${compact ? "" : "<h3>Share</h3>"}
    <p class="form-error" role="alert" hidden></p>
    <div class="share-tabs" role="tablist" aria-label="Share session" ${options.hideTabs ? "hidden" : ""}>
      <button type="button" class="secondary-button" role="tab" id="${paneId}-session-tab" aria-controls="${paneId}-session" aria-selected="true" data-share-tab="session">Session</button>
      <button type="button" class="secondary-button" role="tab" id="${paneId}-chat-tab" aria-controls="${paneId}-chat" aria-selected="false" tabindex="-1" data-share-tab="chat">Chat<span class="share-chat-badge" hidden></span></button>
      <button type="button" class="secondary-button" role="tab" id="${paneId}-setup-tab" aria-controls="${paneId}-setup" aria-selected="false" tabindex="-1" data-share-tab="setup">Setup</button>
      <button type="button" class="secondary-button" role="tab" id="${paneId}-projects-tab" aria-controls="${paneId}-projects" aria-selected="false" tabindex="-1" data-share-tab="projects">Shared projects</button>
    </div>
    <section class="share-tab-panel" role="tabpanel" id="${paneId}-session" aria-labelledby="${paneId}-session-tab" data-share-panel="session">
    <div class="share-screen-controls"><button type="button" class="secondary-button" data-screen title="Hide or show screen (Ctrl+Shift+S)">Hide screen</button>${compact ? "" : '<span class="form-hint">Ctrl+Shift+S</span>'}</div>
    <div class="share-audio-mode"><label for="${paneId}-audio-mode">Audio mode</label>
      <select class="form-control" id="${paneId}-audio-mode" data-audio-mode><option value="speaker-only">Speaker only</option><option value="open-discussion">Open discussion</option><option value="qa">Q&amp;A</option></select></div>
    <p class="form-hint" data-audio-mode-hint></p>
    <label class="share-microphone-device" for="${paneId}-microphone"><span>My microphone</span>
      <select class="form-control" id="${paneId}-microphone" data-microphone-device><option value="">System default</option></select></label>
    <p class="form-hint" data-microphone-hint></p>
    <div class="share-audio-controls" data-voice-controls role="group" aria-label="Microphone and speaking controls"><button type="button" class="secondary-button" data-mic>Unmute my microphone</button>
      <button type="button" class="secondary-button" data-mute-all>Mute all participants</button>
      <button type="button" class="secondary-button" data-allow-all>Allow all participants</button>
      <span class="share-control-divider" aria-hidden="true" data-turn-divider></span>
      <button type="button" class="secondary-button" data-next-question>Next question</button>
      <button type="button" class="secondary-button" data-end-turn>End turn</button></div>
    <p class="form-hint" data-floor-status role="status"></p>
    <section data-join-queue hidden><h4>Join requests</h4><ul class="remote-join-requests" aria-label="Join requests"></ul></section>
    <h4>Participants</h4><p class="form-hint" data-session-empty>No participants waiting or connected. Create invitations in Setup.</p>
    <ul class="remote-client-list" aria-label="Participants"></ul>
    </section>
    <section class="share-tab-panel" role="tabpanel" id="${paneId}-chat" aria-labelledby="${paneId}-chat-tab" data-share-panel="chat" hidden><div data-chat-root></div></section>
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
    <p class="form-hint">Personal codes survive app restarts. Stop sharing invalidates used codes.</p>
    <h4>Invitations</h4><ul class="remote-client-list" data-invitations aria-label="Participant invitations"></ul></section>
    <section class="share-tab-panel" role="tabpanel" id="${paneId}-projects" aria-labelledby="${paneId}-projects-tab" data-share-panel="projects" data-screen-projects hidden>
      <p class="form-hint">Only checked projects are visible. Sharing pauses on other projects and settings. New projects start private.</p>
      <label class="field"><span>Search projects</span><input type="search" data-project-search placeholder="Search projects or groups" autocomplete="off"></label>
      <p class="form-hint">Group toggles apply to all projects in the group, including those hidden by search.</p>
      <div data-project-list></div>
      <p class="form-hint" data-project-empty role="status" hidden>No projects match your search.</p>
    </section>`;
  const chat = api.getShareChat && api.sendShareChat && api.getShareChatImage ? createShareChat(root.querySelector<HTMLElement>("[data-chat-root]")!, {
    read: async id => {
      const value = await api.getShareChat!(id);
      return !id && !value.session && value.sessions?.length ? api.getShareChat!(value.sessions[0].id) : value;
    },
    send: (id, input) => api.sendShareChat!(id, input),
    delete: (id, messageId) => api.deleteShareChatMessage!(id, messageId),
    image: (id, messageId) => api.getShareChatImage!(id, messageId),
    subscribe: callback => api.onShareChatChanged?.(callback),
    openLink: url => {
      if (!options.openUrl) { showError("Link opening is unavailable."); return; }
      const bounds = root.getBoundingClientRect();
      void options.openUrl({ url, sourceId: "boatyard-share-chat", sourceLabel: "Share chat",
        sourceBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } });
    },
    unread: count => { const badge = root.querySelector<HTMLElement>(".share-chat-badge")!; badge.hidden = !count; badge.textContent = count > 99 ? "99+" : String(count); alerts.messages = count; options.onAlertsChanged?.({ ...alerts }); }
  }) : undefined;
  const statuses: Record<Mode, UnknownRecord> = { share: {}, remote: {} };
  const revisions = { share: 0, remote: 0 };
  let disposed = false, busy = false, loaded = false;
  const rows = new Map<string, { root: HTMLLIElement; text: HTMLElement; voice: HTMLElement; mute: HTMLButtonElement; floor: HTMLButtonElement; revoke: HTMLButtonElement; disconnect: HTMLButtonElement; urls: HTMLElement; rendered?: string }>();
  const form = root.querySelector<HTMLFormElement>("[data-invite]")!;
  const label = form.elements.namedItem("label") as HTMLInputElement;
  const list = root.querySelector<HTMLUListElement>('[data-share-panel="session"] .remote-client-list')!;
  const invitations = root.querySelector<HTMLUListElement>("[data-invitations]")!;
  const error = root.querySelector<HTMLElement>("[role=alert]")!;
  const hostMic = root.querySelector<HTMLButtonElement>("[data-mic]")!;
  const screen = root.querySelector<HTMLButtonElement>("[data-screen]")!;
  const projectList = root.querySelector<HTMLElement>("[data-project-list]")!;
  const projectSearch = root.querySelector<HTMLInputElement>("[data-project-search]")!;
  let projects: { id: string; name: string; key: string; group?: string }[] = [];
  const projectControls = new Map<string, HTMLInputElement>();
  const groups = new Map<string, { root: HTMLDetailsElement; input: HTMLInputElement; title: HTMLElement; list: HTMLElement; openBeforeSearch?: boolean }>();
  const stop = root.querySelector<HTMLButtonElement>("[data-stop]")!;
  const start = root.querySelector<HTMLButtonElement>("[data-start]")!;
  const muteAll = root.querySelector<HTMLButtonElement>("[data-mute-all]")!;
  const allowAll = root.querySelector<HTMLButtonElement>("[data-allow-all]")!;
  const audioMode = root.querySelector<HTMLSelectElement>("[data-audio-mode]")!;
  const microphoneDevice = root.querySelector<HTMLSelectElement>("[data-microphone-device]")!;
  let microphoneOptions = "";
  let microphoneLoading = Boolean(api.prepareHostMicrophones);
  const nextQuestion = root.querySelector<HTMLButtonElement>("[data-next-question]")!;
  const endTurn = root.querySelector<HTMLButtonElement>("[data-end-turn]")!;
  iconAction(muteAll, "usersMuted", "Mute all participants");
  iconAction(allowAll, "users", "Allow all participants");
  iconAction(nextQuestion, "nextTurn", "Next question");
  iconAction(endTurn, "endTurn", "End turn");
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
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input:not([data-project-search]), button:not([role=tab]):not(.share-pin)").forEach(control => { control.disabled = busy || !loaded; });
    renderAdmission(share);
    stop.disabled = busy || !share.listening && !share.enabled;
    start.hidden = share.listening === true;
    stop.hidden = !share.listening && !share.enabled;
    const connected = Number(share.connectedClients || 0) + Number(statuses.remote.connectedClients || 0);
    root.querySelector<HTMLElement>("[data-voice-controls]")!.hidden = compact && !connected;
    const hostMuted = statuses.share.listening ? statuses.share.hostMuted !== false : statuses.remote.hostMuted !== false;
    iconAction(hostMic, hostMuted ? "micOff" : "mic", hostMuted ? "Unmute my microphone" : "Mute my microphone");
    hostMic.setAttribute("aria-pressed", String(!hostMuted)); hostMic.disabled = busy || !connected;
    muteAll.disabled = allowAll.disabled = busy || !statuses.share.listening && !statuses.remote.listening;
    const conference = statuses.share.listening ? share : statuses.remote;
    const microphone = toUnknownRecord(conference.hostMicrophone);
    const selectedDevice = String(microphone.deviceId || "");
    const devices = Array.isArray(microphone.devices) ? microphone.devices.map(toUnknownRecord) : [];
    const unavailable = Boolean(selectedDevice) && !devices.some(device => device.deviceId === selectedDevice);
    const optionsKey = JSON.stringify([devices, unavailable ? selectedDevice : ""]);
    if (optionsKey !== microphoneOptions) {
      microphoneDevice.replaceChildren(new Option("System default", ""));
      for (const device of devices) if (device.deviceId !== "default") microphoneDevice.append(new Option(String(device.label), String(device.deviceId)));
      if (unavailable) microphoneDevice.append(new Option("Selected microphone (unavailable)", selectedDevice));
      microphoneOptions = optionsKey;
    }
    microphoneDevice.value = selectedDevice;
    microphoneDevice.disabled = busy || !loaded || microphoneLoading;
    root.querySelector<HTMLElement>("[data-microphone-hint]")!.textContent = microphoneLoading ? "Loading microphones…"
      : unavailable ? "The selected microphone is unavailable. Choose another device to speak."
      : "Shared by Share and Remote. Choosing a device keeps a muted microphone off.";
    const currentMode = String(conference.audioMode || "open-discussion");
    audioMode.value = currentMode;
    audioMode.disabled = busy || !loaded || !statuses.share.listening && !statuses.remote.listening;
    root.querySelector<HTMLElement>("[data-audio-mode-hint]")!.textContent = currentMode === "speaker-only"
      ? "Participants listen and may raise their hand. Give the floor for a question at any time."
      : currentMode === "qa" ? "Take questions from the hand queue, one participant at a time."
      : "Participants may mute or unmute themselves and speak freely.";
    nextQuestion.hidden = currentMode !== "qa";
    root.querySelector<HTMLElement>("[data-turn-divider]")!.hidden = currentMode === "open-discussion";
    endTurn.hidden = currentMode === "open-discussion";
    const ids = new Set<string>();
    let floorLabel = "", allowedCount = 0;
    let waitingCount = 0;
    const participants: { root: HTMLLIElement; rank: number }[] = [];
    for (const mode of ["share", "remote"] as const) {
      const clients = Array.isArray(statuses[mode].clients) ? (statuses[mode].clients as unknown[]).map(toUnknownRecord) : [];
      for (const client of clients) {
        const id = String(client.id), voice = toUnknownRecord(client.voice), connected = client.state === "connected";
        if (connected && voice.allowed === true) allowedCount++;
        if (connected && voice.hasFloor === true) floorLabel = String(client.label || "Unnamed participant");
        if (connected && typeof voice.handRaised === "number") waitingCount++;
        for (const invitation of mode === "share" ? [false, true] : [false]) {
          if (!invitation && client.state === "invited") continue;
          const key = `${mode}:${id}:${invitation}`; ids.add(key);
          let row = rows.get(key);
          if (!row) {
            const item = document.createElement("li"), heading = document.createElement("div"), text = document.createElement("span"), voice = document.createElement("span"), mute = document.createElement("button"), floor = document.createElement("button"), revoke = document.createElement("button"), disconnect = document.createElement("button"), urls = document.createElement("div");
            item.className = "remote-client-row"; item.dataset.clientId = id; heading.className = "remote-client-heading"; urls.className = "remote-urls";
            voice.className = "remote-client-voice"; voice.setAttribute("role", "img");
            for (const button of [mute, floor, revoke, disconnect]) { button.type = "button"; button.className = "secondary-button"; }
            floor.dataset.clientAction = "floor";
            floor.onclick = () => { void run(() => controlConference(mode, { floor: id })); };
            revoke.textContent = "Revoke"; revoke.dataset.clientAction = "revoke"; mute.dataset.clientAction = "mute"; revoke.hidden = mode !== "share";
            mute.onclick = () => { void run(async () => {
              if (!api.setRemoteVoiceAllowed) throw new Error("Voice controls are unavailable.");
              const current = (statuses[mode].clients as unknown[]).map(toUnknownRecord).find(value => value.id === id);
              await mutate(mode, () => api.setRemoteVoiceAllowed!(mode, id, toUnknownRecord(current?.voice).allowed !== true));
            }); };
            revoke.onclick = () => { void run(async () => { if (!api.revokeShareClient) throw new Error("Client management is unavailable."); await mutate("share", () => api.revokeShareClient!(id)); }); };
            disconnect.dataset.clientAction = "disconnect";
            disconnect.onclick = () => { void run(async () => { if (!api.disconnectRemoteClient) throw new Error("Client management is unavailable."); await mutate(mode, () => api.disconnectRemoteClient!(mode, id)); }); };
            heading.append(text, voice, floor, mute, disconnect, revoke); item.append(heading, urls); (invitation ? invitations : list).append(item);
            row = { root: item, text, voice, mute, floor, revoke, disconnect, urls }; rows.set(key, row);
          }
          const route = client.route === "direct" ? "Direct" : client.route === "relay" ? "Relayed" : "Checking connection…";
          row.root.dataset.clientState = String(client.state);
          row.text.textContent = `${client.label || "Unnamed participant"} · ${mode === "remote" ? "Remote · " : ""}${connected ? `Connected · ${route}` : client.state === "invited" ? "Invited" : client.state === "connecting" ? "Connecting…" : "Waiting to connect…"}`;
          row.text.title = row.text.textContent;
          const microphoneOff = voice.allowed === false || voice.selfMuted !== false;
          const microphoneLabel = `${voice.hasFloor ? "Has the floor · " : ""}${microphoneOff ? "Microphone off" : "Microphone on"}${voice.allowed === false ? " · Blocked by host" : ""}`;
          row.voice.replaceChildren(createToolIcon(microphoneOff ? "micOff" : "mic"));
          row.voice.title = microphoneLabel; row.voice.setAttribute("aria-label", microphoneLabel);
          row.voice.dataset.muted = String(microphoneOff);
          row.voice.dataset.blocked = String(voice.allowed === false);
          row.root.classList.toggle("has-floor", voice.hasFloor === true);
          const handRaised = connected && typeof voice.handRaised === "number";
          row.root.classList.toggle("hand-raised", !invitation && handRaised);
          iconAction(row.floor, "hand", `Give the floor to ${client.label || "Unnamed participant"}`);
          row.floor.hidden = invitation || !handRaised; row.floor.disabled = busy;
          if (!invitation) participants.push({ root: row.root, rank: handRaised ? Number(voice.handRaised) : Infinity });
          row.voice.hidden = invitation || !connected;
          iconAction(row.mute, voice.allowed === false ? "micOff" : "mic", `${voice.allowed === false ? "Allow microphone" : "Mute"}: ${client.label || "Unnamed participant"}`);
          row.mute.dataset.allowed = String(voice.allowed !== false);
          iconAction(row.revoke, "trash", `Revoke: ${client.label || "Unnamed participant"}`);
          row.mute.disabled = busy || !connected; row.mute.hidden = invitation || !connected; row.revoke.disabled = busy; row.revoke.hidden = !invitation;
          iconAction(row.disconnect, "unplug", `Disconnect: ${client.label || "Unnamed participant"}`);
          row.disconnect.hidden = invitation || !connected; row.disconnect.disabled = busy;
          row.urls.hidden = !invitation;
          const links = invitation && Array.isArray(client.urls) ? client.urls.map(String) : [];
          const rendered = JSON.stringify([links, client.code]);
          if (invitation && row.rendered !== rendered) { row.urls.replaceChildren(); appendRemoteConnectionLinks(row.urls, links, api, showError, { hideFragment: true, code: String(client.code || "") }); row.rendered = rendered; }
        }
      }
    }
    for (const [id, row] of rows) if (!ids.has(id)) { row.root.remove(); rows.delete(id); }
    root.querySelector<HTMLElement>("[data-session-empty]")!.hidden = participants.length > 0;
    for (const [index, participant] of participants.sort((a, b) => a.rank - b.rank).entries()) {
      if (list.children[index] !== participant.root) list.moveBefore(participant.root, list.children[index] || null);
    }
    alerts.requests = Array.isArray(toUnknownRecord(share.shareAccess).requests) ? (toUnknownRecord(share.shareAccess).requests as unknown[]).length : 0;
    alerts.hands = waitingCount;
    options.onAlertsChanged?.({ ...alerts });
    nextQuestion.disabled = busy || !waitingCount;
    endTurn.disabled = busy || !floorLabel;
    root.querySelector<HTMLElement>("[data-floor-status]")!.textContent = `${floorLabel ? `${floorLabel} has the floor. ` : ""}${allowedCount} participant${allowedCount === 1 ? "" : "s"} allowed to speak.${currentMode !== "open-discussion" && allowedCount > 1 ? " Manual permissions override this mode." : ""}`;
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
    selectedTab = tab.dataset.shareTab as ShareTab;
    chat?.setVisible(paneVisible && selectedTab === "chat");
    options.onTabChanged?.(selectedTab);
    if (tab.dataset.shareTab === "projects") refreshProjects();
  }
  root.setShareVisible = visible => { if (visible === paneVisible) return; paneVisible = visible; chat?.setVisible(visible && selectedTab === "chat"); };
  root.selectShareTab = (name, section) => {
    if (name !== selectedTab) selectTab(tabs.find(tab => tab.dataset.shareTab === name)!);
    if (section) {
      const target = root.querySelector<HTMLElement>(section === "requests" ? "[data-join-queue]" : "[data-share-panel=session] .hand-raised")!;
      if (!target) return;
      target.scrollIntoView({ block: "nearest" });
      target.querySelector<HTMLButtonElement>(section === "hands" ? "[data-client-action=floor]" : "button")?.focus({ preventScroll: true });
    }
  };
  for (const [index, tab] of tabs.entries()) {
    tab.onclick = () => selectTab(tab);
    tab.onkeydown = event => {
      const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : undefined;
      if (next) { event.preventDefault(); selectTab(next); next.focus(); }
    };
  }
  refreshProjects();
  hostMic.onclick = () => { void run(async () => {
    if (!api.setHostMicrophoneMuted) throw new Error("Microphone controls are unavailable.");
    const mode = statuses.share.listening ? "share" : "remote";
    const muted = statuses[mode].hostMuted === false;
    await mutate(mode, () => api.setHostMicrophoneMuted!(mode, muted));
  }); };
  function all(allowed: boolean) { void run(async () => {
    if (!api.setRemoteVoiceAllowed) throw new Error("Voice controls are unavailable.");
    for (const mode of ["share", "remote"] as const) if (statuses[mode].listening) await mutate(mode, () => api.setRemoteVoiceAllowed!(mode, null, allowed));
  }); }
  muteAll.onclick = () => all(false); allowAll.onclick = () => all(true);
  async function controlConference(mode: Mode, action: { audioMode: RemoteAudioMode } | { floor: string | null }) {
    if (!api.controlRemoteConference) throw new Error("Conference controls are unavailable.");
    await mutate(mode, () => api.controlRemoteConference!(mode, action));
  }
  const conferenceService = (): Mode => statuses.share.listening ? "share" : "remote";
  microphoneDevice.onchange = () => { const deviceId = microphoneDevice.value; void run(async () => {
    if (!api.setHostMicrophoneDevice) throw new Error("Microphone selection is unavailable.");
    const mode = conferenceService();
    await mutate(mode, () => api.setHostMicrophoneDevice!(mode, deviceId));
  }); };
  audioMode.onchange = () => { const selected = audioMode.value as RemoteAudioMode; void run(async () => {
    await controlConference(conferenceService(), { audioMode: selected });
  }); };
  endTurn.onclick = () => { void run(() => controlConference(conferenceService(), { floor: null })); };
  nextQuestion.onclick = () => { void run(async () => {
    const waiting = (["share", "remote"] as const).flatMap(mode => (Array.isArray(statuses[mode].clients) ? statuses[mode].clients as unknown[] : [])
      .map(toUnknownRecord).filter(client => client.state === "connected" && typeof toUnknownRecord(client.voice).handRaised === "number")
      .map(client => ({ mode, id: String(client.id), rank: Number(toUnknownRecord(client.voice).handRaised) }))).sort((a, b) => a.rank - b.rank);
    if (waiting[0]) await controlConference(waiting[0].mode, { floor: waiting[0].id });
  }); };
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
  const microphoneRevision = revisions.share;
  void api.prepareHostMicrophones?.("share").then(value => { if (microphoneRevision === revisions.share) apply("share", value); }).catch(showError).finally(() => {
    microphoneLoading = false; if (!disposed) render();
  });
  let unsubscribePin: (() => void) | undefined;
  root.boatyardCleanup = () => { disposed = true; unsubscribePin?.(); chat?.dispose(); subscriptions.forEach(unsubscribe => unsubscribe?.()); };
  render();
  if (options.sidebarPin) {
    const pin = document.createElement("button"); pin.type = "button"; pin.className = "secondary-button share-pin";
    const renderPin = () => { pin.textContent = options.sidebarPin!.isPinned() ? "Unpin from right sidebar" : "Pin to right sidebar"; pin.setAttribute("aria-pressed", String(options.sidebarPin!.isPinned())); };
    pin.onclick = () => options.sidebarPin!.toggle(); root.prepend(pin); renderPin();
    unsubscribePin = options.sidebarPin.subscribe(renderPin);
  }
  return root;
}
