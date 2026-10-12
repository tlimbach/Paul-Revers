import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function processor() {
  let LevelMatch;
  vm.runInNewContext(readFileSync(new URL('../recorder-worklet.js', import.meta.url), 'utf8'), {
    sampleRate: 48000, Float32Array,
    AudioWorkletProcessor: class {},
    registerProcessor(name, implementation) { if (name === 'distortion-level-match') LevelMatch = implementation; }
  });
  return new LevelMatch();
}

test('distorted audio converges to original RMS without exceeding it', () => {
  const effect = processor();
  const dry = Float32Array.from({ length: 128 }, (_, i) => .04 * Math.sin(i * .15));
  const wet = Float32Array.from(dry, value => .45 * Math.tanh(48 * value));
  const output = new Float32Array(128);
  const energy = data => data.reduce((sum, value) => sum + value * value, 0);
  for (let i = 0; i < 400; i++) {
    effect.process([[wet], [dry]], [[output]]);
    assert.ok(energy(output) <= energy(dry) * 1.00001);
  }
  assert.ok(energy(output) > energy(dry) * .99);
  // A sudden quieter phrase / increased distortion must not produce a loud burst.
  const quieter = Float32Array.from(dry, value => value / 4);
  effect.process([[wet], [quieter]], [[output]]);
  assert.ok(energy(output) <= energy(quieter) * 1.00001);
});

test('silence and missing inputs remain silent and finite', () => {
  const effect = processor();
  const output = new Float32Array(128).fill(1);
  effect.process([[], []], [[output]]);
  assert.ok(output.every(value => value === 0));
  effect.process([[new Float32Array(128).fill(.1)], [new Float32Array(128)]], [[output]]);
  assert.ok(output.every(value => value === 0));
});
