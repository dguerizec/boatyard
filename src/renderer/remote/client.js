import { remoteFrameFooterHeight, readRemoteFrameMetadata } from "../../shared/remoteFrameMetadata.js";
import { calculateHugescreenPan } from "../../shared/hugescreenPan.js";
import { HugescreenMotion } from "../../shared/hugescreenMotion.js";
import { remotePeerConfiguration, waitForRemoteIce, TURN_CREDENTIAL_RENEWAL_MS } from "../../shared/remoteIce.js";
import { createToolIcon } from "../toolIcons.js";
import { startRemoteClientUpdates } from "./clientUpdates.js";
import { startRemoteDiagnostics } from "./diagnostics.js";
import { RemoteConnectionRecovery, preferLowLatency } from './recovery.js';
import { requestRemoteApi } from "./api.js";

(() => {
  const $ = id => document.getElementById(id);
  document.querySelectorAll('[data-icon]').forEach(button => button.replaceChildren(createToolIcon(button.dataset.icon)));
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
  const recovery = new RemoteConnectionRecovery();
  let recovering = false;
  const diagnostics = startRemoteDiagnostics({ connection: () => peer, button: $('diagnostics'), panel: $('diagnosticsPanel'), indicator: $('videoDelay') });
  const pointers = new Map();
  let gesture, down = false;
  const motion = new HugescreenMotion();
  let mouseSample, passwordLogin = false, followLocal = false, localCursor = null;
  const share = new URLSearchParams(location.hash.slice(1)).get('share');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  $('login').hidden = true;
  const status = message => {
    $('status').textContent = message; $('status').title = message;
    surface.classList.toggle('has-message', !message.startsWith('Connected'));
    $('loginStatus').textContent = message; $('loginStatus').hidden = authenticated || $('login').hidden;
  };
  const send = message => {
    if ((readOnly || followLocal) && ['pointer', 'key', 'text'].includes(message.kind)) return;
    if (channel?.readyState === 'open' && channel.bufferedAmount < 65536) channel.send(JSON.stringify(message));
  };
  const api = async (path, body) => {
    const { response, value } = await requestRemoteApi(path, body);
    if (response.status === 401 && authenticated) {
      authenticated = false; reset(); document.body.classList.remove('authenticated');
      $('login').hidden = !passwordLogin; $('logout').hidden = true;
    }
    if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
    return value;
  };
  function release() {
    mouseSample = null; cancelAnimationFrame(moveFrame); moveFrame = null; lastMove = null;
    send({ kind: 'release' }); pointerViewport = null; down = false; pointers.clear(); gesture = null;
  }
  function closeTransport() {
    clearTimeout(iceRenewalTimer);
    generation++;
    release(); clearInterval(frameTimer);
    if (frameCallback !== undefined) video.cancelVideoFrameCallback?.(frameCallback);
    frameCallback = undefined; viewports.clear(); clearTimeout(viewTimer); viewTimer = null;
    ['followMouse', 'fill', 'fit', 'fullscreen', 'zoomIn', 'zoomOut', 'keyboard'].forEach(id => { $(id).disabled = true; });
    setKeyboardOpen(false);
    peer?.close(); peer = null; channel = null;
    diagnostics.reset(); video.srcObject = null; surface.classList.remove('live');
  }
  function reset(checkUpdate = true) {
    recovering = false; recovery.reset();
    closeTransport();
    setFollowLocal(false); viewport = requested = null;
    ['followMouse', 'disconnect', 'fill', 'fit', 'fullscreen', 'zoomIn', 'zoomOut', 'keyboard'].forEach(id => { $(id).disabled = true; });
    setKeyboardOpen(false); $('connect').hidden = !authenticated;
    const id = sessionId; sessionId = null;
    status('Disconnected');
    const disconnected = id ? api('/api/disconnect', { sessionId: id }).catch(() => {}) : Promise.resolve();
    return disconnected.then(() => { if (checkUpdate !== false) return clientUpdates.check(); });
  }
  $('disconnect').onclick = reset;
  async function loadWindows() {
    const result = await api('/api/windows'); iceServers = result.iceServers; readOnly = result.readOnly;
    $('windows').replaceChildren(...result.windows.map(w => {
      const option = document.createElement('option'); option.value = w.id; option.textContent = w.title || w.id;
      option.dataset.width = w.width; option.dataset.height = w.height; return option;
    }));
    authenticated = true; document.body.classList.add('authenticated');
    $('windows').hidden = result.windows.length <= 1;
    $('windows').closest('label').hidden = result.windows.length <= 1;
    $('connect').hidden = result.windows.length === 1; $('login').hidden = true; $('logout').hidden = false;
    updateViewerHint();
    status(result.windows.length ? 'Choose a window' : 'No windows available');
    if (result.windows.length === 1) $('connect').requestSubmit();
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
    reset(false);
    try { await api('/api/logout', {}); } catch (error) { status(error.message); }
    authenticated = false; document.body.classList.remove('authenticated');
    $('login').hidden = !passwordLogin; $('logout').hidden = true; if (passwordLogin) $('password').focus();
    else status('Ask for a new read-only share link to sign in again.');
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
    if (peer) return;
    const startedAt = generation;
    const selected = $('windows').selectedOptions[0]; if (!selected) return;
    if (!replaceTransport && (await clientUpdates.check() || peer)) return;
    try {
      const metadata = await api('/api/windows');
      if (generation !== startedAt) return;
      readOnly = metadata.readOnly; iceServers = metadata.iceServers;
      if (!replaceTransport) iceTransportPolicy = metadata.iceTransportPolicy === "relay" ? "relay" : "all";
    }
    catch (error) { if (generation === startedAt) { if (replaceTransport) reset(); status(replaceTransport ? `Connection lost. ${error.message}` : error.message); } return; }
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
      if (message.kind === 'viewport') {
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
      } else if (message.kind === 'follow-error') { setFollowLocal(false); status(message.message); }
      else if (message.kind === 'ping') send({ kind: 'pong', sentAt: performance.now() });
      else if (message.kind === 'error') status(message.message);
    };
    const interrupted = () => {
      if (generation !== current || recovering) return;
      if (recovery.attempt()) void recoverStream();
      else { reset(); status('Connection lost. Connect again.'); }
    };
    channel.onclose = interrupted;
    channel.onopen = () => { if (generation === current) {
      send({ kind: 'pong', sentAt: performance.now() }); scheduleIceRenewal();
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
      await connection.setLocalDescription(await connection.createOffer());
      await waitForRemoteIce(connection);
      if (generation !== current) return;
      const answer = await api(replaceTransport ? '/api/recover' : '/api/connect', { windowId: selected.value, ...(replaceTransport ? { sessionId } : {}), ...connection.localDescription.toJSON() });
      if (generation !== current) { await api('/api/disconnect', { sessionId: answer.sessionId }); return; }
      sessionId = answer.sessionId;
      await connection.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
    } catch (error) { if (generation === current) { reset(); status(replaceTransport ? `Connection lost. ${error.message}` : error.message); } }
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
    viewport = camera; frame.dataset.revision = String(camera.revision); surface.classList.add('live'); drawLocalCursor();
    if (mouseSample && !down && !gesture) pointer({ clientX: mouseSample.cursor.x + surface.getBoundingClientRect().left, clientY: mouseSample.cursor.y + surface.getBoundingClientRect().top, button: 0 }, 'move');
  }
  function updateViewerHint() {
    $('viewerHint').textContent = followLocal
      ? 'Following local mouse · Remote input paused · Pinch / wheel to zoom'
      : readOnly ? 'Drag to pan · Pinch / wheel to zoom' : 'One finger: interact · Two fingers: pan / pinch · Alt+drag: pan · Alt+wheel: zoom';
  }
  function setFollowLocal(enabled) {
    release(); followLocal = enabled; localCursor = null;
    $('followMouse').setAttribute('aria-pressed', String(enabled));
    $('keyboard').disabled = enabled || readOnly || channel?.readyState !== 'open';
    if (enabled) $('textForm').hidden = true;
    $('localCursor').hidden = true; updateViewerHint();
    send({ kind: 'follow-cursor', enabled });
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
  function zoom(factor) {
    if (!requested) return;
    const v = cameraView();
    setView({ x: v.x + v.width * (1 - factor) / 2, y: v.y + v.height * (1 - factor) / 2, width: v.width * factor, height: v.height * factor });
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
  surface.onwheel = event => { event.preventDefault(); if (event.altKey || readOnly || followLocal) zoom(event.deltaY > 0 ? 1.1 : .9); else pointer(event, 'wheel'); };
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
  window.addEventListener('pagehide', () => { diagnostics.stop(); reset(false); });
  const clientUpdates = startRemoteClientUpdates({ version: document.querySelector('meta[name="boatyard-client-version"]').content,
    installButton: $('install'), isConnected: () => Boolean(peer) });
  void (async () => {
    try {
      passwordLogin = (await api('/api/auth')).passwordLogin;
      if (share) await api('/api/redeem', { token: share });
      await loadWindows();
    } catch (error) {
      $('login').hidden = !passwordLogin || Boolean(share);
      status(share ? error.message : passwordLogin ? 'Sign in to connect.' : 'Open your one-use read-only share link.');
    }
  })();
})();
