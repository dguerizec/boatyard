import { RemoteAudioMixer } from '../../src/renderer/remote/audioMixer.js';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const requests = [], changes = [], streams = [];
let devices = [{ kind: 'audioinput', deviceId: 'desk', label: 'Desk microphone' }, { kind: 'audioinput', deviceId: 'headset', label: 'Headset' }];
let failure = false, pending = null;
navigator.mediaDevices.enumerateDevices = async () => devices;
const mixer = new RemoteAudioMixer(muted => changes.push(muted));
const participantStream = mixer.context.createMediaStreamDestination().stream;
mixer.add('alice'); mixer.add('bob');
mixer.receive('alice', participantStream.getAudioTracks()[0]);
check(mixer.participants.get('alice').playback.muted, 'Muted guests cannot play locally');
mixer.setVoice('alice', { allowed: true, selfMuted: false });
check(!mixer.participants.get('alice').playback.muted, 'Allowed guests use native remote playback');
mixer.setVoice('alice', { allowed: false, selfMuted: false });
check(mixer.participants.get('alice').playback.muted, 'Host blocking also stops local playback');
// The fixture never requests a hardware device or generates audible samples.
const stream = () => { const media = mixer.context.createMediaStreamDestination().stream; streams.push(media); return media; };
navigator.mediaDevices.getUserMedia = async constraints => {
  requests.push(constraints);
  check(constraints.video === false, 'Microphone capture never requests a camera');
  check(constraints.audio.echoCancellation && constraints.audio.noiseSuppression && constraints.audio.autoGainControl === false, 'Native echo and noise processing precede one controlled gain stage');
  if (failure) throw new Error('Device capture failed');
  if (pending) return pending;
  return stream();
};
await mixer.setHostDevice('desk');
check(requests.length === 0 && !mixer.host, 'Choosing a microphone while muted never opens it');
await mixer.setHostMuted(false);
check(requests.at(-1).audio.deviceId.exact === 'desk' && requests.at(-1).audio.echoCancellation, 'Unmute uses the selected device and voice processing');
const previous = mixer.host.media;
await mixer.setHostDevice('headset');
check(requests.at(-1).audio.deviceId.exact === 'headset', 'An active microphone switches to the selected device');
check(previous.getTracks().every(track => track.readyState === 'ended') && mixer.host.media !== previous, 'Successful switching releases the old capture');
const active = mixer.host;
failure = true;
try { await mixer.setHostDevice('desk'); throw new Error('Expected capture failure'); }
catch (error) { check(error.message === 'Device capture failed', 'Capture failure is reported'); }
check(mixer.host === active && mixer.hostDeviceId === 'headset', 'A failed switch retains the active microphone and selection');
failure = false; devices = devices.filter(device => device.deviceId !== 'desk');
try { await mixer.setHostDevice('desk'); throw new Error('Expected unavailable device'); }
catch (error) { check(error.message.includes('unavailable'), 'Missing devices cannot silently select another microphone'); }
await mixer.setHostMuted(true);
await mixer.setHostDevice('');
check(!mixer.host && mixer.hostDeviceId === '', 'Choosing System default retains mute');
await mixer.setHostMuted(false);
check(!('deviceId' in requests.at(-1).audio), 'System default leaves device selection to the operating system');
const ended = mixer.host;
ended.media.getAudioTracks()[0].dispatchEvent(new Event('ended'));
await new Promise(resolve => setTimeout(resolve, 0));
check(!mixer.host && changes.at(-1) === true, 'An ended device updates host mute state');
let resolveCapture;
pending = new Promise(resolve => { resolveCapture = resolve; });
const opening = mixer.setHostMuted(false);
await mixer.setHostMuted(true);
const late = stream(); resolveCapture(late);
try { await opening; throw new Error('Expected canceled capture'); }
catch (error) { check(error.message.includes('canceled'), 'Late capture reports cancellation'); }
check(!mixer.host && late.getTracks().every(track => track.readyState === 'ended'), 'A canceled unmute cannot reopen the microphone');
mixer.close();
participantStream.getTracks().forEach(track => track.stop());
check(streams.every(media => media.getTracks().every(track => track.readyState === 'ended')), 'All captures are released');
window.browserTestResult = 'passed';
