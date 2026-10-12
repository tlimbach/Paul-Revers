import test from 'node:test';
import assert from 'node:assert/strict';
import { trimSilence } from '../audio.js';

test('trims long quiet edges, keeping 100ms margins and internal pauses', () => {
  const samples = new Float32Array(4000);
  samples.fill(.2, 1000, 1500);
  samples.fill(.2, 2000, 2500);
  const result = trimSilence(samples, 1000);
  assert.equal(result.length, 1700);
  assert.deepEqual(result, samples.slice(900, 2600));
  assert.equal(samples.length, 4000);
});

test('keeps short pauses and handles silence without an empty audio buffer', () => {
  const samples = new Float32Array(1000);
  samples.fill(.2, 100, 900);
  assert.deepEqual(trimSilence(samples, 1000), samples);
  const silence = new Float32Array(2000);
  assert.deepEqual(trimSilence(silence, 1000), silence);
});

test('detects quiet speech above a low background noise level', () => {
  const samples = new Float32Array(3000).fill(.0005);
  samples.fill(.006, 1000, 2000);
  assert.deepEqual(trimSilence(samples, 1000), samples.slice(900, 2100));
});
