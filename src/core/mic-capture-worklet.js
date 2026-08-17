// Inline source loaded through a Blob URL. Keeping the processor as a string
// lets the built test console remain one self-contained HTML file while still
// moving capture off the browser main thread.
export const MIC_CAPTURE_WORKLET_SOURCE = `
class YuyiPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = Number(options.processorOptions && options.processorOptions.chunkFrames);
    this.chunkFrames = Math.max(128, Number.isFinite(requested) ? Math.floor(requested) : 1600);
    this.buffer = new Float32Array(this.chunkFrames);
    this.offset = 0;
    this.bufferStartFrame = 0;
    this.expectedFrame = null;
    this.gapFrames = 0;
    this.port.onmessage = event => {
      if (event.data && event.data.type === 'flush') {
        this.emitSamples();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  emitSamples() {
    if (this.offset <= 0) return;
    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage({
      type: 'samples',
      samples: samples.buffer,
      startFrame: this.bufferStartFrame,
      endFrame: this.bufferStartFrame + this.offset,
      gapFrames: this.gapFrames,
    }, [samples.buffer]);
    this.offset = 0;
    this.gapFrames = 0;
  }

  process(inputs, outputs) {
    // The graph remains connected to the destination to prevent browsers from
    // pruning it, but emits silence so microphone audio is never played back.
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }

    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    if (this.expectedFrame != null && currentFrame !== this.expectedFrame) {
      this.emitSamples();
      if (currentFrame > this.expectedFrame) this.gapFrames += currentFrame - this.expectedFrame;
    }

    let inputOffset = 0;
    while (inputOffset < input.length) {
      if (this.offset === 0) this.bufferStartFrame = currentFrame + inputOffset;
      const count = Math.min(this.chunkFrames - this.offset, input.length - inputOffset);
      this.buffer.set(input.subarray(inputOffset, inputOffset + count), this.offset);
      this.offset += count;
      inputOffset += count;
      if (this.offset === this.chunkFrames) this.emitSamples();
    }
    this.expectedFrame = currentFrame + input.length;
    return true;
  }
}
registerProcessor('yuyi-pcm-capture', YuyiPcmCaptureProcessor);
`;
