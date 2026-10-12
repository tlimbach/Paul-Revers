// Runs on the audio thread. Audio outputs remain silent to avoid feedback.
class VoiceRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(Math.ceil(sampleRate * 60));
    this.length = 0;
    this.done = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'stop') this.finish();
    };
  }

  finish() {
    if (this.done) return;
    this.done = true;
    const samples = this.samples.slice(0, this.length);
    this.port.postMessage({ type: 'complete', samples }, [samples.buffer]);
    this.samples = null;
  }

  process(inputs) {
    if (this.done) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    const count = Math.min(channels[0].length, this.samples.length - this.length);
    for (let i = 0; i < count; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      this.samples[this.length++] = value / channels.length;
    }
    if (this.length === this.samples.length) this.finish();
    return !this.done;
  }
}

registerProcessor('voice-recorder', VoiceRecorder);

// Input 0: distorted voice. Input 1: original voice as a level reference.
class LevelMatch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gain = 1 / 48;
    this.release = Math.exp(-1 / (sampleRate * .08));
  }

  process(inputs, outputs) {
    const wet = inputs[0]?.[0];
    const reference = inputs[1]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!wet || !reference) { output.fill(0); return true; }
    let dryEnergy = 0, wetEnergy = 0;
    for (let i = 0; i < output.length; i++) {
      dryEnergy += (reference[i] || 0) ** 2;
      wetEnergy += (wet[i] || 0) ** 2;
    }
    // Only attenuate: never amplify noise or quiet gaps.
    const target = wetEnergy > 1e-12 ? Math.min(1, Math.sqrt(dryEnergy / wetEnergy)) : this.gain;
    // Immediately catch louder blocks; recover gradually to avoid pumping.
    this.gain = Math.min(this.gain, target);
    for (let i = 0; i < output.length; i++) {
      this.gain = target + (this.gain - target) * this.release;
      output[i] = (wet[i] || 0) * this.gain;
    }
    return true;
  }
}

registerProcessor('distortion-level-match', LevelMatch);
