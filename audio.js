/** Copy first, so the original recording is always preserved. */
export function reverseSamples(samples) {
  return Float32Array.from(samples).reverse();
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
