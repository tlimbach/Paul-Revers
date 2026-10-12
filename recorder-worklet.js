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
