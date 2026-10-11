// Level-based expansion complements native echo cancellation and noise suppression.
// It does not identify speakers or cancel acoustic feedback by itself.
export const MICROPHONE_PAUSE_GAIN = 0.005;
export const MICROPHONE_LOOKAHEAD_SECONDS = 0.04;

export class MicrophoneLevel {
  constructor() {
    this.noise = 0.0003;
    this.minimum = Infinity;
    this.windowTime = 0;
    this.hold = 0;
    this.onset = 0;
    this.gain = 1;
    this.envelope = MICROPHONE_PAUSE_GAIN;
  }
  update(rms, peak, seconds) {
    this.minimum = Math.min(this.minimum, rms);
    this.windowTime += seconds;
    if (this.windowTime >= 1) {
      // A bounded lower envelope avoids learning an entire sentence as noise.
      const floor = Math.max(0.0001, Math.min(0.003, this.minimum));
      this.noise += (floor - this.noise) * (floor < this.noise ? 0.8 : 0.15);
      this.minimum = Infinity;
      this.windowTime = 0;
    }
    const threshold = Math.max(0.004, this.noise * 4);
    // A brief key click must not open the microphone for an entire hold period.
    const aboveThreshold = rms > threshold * (this.hold > 0 ? 0.65 : 1);
    const sustained = aboveThreshold && peak < rms * 5;
    this.onset = sustained ? Math.min(0.025, this.onset + seconds) : Math.max(0, this.onset - seconds * 2);
    const active = sustained && (this.hold > 0 || this.onset >= 0.025);
    if (active) this.hold = 0.25;
    else this.hold = Math.max(0, this.hold - seconds);
    if (active) {
      // Boost at most 6 dB, slowly, and never increase gain during a pause.
      const target = Math.max(0.25, Math.min(2, 0.08 / Math.max(rms, 0.0001)));
      const time = target < this.gain ? 0.03 : 2;
      this.gain += (target - this.gain) * (1 - Math.exp(-seconds / time));
    }
    const targetEnvelope = this.hold > 0 ? 1 : MICROPHONE_PAUSE_GAIN;
    this.envelope += (targetEnvelope - this.envelope) * (1 - Math.exp(-seconds / (targetEnvelope > this.envelope ? 0.005 : 0.15)));
    return Math.min(this.gain * this.envelope, peak > 0 ? 0.95 / peak : 2);
  }
}
