import { MicrophoneLevel, MICROPHONE_PAUSE_GAIN } from '../../src/renderer/remote/microphoneLevel.js';
import { openMicrophone } from '../../src/renderer/remote/microphone.js';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const level = new MicrophoneLevel();
const run = (rms, seconds, peak = rms * 2) => { let result; for (let i = 0; i < seconds * 100; i++) result = level.update(rms, peak, 0.01); return result; };
const quiet = run(0.0005, 2);
check(quiet < 0.05, 'Low background noise is attenuated during pauses');
check(run(0.02, 0.05) > 0.9, 'Sustained voice opens rapidly');
run(0.02, 4);
const speechGain = level.gain;
check(speechGain > 1 && speechGain <= 2, 'Quiet speech receives bounded automatic gain');
run(0.0005, 2);
check(level.gain === speechGain && level.envelope < 0.006, 'Pauses do not increase gain and close softly');
check(run(0.5, 0.1, 1) <= 0.95, 'Loud inputs cannot request clipped output');
run(0.0005, 1);
run(0.015, 0.05);
check(level.envelope > 0.95, 'A quiet voice reopens after a loud input');

const background = new MicrophoneLevel();
for (let i = 0; i < 500; i++) background.update(0.003, 0.006, 0.01);
check(background.hold === 0 && background.gain === 1 && background.envelope === MICROPHONE_PAUSE_GAIN, 'Weak sustained sound cannot open the gate or increase gain');
const clicks = new MicrophoneLevel();
for (let i = 0; i < 30; i++) {
  clicks.update(0.06, 0.15, 0.01);
  for (let pause = 0; pause < 4; pause++) clicks.update(0.0005, 0.001, 0.01);
  check(clicks.hold === 0 && clicks.envelope === MICROPHONE_PAUSE_GAIN && clicks.gain === 1, 'Repeated short clicks do not open the gate or increase gain');
}
for (let i = 0; i < 10; i++) clicks.update(0.01, 0.1, 0.01);
check(clicks.hold === 0, 'High-crest impulses are not mistaken for sustained input');
for (let i = 0; i < 5; i++) clicks.update(0.02, 0.04, 0.01);
check(clicks.envelope > 0.95, 'Normal voice can open after rejected clicks');

// Exercise the actual worklet graph with synthetic audio, never connected to speakers.
const context = new AudioContext();
const oscillator = context.createOscillator(), inputGain = context.createGain(), input = context.createMediaStreamDestination();
inputGain.gain.value = 0.0005;
oscillator.connect(inputGain); inputGain.connect(input); oscillator.start();
navigator.mediaDevices.getUserMedia = async () => input.stream;
const capture = await openMicrophone(context);
const analyser = context.createAnalyser(); analyser.fftSize = 2048;
const output = context.createMediaStreamSource(capture.stream); output.connect(analyser);
const data = new Float32Array(analyser.fftSize);
const rms = () => { analyser.getFloatTimeDomainData(data); return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length); };
await new Promise(resolve => setTimeout(resolve, 700));
check(rms() < 0.00005, 'Worklet output suppresses a quiet background');
inputGain.gain.value = 0.004;
await new Promise(resolve => setTimeout(resolve, 300));
check(rms() < 0.00005, 'A weak distant signal stays attenuated in the real worklet');
inputGain.gain.value = 0.04;
await new Promise(resolve => setTimeout(resolve, 150));
check(rms() > 0.02, 'Speech-level signal passes through the worklet');
inputGain.gain.value = 0.0005;
await new Promise(resolve => setTimeout(resolve, 1200));
check(rms() < 0.0001, 'Worklet output attenuates the following pause');
capture.close();
check(capture.media.getTracks().every(track => track.readyState === 'ended') && capture.stream.getTracks().every(track => track.readyState === 'ended'), 'Closing releases raw and processed tracks');
oscillator.stop(); output.disconnect(); await context.close();
const failedContext = new AudioContext(), failedMedia = failedContext.createMediaStreamDestination().stream;
navigator.mediaDevices.getUserMedia = async () => failedMedia;
failedContext.audioWorklet.addModule = async () => { throw new Error('Worklet load failed'); };
try { await openMicrophone(failedContext); throw new Error('Expected worklet failure'); }
catch (error) { check(error.message === 'Worklet load failed', 'Processing failure is reported'); }
check(failedMedia.getTracks().every(track => track.readyState === 'ended'), 'Processing failure releases the raw microphone');
await failedContext.close();
window.browserTestResult = 'passed';
