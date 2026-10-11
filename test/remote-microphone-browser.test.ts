import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { runBrowserTest } from "./helpers/browser";

for (const rate of [44100, 48000]) test(`microphone lookahead preserves voice onset and attenuates a short click at ${rate} Hz`, () => {
  const code = buildSync({ entryPoints: ["src/renderer/remote/microphoneWorklet.js"], bundle: true, write: false, format: "iife" }).outputFiles[0].text;
  type Processor = { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
  let ProcessorClass!: new () => Processor;
  runInNewContext(code, { AudioWorkletProcessor: class {}, sampleRate: rate,
    registerProcessor: (_name: string, processor: new () => Processor) => { ProcessorClass = processor; } });
  const render = (duration: number) => {
    const processor = new ProcessorClass(), samples: number[] = [];
    for (let offset = 0; offset < rate * 0.2; offset += 128) {
      const input = Float32Array.from({ length: 128 }, (_, i) => offset + i < rate * duration ? 0.04 : 0);
      const output = new Float32Array(128);
      assert.equal(processor.process([[input]], [[output]]), true);
      samples.push(...output);
    }
    return samples;
  };
  const voice = render(0.1), delay = Math.ceil(rate * 0.04);
  assert.ok(voice.slice(0, delay).every(value => value === 0), "The buffer adds only the intended lookahead");
  assert.ok(voice[delay] > 0.038, "The first voiced sample passes after the opening decision");
  assert.ok(Math.max(...render(0.01).map(Math.abs)) < 0.001, "A short click remains strongly attenuated");
});

test("host microphone selection preserves mute, switches safely and releases canceled captures", t => {
  runBrowserTest(t, "test/fixtures/remote-microphone.browser.js", undefined, ["build/renderer/remote/microphoneWorklet.js"]);
});

test("microphone processing attenuates pauses, freezes gain and bounds peaks without speaker output", t => {
  runBrowserTest(t, "test/fixtures/microphone-processing.browser.js", undefined, ["build/renderer/remote/microphoneWorklet.js"]);
});

test("hosts can prepare microphones before starting either service or connecting guests", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-microphone-setup.main.cjs", preload: "test/fixtures/remote-access.preload.cjs"
  });
});
