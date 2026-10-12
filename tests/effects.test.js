import test from 'node:test';
import assert from 'node:assert/strict';
import { createHallEffect, createDistortionEffect, distortionCurve } from '../audio.js';

function mockContext() {
  const nodes = [];
  const parameter = () => ({ value: 1, events: [], setTargetAtTime(...event) { this.events.push(event); } });
  const makeNode = () => {
    const node = { gain: parameter(), frequency: parameter(), Q: parameter(), delayTime: parameter(), connections: [],
      connect(destination) { this.connections.push(destination); },
      disconnect() { this.disconnected = true; },
      start() { this.started = true; }, stop() { this.stops = (this.stops || 0) + 1; }
    };
    nodes.push(node); return node;
  };
  return { nodes, currentTime: 5, createGain: makeNode, createOscillator: makeNode, createDelay: makeNode, createBiquadFilter: makeNode, createWaveShaper: makeNode };
}

test('clean bypass and bounded, slowly modulated delay voices', () => {
  const context = mockContext();
  const effect = createHallEffect(context);
  const [input, dry, wet, output] = context.nodes;
  assert.equal(dry.gain.value, 1);
  assert.equal(wet.gain.value, 0);
  assert.deepEqual(dry.connections, [output]);
  assert.deepEqual(wet.connections, [output]);
  let total = 0;
  for (let i = 4; i < context.nodes.length; i += 4) {
    const [delay, voice, modulation, oscillator] = context.nodes.slice(i, i + 4);
    assert.ok(delay.delayTime.value - modulation.gain.value > 0);
    assert.ok(delay.delayTime.value + modulation.gain.value < .3);
    assert.ok(oscillator.frequency.value < 1);
    assert.deepEqual(oscillator.connections, [modulation]);
    assert.deepEqual(modulation.connections, [delay.delayTime]);
    assert.ok(input.connections.includes(delay));
    assert.deepEqual(delay.connections, [voice]);
    assert.deepEqual(voice.connections, [wet]);
    total += voice.gain.value;
  }
  assert.equal(total, 1);
  assert.equal(effect.input, input);
  assert.equal(effect.output, output);
});

test('live mix changes are complementary, clamped and smoothed', () => {
  const context = mockContext();
  const effect = createHallEffect(context, .5);
  const [, dry, wet] = context.nodes;
  assert.equal(dry.gain.value + wet.gain.value, 1);
  for (const amount of [0, .4, 1, 2, -1]) {
    effect.setAmount(amount);
    const strength = Math.max(0, Math.min(2, amount));
    const mix = .8 * Math.min(1, strength) + .2 * Math.max(0, strength - 1);
    assert.deepEqual(dry.gain.events.at(-1), [1 - mix, 5, .02]);
    assert.deepEqual(wet.gain.events.at(-1), [mix, 5, .02]);
  }
});

test('disposing stops the oscillator and disconnects every node exactly once', () => {
  const context = mockContext();
  const effect = createHallEffect(context);
  effect.dispose(); effect.dispose(); effect.setAmount(.5);
  assert.equal(context.nodes.filter(node => node.started).length, 3);
  assert.ok(context.nodes.filter(node => node.started).every(node => node.stops === 1));
  assert.ok(context.nodes.every(node => node.disconnected));
  assert.equal(context.nodes[1].gain.events.length, 0);
});


test('distortion curve adds saturation without DC offset and stays bounded', () => {
  const curve = distortionCurve();
  assert.equal(curve[(curve.length - 1) / 2], 0);
  assert.ok(curve.every(value => Number.isFinite(value) && Math.abs(value) <= .451));
  assert.ok(Math.abs(curve[0] + curve.at(-1)) < 1e-6);
  assert.ok(curve[Math.floor(curve.length * .55)] > .3);
});

test('distortion bypass, live mixing and cleanup work independently', () => {
  const context = mockContext();
  const levelMatch = { connect() {}, disconnect() {} };
  const effect = createDistortionEffect(context, 0, levelMatch);
  const [input, dry, wet, output, highpass, shaper, drive, lowpass] = context.nodes;
  assert.equal(dry.gain.value, 1);
  assert.equal(wet.gain.value, 0);
  assert.deepEqual(input.connections, [dry, highpass, levelMatch]);
  assert.deepEqual(highpass.connections, [drive]);
  assert.deepEqual(drive.connections, [shaper]);
  assert.deepEqual(shaper.connections, [lowpass]);
  assert.deepEqual(lowpass.connections, [levelMatch]);
  assert.deepEqual(wet.connections, [output]);
  effect.setAmount(.7);
  assert.ok(Math.abs(dry.gain.events.at(-1)[0] - .3) < 1e-9);
  assert.deepEqual(wet.gain.events.at(-1), [.7, 5, .02]);
  effect.dispose();
  assert.ok(context.nodes.every(node => node.disconnected));
});


test('200 percent extends hall delays and modulation to twice their old maximum', () => {
  const context = mockContext();
  const effect = createHallEffect(context, 2);
  assert.equal(context.nodes[1].gain.value, 0);
  assert.equal(context.nodes[2].gain.value, 1);
  assert.equal(context.nodes[12].delayTime.value, .29);
  assert.equal(context.nodes[14].gain.value, .024);
  effect.setAmount(1);
  assert.equal(context.nodes[12].delayTime.events.at(-1)[0], .145);
});

test('200 percent increases distortion drive without increasing output ceiling', () => {
  const context = mockContext();
  const levelMatch = { connect() {}, disconnect() {} };
  const effect = createDistortionEffect(context, 2, levelMatch);
  assert.equal(context.nodes[6].gain.value, 4);
  assert.equal(context.nodes[1].gain.value, 0);
  assert.equal(context.nodes[2].gain.value, 1);
  effect.setAmount(1);
  assert.deepEqual(context.nodes[6].gain.events.at(-1), [1, 5, .02]);
  effect.setAmount(3);
  assert.deepEqual(context.nodes[6].gain.events.at(-1), [4, 5, .02]);
});
