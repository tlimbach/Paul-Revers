import test from 'node:test';
import assert from 'node:assert/strict';
import { reverseSamples, transformSamples } from '../audio.js';

test('reversal preserves the original and reverses every sample', () => {
  const input = new Float32Array([.25, -.5, 1, 0]);
  assert.deepEqual([...reverseSamples(input)], [0, 1, -.5, .25]);
  assert.deepEqual([...input], [.25, -.5, 1, 0]);
});
test('normal playback preserves audio exactly', () => {
  const input = new Float32Array([.1, -.2, .3]);
  assert.deepEqual(transformSamples(input, 48000), input);
});
test('speed sets duration independently of pitch, with finite bounded audio', () => {
  const input = Float32Array.from({ length: 48000 }, (_, i) => .7 * Math.sin(i * 2 * Math.PI * 220 / 48000));
  for (const speed of [.5, 1, 1.5]) for (const pitch of [-7, 0, 7]) {
    const result = transformSamples(input, 48000, speed, pitch);
    assert.equal(result.length, Math.ceil(input.length / speed));
    assert.ok(result.every(value => Number.isFinite(value) && Math.abs(value) <= .701));
  }
});
test('silent recordings stay silent with effects', () => {
  assert.ok(transformSamples(new Float32Array(8000), 8000, .5, 7).every(value => value === 0));
});
