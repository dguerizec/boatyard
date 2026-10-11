import { MicrophoneLevel, MICROPHONE_PAUSE_GAIN, MICROPHONE_LOOKAHEAD_SECONDS } from './microphoneLevel.js';

class MicrophoneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.level = new MicrophoneLevel();
    this.previousGain = MICROPHONE_PAUSE_GAIN;
    // Decide whether to open before these samples reach the outgoing track.
    this.delay = new Float32Array(Math.ceil(sampleRate * MICROPHONE_LOOKAHEAD_SECONDS));
    this.position = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0], output = outputs[0]?.[0];
    if (!input || !output) return true;
    let sum = 0, peak = 0;
    for (const sample of input) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
    const gain = this.level.update(Math.sqrt(sum / input.length), peak, input.length / sampleRate);
    for (let i = 0; i < output.length; i++) {
      const interpolated = this.previousGain + (gain - this.previousGain) * (i + 1) / output.length;
      const sample = this.delay[this.position];
      this.delay[this.position] = input[i];
      this.position = (this.position + 1) % this.delay.length;
      output[i] = Math.max(-0.95, Math.min(0.95, sample * interpolated));
    }
    this.previousGain = gain;
    return true;
  }
}
registerProcessor('boatyard-microphone', MicrophoneProcessor);
