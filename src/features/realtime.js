import { $, qsa } from '../core/dom.js';
import { persistEndpointSettings } from '../core/api.js';
import { appendLog, appendLogRaw } from '../core/logger.js';
import { esc, pretty, safeParse } from '../core/format.js';
import { toast } from '../core/toast.js';

const realtime = {
  ws: null,
  sending: false,
  chunksSent: 0,
  totalChunks: 0,
  messages: 0,
  segments: new Map(),
  supersededSegments: new Set(),
  previewAudioBuffer: null,
  previewSource: null,
  previewCtx: null,
  micStream: null,
  micAudioCtx: null,
  micProcessor: null,
  micRecording: false,
  micChunks: [],
  micSampleRate: 16000,
  micDownloadUrl: null,
  micDownloadName: '',
  micStartTime: 0,
  micTimer: null,
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function summarizeRealtimeEvent(json) {
  const type = json.type || 'Unknown';
  if (type === 'SessionStarted') {
    return `SessionStarted session=${json.session_id || ''}`;
  }
  if (type === 'SessionCompleted') {
    return `SessionCompleted session=${json.session_id || ''}`;
  }
  if (type === 'ErrorResponse') {
    return `ErrorResponse code=${json.code || ''} message=${json.message || ''}`;
  }
  if (type === 'TranscriptUpdate') {
    const seg = json.segment_id || '';
    const rev = json.revision ?? '';
    const src = json.source || '';
    const spk = json.speaker_id != null ? ` speaker=${json.speaker_id}` : '';
    const emo = json.emotion ? ` emotion=${json.emotion}` : '';
    const parent = json.parent_segment_id ? ` parent=${json.parent_segment_id}` : '';
    const supersedes = json.supersedes_segment_id ? ` supersedes=${json.supersedes_segment_id}` : '';
    const preview = (json.text || '').slice(0, 80);
    return `TranscriptUpdate seg=${seg} rev=${rev} source=${src}${spk}${emo}${parent}${supersedes} text=${preview}`;
  }
  return pretty(json);
}

function setWsStatus(label, kind) {
  $('wsChip').className = `chip ${kind}`;
  $('wsChipLabel').textContent = label;
}

function updateStats() {
  $('statsLabel').textContent = `chunks: ${realtime.chunksSent} · messages: ${realtime.messages}`;
}

function updateProgress() {
  const pct = realtime.totalChunks > 0
    ? Math.min(100, (realtime.chunksSent / realtime.totalChunks) * 100)
    : 0;
  $('sendProgressFill').style.width = `${pct}%`;
}

function drawWaveform(canvas, audioBuffer, color = '#3b82f6') {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  const data = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.ceil(data.length / Math.max(1, width)));
  const half = height / 2;
  ctx.fillStyle = color;

  for (let x = 0; x < width; x++) {
    let min = 1;
    let max = -1;
    for (let j = 0; j < step; j++) {
      const val = data[x * step + j] || 0;
      if (val < min) min = val;
      if (val > max) max = val;
    }
    const y1 = (1 + min) * half;
    const y2 = (1 + max) * half;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  ctx.globalAlpha = 1;
}

function drawLiveChunk(canvas, chunk) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.floor(rect.width * dpr)) {
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const shiftPx = Math.max(2, Math.ceil(width / 200));
  ctx.clearRect(0, 0, width, height);
  ctx.putImageData(imgData, -shiftPx * dpr, 0);

  const int16 = new Int16Array(chunk);
  let min = 0;
  let max = 0;
  for (let i = 0; i < int16.length; i++) {
    if (int16[i] < min) min = int16[i];
    if (int16[i] > max) max = int16[i];
  }
  const half = height / 2;
  const y1 = half + (min / 32768) * half;
  const y2 = half + (max / 32768) * half;
  ctx.fillStyle = '#22c55e';
  ctx.globalAlpha = 0.65;
  ctx.fillRect(width - shiftPx, y1, shiftPx, Math.max(1, y2 - y1));
  ctx.globalAlpha = 1;
}

async function decodeToPcm16(file, targetRate = 16000) {
  const bytes = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const decoded = await audioCtx.decodeAudioData(bytes.slice(0));
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
  const source = offline.createBufferSource();
  const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
  const output = mono.getChannelData(0);

  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < data.length; i++) output[i] += data[i] / decoded.numberOfChannels;
  }

  source.buffer = mono;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const data = rendered.getChannelData(0);
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  await audioCtx.close();
  return int16.buffer;
}

function floatToPcm16Sample(value) {
  const s = Math.max(-1, Math.min(1, value));
  return s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
}

function createStreamingPcm16Resampler(sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) {
    return input => {
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) int16[i] = floatToPcm16Sample(input[i]);
      return int16;
    };
  }

  const ratio = sourceRate / targetRate;
  let carry = new Float32Array(0);
  let sourcePosition = 0;

  return input => {
    const extended = new Float32Array(carry.length + input.length);
    extended.set(carry);
    extended.set(input, carry.length);
    const out = [];

    while (sourcePosition + 1 < extended.length) {
      const index = Math.floor(sourcePosition);
      const fraction = sourcePosition - index;
      const sample = extended[index] + (extended[index + 1] - extended[index]) * fraction;
      out.push(floatToPcm16Sample(sample));
      sourcePosition += ratio;
    }

    const keepFrom = Math.max(0, Math.floor(sourcePosition));
    carry = extended.slice(keepFrom);
    sourcePosition -= keepFrom;
    return new Int16Array(out);
  };
}

function concatFloat32Chunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function encodeWav(int16, sampleRate = 16000) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + int16.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + int16.length * bytesPerSample, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, int16.length * bytesPerSample, true);
  for (let i = 0; i < int16.length; i++) {
    view.setInt16(44 + i * bytesPerSample, int16[i], true);
  }
  return buffer;
}

function requireMediaDevices() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    throw new Error('当前环境不支持麦克风录音，请使用 HTTPS、localhost 或 127.0.0.1 打开');
  }
  return navigator.mediaDevices;
}

async function handleRealtimeFileChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  $('waveformPlaceholder').classList.add('hidden');
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    realtime.previewCtx = realtime.previewCtx || new AudioCtx();
    const buffer = await file.arrayBuffer();
    realtime.previewAudioBuffer = await realtime.previewCtx.decodeAudioData(buffer.slice(0));
    drawWaveform($('waveformCanvas'), realtime.previewAudioBuffer);
    $('waveformInfo').innerHTML = `
      <span>${realtime.previewAudioBuffer.duration.toFixed(2)}s</span>
      <span>${realtime.previewAudioBuffer.sampleRate} Hz</span>
      <span>${realtime.previewAudioBuffer.numberOfChannels} ch</span>
      <span>${(file.size / 1024).toFixed(1)} KB</span>
    `;
    $('playAudioBtn').disabled = false;
    toast(`已加载: ${file.name}`, 'success');
  } catch (err) {
    $('waveformPlaceholder').textContent = '无法解码此音频格式';
    $('waveformPlaceholder').classList.remove('hidden');
    $('waveformInfo').innerHTML = '';
    $('playAudioBtn').disabled = true;
    toast(`音频解码失败: ${err.message}`, 'error');
  }
}

function playPreviewAudio() {
  if (!realtime.previewAudioBuffer || !realtime.previewCtx) return;
  if (realtime.previewSource) {
    realtime.previewSource.stop();
    realtime.previewSource = null;
  }
  realtime.previewSource = realtime.previewCtx.createBufferSource();
  realtime.previewSource.buffer = realtime.previewAudioBuffer;
  realtime.previewSource.connect(realtime.previewCtx.destination);
  realtime.previewSource.start();
  $('playAudioBtn').disabled = true;
  $('stopAudioBtn').disabled = false;
  realtime.previewSource.onended = () => {
    $('playAudioBtn').disabled = false;
    $('stopAudioBtn').disabled = true;
    realtime.previewSource = null;
  };
}

function stopPreviewAudio() {
  if (realtime.previewSource) {
    realtime.previewSource.stop();
    realtime.previewSource = null;
  }
  $('playAudioBtn').disabled = false;
  $('stopAudioBtn').disabled = true;
}

function buildWsUrl() {
  const raw = $('wsBase').value.trim();
  const url = new URL(raw);
  const params = url.searchParams;
  const audioEncoding = $('audioEncoding').value;
  params.set('audio_encoding', audioEncoding);
  params.set('sample_rate', audioEncoding === 'pcm_s16le' ? '16000' : ($('sampleRate').value || '16000'));
  params.set('enable_speaker', $('enableSpeaker').value);

  const optionals = [
    ['speaker_num', 'speakerNum'],
    ['vad_threshold', 'vadThreshold'],
    ['vad_min_silence_duration_ms', 'vadMinSilence'],
    ['hotword_id', 'realtimeHotwordId'],
    ['context', 'realtimeContext'],
    ['number_normalization_mode', 'realtimeNumberMode'],
    ['filler_filter_mode', 'realtimeFillerMode'],
    ['profanity_filter_mode', 'realtimeProfanityMode'],
  ];
  for (const [param, elId] of optionals) {
    const value = $(elId).value.trim();
    if (value) params.set(param, value);
    else params.delete(param);
  }
  return url.toString();
}

function clearRealtimeState() {
  realtime.chunksSent = 0;
  realtime.totalChunks = 0;
  realtime.messages = 0;
  realtime.segments.clear();
  realtime.supersededSegments.clear();
  updateStats();
  updateProgress();
  rebuildSegments();
  $('realtimeLog').innerHTML = '';
}

async function sendAudio(file) {
  const mode = $('streamMode').value;
  const ws = realtime.ws;
  const chunkMs = Math.max(1, Number($('chunkMs').value || 100));
  const sleepMs = Math.max(0, Number($('sleepMs').value || 0));
  const liveCanvas = $('liveWaveCanvas');
  const ctx = liveCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = liveCanvas.getBoundingClientRect();
  liveCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
  liveCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);

  realtime.sending = true;
  realtime.chunksSent = 0;
  realtime.totalChunks = 0;
  updateStats();
  updateProgress();

  try {
    if (mode === 'decode_pcm') {
      appendLog($('realtimeLog'), '正在浏览器端解码为 PCM16LE...', 'log-info', 'info');
      const sampleRate = 16000;
      const pcm = await decodeToPcm16(file, sampleRate);
      const bytesPerMs = sampleRate * 2 / 1000;
      const chunkBytes = Math.max(2, Math.floor(chunkMs * bytesPerMs / 2) * 2);
      const bytes = new Uint8Array(pcm);
      realtime.totalChunks = Math.ceil(bytes.length / chunkBytes);
      appendLog($('realtimeLog'), `解码完成，共 ${bytes.length} 字节，将分 ${realtime.totalChunks} 块发送`, 'log-info', 'info');
      for (let off = 0; off < bytes.length; off += chunkBytes) {
        if (ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket 已关闭');
        const chunk = bytes.slice(off, off + chunkBytes);
        ws.send(chunk);
        drawLiveChunk(liveCanvas, chunk.buffer);
        realtime.chunksSent++;
        updateStats();
        updateProgress();
        if (sleepMs > 0) await sleep(sleepMs);
      }
    } else if (mode === 'raw_once') {
      const buf = await file.arrayBuffer();
      ws.send(buf);
      realtime.chunksSent = 1;
      realtime.totalChunks = 1;
      updateStats();
      updateProgress();
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const rawChunkBytes = Math.max(1024, Number($('rawChunkBytes').value || 65536));
      realtime.totalChunks = Math.ceil(bytes.length / rawChunkBytes);
      for (let off = 0; off < bytes.length; off += rawChunkBytes) {
        if (ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket 已关闭');
        ws.send(bytes.slice(off, off + rawChunkBytes));
        realtime.chunksSent++;
        updateStats();
        updateProgress();
        if (sleepMs > 0) await sleep(sleepMs);
      }
    }

    appendLog($('realtimeLog'), `音频发送完成: ${file.name}`, 'log-sent', 'info');
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('stop');
      appendLog($('realtimeLog'), '>>> stop (文件发送完成后自动结束会话)', 'log-sent', 'info');
    }
    toast('音频发送完成', 'success');
  } catch (err) {
    appendLog($('realtimeLog'), `发送失败: ${err.message}`, 'log-err', 'error');
    toast(`发送失败: ${err.message}`, 'error');
  } finally {
    realtime.sending = false;
  }
}

function rebuildSegments() {
  const rows = [...realtime.segments.values()]
    .filter(seg => !realtime.supersededSegments.has(seg.segment_id || ''))
    .sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0));

  if (rows.length === 0) {
    $('segTbody').innerHTML = '<tr><td colspan="9" class="seg-empty">等待转写结果...</td></tr>';
    return;
  }

  $('segTbody').innerHTML = rows.map(seg => {
    const isFinal = seg.source === 'final'
      || seg.source === 'offline_asr'
      || seg.source === 'speaker_refine'
      || seg.is_final;
    const badge = isFinal
      ? '<span class="badge badge-final">final</span>'
      : '<span class="badge badge-partial">partial</span>';
    return `<tr>
      <td>${badge}</td>
      <td class="mono">${esc(seg.segment_id || '')}</td>
      <td class="mono">${esc(seg.parent_segment_id || '')}</td>
      <td class="mono">${esc(seg.supersedes_segment_id || '')}</td>
      <td class="mono">${seg.revision ?? ''}</td>
      <td>${esc(seg.source || '')}</td>
      <td>${seg.speaker_id != null ? `S${esc(seg.speaker_id)}` : ''}</td>
      <td>${esc(seg.emotion || seg.emotion_state || '')}</td>
      <td class="seg-text">${esc(seg.text || '')}</td>
    </tr>`;
  }).join('');
}

function setupWsHandlers(ws) {
  ws.onmessage = event => {
    realtime.messages++;
    updateStats();
    const json = safeParse(event.data);
    if (!json) {
      appendLog($('realtimeLog'), `收到文本帧 ${String(event.data).slice(0, 120)}`, 'log-recv', 'info');
      appendLogRaw($('realtimeLog'), event.data, 'log-recv', 'debug');
      return;
    }
    appendLog(
      $('realtimeLog'),
      summarizeRealtimeEvent(json),
      json.type === 'ErrorResponse' ? 'log-err' : 'log-recv',
      json.type === 'ErrorResponse' ? 'error' : 'info',
    );
    appendLogRaw($('realtimeLog'), pretty(json), 'log-recv', 'debug');
    if (json.type === 'TranscriptUpdate') {
      if (json.supersedes_segment_id) realtime.supersededSegments.add(json.supersedes_segment_id);
      const current = realtime.segments.get(json.segment_id);
      if (!current || (json.revision ?? 0) >= (current.revision ?? 0)) {
        realtime.segments.set(json.segment_id, json);
        rebuildSegments();
      }
    }
  };
  ws.onerror = () => {
    setWsStatus('连接错误', 'error');
    appendLog($('realtimeLog'), 'WebSocket 发生错误', 'log-err', 'error');
    toast('WebSocket 连接出错', 'error');
  };
  ws.onclose = event => {
    const ok = event.code === 1000;
    setWsStatus(`已断开 (${event.code})`, ok ? 'warn' : 'error');
    appendLog($('realtimeLog'), `连接关闭 code=${event.code} reason=${event.reason || ''}`, ok ? 'log-info' : 'log-err', ok ? 'info' : 'error');
    if (realtime.micRecording) stopMic();
  };
}

function connectAndSendFile() {
  const file = $('realtimeFile').files[0];
  if (!file) {
    toast('请先选择音频文件', 'error');
    return;
  }
  let url;
  try {
    url = buildWsUrl();
  } catch (err) {
    toast(`WebSocket URL 无效: ${err.message}`, 'error');
    return;
  }

  clearRealtimeState();
  appendLog($('realtimeLog'), `连接 ${url}`, 'log-info', 'info');
  setWsStatus('连接中...', 'warn');
  const ws = new WebSocket(url);
  realtime.ws = ws;
  ws.onopen = async () => {
    setWsStatus('已连接', 'ok');
    appendLog($('realtimeLog'), '连接成功，开始发送音频', 'log-sent', 'info');
    toast('WebSocket 已连接', 'success');
    await sendAudio(file);
  };
  setupWsHandlers(ws);
}

function updateMicTimer() {
  const elapsed = Math.floor((Date.now() - realtime.micStartTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  $('micTimerLabel').textContent = `${mm}:${ss}`;
}

function setMicUI(recording) {
  $('micCircle').classList.toggle('recording', recording);
  $('micHeroText').textContent = recording ? '正在录制并实时发送...' : '点击下方按钮开始录制';
  $('micTimerWrap').classList.toggle('hidden', !recording);
  $('micBtn').classList.toggle('hidden', recording);
  $('micStopBtn').classList.toggle('hidden', !recording);
  $('connectBtn').disabled = recording;
}

function resetRealtimeMicDownload() {
  if (realtime.micDownloadUrl) URL.revokeObjectURL(realtime.micDownloadUrl);
  realtime.micDownloadUrl = null;
  realtime.micDownloadName = '';
  $('micDownloadBtn').classList.add('hidden');
  $('micDownloadHint').textContent = '录制结束后可下载最近一次录音';
}

function prepareRealtimeMicDownload(chunks, sampleRate) {
  if (!chunks.length) {
    $('micDownloadHint').textContent = '本次录音没有捕获到可下载的音频';
    return;
  }
  const samples = concatFloat32Chunks(chunks);
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) int16[i] = floatToPcm16Sample(samples[i]);
  const wav = encodeWav(int16, sampleRate);
  const blob = new Blob([wav], { type: 'audio/wav' });
  const durationSec = sampleRate > 0 ? int16.length / sampleRate : 0;
  const filename = `realtime-mic-${Date.now()}.wav`;
  if (realtime.micDownloadUrl) URL.revokeObjectURL(realtime.micDownloadUrl);
  realtime.micDownloadUrl = URL.createObjectURL(blob);
  realtime.micDownloadName = filename;
  $('micDownloadBtn').classList.remove('hidden');
  $('micDownloadHint').textContent = `最近录音已就绪：${filename} · ${durationSec.toFixed(1)}s`;
}

function stopMic() {
  const chunks = realtime.micChunks.slice();
  const sampleRate = realtime.micSampleRate || 16000;
  realtime.micRecording = false;
  realtime.micChunks = [];
  if (realtime.micTimer) clearInterval(realtime.micTimer);
  realtime.micTimer = null;
  if (realtime.micProcessor) realtime.micProcessor.disconnect();
  realtime.micProcessor = null;
  if (realtime.micStream) realtime.micStream.getTracks().forEach(track => track.stop());
  realtime.micStream = null;
  if (realtime.micAudioCtx) realtime.micAudioCtx.close();
  realtime.micAudioCtx = null;
  setMicUI(false);
  appendLog($('realtimeLog'), '麦克风录制已停止', 'log-info', 'info');
  toast('录制已停止', 'info');
  try {
    prepareRealtimeMicDownload(chunks, sampleRate);
  } catch (err) {
    appendLog($('realtimeLog'), `生成下载音频失败: ${err.message}`, 'log-err', 'error');
  }
}

async function startMic() {
  if (realtime.micRecording) return;
  $('audioEncoding').value = 'pcm_s16le';
  $('sampleRate').value = '16000';
  clearRealtimeState();
  resetRealtimeMicDownload();

  let stream;
  try {
    stream = await requireMediaDevices().getUserMedia({
      audio: { sampleRate: { ideal: 16000 }, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    toast(`麦克风不可用: ${err.message}`, 'error');
    appendLog($('realtimeLog'), `麦克风获取失败: ${err.message}`, 'log-err', 'error');
    return;
  }
  realtime.micStream = stream;

  let url;
  try {
    url = buildWsUrl();
  } catch (err) {
    toast(`WebSocket URL 无效: ${err.message}`, 'error');
    realtime.micStream.getTracks().forEach(track => track.stop());
    realtime.micStream = null;
    return;
  }
  appendLog($('realtimeLog'), `连接 ${url}`, 'log-info', 'info');
  setWsStatus('连接中...', 'warn');
  const ws = new WebSocket(url);
  realtime.ws = ws;
  setupWsHandlers(ws);

  ws.onopen = () => {
    setWsStatus('已连接 (麦克风)', 'ok');
    appendLog($('realtimeLog'), '连接成功，开始麦克风录制', 'log-sent', 'info');
    toast('麦克风录制中', 'success');
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx({ sampleRate: 16000 });
    realtime.micAudioCtx = audioCtx;
    realtime.micSampleRate = audioCtx.sampleRate || 16000;
    realtime.micChunks = [];
    appendLog($('realtimeLog'), `麦克风实际采样率 ${realtime.micSampleRate}Hz，发送给 WS 的 PCM 固定重采样为 16000Hz`, 'log-info', 'info');

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    realtime.micProcessor = processor;
    const resampleToPcm16 = createStreamingPcm16Resampler(realtime.micSampleRate, 16000);
    const liveCanvas = $('liveWaveCanvas');
    processor.onaudioprocess = event => {
      if (!realtime.micRecording || ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      realtime.micChunks.push(new Float32Array(input));
      const int16 = resampleToPcm16(input);
      if (int16.length === 0) return;
      ws.send(int16.buffer);
      realtime.chunksSent++;
      updateStats();
      drawLiveChunk(liveCanvas, int16.buffer);
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);
    realtime.micRecording = true;
    realtime.micStartTime = Date.now();
    realtime.micTimer = setInterval(updateMicTimer, 500);
    updateMicTimer();
    setMicUI(true);
  };
}

function syncWsUrlFromHttp() {
  const base = $('httpBase')?.value?.trim();
  if (!base) return;
  try {
    const url = new URL(base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/api/realtime/ws';
    url.search = '';
    $('wsBase').value = url.toString();
    persistEndpointSettings();
    toast('WS URL 已按 HTTP 地址重置', 'info');
  } catch (err) {
    toast(`HTTP Base URL 无效: ${err.message}`, 'error');
  }
}

function registerSourceTabs() {
  qsa('.source-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      qsa('.source-tab').forEach(item => item.classList.remove('active'));
      qsa('.source-panel').forEach(panel => panel.classList.remove('active'));
      tab.classList.add('active');
      $(`source-${tab.dataset.source}`).classList.add('active');
    });
  });
}

export function registerRealtime() {
  registerSourceTabs();
  updateStats();
  updateProgress();
  $('realtimeFile').addEventListener('change', handleRealtimeFileChange);
  $('playAudioBtn').addEventListener('click', playPreviewAudio);
  $('stopAudioBtn').addEventListener('click', stopPreviewAudio);
  window.addEventListener('resize', () => {
    if (realtime.previewAudioBuffer) drawWaveform($('waveformCanvas'), realtime.previewAudioBuffer);
  });
  $('connectBtn').addEventListener('click', connectAndSendFile);
  $('micBtn').addEventListener('click', startMic);
  $('micStopBtn').addEventListener('click', () => {
    if (realtime.ws?.readyState === WebSocket.OPEN) {
      realtime.ws.send('stop');
      appendLog($('realtimeLog'), '>>> stop (录制结束)', 'log-sent', 'info');
    }
    stopMic();
  });
  $('micDownloadBtn').addEventListener('click', () => {
    if (!realtime.micDownloadUrl) {
      toast('当前没有可下载的录音', 'error');
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = realtime.micDownloadUrl;
    anchor.download = realtime.micDownloadName || `realtime-mic-${Date.now()}.wav`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    appendLog($('realtimeLog'), `下载录音: ${anchor.download}`, 'log-info', 'info');
  });
  $('pingBtn').addEventListener('click', () => {
    if (realtime.ws?.readyState === WebSocket.OPEN) {
      realtime.ws.send('ping');
      appendLog($('realtimeLog'), '>>> ping', 'log-sent', 'info');
    } else {
      toast('WebSocket 未连接', 'error');
    }
  });
  $('stopBtn').addEventListener('click', () => {
    if (realtime.ws?.readyState === WebSocket.OPEN) {
      realtime.ws.send('stop');
      appendLog($('realtimeLog'), '>>> stop', 'log-sent', 'info');
    } else {
      toast('WebSocket 未连接', 'error');
    }
  });
  $('closeBtn').addEventListener('click', () => {
    if (realtime.micRecording) stopMic();
    realtime.ws?.close();
  });
  $('clearSegBtn').addEventListener('click', () => {
    realtime.segments.clear();
    realtime.supersededSegments.clear();
    rebuildSegments();
  });
  $('clearRealtimeLogBtn').addEventListener('click', () => { $('realtimeLog').innerHTML = ''; });
  $('syncWsBtn').addEventListener('click', syncWsUrlFromHttp);
  $('streamMode').addEventListener('change', () => {
    if ($('streamMode').value === 'decode_pcm') {
      $('audioEncoding').value = 'pcm_s16le';
    }
  });
}
