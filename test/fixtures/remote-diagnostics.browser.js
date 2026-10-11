import { RemoteFrameClock, RemoteFrameDisplay, remoteVideoDiagnostics, remoteFramePresentation } from '../../src/renderer/remote/diagnostics.js';
import { RemoteConnectionRecovery, preferLowLatency } from '../../src/renderer/remote/recovery.js';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const previous = { id: 'video', timestamp: 1000, framesDecoded: 20, bytesReceived: 1000,
  jitterBufferDelay: 2, jitterBufferEmittedCount: 20, totalDecodeTime: .2 };
const current = { ...previous, type: 'inbound-rtp', kind: 'video', timestamp: 3000, framesDecoded: 60,
  bytesReceived: 101000, jitterBufferDelay: 6, jitterBufferEmittedCount: 60, totalDecodeTime: .6, freezeCount: 2 };
const stats = new Map([
  ['video', current], ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
  ['pair', { localCandidateId: 'local', remoteCandidateId: 'remote', currentRoundTripTime: .012 }],
  ['local', { candidateType: 'host' }], ['remote', { candidateType: 'host' }]
]);
let result = remoteVideoDiagnostics(stats, previous);
assert(result.route === 'direct' && result.rtt === 12, 'Selected candidates identify a direct connection and its network round trip');
assert(result.fps === 20 && result.bitrate === 400, 'Video rates use the sampling interval');
assert(result.buffer === 100 && Math.abs(result.decode - 10) < .001, 'Buffer and decoding delays use counter deltas instead of lifetime totals');
stats.get('remote').candidateType = 'relay';
result = remoteVideoDiagnostics(stats, previous);
assert(result.route === 'relay', 'A relay on either side identifies TURN');
assert(Number.isNaN(remoteVideoDiagnostics(stats, null).buffer), 'The first sample does not invent an interval delay');
assert(Number.isNaN(remoteVideoDiagnostics(stats, { ...previous, id: 'old-stream' }).fps), 'Replaced RTP streams do not reuse old counters');
const presentation = remoteFramePresentation(10000, { captureTime: 5600, receiveTime: 5628 });
assert(presentation.captureToReceive === 28 && presentation.receiveToPresent === 4372 && presentation.browserFrameAge === 4400, 'Per-frame timestamps distinguish transport from browser presentation delay');
assert(Number.isNaN(remoteFramePresentation(10000, {}).receiveToPresent), 'Missing browser frame timestamps remain unavailable');
const clock = new RemoteFrameClock();
clock.timestamp = 4950;
assert(Number.isNaN(clock.age(1100)), 'Frame age waits for a clock sample');
clock.synchronize(1000, 5000, 1020);
assert(clock.age(1100) === 140, 'Frame age compensates for different host and client clock origins');
clock.synchronize(1100, 5100, 1600);
assert(clock.age(1100) === 140, 'A delayed control response does not replace the better clock estimate');
assert(clock.age(21100) === 20140, 'A frozen displayed frame keeps aging');
clock.synchronize(70000, 73980, 70020);
clock.timestamp = 73950;
assert(clock.age(70100) === 120, 'Periodic fresh samples follow clock drift');
clock.reset();
assert(Number.isNaN(clock.age(70100)), 'Reconnection clears the previous frame and clock');
const recovery = new RemoteConnectionRecovery();
const display = new RemoteFrameDisplay();
assert(Number.isNaN(display.heldFor(1000)), 'Display diagnostics wait for a displayed frame');
display.observe({ timestamp: 500 }, 'Displayed', 1000);
display.observe({ timestamp: 500 }, 'Displayed', 1100);
assert(display.heldFor(2000) === 1000, 'Repeated sampling of the same video frame does not hide a frozen display');
display.observe(null, 'Unreadable', 2000);
display.observe({ timestamp: 1500 }, 'Unknown viewport', 2100);
assert(display.heldFor(3000) === 2000 && display.reason === 'Unknown viewport', 'Rejected frames keep the displayed frame aging and identify the rejection');
display.observe({ timestamp: 2500 }, 'Displayed', 3100);
assert(display.heldFor(3200) === 100, 'A newly displayed frame clears the hold duration');
display.reset();
assert(Number.isNaN(display.heldFor(3200)) && display.reason === 'Waiting', 'A new transport clears display diagnostics');
assert(recovery.attempt(0), 'An interrupted connection can recover immediately');
assert(!recovery.attempt(29999) && recovery.attempt(30000), 'Connection recovery is rate limited');
recovery.reset();
assert(recovery.attempt(0), 'A fresh session resets interruption recovery');
const modern = { jitterBufferTarget: null }, legacy = { playoutDelayHint: null };
preferLowLatency(modern); preferLowLatency(legacy); preferLowLatency({});
assert(modern.jitterBufferTarget === 0 && legacy.playoutDelayHint === 0, 'Both receiver APIs request low latency in their own units');
preferLowLatency({ set jitterBufferTarget(_) { throw new Error('unsupported'); } });
window.browserTestResult = 'passed';
