/* Original capture worklet. Mono PCM16-LE at 24 kHz; no AudioContext rate override. */
class CounterchimePCM extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const actualRate = options.processorOptions?.inputSampleRate || sampleRate;
    this.ratio = actualRate / 24000;
    this.nextSourcePosition = 0;
    this.totalInputFrames = 0;
    this.previousSample = 0;
    this.chunk = new ArrayBuffer(480 * 2); // 20 ms, amortizes WebSocket overhead.
    this.view = new DataView(this.chunk);
    this.chunkSamples = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    const length = channels[0].length;
    const base = this.totalInputFrames;
    const last = base + length - 1;
    const sampleAt = (index) => {
      if (index < base) return this.previousSample;
      let total = 0;
      for (const channel of channels) total += channel[index - base] || 0;
      return total / channels.length;
    };
    // Keep fractional phase and the boundary sample across 128-frame render
    // quanta. Flooring the output length per block drifts badly at 44.1 kHz.
    while (this.nextSourcePosition <= last) {
      const lower = Math.floor(this.nextSourcePosition);
      const fraction = this.nextSourcePosition - lower;
      if (fraction > 1e-9 && lower + 1 > last) break;
      const a = sampleAt(lower);
      const value = fraction <= 1e-9 ? a : a + (sampleAt(lower + 1) - a) * fraction;
      const clipped = Math.max(-1, Math.min(1, value));
      const pcm = Math.round(clipped < 0 ? clipped * 32768 : clipped * 32767);
      this.view.setInt16(this.chunkSamples * 2, pcm, true);
      this.chunkSamples += 1;
      if (this.chunkSamples === 480) {
        this.port.postMessage(this.chunk, [this.chunk]);
        this.chunk = new ArrayBuffer(480 * 2);
        this.view = new DataView(this.chunk);
        this.chunkSamples = 0;
      }
      this.nextSourcePosition += this.ratio;
    }
    this.previousSample = sampleAt(last);
    this.totalInputFrames += length;
    // Outputs deliberately stay silent. A zero-gain sink keeps capture active.
    return true;
  }
}
registerProcessor('counterchime-pcm', CounterchimePCM);
