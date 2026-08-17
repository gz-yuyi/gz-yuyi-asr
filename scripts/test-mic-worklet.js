import assert from 'node:assert/strict';
import vm from 'node:vm';

import { MIC_CAPTURE_WORKLET_SOURCE } from '../src/core/mic-capture-worklet.js';

let ProcessorClass = null;
class MockAudioWorkletProcessor {
  constructor() {
    this.port = {
      messages: [],
      onmessage: null,
      postMessage: message => this.port.messages.push(message),
    };
  }
}

globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
globalThis.registerProcessor = (name, cls) => {
  assert.equal(name, 'yuyi-pcm-capture');
  ProcessorClass = cls;
};
globalThis.currentFrame = 0;
vm.runInThisContext(MIC_CAPTURE_WORKLET_SOURCE, { filename: 'yuyi-mic-worklet.js' });
assert.ok(ProcessorClass, 'worklet must register its processor');

const processor = new ProcessorClass({ processorOptions: { chunkFrames: 256 } });
const makeInput = value => new Float32Array(128).fill(value);
const output = new Float32Array(128).fill(1);

for (let block = 0; block < 3; block++) {
  globalThis.currentFrame = block * 128;
  assert.equal(processor.process([[makeInput(block + 1)]], [[output]]), true);
  assert.ok(output.every(value => value === 0), 'worklet output must stay silent');
}

// Simulate one missing 128-frame render quantum. The buffered pre-gap samples
// must be emitted separately and the next emitted block must report the gap.
globalThis.currentFrame = 512;
processor.process([[makeInput(4)]], [[output]]);
processor.port.onmessage({ data: { type: 'flush' } });

const sampleMessages = processor.port.messages.filter(message => message.type === 'samples');
assert.deepEqual(sampleMessages.map(message => new Float32Array(message.samples).length), [256, 128, 128]);
assert.deepEqual(sampleMessages.map(message => message.startFrame), [0, 256, 512]);
assert.deepEqual(sampleMessages.map(message => message.gapFrames), [0, 0, 128]);
assert.equal(processor.port.messages.at(-1).type, 'flushed');
assert.ok(new Float32Array(sampleMessages[0].samples).subarray(0, 128).every(value => value === 1));
assert.ok(new Float32Array(sampleMessages[0].samples).subarray(128).every(value => value === 2));

console.log('microphone AudioWorklet tests passed');
