const WAV_HEADER_BYTES = 44;

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function pcm16WavBlob(channelSamples, sampleRate, sampleToPcm16) {
  const channelCount = channelSamples.length;
  const frameCount = channelSamples[0]?.length ?? 0;
  const normalizedSampleRate = Math.round(Number(sampleRate));
  if (!channelCount || channelCount > 0xffff) throw new Error('音频声道数无效');
  if (!frameCount || channelSamples.some(samples => samples.length !== frameCount)) {
    throw new Error('音频采样数据为空或长度不一致');
  }
  if (!Number.isFinite(normalizedSampleRate) || normalizedSampleRate <= 0) {
    throw new Error('音频采样率无效');
  }

  const blockAlign = channelCount * 2;
  const dataSize = frameCount * blockAlign;
  if (dataSize > 0xffffffff - 36) throw new Error('音频片段过大，无法导出为 WAV');

  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, normalizedSampleRate, true);
  view.setUint32(28, normalizedSampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const converted = Number(sampleToPcm16(channelSamples[channel][frame]));
      const sample = Number.isFinite(converted)
        ? Math.max(-32768, Math.min(32767, Math.round(converted)))
        : 0;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function floatSampleToPcm16(value) {
  const sample = Math.max(-1, Math.min(1, Number(value) || 0));
  return sample < 0 ? sample * 0x8000 : sample * 0x7fff;
}

export function monoPcm16WavBlob(samples, sampleRate) {
  return pcm16WavBlob([samples], sampleRate, value => value);
}

export function audioBufferRangeToWavBlob(audioBuffer, startSeconds, endSeconds) {
  const channelCount = Number(audioBuffer?.numberOfChannels);
  const sampleRate = Number(audioBuffer?.sampleRate);
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  if (!Number.isInteger(channelCount) || channelCount <= 0 || typeof audioBuffer?.getChannelData !== 'function') {
    throw new Error('音频尚未解析完成');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('音频采样率无效');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('音频片段时间范围无效');
  }

  const channels = Array.from({ length: channelCount }, (_, channel) => audioBuffer.getChannelData(channel));
  const frameLength = channels.reduce(
    (length, samples) => Math.min(length, Number(samples?.length) || 0),
    Number.POSITIVE_INFINITY,
  );
  const startFrame = Math.max(0, Math.min(frameLength, Math.floor(start * sampleRate)));
  const endFrame = Math.max(0, Math.min(frameLength, Math.ceil(end * sampleRate)));
  if (!Number.isFinite(frameLength) || endFrame <= startFrame) {
    throw new Error('音频片段超出可下载范围');
  }

  const ranges = channels.map(samples => samples.subarray(startFrame, endFrame));
  return pcm16WavBlob(ranges, sampleRate, floatSampleToPcm16);
}
