/** Copy first, so the original recording is always preserved. */
export function reverseSamples(samples) {
  return Float32Array.from(samples).reverse();
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
