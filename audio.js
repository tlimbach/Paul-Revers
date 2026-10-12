/** Copy first, so the original recording is always preserved. */
export function reverseSamples(samples) {
  return Float32Array.from(samples).reverse();
}

/** Slow modulated delays create a floating chorus, with a short drifting echo. */
export function createHallEffect(context, amount = 0) {
  const input = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const output = context.createGain();
  const nodes = [input, dry, wet, output];
  const oscillators = [];
  const voices = [];
  input.connect(dry); dry.connect(output); wet.connect(output);

  // Gains sum to one; no feedback and no audio-rate amplitude modulation.
  for (const [base, depth, frequency, level] of [
    [.022, .006, .63, .38],
    [.035, .008, .89, .38],
    [.145, .012, .27, .24]
  ]) {
    const delay = context.createDelay(.6);
    const voice = context.createGain();
    const modulation = context.createGain();
    const oscillator = context.createOscillator();
    delay.delayTime.value = base;
    voice.gain.value = level;
    modulation.gain.value = depth;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    input.connect(delay); delay.connect(voice); voice.connect(wet);
    oscillator.connect(modulation); modulation.connect(delay.delayTime);
    oscillators.push(oscillator);
    voices.push({ delay, modulation, base, depth });
    nodes.push(delay, voice, modulation, oscillator);
  }
  function applyAmount(value, live = false) {
    const strength = Math.max(0, Math.min(2, value));
    const extra = Math.max(0, strength - 1);
    const mix = .8 * Math.min(1, strength) + .2 * extra;
    const set = (param, value, smoothing = .02) => {
      if (live) param.setTargetAtTime(value, context.currentTime, smoothing);
      else param.value = value;
    };
    set(dry.gain, 1 - mix); set(wet.gain, mix);
    for (const { delay, modulation, base, depth } of voices) {
      set(delay.delayTime, base * (1 + extra), .1);
      set(modulation.gain, depth * (1 + extra), .1);
    }
  }
  applyAmount(amount);
  for (const oscillator of oscillators) oscillator.start();
  let disposed = false;
  return {
    input,
    output,
    setAmount(value) {
      if (disposed) return;
      applyAmount(value, true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const oscillator of oscillators) oscillator.stop();
      for (const node of nodes) node.disconnect();
    }
  };
}

/** Saturation adds harmonics; the narrow frequency band gives a tinny radio tone. */
export function distortionCurve(size = 4097) {
  return Float32Array.from({ length: size }, (_, i) => .45 * Math.tanh(12 * (2 * i / (size - 1) - 1)));
}

export function createDistortionEffect(context, amount = 0, levelMatch = new AudioWorkletNode(context, 'distortion-level-match', {
  numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit'
})) {
  const input = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const output = context.createGain();
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass'; highpass.frequency.value = 450; highpass.Q.value = .7;
  const shaper = context.createWaveShaper();
  shaper.curve = distortionCurve(); shaper.oversample = '4x';
  const drive = context.createGain();
  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass'; lowpass.frequency.value = 3000; lowpass.Q.value = .7;
  input.connect(dry); dry.connect(output);
  input.connect(highpass); highpass.connect(drive); drive.connect(shaper); shaper.connect(lowpass);
  lowpass.connect(levelMatch, 0, 0);
  input.connect(levelMatch, 0, 1);
  levelMatch.connect(wet); wet.connect(output);
  const strength = Math.max(0, Math.min(1, amount));
  dry.gain.value = 1 - strength; wet.gain.value = strength;
  drive.gain.value = 1 + 3 * Math.max(0, Math.min(2, amount) - 1);
  let disposed = false;
  return {
    input, output,
    setAmount(value) {
      if (disposed) return;
      const strength = Math.max(0, Math.min(1, value));
      dry.gain.setTargetAtTime(1 - strength, context.currentTime, .02);
      wet.gain.setTargetAtTime(strength, context.currentTime, .02);
      drive.gain.setTargetAtTime(1 + 3 * Math.max(0, Math.min(2, value) - 1), context.currentTime, .02);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const node of [input, dry, wet, output, highpass, shaper, drive, lowpass, levelMatch]) node.disconnect();
      levelMatch.port?.close();
    }
  };
}

/** Trim quiet edges only; keep internal pauses and a short safety margin. */
export function trimSilence(samples, sampleRate) {
  const frameSize = Math.max(1, Math.round(sampleRate * .02));
  const levels = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(start + frameSize, samples.length);
    let energy = 0;
    for (let i = start; i < end; i++) energy += samples[i] ** 2;
    levels.push(Math.sqrt(energy / (end - start)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const peak = sorted.at(-1) || 0;
  if (peak < .001) return samples.slice();
  const noise = sorted[Math.floor(sorted.length * .2)] || 0;
  const threshold = Math.max(.001, Math.min(peak * .2, Math.max(peak * .04, noise * 2.5)));
  const first = levels.findIndex(level => level >= threshold);
  let last = levels.length - 1;
  while (last > first && levels[last] < threshold) last--;
  const padding = Math.round(sampleRate * .1);
  const minimumPause = sampleRate * .25;
  const onset = first * frameSize;
  const ending = Math.min(samples.length, (last + 1) * frameSize);
  const start = onset >= minimumPause ? Math.max(0, onset - padding) : 0;
  const end = samples.length - ending >= minimumPause ? Math.min(samples.length, ending + padding) : samples.length;
  return samples.slice(start, end);
}

/** Integrate the same linear speed ramps used by the audio source. */
export class PlaybackClock {
  constructor(time, rate) {
    this.time = time;
    this.offset = 0;
    this.from = rate;
    this.to = rate;
    this.ramp = 0;
  }

  rateAt(time) {
    const fraction = this.ramp ? Math.min(1, Math.max(0, time - this.time) / this.ramp) : 1;
    return this.from + (this.to - this.from) * fraction;
  }

  positionAt(time) {
    const elapsed = Math.max(0, time - this.time);
    const rampTime = Math.min(elapsed, this.ramp);
    const rampDistance = this.ramp
      ? this.from * rampTime + (this.to - this.from) * rampTime ** 2 / (2 * this.ramp)
      : 0;
    return this.offset + rampDistance + this.to * (elapsed - rampTime);
  }

  change(time, rate, ramp = .03) {
    const from = this.rateAt(time);
    this.offset = this.positionAt(time);
    this.time = time;
    this.from = from;
    this.to = rate;
    this.ramp = ramp;
    return from;
  }
}

/** Overlap short, windowed grains to change pitch independently of duration.
 * This deliberately simple effect is suitable for voices, not studio mastering.
 */
export function transformSamples(samples, sampleRate, speed = 1, semitones = 0) {
  if (!(speed > 0) || !(sampleRate > 0) || !Number.isFinite(semitones)) throw new RangeError('Invalid audio settings');
  if (speed === 1 && semitones === 0) return Float32Array.from(samples);
  const output = new Float32Array(Math.ceil(samples.length / speed));
  const weights = new Float32Array(output.length);
  const pitch = 2 ** (semitones / 12);
  const grain = Math.round(sampleRate * 0.08);
  const hop = Math.max(1, Math.round(grain / 4));
  for (let center = -hop; center < output.length + grain / 2; center += hop) {
    for (let j = 0; j < grain; j++) {
      const offset = j - Math.floor(grain / 2);
      const target = center + offset;
      const source = center * speed + offset * pitch;
      if (target < 0 || target >= output.length || source < 0 || source >= samples.length - 1) continue;
      const base = Math.floor(source);
      const fraction = source - base;
      const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / (grain - 1));
      output[target] += (samples[base] * (1 - fraction) + samples[base + 1] * fraction) * weight;
      weights[target] += weight;
    }
  }
  for (let i = 0; i < output.length; i++) {
    if (weights[i] > 0.00001) output[i] /= weights[i];
    // A tiny fade prevents clicks at the beginning and end.
    output[i] *= Math.min(1, i / (sampleRate * .005), (output.length - 1 - i) / (sampleRate * .005));
  }
  return output;
}
