import { remoteFrameFooterHeight, writeRemoteFrameMetadata, readRemoteFrameMetadata } from "../../shared/remoteFrameMetadata.js";
import { remoteConnectionRoute, remotePeerConfiguration, waitForRemoteIce } from "../../shared/remoteIce.js";
import { RemoteCommandQueue } from "../../shared/remoteCommandQueue.js";


/* global remoteHost */
const connections = new Map();
remoteHost.onMessage(message => {
  const { id, action, payload } = message;
  if (action === 'offer') {
    connections.get(id)?.close(false);
    const bridge = { invoke: (action, value) => remoteHost.invoke('transport', { epoch: payload.epoch, action, payload: value }, id) };
    const connection = startConnection(id, payload, bridge);
    connections.set(id, connection);
  } else if (action === 'close') {
    connections.get(id)?.close(false); connections.delete(id);
  }
});
window.addEventListener('pagehide', () => { for (const connection of connections.values()) connection.close(); });
function startConnection(id, offer, remoteHost) {
  const source = document.createElement('video');
  source.muted = true;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  let peer, channel, media, output, viewport, timer, heartbeat, cursorTimer, lostTimer;
  let cursorPending = false, followCursor = false;
  let commands;
  let active = true;
  let routePending = false, lastRoute, iceRestartPending = false, lastIceRestartAt = 0;
  let previousVideoStats, paintedFrames = 0, previousPaintedFrames = 0;
  let captureReader, captureTrack, canvasTimestamp = null;
  async function publishRoute() {
    if (!active || routePending || peer?.connectionState !== 'connected') return;
    routePending = true;
    try {
      const stats = await peer.getStats(), route = remoteConnectionRoute(stats);
      if (active && route !== lastRoute) { await remoteHost.invoke('route', route); lastRoute = route; }
      const video = [...stats.values()].find(report => report.type === 'outbound-rtp' && report.kind === 'video');
      if (active && video && previousVideoStats?.id === video.id) {
        const seconds = (video.timestamp - previousVideoStats.timestamp) / 1000;
        const encoded = video.framesEncoded - previousVideoStats.framesEncoded;
        if (seconds > 0) send({ kind: 'diagnostics', host: {
          renderedFps: (paintedFrames - previousPaintedFrames) / seconds,
          encodedFps: encoded / seconds,
          encodeMs: encoded > 0 ? 1000 * (video.totalEncodeTime - previousVideoStats.totalEncodeTime) / encoded : null,
          packetQueueMs: video.packetsSent > previousVideoStats.packetsSent
            ? 1000 * (video.totalPacketSendDelay - previousVideoStats.totalPacketSendDelay) / (video.packetsSent - previousVideoStats.packetsSent) : null,
          canvasCaptureAgeMs: canvasTimestamp === null ? null : Math.max(0, performance.now() - canvasTimestamp),
          limitation: video.qualityLimitationReason,
          width: source.videoWidth, height: source.videoHeight,
          encodedWidth: video.frameWidth, encodedHeight: video.frameHeight
        } });
      }
      previousVideoStats = video; previousPaintedFrames = paintedFrames;
    } catch { /* Retry on the next heartbeat without interrupting the stream. */ }
    finally { routePending = false; }
  }
  const send = message => { if (active && channel?.readyState === 'open') channel.send(JSON.stringify(message)); };
  function close(notify = true) {
    if (!active) return;
    active = false;
    commands?.clear();
    clearInterval(timer); clearInterval(heartbeat); clearInterval(cursorTimer); clearTimeout(lostTimer);
    void captureReader?.cancel().catch(() => {}); captureTrack?.stop();
    media?.getTracks().forEach(track => track.stop());
    output?.getTracks().forEach(track => track.stop());
    peer?.close(); connections.delete(id);
    if (notify) remoteHost.invoke('closed').catch(() => {});
  }
  function deferClose() {
    // Give the authenticated HTTP recovery offer time to replace this transport.
    if (active && !lostTimer) lostTimer = setTimeout(close, 15000);
  }
  void (async () => {
    try {
      const setup = await remoteHost.invoke('setup');
      if (!active) return;
      viewport = setup.viewport;
      media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: setup.sourceId, maxFrameRate: 30
      } } });
      if (!active) { media.getTracks().forEach(track => track.stop()); return; }
      media.getVideoTracks()[0].onended = close;
      source.srcObject = media;
      await source.play();
      if (!active) return;
      canvas.width = 1280; canvas.height = 720;
      output = canvas.captureStream(24);
      if (typeof MediaStreamTrackProcessor !== 'undefined') {
        try {
          captureTrack = output.getVideoTracks()[0].clone();
          captureReader = new MediaStreamTrackProcessor({ track: captureTrack, maxBufferSize: 1 }).readable.getReader();
          const footer = document.createElement('canvas'), footerContext = footer.getContext('2d', { willReadFrequently: true });
          // Observe the canvas track before WebRTC, without copying the full image
          // or retaining a queue of frames in the diagnostic consumer.
          void (async () => {
            try {
              while (active) {
                const { value: frame, done } = await captureReader.read();
                if (done) break;
                try {
                  const width = frame.displayWidth, height = remoteFrameFooterHeight(width);
                  if (footer.width !== width || footer.height !== height + 1) { footer.width = width; footer.height = height + 1; }
                  footerContext.drawImage(frame, 0, frame.displayHeight - height, width, height, 0, 1, width, height);
                  canvasTimestamp = readRemoteFrameMetadata(footerContext, width, height + 1)?.timestamp ?? null;
                } finally { frame.close(); }
              }
            } catch { canvasTimestamp = null; }
          })();
        } catch { captureTrack?.stop(); captureTrack = null; }
      }
      const dimensions = () => ({ kind: 'viewport', viewport, sourceWidth: source.videoWidth, sourceHeight: source.videoHeight });
      function paint() {
        if (!active || !source.videoWidth) return;
        // Native capture includes window chrome (for example the menu bar).
        // Input coordinates start at the content origin. Remove chrome before
        // cropping, independently of the desktop's device scale factor.
        const sx = source.videoWidth / setup.captureBounds.width;
        const sy = source.videoHeight / setup.captureBounds.height;
        const ratio = Math.min(1280 / viewport.width, 720 / viewport.height, 1);
        const width = Math.max(2, Math.round(viewport.width * ratio / 2) * 2);
        const height = Math.max(2, Math.round(viewport.height * ratio / 2) * 2);
        const transportHeight = height + remoteFrameFooterHeight(width);
        if (canvas.width !== width || canvas.height !== transportHeight) { canvas.width = width; canvas.height = transportHeight; }
        context.drawImage(source, (setup.contentOffset.x + viewport.x) * sx, (setup.contentOffset.y + viewport.y) * sy, viewport.width * sx, viewport.height * sy, 0, 0, width, height);
        writeRemoteFrameMetadata(context, width, transportHeight, viewport.revision, performance.now());
        paintedFrames++;
      }
      paint(); timer = setInterval(paint, 1000 / 24);
      commands = new RemoteCommandQueue(async message => {
        if (!active) return;
        if (message.kind === 'viewport') {
          await remoteHost.invoke('input', { kind: 'release' });
          viewport = await remoteHost.invoke('viewport', message.viewport);
          if (active) { paint(); send(dimensions()); }
        } else await remoteHost.invoke('input', message);
      }, error => send({ kind: 'error', message: error.message }));
      if (!active) return;
      peer = new RTCPeerConnection(remotePeerConfiguration(setup.iceServers, setup.iceTransportPolicy));
      output.getTracks().forEach(track => {
        track.contentHint = 'detail';
        peer.addTrack(track, output);
      });
      async function publishCursor() {
        if (!active || !followCursor || cursorPending || channel?.readyState !== 'open' || channel.bufferedAmount > 16384) return;
        cursorPending = true;
        try {
          const cursor = await remoteHost.invoke('cursor');
          if (active && followCursor) send({ kind: 'cursor', cursor });
        } catch {
          followCursor = false; clearInterval(cursorTimer);
          send({ kind: 'follow-error', message: 'Local pointer tracking is unavailable on this desktop.' });
        }
        finally { cursorPending = false; }
      }
      peer.ondatachannel = event => {
        if (!active) return;
        channel = event.channel;
        channel.onopen = () => {
          if (!active) return;
          send(dimensions()); void publishRoute();
          heartbeat = setInterval(() => { send({ kind: 'ping' }); void publishRoute(); }, 3000);
        };
        channel.onclose = deferClose;
        let events = 0, epoch = performance.now();
        channel.onmessage = event => {
          if (!active) return;
          if (typeof event.data !== 'string' || event.data.length > 16384) return;
          if (performance.now() - epoch > 1000) { events = 0; epoch = performance.now(); }
          if (++events > 300) return;
          try {
            const message = JSON.parse(event.data);
            if (message.kind === 'ice-restart') {
              if (iceRestartPending || Date.now() - lastIceRestartAt < 60000 || typeof message.sdp !== 'string') return;
              lastIceRestartAt = Date.now();
              iceRestartPending = true;
              void (async () => {
                try {
                  const servers = await remoteHost.invoke('ice-servers');
                  if (!active) return;
                  peer.setConfiguration(remotePeerConfiguration(servers, peer.getConfiguration().iceTransportPolicy));
                  await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
                  await peer.setLocalDescription(await peer.createAnswer());
                  await waitForRemoteIce(peer);
                  if (active) send({ kind: 'ice-answer', sdp: peer.localDescription.sdp });
                } catch { if (active) send({ kind: 'ice-error' }); }
                finally { iceRestartPending = false; }
              })();
              return;
            }
            if (message.kind === 'pong') {
              remoteHost.invoke('heartbeat').catch(close);
              if (Number.isFinite(message.sentAt)) send({ kind: 'clock', sentAt: message.sentAt, hostAt: performance.now() });
              return;
            }
            if (message.kind === 'follow-cursor') {
              followCursor = message.enabled === true;
              clearInterval(cursorTimer);
              if (followCursor) { void publishCursor(); cursorTimer = setInterval(publishCursor, 50); }
              return;
            }
            commands.push(message);
          } catch { send({ kind: 'error', message: 'Invalid control message' }); }
        };
      };
      peer.onconnectionstatechange = () => {
        if (!active) return;
        if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) deferClose();
        else { clearTimeout(lostTimer); lostTimer = null; void publishRoute(); }
      };
      await peer.setRemoteDescription(offer);
      if (!active) return;
      await peer.setLocalDescription(await peer.createAnswer());
      for (const sender of peer.getSenders()) {
        if (sender.track?.kind !== 'video') continue;
        const parameters = sender.getParameters();
        // Configure negotiated encodings, keeping resolution stable because
        // the crop metadata uses fixed pixel cells.
        parameters.degradationPreference = 'maintain-resolution';
        parameters.encodings = parameters.encodings.map(encoding => ({ ...encoding, maxBitrate: 2500000, maxFramerate: 24 }));
        await sender.setParameters(parameters);
      }
      await waitForRemoteIce(peer);
      if (!active) return;
      await remoteHost.invoke('answer', peer.localDescription.toJSON());
    } catch (error) { if (!active) return; await remoteHost.invoke('error', error.message).catch(() => {}); close(); }
  })();
  return { close };
}
