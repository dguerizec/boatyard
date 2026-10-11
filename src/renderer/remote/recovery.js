// Retry interrupted transports without restarting a healthy connection based
// on frame age: the latency measurement must remain observable while debugging.
export class RemoteConnectionRecovery {
  constructor() { this.reset(); }
  reset() { this.attemptedAt = -Infinity; }
  attempt(now = performance.now()) {
    if (now - this.attemptedAt < 30000) return false;
    this.attemptedAt = now; return true;
  }
}

export function preferLowLatency(receiver) {
  // Older Chromium versions expose the same preference in seconds.
  try {
    if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0;
    else if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0;
  } catch { /* Browser defaults remain usable when the preference is rejected. */ }
}
