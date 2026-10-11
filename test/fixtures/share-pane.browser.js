import { createSharePane } from '../../src/renderer/sharePane.js';
import { cleanupPaneLayout } from '../../src/renderer/paneCleanup.js';
import '../../src/renderer/styles.css';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const listeners = { share: new Set(), remote: new Set() };
const state = {
  share: { listening: true, connectedClients: 2, port: 47832, hostMuted: true, urls: ['http://192.0.2.10:47832/', 'http://192.0.2.20:47832/'], clients: [
    { id: 'alice', label: 'Alice', state: 'connected', voice: { allowed: true, selfMuted: true, handRaised: null } },
    { id: 'bob', label: 'Bob', state: 'connected', voice: { allowed: false, selfMuted: true, handRaised: 1 } }
  ] },
  remote: { listening: true, connectedClients: 1, hostMuted: true, clients: [{ id: 'remote', label: 'Remote client', state: 'connected', voice: { allowed: true, selfMuted: true, handRaised: null } }] }
};
const controls = [];
let resolveInitial;
let copied = '';
const bridge = {
  async writeClipboardText(value) { copied = value; },
  async configureShareAccess(patch) {
    state.share.shareAccess = { groupApprovalRequired: true, ...state.share.shareAccess, ...patch, groupCode: '123456', groupUrls: ['http://192.0.2.10:47832/#share=123456', 'http://192.0.2.20:47832/#share=123456'] };
    listeners.share.forEach(listener => listener(state.share)); return state.share;
  },
  async decideShareJoinRequest(id, accepted) {
    controls.push({ id, accepted });
    state.share.shareAccess.requests = state.share.shareAccess.requests.filter(request => request.id !== id);
    listeners.share.forEach(listener => listener(state.share)); return state.share;
  },
  getShareProjects: async () => [{ id: 'one', name: 'Project One', key: 'context:one', group: 'Work' }, { id: 'two', name: 'Project Two', key: 'context:two', group: 'Work' }, { id: 'three', name: 'Project Three', key: 'context:three' }],
  async updateShareScreen(patch) {
    controls.push(patch);
    Object.assign(state.share, patch, patch.sharedProjectIds ? { sharedProjectIds: patch.sharedProjectIds.map(id => `context:${id}`) } : {});
    listeners.share.forEach(listener => listener(state.share)); return state.share;
  },
  getRemoteStatus: mode => mode === 'share' ? new Promise(resolve => { resolveInitial = resolve; }) : Promise.resolve(state.remote),
  onRemoteStatusChanged: (listener, mode) => { listeners[mode].add(listener); return () => listeners[mode].delete(listener); },
  async setRemoteVoiceAllowed(mode, id, allowed) {
    controls.push({ mode, id, allowed });
    for (const client of state[mode].clients) if (id === null || id === client.id) { client.voice.allowed = allowed; if (!allowed) client.voice.selfMuted = true; }
    listeners[mode].forEach(listener => listener(state[mode])); return state[mode];
  },
  async controlRemoteConference(mode, action) {
    controls.push({ mode, ...action });
    for (const service of ['share', 'remote']) {
      if (action.audioMode) state[service].audioMode = action.audioMode;
      for (const client of state[service].clients) {
        if (action.audioMode) { client.voice.allowed = action.audioMode === 'open-discussion'; client.voice.selfMuted = true; client.voice.hasFloor = false; }
        else if (action.floor === null) { if (client.voice.hasFloor) client.voice.allowed = false; client.voice.hasFloor = false; }
        else { client.voice.hasFloor = client.id === action.floor; client.voice.allowed = client.voice.hasFloor; if (client.voice.hasFloor) client.voice.handRaised = null; }
      }
      listeners[service].forEach(listener => listener(state[service]));
    }
    return state[mode];
  },
  async setHostMicrophoneDevice(mode, deviceId) {
    controls.push({ mode, deviceId });
    for (const service of ['share', 'remote']) {
      state[service].hostMicrophone = { ...state[service].hostMicrophone, deviceId };
      listeners[service].forEach(listener => listener(state[service]));
    }
    return state[mode];
  },
  async setHostMicrophoneMuted(mode, muted) { state.share.hostMuted = state.remote.hostMuted = muted; for (const mode of ['share', 'remote']) listeners[mode].forEach(listener => listener(state[mode])); return { ...state[mode], hostMuted: true }; }
};
const pane = createSharePane(bridge); document.body.append(pane); pane.style.width = '300px'; pane.style.height = '600px';
listeners.share.forEach(listener => listener(state.share));
resolveInitial({ listening: false, clients: [], connectedClients: 0 }); await tick();
const session = pane.querySelector('[data-share-panel=session]'), setup = pane.querySelector('[data-share-panel=setup]');
check(!session.hidden && setup.hidden && pane.querySelector('[role=tab]').dataset.shareTab === 'session', 'Session is the first and default tab');
check(session.querySelectorAll('.remote-client-row').length === 3, 'New status wins over stale initial response');
check(!session.querySelector('[data-invite]') && !session.querySelector('.remote-urls button') && !session.querySelector('[data-stop]'), 'Live session excludes invitations, codes and service settings');
check(setup.querySelector('[data-invite]') && setup.querySelector('[data-stop]') && setup.querySelectorAll('.remote-client-row').length === 2, 'Setup owns invitations including connected participants');
check(setup.querySelector('.share-admission').tagName === 'SECTION' && (setup.querySelector('.share-admission').compareDocumentPosition(setup.querySelector('[data-invite]')) & Node.DOCUMENT_POSITION_FOLLOWING), 'Joining options stay expanded above participant name');
check([...setup.querySelectorAll('.share-admission input')].every(input => input.getAttribute('role') === 'switch'), 'Joining controls reuse accessible switches');
check(setup.querySelector('[data-group-approval]').checked, 'Approval is selected before a sharing session starts');
const alice = pane.querySelector('[data-client-id=alice]'), bob = pane.querySelector('[data-client-id=bob]');
check(bob.querySelector('.remote-client-voice').title.includes('Blocked by host') && !bob.querySelector('[data-client-action=floor]').hidden, 'Microphone status and the waiting action remain accessible');
check(!bob.textContent.includes('Hand #') && !alice.textContent.includes('Allowed to speak') && !alice.textContent.includes('Microphone off'), 'Compact participant rows omit redundant status text');
const microphoneStatus = alice.querySelector('.remote-client-voice');
check(microphoneStatus.querySelector('svg') && microphoneStatus.closest('.remote-client-heading') && microphoneStatus.getAttribute('aria-label') === 'Microphone off', 'The microphone state is an accessible icon on the participant line');
pane.querySelector('[data-share-tab=setup]').click();
const groupSwitches = [...setup.querySelectorAll('.share-group-options .switch-row')].map(row => row.getBoundingClientRect());
check(groupSwitches.length === 2 && groupSwitches[0].top === groupSwitches[1].top && groupSwitches[1].right <= setup.getBoundingClientRect().right + 1, 'Both group options share one row even in a narrow pane');
check([...setup.querySelectorAll('.share-admission .switch-row')].every(row => getComputedStyle(row).borderTopWidth === '0px'), 'Joining switches have no surrounding borders');
const name = pane.querySelector('input[name=label]'); name.value = 'Draft invitation'; name.focus();
state.share.clients[0].voice.handRaised = 2; listeners.share.forEach(listener => listener(state.share));
check(pane.querySelector('[data-client-id=alice]') === alice && document.activeElement === name && name.value === 'Draft invitation', 'Updates preserve rows, focus and draft');
pane.querySelector('[data-share-tab=session]').click();
check([...session.querySelectorAll('.remote-client-row')].map(row => row.dataset.clientId).join() === 'bob,alice,remote', 'Participants with raised hands appear first in queue order');
check(!pane.querySelector('.remote-speaking-queue') && session.querySelectorAll('[data-client-id=bob]').length === 1, 'Each participant appears only once in the merged list');
bob.querySelector('[data-client-action=mute]').click(); await tick();
check(bob.classList.contains('hand-raised') && session.querySelector('.remote-client-row') === bob && state.share.clients[1].voice.handRaised === 1, 'Restoring microphone permission leaves the participant at the front of the hand queue');
session.querySelector('.hand-raised [data-client-action=floor]').click(); await tick();
check(controls.at(-1).floor === 'bob' && state.share.clients[1].voice.selfMuted, 'Allow microphone keeps personal mute');
check(!bob.classList.contains('hand-raised') && bob.querySelector('[data-client-action=floor]').hidden && session.querySelector('.remote-client-row') === alice, 'Giving the floor clears the hand and moves the next waiting participant to the top');
pane.querySelector('[data-mute-all]').click(); await tick();
check(controls.slice(-2).every(control => control.id === null && !control.allowed), 'Collective mute includes Share and Remote');
pane.querySelector('[data-allow-all]').click(); await tick();
check(state.share.clients.every(client => client.voice.selfMuted), 'Allow all does not start microphones');
pane.querySelector('[data-mic]').click(); await tick();
check(pane.querySelector('[data-mic]').textContent === 'Mute my microphone', 'Host microphone updates from authoritative state');
check(pane.scrollWidth <= pane.clientWidth, 'Narrow pane wraps participant controls');
pane.querySelector('[data-screen]').click(); await tick();
check(state.share.screenHidden === true && pane.querySelector('[data-screen]').title.startsWith('Show screen'), 'Hide screen updates live status');
check(pane.querySelector('[data-share-panel=projects]').hidden, 'Projects start in a separate hidden tab');
pane.querySelector('[data-share-tab=projects]').click(); await tick();
check(session.hidden && setup.hidden, 'Projects tab hides both session and setup controls');
const group = pane.querySelector('[data-project-group="Work"]');
const groupToggle = group.querySelector('summary input');
check(pane.querySelector('[data-project-group=""]'), 'Projects without a group have their own section');
check([...pane.querySelectorAll('.share-project-group')].every(group => !group.open), 'All project groups start collapsed');
group.querySelector('summary').click();
check(group.open, 'Groups can be expanded manually');
const project = pane.querySelector('[data-project-id=one]'); project.click(); await tick();
check(state.share.sharedProjectIds.join() === 'context:one' && project.checked, 'Selecting a project saves without losing the toggle');
check(groupToggle.indeterminate && !groupToggle.checked, 'Group indicates partially shared projects');
group.open = false;
groupToggle.click(); await tick();
check(!group.open && groupToggle.checked && !groupToggle.indeterminate, 'Group enable preserves collapsed state');
check(state.share.sharedProjectIds.join() === 'context:one,context:two', 'Group enable affects only its members');
pane.querySelector('[data-project-id=three]').click(); await tick();
groupToggle.click(); await tick();
check(state.share.sharedProjectIds.join() === 'context:three', 'Group disable preserves other groups');
check(!group.open && !groupToggle.checked && !groupToggle.indeterminate, 'Updates preserve folding and group state');
check(!pane.querySelector('[data-share-panel=projects]').hidden, 'Status updates preserve the selected tab');
const search = pane.querySelector('[data-project-search]');
const setSearch = value => { search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })); };
search.focus(); setSearch('  pRoJeCt OnE  ');
check(group.open && !group.hidden && pane.querySelector('[data-project-group=""]').hidden, 'Search opens matching groups and hides unrelated groups');
check(!project.parentElement.hidden && pane.querySelector('[data-project-id=two]').parentElement.hidden, 'Search filters projects case-insensitively');
listeners.share.forEach(listener => listener(state.share));
check(document.activeElement === search && search.value === '  pRoJeCt OnE  ', 'Live updates preserve search and focus');
groupToggle.click(); await tick();
check(state.share.sharedProjectIds.join() === 'context:one,context:two,context:three', 'Filtered group toggle still includes every member and preserves other groups');
setSearch('work');
check(!pane.querySelector('[data-project-id=two]').parentElement.hidden, 'Group names match all their projects');
setSearch('missing');
check(!pane.querySelector('[data-project-empty]').hidden && [...pane.querySelectorAll('.share-project-group')].every(group => group.hidden), 'Search reports no results');
setSearch('');
check(!group.open && !group.hidden && !project.parentElement.hidden && pane.querySelector('[data-project-empty]').hidden, 'Clearing search restores folding and all projects');
check(state.share.sharedProjectIds.length === 3, 'Searching does not change sharing permissions');
const projectsTab = pane.querySelector('[data-share-tab=projects]');
projectsTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
check(!setup.hidden && name.value === 'Draft invitation', 'Keyboard tab switching preserves invitation draft');
pane.querySelector('[data-share-tab=setup]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
check(!session.hidden && setup.hidden, 'Home returns to the default session tab');
listeners.share.forEach(listener => listener({ ...state.share, screenHidden: false }));
check(pane.querySelector('[data-screen]').title.startsWith('Hide screen'), 'A hotkey status update refreshes the button');
pane.querySelector('[data-share-tab=setup]').click();
pane.querySelector('[data-group-enabled]').click(); await tick();
check(state.share.shareAccess.groupEnabled && !pane.querySelector('[data-group-approval]').disabled, 'Group admission enables its approval option');
check(state.share.shareAccess.groupApprovalRequired && pane.querySelector('[data-group-approval]').checked, 'Group entry starts with approval selected');
pane.querySelector('[data-group-approval]').click(); await tick();
check(!state.share.shareAccess.groupApprovalRequired && !pane.querySelector('[data-group-approval]').checked, 'The host can disable default approval');
listeners.share.forEach(listener => listener(state.share));
check(!pane.querySelector('[data-group-approval]').checked, 'Status updates preserve the explicit opt-out');
pane.querySelector('[data-group-approval]').click(); await tick();
const links = pane.querySelector('[data-admission-links]');
check(links.querySelectorAll('.remote-url-selector').length === 1 && links.querySelectorAll('button').length === 2 && (pane.querySelector('[data-join-requests]').parentElement.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING), 'Both admission modes share one URL row beneath the switches');
links.querySelector('[data-copy-code]').click(); await tick();
check(copied === '123 456' && !links.textContent.includes('123456'), 'Group codes can be copied without exposing them in the shared screen');
links.querySelector('select').value = '1'; links.querySelector('select').dispatchEvent(new Event('change'));
links.querySelector('button').click(); await tick();
check(copied === 'http://192.0.2.20:47832/#share=123456', 'The shared URL row copies the full group invitation');
pane.querySelector('[data-join-requests]').click(); await tick();
check(state.share.shareAccess.allowJoinRequests, 'The host can allow requests without a code');
check(!state.share.shareAccess.groupEnabled && !pane.querySelector('[data-group-enabled]').checked && pane.querySelector('[data-group-approval]').disabled, 'Ask to join disables group entry atomically');
check(links.querySelector('[data-copy-code]').disabled && links.querySelector('select').value === '1', 'Ask to join keeps the selected address and disables Copy code');
links.querySelector('button').click(); await tick();
check(copied === 'http://192.0.2.20:47832/' && links.querySelector('a').href === copied, 'Open and Copy URL use the code-free address for Ask to join');
links.querySelector('[data-copy-code]').click(); await tick();
check(copied === 'http://192.0.2.20:47832/' && links.querySelector('[data-copy-code]').disabled, 'Disabled code copying cannot copy an old group code');
pane.querySelector('[data-group-enabled]').click(); await tick();
check(state.share.shareAccess.groupEnabled && !state.share.shareAccess.allowJoinRequests && !pane.querySelector('[data-join-requests]').checked, 'Group entry disables Ask to join atomically');
check(!links.querySelector('[data-copy-code]').disabled && links.querySelector('select').value === '1', 'Switching back enables code copying and preserves the address');
pane.querySelector('[data-join-requests]').click(); await tick();
state.share.shareAccess.requests = [{ id: 'request-one', label: 'Carol' }, { id: 'request-two', label: 'Dave' }];
listeners.share.forEach(listener => listener(state.share));
const requestRow = pane.querySelector('[data-request-id=request-one]');
check(requestRow.textContent.includes('Carol wants to join'), 'Requests identify their participant');
check(session.contains(requestRow) && !setup.contains(requestRow), 'Access approvals belong to the live session');
name.focus(); name.value = 'Keep this draft';
listeners.share.forEach(listener => listener(state.share));
check(pane.querySelector('[data-request-id=request-one]') === requestRow && document.activeElement === name, 'Request updates preserve identity and input focus');
pane.querySelector('[data-share-tab=session]').click();
requestRow.querySelector('button').click(); await tick();
check(controls.at(-1).accepted === true && !pane.querySelector('[data-request-id=request-one]'), 'Accept removes the handled request');
pane.querySelector('[data-request-id=request-two] button:last-child').click(); await tick();
check(controls.at(-1).accepted === false && pane.querySelector('[data-join-queue]').hidden, 'Decline clears the final pending request');

const audioMode = pane.querySelector('[data-audio-mode]');
const selectAudioMode = async value => { audioMode.value = value; audioMode.dispatchEvent(new Event('change')); await tick(); };
state.share.clients[0].voice.handRaised = 2;
state.remote.clients[0].voice.handRaised = 1;
await selectAudioMode('speaker-only');
check(state.share.clients.every(client => !client.voice.allowed) && state.remote.clients.every(client => !client.voice.allowed), 'Speaker only applies across both services');
check(state.share.clients[0].voice.handRaised === 2 && pane.querySelector('[data-next-question]').hidden, 'Conference keeps raised hands without Q&A controls');
session.querySelector('.hand-raised [data-client-action=floor]').click(); await tick();
check(state.remote.clients[0].voice.hasFloor && audioMode.value === 'speaker-only', 'A conference interruption gives the floor without changing mode');
pane.querySelector('[data-allow-all]').click(); await tick();
check(audioMode.value === 'speaker-only' && pane.querySelector('[data-floor-status]').textContent.includes('Manual permissions override'), 'Collective moderation overrides the mode visibly');
state.share.clients[0].voice.handRaised = 1;
await selectAudioMode('qa');
check(!pane.querySelector('[data-next-question]').hidden && !pane.querySelector('[data-next-question]').disabled, 'Q&A exposes the next waiting question');
pane.querySelector('[data-next-question]').click(); await tick();
check(state.share.clients[0].voice.hasFloor && !state.remote.clients[0].voice.allowed, 'Next question consumes the remaining hand across services');
check(pane.querySelector('[data-client-id=alice]').classList.contains('has-floor'), 'The current floor holder is highlighted');
pane.querySelector('[data-end-turn]').click(); await tick();
check(!state.share.clients[0].voice.allowed && pane.querySelector('[data-end-turn]').disabled, 'Ending the turn blocks its holder');
await selectAudioMode('open-discussion');
check(state.share.clients.every(client => client.voice.allowed && client.voice.selfMuted), 'Discussion permits speech without starting microphones');
const audioButtons = [...pane.querySelectorAll('[data-voice-controls] button')].filter(button => !button.hidden);
check(audioButtons.every(button => button.querySelector('svg') && button.title && button.getAttribute('aria-label')), 'Icon controls have tooltips and accessible names');
check(audioButtons.every(button => Math.round(button.getBoundingClientRect().width) === 34 && Math.round(button.getBoundingClientRect().height) === 34), 'Microphone controls use matching square sizes');
check(pane.scrollWidth <= pane.clientWidth, 'Audio modes fit the narrow pane');

const microphoneDevice = pane.querySelector('[data-microphone-device]');
state.share.hostMicrophone = { deviceId: '', devices: [{ deviceId: 'default', label: 'Default microphone' }, { deviceId: 'desk', label: 'Desk microphone' }, { deviceId: 'headset', label: 'Headset' }] };
listeners.share.forEach(listener => listener(state.share));
check(microphoneDevice.options.length === 3 && microphoneDevice.options[0].textContent === 'System default', 'Microphones include one system default and named physical devices');
state.share.hostMuted = state.remote.hostMuted = true;
microphoneDevice.value = 'desk'; microphoneDevice.dispatchEvent(new Event('change')); await tick();
check(state.share.hostMicrophone.deviceId === 'desk' && state.remote.hostMicrophone.deviceId === 'desk' && state.share.hostMuted, 'Selecting a microphone updates shared state without enabling capture');
microphoneDevice.focus();
state.share.hostMicrophone.devices = state.share.hostMicrophone.devices.filter(device => device.deviceId !== 'desk');
listeners.share.forEach(listener => listener(state.share));
check(microphoneDevice.value === 'desk' && microphoneDevice.selectedOptions[0].textContent.includes('unavailable') && document.activeElement === microphoneDevice, 'An unplugged selection remains explicit and keeps focus');
check(pane.querySelector('[data-microphone-hint]').textContent.includes('unavailable'), 'Missing devices have a visible explanation');
microphoneDevice.value = ''; microphoneDevice.dispatchEvent(new Event('change')); await tick();
check(state.share.hostMicrophone.deviceId === '' && state.share.hostMuted, 'System default can be selected without unmuting');
check(pane.scrollWidth <= pane.clientWidth, 'The microphone selector fits a narrow pane');
state.share.listening = state.remote.listening = false;
state.share.connectedClients = state.remote.connectedClients = 0;
state.share.clients = state.remote.clients = [];
state.remote.hostMicrophone.devices = state.share.hostMicrophone.devices;
for (const mode of ['share', 'remote']) listeners[mode].forEach(listener => listener(state[mode]));
check(!microphoneDevice.disabled, 'The host can prepare a microphone with both services stopped and no participants');
microphoneDevice.value = 'headset'; microphoneDevice.dispatchEvent(new Event('change')); await tick();
check(state.share.hostMicrophone.deviceId === 'headset' && state.remote.hostMicrophone.deviceId === 'headset', 'Idle selection remains shared');
check(!state.share.listening && !state.remote.listening && state.share.hostMuted, 'Idle selection starts neither a session nor a capture');
cleanupPaneLayout(pane);
check(listeners.share.size === 0 && listeners.remote.size === 0, 'Disposed pane releases both subscriptions');
window.browserTestResult = 'passed';
