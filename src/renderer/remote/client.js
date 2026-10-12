import { startShareChatClient } from "./shareChatClient.js";
import { remoteFrameFooterHeight, readRemoteFrameMetadata } from "../../shared/remoteFrameMetadata.js";
import { calculateHugescreenPan } from "../../shared/hugescreenPan.js";
import { HugescreenMotion } from "../../shared/hugescreenMotion.js";
import { remotePeerConfiguration, waitForRemoteIce, TURN_CREDENTIAL_RENEWAL_MS } from "../../shared/remoteIce.js";
import { createToolIcon } from "../toolIcons.js";
import { startRemoteClientUpdates } from "./clientUpdates.js";
import { startRemoteDiagnostics } from "./diagnostics.js";
import { RemoteConnectionRecovery, preferLowLatency } from './recovery.js';
import { createShareJoin } from "./shareJoin.js";
import { requestRemoteApi } from "./api.js";
import { openMicrophone } from './microphone.js';

(() => {
  const $ = id => document.getElementById(id);
  document.querySelectorAll('[data-icon]').forEach(button => button.replaceChildren(createToolIcon(button.dataset.icon)));
  window.addEventListener("pagehide", () => closeChat());
  window.addEventListener("pageshow", event => { if (event.persisted && authenticated) void loadWindows().catch(error => status(error.message)); });
  const surface = $('surface'), video = $('video'), frame = $('frame');
  function resizeViewer() {
    const visible = window.visualViewport;
    document.body.style.setProperty('--viewer-height', `${visible?.height ?? window.innerHeight}px`);
    document.body.style.setProperty('--viewer-top', `${visible?.offsetTop ?? 0}px`);
  }
  window.visualViewport?.addEventListener('resize', resizeViewer);
  window.visualViewport?.addEventListener('scroll', resizeViewer);
  window.addEventListener('resize', resizeViewer);
  resizeViewer();
  const frameContext = frame.getContext('2d', { alpha: false });
  const frameBuffer = document.createElement('canvas'), bufferContext = frameBuffer.getContext('2d', { willReadFrequently: true });
  const viewports = new Map();
  let frameTimer, frameCallback, pointerViewport, iceRenewalTimer;
  let authenticated = false, readOnly = false, iceServers = [], iceTransportPolicy = "all", peer, channel, sessionId, viewport, full, requested, revision = 0;
  let generation = 0, viewTimer, lastMove, moveFrame;
  let reconnectTimer, reconnectEpoch = 0;
  const remembered = key => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const remember = (key, value) => { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* Reconnection still works within this page when storage is unavailable. */ } };
  let reconnectWanted = remembered('boatyard-stream-active') === 'true';
  function cancelReconnect(clearIntent = true) {
    ++reconnectEpoch; clearTimeout(reconnectTimer); reconnectTimer = null;
    if (clearIntent) { reconnectWanted = false; remember('boatyard-stream-active', null); }
  }
  function retryConnection() {
    if (!reconnectWanted || peer || reconnectTimer) return;
    const epoch = reconnectEpoch;
    status('Waiting for Boatyard to reconnect…');
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (epoch !== reconnectEpoch || !reconnectWanted) return;
      closeChat();
      try { if (await loadWindows(true)) return; }
      catch (error) {
        if (epoch === reconnectEpoch) {
          status(error.message);
          if (error.status === 401) {
            cancelReconnect();
            if (!passwordLogin) shareJoin.show(error.message);
          }
        }
      }
      if (epoch === reconnectEpoch) retryConnection();
    }, 1500);
  }
  const voiceAudio = $('voiceAudio');
  let microphone = null, audioSender = null, voiceAllowed = false, selfMuted = true, handRaised = null, microphoneBusy = false, voiceError = "", microphoneRequest = 0, audioMode = 'open-discussion', hasFloor = false;
  let microphoneCapture = null;
  function renderVoice() {
    const connected = channel?.readyState === 'open';
    $('microphone').disabled = !connected || (selfMuted && !voiceAllowed && handRaised === null) || microphoneBusy;
    $('microphone').replaceChildren(createToolIcon(selfMuted ? 'micOff' : 'mic'));
    if (connected && !voiceAllowed) {
      const lock = createToolIcon('lock'); lock.classList.add('microphone-lock'); $('microphone').append(lock);
    }
    $('microphone').setAttribute('aria-pressed', String(!selfMuted));
    const action = selfMuted ? 'Unmute microphone' : 'Mute microphone';
    const modeLabel = audioMode === 'speaker-only' ? 'Speaker only' : audioMode === 'qa' ? 'Q&A' : 'Open discussion';
    $('microphone').title = voiceError || `${voiceAllowed ? action : handRaised === null && selfMuted ? 'Raise your hand to prepare your microphone · Blocked by host' : `${action} · Blocked by host`} · ${modeLabel}${hasFloor ? ' · You have the floor' : ''}`;
    $('microphone').setAttribute('aria-label', $('microphone').title);
    $('raiseHand').disabled = !connected;
    $('raiseHand').replaceChildren(createToolIcon('hand'));
    if (handRaised !== null) {
      const number = document.createElement('span'); number.textContent = String(handRaised); number.setAttribute('aria-hidden', 'true'); $('raiseHand').append(number);
    }
    $('raiseHand').title = handRaised === null ? 'Raise hand' : `Lower hand (#${handRaised})`;
    $('raiseHand').setAttribute('aria-pressed', String(handRaised !== null));
    $('raiseHand').setAttribute('aria-label', handRaised === null ? 'Raise hand' : 'Lower hand');
    $('voiceStatus').textContent = voiceError || (connected ? `${modeLabel} · ${hasFloor ? 'You have the floor' : !voiceAllowed ? 'Microphone blocked by host' : 'Allowed to speak'}` : '');
  }
  function stopMicrophone() {
    microphoneRequest++;
    microphoneCapture?.close(); microphoneCapture = null;
    microphone?.getTracks().forEach(track => track.stop()); microphone = null; selfMuted = true;
  }
  async function playVoice() {
    try { await voiceAudio.play(); $('listen').hidden = true; }
    catch { if (voiceAudio.srcObject) $('listen').hidden = false; }
  }
  $('listen').onclick = playVoice;
  $('raiseHand').onclick = () => send({ kind: 'voice', raised: handRaised === null });
  $('microphone').onclick = async () => {
    if (microphoneBusy || (selfMuted && !voiceAllowed && handRaised === null) || !audioSender) return;
    const current = generation, sender = audioSender, request = ++microphoneRequest;
    microphoneBusy = true; voiceError = ""; renderVoice();
    try {
      if (!selfMuted) { stopMicrophone(); await sender.replaceTrack(null); send({ kind: 'voice', selfMuted: true }); }
      else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone requires HTTPS or localhost.');
        const context = new AudioContext();
        let capture;
        try { capture = await openMicrophone(context); }
        catch (error) { void context.close(); throw error; }
        const close = () => { capture.close(); void context.close(); };
        const media = capture.stream;
        if (generation !== current || microphoneRequest !== request || (!voiceAllowed && handRaised === null) || channel?.readyState !== 'open') { close(); return; }
        const track = media.getAudioTracks()[0]; track.enabled = false;
        microphone = media; microphoneCapture = { close, settings: capture.settings };
        await sender.replaceTrack(track);
        if (generation !== current || microphoneRequest !== request || (!voiceAllowed && handRaised === null) || microphone !== media) { close(); return; }
        selfMuted = false; track.enabled = voiceAllowed;
        capture.media.getAudioTracks()[0].onended = () => { if (microphone === media) { stopMicrophone(); send({ kind: 'voice', selfMuted: true }); renderVoice(); } };
        send({ kind: 'voice', selfMuted: false });
      }
      void playVoice();
    } catch (error) { if (generation === current) { stopMicrophone(); voiceError = error.message; } }
    finally { if (generation === current) { microphoneBusy = false; renderVoice(); } }
  };
  const recovery = new RemoteConnectionRecovery();
  let recovering = false;
  const diagnostics = startRemoteDiagnostics({ connection: () => peer, microphone: () => microphoneCapture?.settings(), button: $('diagnostics'), panel: $('diagnosticsPanel'), indicator: $('videoDelay') });
  const pointers = new Map();
  let gesture, down = false;
  const motion = new HugescreenMotion();
  let mouseSample, passwordLogin = false, followLocal = false, followRevision = 0, localCursor = null;
  const share = new URLSearchParams(location.hash.slice(1)).get('share');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  $('login').hidden = true;
  function refreshWaitingScreen() {
    const waiting = surface.classList.contains('screen-waiting');
    const connecting = !surface.classList.contains('live') && /^(Connecting|Recovering live video|Connected)/.test($('status').textContent);
    $('status').hidden = waiting;
    $('screenWaitingCopy').hidden = !waiting;
    $('waitingHint').textContent = waiting ? 'Your connection is active. Video will return when the host resumes sharing.' : 'Establishing the connection…';
    $('waitingHint').hidden = $('waitingActivity').hidden = !waiting && !connecting;
  }
  const status = message => {
    $('status').textContent = message; $('status').title = message;
    surface.classList.toggle('has-message', !message.startsWith('Connected'));
    refreshWaitingScreen();
    $('loginStatus').textContent = message; $('loginStatus').hidden = authenticated || $('login').hidden;
  };
  const send = message => {
    if ((readOnly || followLocal) && ['pointer', 'key', 'text'].includes(message.kind)) return;
    if (channel?.readyState === 'open' && channel.bufferedAmount < 65536) channel.send(JSON.stringify(message));
  };
  let shareJoin, disposeChat;
  const closeChat = () => { disposeChat?.(); disposeChat = null; };
  const api = async (path, body) => {
    const { response, value } = await requestRemoteApi(path, body);
    if (response.status === 401 && authenticated) {
      closeChat(); authenticated = false; reset(); document.body.classList.remove('authenticated');
      $('login').hidden = !passwordLogin; $('logout').hidden = true;
      if (!passwordLogin) { shareJoin.hideAccess(); shareJoin.show(value.error); status(value.error); }
    }
    if (!response.ok) { const error = new Error(value.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return value;
  };
  shareJoin = createShareJoin({ api, joined: loadWindows, initialCode: share });
  function release() {
    mouseSample = null; cancelAnimationFrame(moveFrame); moveFrame = null; lastMove = null;
    send({ kind: 'release' }); pointerViewport = null; down = false; pointers.clear(); gesture = null;
  }
  function closeTransport() {
    clearTimeout(iceRenewalTimer);
    generation++; stopMicrophone(); audioSender = null; voiceAllowed = false; microphoneBusy = false; hasFloor = false;
    voiceAudio.srcObject = null; $('listen').hidden = true;
    release(); clearInterval(frameTimer);
    if (frameCallback !== undefined) video.cancelVideoFrameCallback?.(frameCallback);
    frameCallback = undefined; viewports.clear(); clearTimeout(viewTimer); viewTimer = null;
    ['followMouse', 'fill', 'fit', 'fullscreen', 'zoomIn', 'zoomOut', 'keyboard'].forEach(id => { $(id).disabled = true; });
    setKeyboardOpen(false);
    peer?.close(); peer = null; channel = null;
    diagnostics.reset(); renderVoice(); video.srcObject = null; surface.classList.remove('live', 'screen-waiting'); refreshWaitingScreen();
  }
  function reset(checkUpdate = true, preserveIntent = false) {
    cancelReconnect(!preserveIntent);
    recovering = false; recovery.reset();
    closeTransport(); handRaised = null; voiceError = "";
    followRevision = 0; setFollowLocal(false); renderVoice(); viewport = requested = null;
    ['followMouse', 'disconnect', 'fill', 'fit', 'fullscreen', 'zoomIn', 'zoomOut', 'keyboard'].forEach(id => { $(id).disabled = true; });
    setKeyboardOpen(false); $('connect').hidden = !authenticated;
    const id = sessionId; sessionId = null;
    status('Disconnected');
    const disconnected = id ? api('/api/disconnect', { sessionId: id }).catch(() => {}) : Promise.resolve();
    return disconnected.then(() => { if (checkUpdate !== false) return clientUpdates.check(); });
  }
  $('disconnect').onclick = () => { void reset(); };
  async function loadWindows(resume = false) {
    const epoch = reconnectEpoch;
    const result = await api('/api/windows');
    if (resume && epoch !== reconnectEpoch) return true;
    iceServers = result.iceServers; readOnly = result.readOnly;
    $('windows').replaceChildren(...result.windows.map(w => {
      const option = document.createElement('option'); option.value = w.id; option.textContent = w.title || w.id;
      option.dataset.width = w.width; option.dataset.height = w.height; return option;
    }));
    authenticated = true; document.body.classList.add('authenticated');
    $('windows').hidden = result.windows.length <= 1;
    $('windows').closest('label').hidden = result.windows.length <= 1;
    $('connect').hidden = result.windows.length === 1; $('login').hidden = true; $('logout').hidden = false;
    shareJoin.participant(result.participant);
    if (readOnly && !disposeChat) disposeChat = startShareChatClient({ api, root: $("chatPanel"), button: $("chat"), workspace: $("viewerWorkspace") });
    updateViewerHint();
    status(result.windows.length ? 'Choose a window' : 'No windows available');
    const desired = remembered('boatyard-stream-window'), title = remembered('boatyard-stream-title');
    const matches = result.windows.filter(window => window.title === title);
    const selected = result.windows.find(window => window.id === desired) || (matches.length === 1 ? matches[0] : undefined);
    if (resume && selected) $('windows').value = selected.id;
    if (result.windows.length === 1 || resume && selected) return connectStream();
    return false;
  }
  $('login').onsubmit = async event => {
    event.preventDefault(); status('Signing in…');
    const button = $('login').querySelector('button'); button.disabled = true;
    try {
      await api('/api/login', { password: $('password').value }); $('password').value = '';
      await loadWindows();
    } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  };
  $('logout').onclick = async () => {
    closeChat(); reset(false);
    try { await api('/api/logout', {}); } catch (error) { status(error.message); }
    authenticated = false; document.body.classList.remove('authenticated');
    $('login').hidden = !passwordLogin; $('logout').hidden = true; if (passwordLogin) $('password').focus();
    else { shareJoin.hideAccess(); shareJoin.show('Enter your code to join again.'); status('Enter your code to join again.'); }
  };
  $('connect').onsubmit = event => { event.preventDefault(); void connectStream(); };
  async function recoverStream() {
    if (recovering || !peer || !sessionId) return;
    recovering = true;
    const following = followLocal;
    closeTransport(); status('Recovering live video…');
    try { await connectStream(true, following); }
    finally { recovering = false; }
  }
  async function connectStream(replaceTransport = false, following = false) {
    if (peer) return true;
    reconnectWanted = true; remember('boatyard-stream-active', 'true');
    remember('boatyard-stream-window', $('windows').value);
    remember('boatyard-stream-title', $('windows').selectedOptions[0]?.textContent || '');
    const startedAt = generation;
    const selected = $('windows').selectedOptions[0]; if (!selected) return;
    status(replaceTransport ? 'Recovering live video…' : 'Connecting…');
    if (!replaceTransport && (await clientUpdates.check() || peer)) return;
    try {
      const metadata = await api('/api/windows');
      if (generation !== startedAt) return;
      readOnly = metadata.readOnly; iceServers = metadata.iceServers;
      if (!replaceTransport) iceTransportPolicy = metadata.iceTransportPolicy === "relay" ? "relay" : "all";
    }
    catch (error) {
      if (generation === startedAt) {
        void reset(false, reconnectWanted);
        status(replaceTransport ? `Connection lost. ${error.message}` : error.message);
        retryConnection();
      }
      return false;
    }
    if (peer || generation !== startedAt) return;
    const current = ++generation;
    if (!replaceTransport) {
      full = { width: Number(selected.dataset.width), height: Number(selected.dataset.height) };
      revision = 0; viewport = null; requested = { x: 0, y: 0, ...full, revision };
    }
    const connection = new RTCPeerConnection(remotePeerConfiguration(iceServers, iceTransportPolicy)); peer = connection;
    $('connect').hidden = true; $('disconnect').disabled = false; status(replaceTransport ? 'Recovering live video…' : 'Connecting…');
    channel = connection.createDataChannel('controls', { ordered: true });
    channel.onmessage = event => {
      if (generation !== current) return;
      const message = JSON.parse(event.data);
      if (message.kind === 'voice') {
        voiceAllowed = message.allowed === true; handRaised = message.handRaised ?? null;
        audioMode = message.audioMode || 'open-discussion'; hasFloor = message.hasFloor === true;
        if (message.selfMuted) stopMicrophone();
        else microphone?.getAudioTracks().forEach(track => { track.enabled = voiceAllowed && !selfMuted; });
        renderVoice();
      } else if (message.kind === 'viewport') {
        const camera = message.viewport;
        if (replaceTransport && viewports.size === 0) { revision = camera.revision; requested = { ...camera }; }
        viewports.set(camera.revision, camera);
        if (viewports.size > 128) viewports.delete(viewports.keys().next().value);
        if (camera.revision === 0 && !replaceTransport) { full = { width: camera.width, height: camera.height }; fillView(); }
        if (camera.revision === revision) requested = { ...camera };
      } else if (message.kind === 'ice-answer') {
        connection.setRemoteDescription({ type: 'answer', sdp: message.sdp }).then(() => {
          if (generation === current) scheduleIceRenewal();
        }).catch(() => { if (generation === current) status('Could not renew TURN credentials. Connect again.'); });
      } else if (message.kind === 'ice-error') status('Could not renew TURN credentials. Connect again before credentials expire.');
      else if (message.kind === 'diagnostics') diagnostics.setHost(message.host);
      else if (message.kind === 'clock') diagnostics.synchronize(message.sentAt, message.hostAt);
      else if (message.kind === 'cursor') {
        const point = message.cursor;
        localCursor = point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.y >= 0 && point.x < full.width && point.y < full.height ? point : null;
        applyFollowCursor(); drawLocalCursor();
      } else if (message.kind === 'follow-state') {
        if (Number.isSafeInteger(message.revision) && message.revision >= followRevision && typeof message.enabled === 'boolean') {
          followRevision = message.revision;
          if (followLocal !== message.enabled) setFollowLocal(message.enabled, false);
        }
      } else if (message.kind === 'follow-error') { status(message.message); }
      else if (message.kind === 'ping') send({ kind: 'pong', sentAt: performance.now() });
      else if (message.kind === 'error') status(message.message);
    };
    const interrupted = () => {
      if (generation !== current || recovering) return;
      if (recovery.attempt()) void recoverStream();
      else { void reset(false, true); retryConnection(); }
    };
    channel.onclose = interrupted;
    channel.onopen = () => { if (generation === current) {
      send({ kind: 'pong', sentAt: performance.now() }); scheduleIceRenewal(); renderVoice();
      status(readOnly ? 'Connected · Read-only' : 'Connected'); ['followMouse', 'fill', 'fit', 'fullscreen', 'zoomIn', 'zoomOut', 'keyboard'].forEach(id => { $(id).disabled = false; }); setFollowLocal(replaceTransport ? following : readOnly); surface.focus();
    } };
    function scheduleIceRenewal() {
      clearTimeout(iceRenewalTimer);
      if (!iceServers.length) return;
      // Refresh both peers and restart ICE before the 12-hour TURN credentials expire.
      iceRenewalTimer = setTimeout(async () => {
        try {
          const metadata = await api('/api/windows');
          if (generation !== current || channel?.readyState !== 'open') return;
          iceServers = metadata.iceServers;
          connection.setConfiguration(remotePeerConfiguration(iceServers, connection.getConfiguration().iceTransportPolicy));
          await connection.setLocalDescription(await connection.createOffer({ iceRestart: true }));
          await waitForRemoteIce(connection);
          if (generation === current) send({ kind: 'ice-restart', sdp: connection.localDescription.sdp });
        } catch { if (generation === current) status('Could not renew TURN credentials. Connect again before credentials expire.'); }
      }, TURN_CREDENTIAL_RENEWAL_MS);
    }
    connection.ontrack = event => {
      if (generation !== current) return;
      preferLowLatency(event.receiver);
      if (event.track.kind === 'audio') { voiceAudio.srcObject = new MediaStream([event.track]); void playVoice(); return; }
      video.srcObject = event.streams[0];
      if (frameCallback !== undefined) video.cancelVideoFrameCallback?.(frameCallback);
      const observePresentation = (now, metadata) => {
        if (generation !== current) return;
        diagnostics.setPresentation(now, metadata);
        frameCallback = video.requestVideoFrameCallback(observePresentation);
      };
      frameCallback = video.requestVideoFrameCallback?.(observePresentation);
      clearInterval(frameTimer); frameTimer = setInterval(presentFrame, 1000 / 24); video.play().catch(error => { if (generation === current && error.name !== 'AbortError') status(error.message); });
    };
    connection.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(connection.connectionState)) interrupted();
    };
    try {
      connection.addTransceiver('video', { direction: 'recvonly' });
      audioSender = connection.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      await connection.setLocalDescription(await connection.createOffer());
      await waitForRemoteIce(connection);
      if (generation !== current) return;
      const answer = await api(replaceTransport ? '/api/recover' : '/api/connect', { windowId: selected.value, ...(replaceTransport ? { sessionId } : {}), ...connection.localDescription.toJSON() });
      if (generation !== current) { await api('/api/disconnect', { sessionId: answer.sessionId }); return; }
      sessionId = answer.sessionId;
      await connection.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
      return true;
    } catch (error) {
      if (generation === current) {
        void reset(false, reconnectWanted); status(replaceTransport ? `Connection lost. ${error.message}` : error.message);
        retryConnection();
      }
      return false;
    }
  }
  function sameCrop(a, b) { return a && b && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .01); }
  function presentFrame() {
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return;
    const width = video.videoWidth, transportHeight = video.videoHeight, footerHeight = remoteFrameFooterHeight(width);
    if (frameBuffer.width !== width || frameBuffer.height !== transportHeight) { frameBuffer.width = width; frameBuffer.height = transportHeight; }
    // Sample the video once: metadata and visible pixels must come from the
    // same decoded frame even if the decoder advances between canvas draws.
    bufferContext.drawImage(video, 0, 0, width, transportHeight);
    const metadata = readRemoteFrameMetadata(bufferContext, width, transportHeight);
    const camera = metadata && viewports.get(metadata.revision);
    if (!camera || down && !sameCrop(camera, pointerViewport)) {
      diagnostics.observeFrame(metadata, !metadata ? 'Unreadable' : !camera ? 'Unknown viewport' : 'Pointer crop held');
      return;
    }
    const height = transportHeight - footerHeight;
    if (frame.width !== width || frame.height !== height) { frame.width = width; frame.height = height; }
    frameContext.drawImage(frameBuffer, 0, 0, width, height, 0, 0, width, height);
    diagnostics.setFrame(metadata.timestamp);
    diagnostics.observeFrame(metadata, 'Displayed');
    viewport = camera; frame.dataset.revision = String(camera.revision);
    const waitingChanged = !surface.classList.contains('live') || surface.classList.contains('screen-waiting') !== metadata.screenHidden;
    surface.classList.add('live'); surface.classList.toggle('screen-waiting', metadata.screenHidden);
    if (waitingChanged) refreshWaitingScreen();
    drawLocalCursor();
  }
  function updateViewerHint() {
    $('viewerHint').textContent = followLocal
      ? 'Following local mouse · Remote input paused · Pinch / wheel to zoom'
      : readOnly ? 'Drag to pan · Pinch / wheel to zoom' : 'One finger: interact · Two fingers: pan / pinch · Alt+drag: pan · Alt+wheel: zoom';
  }
  function setFollowLocal(enabled, notify = true) {
    release(); followLocal = enabled; localCursor = null;
    $('followMouse').setAttribute('aria-pressed', String(enabled));
    $('keyboard').disabled = enabled || readOnly || channel?.readyState !== 'open';
    if (enabled) $('textForm').hidden = true;
    $('localCursor').hidden = true; updateViewerHint();
    if (notify) send({ kind: 'follow-cursor', enabled, revision: followRevision });
  }
  $('followMouse').title = 'Follow the local pointer. Remote input is paused while following.';
  $('followMouse').onclick = () => setFollowLocal(!followLocal);
  function applyFollowCursor() {
    if (!followLocal || !localCursor || !requested || !full || gesture || down) return;
    const camera = { ...requested,
      x: Math.max(0, Math.min(full.width - requested.width, localCursor.x - requested.width / 2)),
      y: Math.max(0, Math.min(full.height - requested.height, localCursor.y - requested.height / 2)) };
    if (!sameCrop(camera, requested)) setView(camera, true);
  }
  function drawLocalCursor() {
    const marker = $('localCursor');
    marker.hidden = true;
    if (!followLocal || !localCursor || !viewport || !frame.width || !frame.height) return;
    const rect = displayRect(), bounds = surface.getBoundingClientRect();
    const x = rect.left - bounds.left + (localCursor.x - viewport.x) * rect.width / viewport.width;
    const y = rect.top - bounds.top + (localCursor.y - viewport.y) * rect.height / viewport.height;
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return;
    marker.style.left = `${x}px`; marker.style.top = `${y}px`; marker.hidden = false;
  }
  function setView(value, followMouse = false) {
    if (!followMouse) release();
    const width = Math.max(Math.min(full.width, 100), Math.min(full.width, value.width));
    const height = Math.max(Math.min(full.height, 100), Math.min(full.height, value.height));
    requested = { x: Math.max(0, Math.min(full.width - width, value.x)), y: Math.max(0, Math.min(full.height - height, value.y)), width, height, revision: ++revision };
    if (followMouse) {
      clearTimeout(viewTimer); viewTimer = null;
      send({ kind: 'viewport', viewport: requested });
    } else if (!viewTimer) {
      // Throttle continuous gestures instead of postponing until motion stops.
      // Each tick sends the newest crop, including the final gesture position.
      viewTimer = setTimeout(() => { viewTimer = null; send({ kind: 'viewport', viewport: requested }); }, 50);
    }
  }
  function fillView() {
    if (!requested || !full) return;
    const rect = surface.getBoundingClientRect();
    const scale = Math.min(full.width / rect.width, full.height / rect.height);
    const width = rect.width * scale, height = rect.height * scale;
    setView({ x: (full.width - width) / 2, y: (full.height - height) / 2, width, height });
  }
  function displayRect() {
    const rect = frame.getBoundingClientRect();
    const ratio = frame.width / frame.height;
    const scale = Math.min(rect.width / ratio, rect.height);
    const width = scale * ratio, height = scale;
    return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
  }
  $('fill').onclick = fillView;
  $('fullscreen').onclick = () => {
    const operation = document.fullscreenElement ? document.exitFullscreen() : document.body.requestFullscreen();
    operation.catch(error => status(error.message));
  };
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  });
  new ResizeObserver(() => {
    if (!requested || !full || gesture || pointers.size) return;
    setView(cameraView());
  }).observe(surface);
  function cameraView() {
    const rect = surface.getBoundingClientRect(), v = requested;
    // Include letterboxed space in the camera before zooming. setView clips
    // the result to the source, so available image progressively fills it.
    const scale = Math.max(v.width / rect.width, v.height / rect.height);
    const width = rect.width * scale, height = rect.height * scale;
    return { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height };
  }
  function zoom(factor, anchor) {
    if (!requested) return;
    const v = cameraView();
    const rect = surface.getBoundingClientRect();
    const x = !followLocal && anchor ? Math.max(0, Math.min(1, (anchor.clientX - rect.left) / rect.width)) : .5;
    const y = !followLocal && anchor ? Math.max(0, Math.min(1, (anchor.clientY - rect.top) / rect.height)) : .5;
    setView({ x: v.x + v.width * (1 - factor) * x, y: v.y + v.height * (1 - factor) * y, width: v.width * factor, height: v.height * factor });
  }
  $('fit').onclick = () => { if (full) setView({ x: 0, y: 0, ...full }); };
  $('zoomIn').onclick = () => zoom(.8); $('zoomOut').onclick = () => zoom(1.25);
  function setKeyboardOpen(open) {
    $('textForm').hidden = !open;
    $('keyboard').setAttribute('aria-pressed', String(open));
    if (open) $('text').focus({ preventScroll: true });
    else if (document.activeElement === $('text')) surface.focus({ preventScroll: true });
  }
  $('keyboard').onclick = () => setKeyboardOpen($('textForm').hidden);
  // Prevent browser focus transfer rather than reopening the mobile keyboard
  // after a blur, which can interrupt gestures and requires user activation.
  document.addEventListener('pointerdown', event => {
    if (!$('textForm').hidden && (surface.contains(event.target) || event.target.closest('footer button'))) event.preventDefault();
  }, { capture: true, passive: false });
  $('textForm').onsubmit = event => { event.preventDefault(); if ($('text').value) { send({ kind: 'text', text: $('text').value }); $('text').value = ''; } };
  $('enter').onclick = () => { send({ kind: 'key', action: 'down', key: 'Enter', modifiers: [] }); send({ kind: 'key', action: 'up', key: 'Enter', modifiers: [] }); };
  function point(event) {
    const rect = displayRect();
    if (!rect.width || !rect.height || !viewport) return null;
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }
  function pointer(event, action) {
    if (readOnly || followLocal) return;
    const p = point(event); if (!p) return;
    send({ kind: 'pointer', action, ...p, revision: (pointerViewport || viewport).revision, button: ['left', 'middle', 'right'][event.button] || 'left', deltaX: Math.max(-10000, Math.min(10000, event.deltaX || 0)), deltaY: Math.max(-10000, Math.min(10000, event.deltaY || 0)) });
  }
  function panWithViewerMouse(event) {
    if (followLocal) return false;
    const now = performance.now(), rect = surface.getBoundingClientRect();
    const cursor = { x: Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top)) };
    const previous = mouseSample; mouseSample = { cursor, now };
    if (!previous || !requested || down || pointers.size || event.buttons) {
      motion.reset(cursor, now); return false;
    }
    const delta = motion.filter(previous.cursor, cursor, now);
    for (const [axis, length] of [['x', rect.width], ['y', rect.height]]) {
      if (cursor[axis] <= 0 && previous.cursor[axis] > 0 || cursor[axis] >= length - 1 && previous.cursor[axis] < length - 1) delta[axis] = cursor[axis] - previous.cursor[axis];
    }
    if (!delta.x && !delta.y) return false;
    const v = requested, scaleX = rect.width / v.width, scaleY = rect.height / v.height;
    const position = calculateHugescreenPan({ x: -v.x * scaleX, y: -v.y * scaleY, width: full.width * scaleX, height: full.height * scaleY },
      { x: 0, y: 0, width: rect.width, height: rect.height }, { x: cursor.x - delta.x, y: cursor.y - delta.y }, cursor, undefined, now - previous.now);
    const x = -position.x / scaleX, y = -position.y / scaleY;
    if (Math.abs(x - v.x) < .01 && Math.abs(y - v.y) < .01) return false;
    setView({ ...v, x, y }, true); return true;
  }
  surface.onpointerleave = () => { mouseSample = null; };
  surface.oncontextmenu = event => event.preventDefault();
  surface.onpointerdown = event => {
    if (!viewport) return;
    // Freeze the camera at the frame being clicked, before any queued movement
    // can change the down/up target. Older displayed crops remain valid on host.
    if (!pointers.size) {
      cancelAnimationFrame(moveFrame); moveFrame = null; lastMove = null; mouseSample = null;
      clearTimeout(viewTimer);
      viewTimer = null;
      if (!sameCrop(requested, viewport)) setView(viewport, true);
      pointerViewport = { ...viewport };
    }
    if ($('textForm').hidden) surface.focus();
    surface.setPointerCapture(event.pointerId); pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      send({ kind: 'release' }); down = false;
      const [a, b] = [...pointers.values()]; gesture = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y), view: cameraView(), rect: surface.getBoundingClientRect() };
    } else if (pointers.size === 1 && (readOnly || followLocal || event.altKey)) { gesture = { kind: 'pan', x: event.clientX, y: event.clientY, view: { ...requested } }; }
    else if (pointers.size === 1) { pointer(event, 'down'); down = true; }
  };
  surface.onpointermove = event => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], rect = gesture.rect;
      const factor = gesture.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const v = gesture.view;
      // Keep gesture tracking while setView releases remote buttons.
      const savedPointers = new Map(pointers), savedGesture = gesture;
      setView({ x: v.x + v.width * (1 - factor) / 2 - ((a.x + b.x) / 2 - gesture.x) * v.width / rect.width,
        y: v.y + v.height * (1 - factor) / 2 - ((a.y + b.y) / 2 - gesture.y) * v.height / rect.height, width: v.width * factor, height: v.height * factor });
      savedPointers.forEach((value, key) => pointers.set(key, value)); gesture = savedGesture;
    } else if (gesture?.kind === 'pan' && pointers.size === 1) {
      const rect = displayRect(), v = gesture.view;
      const savedPointers = new Map(pointers), savedGesture = gesture;
      setView({ ...v, x: v.x - (event.clientX - gesture.x) * v.width / rect.width, y: v.y - (event.clientY - gesture.y) * v.height / rect.height });
      savedPointers.forEach((value, key) => pointers.set(key, value)); gesture = savedGesture;
    } else if (!gesture) {
      // Anchor immediately: coalescing several moves into one frame must not
      // discard the starting point of the first sweep.
      if (event.pointerType === 'mouse' && !mouseSample) panWithViewerMouse(event);
      lastMove = event;
      if (!moveFrame) moveFrame = requestAnimationFrame(() => { moveFrame = null; if (lastMove) { if (lastMove.pointerType === 'mouse') panWithViewerMouse(lastMove); pointer(lastMove, 'move'); } lastMove = null; });
    }
  };
  surface.onpointerup = event => {
    if (down && !gesture) pointer(event, 'up');
    down = false; pointers.delete(event.pointerId);
    if (!pointers.size) { gesture = null; pointerViewport = null; }
    send({ kind: 'release' });
  };
  surface.onpointercancel = release;
  surface.onwheel = event => { event.preventDefault(); if (event.altKey || readOnly || followLocal) zoom(event.deltaY > 0 ? 1.1 : .9, event); else pointer(event, 'wheel'); };
  surface.addEventListener('wheel', surface.onwheel, { passive: false }); surface.onwheel = null;
  const keys = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space' };
  function keyboard(event, action) {
    if (readOnly || followLocal || channel?.readyState !== 'open') return;
    event.preventDefault();
    const modifiers = ['shift', 'control', 'alt', 'meta'].filter((_, index) => [event.shiftKey, event.ctrlKey, event.altKey, event.metaKey][index]);
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) { if (action === 'down') send({ kind: 'text', text: event.key }); return; }
    send({ kind: 'key', action, key: keys[event.key] || event.key, modifiers });
  }
  surface.onkeydown = event => keyboard(event, 'down'); surface.onkeyup = event => keyboard(event, 'up');
  surface.addEventListener('blur', release);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  window.addEventListener('pagehide', () => { diagnostics.stop(); void reset(false, true); });
  const clientUpdates = startRemoteClientUpdates({ version: document.querySelector('meta[name="boatyard-client-version"]').content,
    installButton: $('install'), isConnected: () => Boolean(peer) });
  void (async () => {
    status('Connecting…');
    try {
      const auth = await api('/api/auth'); passwordLogin = auth.passwordLogin; shareJoin.configure(auth);
      if (!passwordLogin && share) { shareJoin.show(); return; }
      try { await loadWindows(reconnectWanted); }
      catch (error) {
        if (!passwordLogin && error.status === 401 && shareJoin.resumeRequest()) return;
        throw error;
      }
    } catch (error) {
      $('login').hidden = !passwordLogin;
      if (!passwordLogin) shareJoin.show();
      status(passwordLogin ? 'Sign in to connect.' : 'Enter your access code or ask to join.');
      if (error.status === 401) cancelReconnect(); else retryConnection();
    }
  })();
})();
