import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function createRecorder(sampleRate = 8000) {
  let Recorder;
  const messages = [];
  vm.runInNewContext(readFileSync(new URL('../recorder-worklet.js', import.meta.url), 'utf8'), {
    sampleRate, Float32Array,
    AudioWorkletProcessor: class {
      port = { postMessage: message => messages.push(message) };
    },
    registerProcessor: (name, implementation) => { if (name === 'voice-recorder') Recorder = implementation; }
  });
  return { recorder: new Recorder(), messages };
}

test('stop preserves all captured samples including the final partial block', () => {
  const { recorder, messages } = createRecorder();
  recorder.process([[new Float32Array([.25, -.5])]]);
  recorder.process([[new Float32Array([.75])]]);
  recorder.port.onmessage({ data: { type: 'stop' } });
  assert.deepEqual([...messages[0].samples], [.25, -.5, .75]);
  assert.equal(recorder.process([[new Float32Array([1])]]), false);
  recorder.finish();
  assert.equal(messages.length, 1);
});

test('stereo is mixed to mono and missing input is handled', () => {
  const { recorder, messages } = createRecorder();
  recorder.process([[]]);
  recorder.process([[new Float32Array([1, .5]), new Float32Array([-1, .5])]]);
  recorder.finish();
  assert.deepEqual([...messages[0].samples], [0, .5]);
});

test('recording stops at exactly 60 seconds even without the UI timer', () => {
  const { recorder, messages } = createRecorder(10);
  assert.equal(recorder.process([[new Float32Array(700).fill(.5)]]), false);
  assert.equal(messages[0].samples.length, 600);
});
