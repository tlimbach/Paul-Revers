import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock } from '../audio.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('position integrates speed before, during and after a live change', () => {
  const clock = new PlaybackClock(10, 1);
  near(clock.positionAt(12), 2);
  clock.change(12, 2);
  near(clock.positionAt(12), 2);
  near(clock.rateAt(12.015), 1.5);
  near(clock.positionAt(12.03), 2.045);
  near(clock.positionAt(13), 3.985);
});

test('rapid slider changes keep position and rate continuous', () => {
  const clock = new PlaybackClock(0, 1);
  clock.change(1, 2);
  const before = clock.positionAt(1.015);
  near(clock.change(1.015, .5), 1.5);
  near(clock.positionAt(1.015), before);
  near(clock.positionAt(1.045), before + .03);
  near(clock.positionAt(2.045), before + .53);
});
