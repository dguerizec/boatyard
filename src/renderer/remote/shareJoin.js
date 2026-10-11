export function createShareJoin({ api, joined, initialCode }) {
  const $ = id => document.getElementById(id);
  const form = $('shareJoin'), code = $('accessCode'), name = $('participantName'), message = $('shareJoinStatus');
  let settings = {}, requestToken = null, pollTimer, revision = 0, previewRevision = 0, lastPreviewCode = "", busy = false, askMode = false;
  const normalize = value => value.replace(/[\s-]/g, '');
  const format = value => value.replace(/^(\d{3})(\d{3})$/, '$1 $2');
  const saved = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const save = (key, value) => { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* The cookie still authenticates browsers without session storage. */ } };
  try { name.value = localStorage.getItem('boatyard-share-name') || ''; } catch { /* Name entry still works when browser storage is unavailable. */ }
  function rememberName() {
    try { localStorage.setItem('boatyard-share-name', name.value.trim().slice(0, 80)); } catch { /* Storage is optional for joining. */ }
  }
  name.oninput = rememberName;
  code.value = format(initialCode || saved('boatyard-share-code') || '');
  function status(value) { message.textContent = value; message.hidden = !value; }
  function render() {
    const pending = Boolean(requestToken);
    $('shareJoinModes').hidden = !settings.allowJoinRequests;
    $('accessCodeField').hidden = askMode; code.required = !askMode;
    code.disabled = busy || pending || askMode; name.disabled = busy || pending;
    for (const [id, selected] of [['joinWithCode', !askMode], ['joinWithoutCode', askMode]]) {
      $(id).setAttribute('aria-pressed', String(selected)); $(id).disabled = busy || pending;
    }
    $('joinShare').hidden = askMode;
    $('joinShare').disabled = busy || pending;
    $('askToJoin').hidden = !askMode;
    $('askToJoin').textContent = pending ? 'Waiting for approval…' : 'Ask to join';
    $('askToJoin').disabled = busy || pending;
    $('cancelJoinRequest').hidden = !pending;
    $('joinShare').textContent = pending ? 'Waiting for approval…' : 'Join';
  }
  async function preview() {
    const token = normalize(code.value), current = ++previewRevision, originalName = name.value;
    if (askMode || !/^\d{6}$/.test(token) || token === lastPreviewCode) return;
    code.value = format(token);
    try {
      const result = await api('/api/share/preview', { token });
      if (current !== previewRevision || normalize(code.value) !== token || form.hidden || name.value !== originalName) return;
      lastPreviewCode = token;
      if (result.label) name.value = result.label;
      status(result.approvalRequired ? 'The host will approve your request before you join.' : '');
    } catch (error) { if (current === previewRevision && !form.hidden) status(error.message); }
  }
  code.oninput = () => { ++previewRevision; lastPreviewCode = ''; status(''); if (/^\d{6}$/.test(normalize(code.value))) void preview(); };
  code.onchange = () => { void preview(); };
  async function accepted(result, current) {
    if (current !== revision) return;
    requestToken = null; save('boatyard-share-request', null);
    if (result.participant) {
      code.value = format(result.participant.code); name.value = result.participant.label;
      save('boatyard-share-code', result.participant.code);
    }
    form.hidden = true;
    await joined();
  }
  async function poll(current) {
    if (current !== revision || !requestToken) return;
    try {
      const result = await api('/api/share/request-status', { requestToken });
      if (current !== revision) return;
      if (result.authenticated) { await accepted(result, current); return; }
      if (result.declined) {
        requestToken = null; save('boatyard-share-request', null); render(); status('The host declined your request.'); return;
      }
      status('Waiting for the host to approve your request…');
    } catch (error) {
      if (current !== revision) return;
      if (error.status === 410) { requestToken = null; save('boatyard-share-request', null); render(); status(error.message); return; }
      status(`${error.message} Still waiting; you can cancel and try again.`);
    }
    if (current === revision && requestToken) pollTimer = setTimeout(() => { void poll(current); }, 2000);
  }
  async function submit(ask) {
    if (busy || requestToken || !name.reportValidity()) return;
    if (!ask && !code.reportValidity()) return;
    rememberName(); save('boatyard-share-join-mode', ask ? 'ask' : 'code');
    ++previewRevision;
    const current = ++revision; busy = true; render(); status(ask ? 'Sending join request…' : 'Joining…');
    try {
      const result = await api(ask ? '/api/share/request' : '/api/redeem', { token: normalize(code.value), label: name.value });
      if (current !== revision) return;
      if (result.pending) {
        requestToken = result.requestToken; save('boatyard-share-request', requestToken);
        status('Waiting for the host to approve your request…'); pollTimer = setTimeout(() => { void poll(current); }, 1000);
      } else await accepted(result, current);
    } catch (error) { if (current === revision) { form.hidden = false; status(error.message); } }
    finally { if (current === revision) { busy = false; render(); } }
  }
  form.onsubmit = event => { event.preventDefault(); void submit(askMode); };
  function selectMode(ask) {
    if (busy || requestToken) return;
    ++previewRevision; askMode = ask && settings.allowJoinRequests;
    save('boatyard-share-join-mode', askMode ? 'ask' : 'code'); render(); status('');
    if (!askMode) void preview();
  }
  $('joinWithCode').onclick = () => selectMode(false);
  $('joinWithoutCode').onclick = () => selectMode(true);
  $('cancelJoinRequest').onclick = async () => {
    const token = requestToken; ++revision; clearTimeout(pollTimer); requestToken = null; busy = false;
    save('boatyard-share-request', null); render(); status('');
    try { await api('/api/share/request-cancel', { requestToken: token }); } catch (error) { status(error.message); }
  };
  const accessDialog = $('participantAccess');
  $('access').onclick = () => accessDialog.showModal();
  $('closeParticipantAccess').onclick = () => accessDialog.close();
  for (const [id, link] of [['copyPersonalCode', false], ['copyPersonalLink', true]]) $(id).onclick = async () => {
    try {
      const token = normalize($('personalCode').textContent);
      await navigator.clipboard.writeText(link ? `${location.origin}/#share=${token}` : format(token));
      $('personalAccessStatus').textContent = 'Copied';
    } catch {
      if (link) { $('personalLink').focus(); $('personalLink').select(); }
      $('personalAccessStatus').textContent = link ? 'Link selected. Copy it using your browser.' : 'Copy is unavailable. Select and copy your code.';
    }
  };
  window.addEventListener('pagehide', () => { ++revision; clearTimeout(pollTimer); });
  return {
    configure(value) { settings = value; if (!settings.allowJoinRequests) askMode = false; render(); },
    show(value = '') {
      form.hidden = false; status(value); render();
      if (!value && !askMode) void preview();
    },
    resumeRequest() {
      requestToken = saved('boatyard-share-request');
      if (!requestToken) return false;
      askMode = settings.allowJoinRequests && saved('boatyard-share-join-mode') === 'ask';
      form.hidden = false; render(); void poll(++revision); return true;
    },
    participant(value) {
      if (!value) return;
      requestToken = null; save('boatyard-share-request', null);
      code.value = format(value.code); name.value = value.label; rememberName(); save('boatyard-share-code', value.code);
      $('personalName').textContent = value.label; $('personalCode').textContent = format(value.code);
      $('personalLink').value = `${location.origin}/#share=${value.code}`;
      $('personalAccessStatus').textContent = ''; $('access').hidden = false; form.hidden = true;
    },
    hideAccess() { $('access').hidden = true; if (accessDialog.open) accessDialog.close(); }
  };
}
