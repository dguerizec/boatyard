import { remoteConnectionRoute } from '../../shared/remoteIce.js';

export function remoteVideoDiagnostics(stats, previous) {
  const reports = [...stats.values()];
  const inbound = reports.find(value => value.type === 'inbound-rtp' && value.kind === 'video');
  const transport = reports.find(value => value.type === 'transport' && value.selectedCandidatePairId);
  const pair = stats.get(transport?.selectedCandidatePairId);
  const delta = key => previous && inbound?.id === previous.id ? inbound[key] - previous[key] : NaN;
  const seconds = delta('timestamp') / 1000;
  const average = (total, count) => delta(count) > 0 ? 1000 * delta(total) / delta(count) : NaN;
  return { snapshot: inbound, route: remoteConnectionRoute(stats),
    rtt: pair?.currentRoundTripTime * 1000,
    fps: seconds > 0 ? delta('framesDecoded') / seconds : NaN,
    bitrate: seconds > 0 ? delta('bytesReceived') * 8 / seconds / 1000 : NaN,
    buffer: average('jitterBufferDelay', 'jitterBufferEmittedCount'),
    decode: average('totalDecodeTime', 'framesDecoded'),
    freezes: inbound?.freezeCount };
}

export function remoteFramePresentation(now, metadata) {
  const difference = (end, start) => Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, end - start) : NaN;
  return {
    captureToReceive: difference(metadata.receiveTime, metadata.captureTime),
    receiveToPresent: difference(now, metadata.receiveTime),
    browserFrameAge: difference(now, metadata.captureTime)
  };
}

export class RemoteFrameClock {
  constructor() { this.reset(); }
  reset() { this.offset = null; this.roundTrip = Infinity; this.sampleAt = null; this.timestamp = null; }
  synchronize(sentAt, hostAt, receivedAt = performance.now()) {
    if (![sentAt, hostAt, receivedAt].every(Number.isFinite) || receivedAt < sentAt) return;
    const roundTrip = receivedAt - sentAt;
    // Prefer a recent low-latency sample so a queued control message does not
    // look like a clock offset. Refresh periodically to follow clock drift.
    if (roundTrip <= this.roundTrip || this.sampleAt === null || receivedAt - this.sampleAt > 60000) {
      this.offset = (sentAt + receivedAt) / 2 - hostAt;
      this.roundTrip = roundTrip; this.sampleAt = receivedAt;
    }
  }
  age(now = performance.now(), timestamp = this.timestamp) {
    return this.offset === null || timestamp === null ? NaN : Math.max(0, now - timestamp - this.offset);
  }
}

export class RemoteFrameDisplay {
  constructor() { this.reset(); }
  reset() { this.timestamp = null; this.changedAt = null; this.sample = null; this.reason = 'Waiting'; }
  observe(metadata, reason, now = performance.now()) {
    this.sample = metadata;
    this.reason = reason;
    if (reason === 'Displayed' && metadata.timestamp !== this.timestamp) {
      this.timestamp = metadata.timestamp;
      this.changedAt = now;
    }
  }
  heldFor(now = performance.now()) { return this.changedAt === null ? NaN : Math.max(0, now - this.changedAt); }
}

export function microphoneProcessingSummary(settings) {
  if (!settings) return 'Off';
  const state = value => value === true ? 'On' : value === false ? 'Off' : 'Unreported';
  return `Echo cancellation: ${state(settings.echoCancellation)} · Noise suppression: ${state(settings.noiseSuppression)} · Native gain: ${state(settings.autoGainControl)} · Adaptive gain and pause attenuation: On`;
}

export function startRemoteDiagnostics({ connection, microphone = () => null, button, panel, indicator }) {
  let previous, pending = false, timer, host, presentation;
  const clock = new RemoteFrameClock();
  const display = new RemoteFrameDisplay();
  const number = (value, unit) => Number.isFinite(value) ? `${Math.round(value)} ${unit}` : 'Unavailable';
  function updateIndicator() {
    const age = clock.age();
    indicator.hidden = !connection() || !Number.isFinite(age);
    if (!indicator.hidden) indicator.textContent = `Video delay: ${number(age, 'ms')}`;
  }
  const indicatorTimer = setInterval(updateIndicator, 500);
  async function update() {
    if (pending || panel.hidden) return;
    const peer = connection();
    if (!peer) { previous = null; panel.textContent = 'Not connected'; return; }
    pending = true;
    try {
      const result = remoteVideoDiagnostics(await peer.getStats(), previous?.peer === peer ? previous.snapshot : null);
      if (connection() !== peer || panel.hidden) return;
      previous = { peer, snapshot: result.snapshot };
      panel.textContent = [
        `Transport: ${result.route === 'direct' ? 'Direct' : result.route === 'relay' ? 'TURN relay' : 'Checking…'}`,
        `Your microphone: ${microphoneProcessingSummary(microphone())}`,
        `Host microphone: ${microphoneProcessingSummary(host?.microphone)}`,
        `Network round trip: ${number(result.rtt, 'ms')}`,
        `Host render / encode: ${number(host?.renderedFps, 'fps')} / ${number(host?.encodedFps, 'fps')}`,
        `Host encode per frame: ${number(host?.encodeMs, 'ms')} · ${host?.limitation || 'Unavailable'}`,
        `Host packet queue: ${number(host?.packetQueueMs, 'ms')}`,
        `Host canvas capture age: ${number(host?.canvasCaptureAgeMs, 'ms')}`,
        `Captured window: ${Number.isFinite(host?.width) && Number.isFinite(host?.height) ? `${host.width} × ${host.height}` : 'Unavailable'}`,
        `Sent video: ${Number.isFinite(host?.encodedWidth) && Number.isFinite(host?.encodedHeight) ? `${host.encodedWidth} × ${host.encodedHeight}` : 'Unavailable'}`,
        `Received video: ${number(result.fps, 'fps')} · ${number(result.bitrate, 'kb/s')}`,
        `Video buffer: ${number(result.buffer, 'ms')}`,
        `Decode per frame: ${number(result.decode, 'ms')}`,
        `Capture → receive: ${number(presentation?.captureToReceive, 'ms')}`,
        `Receive → present: ${number(presentation?.receiveToPresent, 'ms')}`,
        `Browser frame age: ${number(presentation?.browserFrameAge, 'ms')}`,
        `Frame footer: ${display.reason}`,
        `Sampled footer age: ${number(clock.age(performance.now(), display.sample?.timestamp ?? null), 'ms')}`,
        `Displayed frame unchanged: ${number(display.heldFor(), 'ms')}`,
        `Clock round trip: ${number(clock.offset === null ? NaN : clock.roundTrip, 'ms')}`,
        `Estimated frame age: ${number(clock.age(), 'ms')}`,
        `Video freezes: ${number(result.freezes, '')}`
      ].join('\n');
    } catch { panel.textContent = 'Diagnostics unavailable'; }
    finally { pending = false; }
  }
  button.onclick = () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-pressed', String(!panel.hidden));
    clearInterval(timer); previous = null;
    if (!panel.hidden) { void update(); timer = setInterval(update, 2000); }
  };
  return { setPresentation: (now, metadata) => { presentation = remoteFramePresentation(now, metadata); }, setHost: value => { host = value; }, setFrame: timestamp => { clock.timestamp = timestamp; },
    observeFrame: (metadata, reason) => display.observe(metadata, reason),
    synchronize: (sentAt, hostAt) => clock.synchronize(sentAt, hostAt),
    reset: () => { previous = null; host = null; presentation = null; clock.reset(); display.reset(); updateIndicator(); },
    stop: () => { clearInterval(timer); clearInterval(indicatorTimer); } };
}
