import { openMicrophone } from './microphone.js';

export class RemoteAudioMixer {
  constructor(onHostMuted) {
    this.context = new AudioContext();
    this.participants = new Map();
    this.host = null;
    this.hostDeviceId = '';
    this.hostRequest = 0;
    this.onHostMuted = onHostMuted;
    void this.context.resume();
  }
  add(id) {
    const destination = this.context.createMediaStreamDestination();
    const limiter = this.context.createDynamicsCompressor();
    limiter.connect(destination);
    this.participants.set(id, { destination, limiter, input: null, allowed: false, selfMuted: true });
    this.route();
    return destination.stream;
  }
  receive(id, track) {
    const participant = this.participants.get(id);
    if (!participant || participant.input?.mediaStream.getAudioTracks()[0] === track) return;
    participant.input?.disconnect();
    if (!participant.playback) {
      participant.playback = document.createElement('audio');
      participant.playback.muted = true;
      participant.playback.autoplay = true;
    }
    const stream = new MediaStream([track]);
    // Keep local listening on the native WebRTC renderer for its echo reference.
    // Web Audio only builds the outgoing mixes, which exclude each listener.
    participant.playback.srcObject = stream;
    void participant.playback.play().catch(() => {});
    participant.input = this.context.createMediaStreamSource(stream);
    this.route();
  }
  setVoice(id, state) {
    const participant = this.participants.get(id);
    if (!participant) return;
    Object.assign(participant, { allowed: state.allowed === true, selfMuted: state.selfMuted !== false });
    this.route();
  }
  route() {
    this.host?.source.disconnect();
    if (this.host) for (const participant of this.participants.values()) this.host.source.connect(participant.limiter);
    for (const [id, participant] of this.participants) {
      participant.input?.disconnect();
      if (participant.playback) participant.playback.muted = !participant.allowed || participant.selfMuted;
      if (!participant.input || !participant.allowed || participant.selfMuted) continue;
      for (const [otherId, other] of this.participants) if (id !== otherId) participant.input.connect(other.limiter);
    }
  }
  async openHost(deviceId) {
    const request = ++this.hostRequest;
    const capture = await openMicrophone(this.context, deviceId);
    const { media } = capture;
    if (request !== this.hostRequest) {
      capture.close();
      throw new Error('Microphone request was canceled.');
    }
    let source;
    try { source = this.context.createMediaStreamSource(capture.stream); }
    catch (error) { capture.close(); throw error; }
    const previous = this.host, host = { media, source, capture };
    this.host = host;
    media.getAudioTracks()[0].onended = () => { if (this.host === host) void this.setHostMuted(true); };
    if (previous) { previous.source.disconnect(); previous.capture.close(); }
    this.route(); this.onHostMuted(false);
  }
  async setHostDevice(deviceId) {
    if (deviceId === this.hostDeviceId) return;
    if (deviceId && !(await navigator.mediaDevices.enumerateDevices()).some(device => device.kind === 'audioinput' && device.deviceId === deviceId)) {
      throw new Error('The selected microphone is unavailable.');
    }
    if (this.host) await this.openHost(deviceId);
    this.hostDeviceId = deviceId;
  }
  async setHostMuted(muted) {
    if (muted) {
      this.hostRequest++;
      if (this.host) { this.host.source.disconnect(); this.host.capture.close(); this.host = null; }
    } else if (!this.host) {
      await this.openHost(this.hostDeviceId);
    }
    await this.context.resume(); this.route(); this.onHostMuted(!this.host);
  }
  remove(id) {
    const participant = this.participants.get(id);
    if (!participant) return;
    participant.input?.disconnect(); participant.limiter.disconnect();
    if (participant.playback) { participant.playback.pause(); participant.playback.srcObject = null; }
    participant.destination.stream.getTracks().forEach(track => track.stop());
    this.participants.delete(id); this.route();
  }
  close() {
    this.hostRequest++;
    if (this.host) { this.host.source.disconnect(); this.host.capture.close(); this.host = null; }
    for (const id of [...this.participants.keys()]) this.remove(id);
    void this.context.close();
  }
}
