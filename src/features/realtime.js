import { $, qsa } from '../core/dom.js';
import { persistEndpointSettings } from '../core/api.js';
import { appendLog, appendLogRaw } from '../core/logger.js';
import { esc, parseListInput, pretty, safeParse } from '../core/format.js';
import { toast } from '../core/toast.js';

const realtime = {
  ws: null,
  sending: false,
  chunksSent: 0,
  totalChunks: 0,
  messages: 0,
  session: null,
  completed: null,
  segments: new Map(),   // segment_id -> latest TranscriptUpdate
  segNodes: new Map(),   // segment_id -> timeline row DOM node
  errors: [],
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

const SPEAKER_COLORS = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#f97316',
];

const TIMELINE_STICKY_BOTTOM_PX = 80;

function summarizeRealtimeEvent(json) {
  const type = json.type || 'Unknown';
  if (type === 'SessionStarted') {
    const speaker = json.enable_speaker ? 'speaker=on' : 'speaker=off';
    const pv = json.protocol_version != null ? ` pv=${json.protocol_version}` : '';
    return `SessionStarted session=${json.session_id || ''} ${speaker}${pv}`;
  }
  if (type === 'SessionCompleted') {
    return `SessionCompleted session=${json.session_id || ''} segments=${json.segment_count ?? ''}${json.canceled ? ' canceled' : ''}`;
  }
  if (type === 'ErrorResponse') {
    return `ErrorResponse code=${json.code || ''} error=${json.error_code || ''} message=${json.message || ''}`;
  }
  if (type === 'TranscriptUpdate') {
    const seg = json.segment_id || '';
    const rev = json.revision ?? '';
    const spk = json.speaker_id != null ? ` speaker=${json.speaker_id}` : '';
    const registered = json.speaker_match_status === 'matched'
      ? ` registered=${json.speaker_name || json.speaker_profile_id || ''}`
      : (json.speaker_match_status === 'unknown' ? ' registered=unknown' : '');
    const flag = json.segment_deleted ? 'deleted' : (json.is_final ? 'final' : 'draft');
    const time = formatMsRange(json.start_ms, json.end_ms);
    const preview = (json.text || '').slice(0, 80);
    return `TranscriptUpdate seg=${seg} rev=${rev} ${json.source || ''} ${flag}${spk}${registered} ${time} text=${preview}`;
  }
  if (type === 'Pong') return 'Pong';
  return pretty(json);
}

function setWsStatus(label, kind) {
  $('wsChip').className = `chip ${kind}`;
  $('wsChipLabel').textContent = label;
}

function updateStats() {
  const segs = sortedSegments();
  const finalCount = segs.filter(s => s.is_final).length;
  $('statsLabel').textContent = [
    `chunks: ${realtime.chunksSent}`,
    `events: ${realtime.messages}`,
    `segments: ${segs.length}`,
    `final: ${finalCount}`,
  ].join(' · ');
}

function updateProgress() {
  const pct = realtime.totalChunks > 0
    ? Math.min(100, (realtime.chunksSent / realtime.totalChunks) * 100)
    : 0;
  $('sendProgressFill').style.width = `${pct}%`;
}

function formatMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return '-';
  const total = Math.max(0, value) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function formatMsRange(startMs, endMs) {
  return `${formatMs(startMs)}-${formatMs(endMs)}`;
}

function speakerColor(speakerId) {
  if (speakerId == null || speakerId === '') return '#71717a';
  const index = Math.abs(Number(speakerId) || 0) % SPEAKER_COLORS.length;
  return SPEAKER_COLORS[index];
}

function speakerText(speakerId, state = '') {
  if (speakerId == null || speakerId === '') {
    return state === 'disabled' ? '无说话人' : '未知说话人';
  }
  return `S${speakerId}`;
}

function speakerIdentity(seg) {
  const local = speakerText(seg.speaker_id, seg.speaker_state);
  const status = seg.speaker_match_status || '';
  const score = Number(seg.speaker_match_score);
  const scoreText = Number.isFinite(score) ? score.toFixed(3) : '';
  if (status === 'matched') {
    const name = seg.speaker_name || seg.speaker_profile_id || '已注册说话人';
    const details = [local];
    if (seg.speaker_profile_id && seg.speaker_profile_id !== name) details.push(seg.speaker_profile_id);
    if (scoreText) details.push(scoreText);
    return { primary: name, secondary: details.join(' · '), status };
  }
  if (status === 'unknown') {
    return {
      primary: '未知声纹',
      secondary: [local, scoreText].filter(Boolean).join(' · '),
      status,
    };
  }
  return { primary: local, secondary: '', status };
}

// One event stream keyed by segment_id. Draft (is_final:false) and final
// (is_final:true) are the same segment at different revisions; speaker labels
// and word timings arrive as higher revisions of the same segment. No
// cross-stream reconciliation needed.
function sortedSegments() {
  return [...realtime.segments.values()]
    .filter(seg => !seg.segment_deleted)
    .sort((a, b) => (a.start_ms ?? 0) - (b.start_ms ?? 0));
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

async function loadRealtimeFile(file) {
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

async function handleRealtimeFileChange(event) {
  await loadRealtimeFile(event.target.files[0]);
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
  url.search = '';
  return url.toString();
}

function optionalText(elId) {
  const value = $(elId).value.trim();
  return value || null;
}

function optionalNumber(elId) {
  const value = $(elId).value.trim();
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readNumberInput(elId, fallback, min = 0) {
  const input = $(elId);
  const raw = input.value.trim();
  const parsed = raw === '' ? fallback : Number(raw);
  const value = Number.isFinite(parsed) ? Math.max(min, parsed) : Math.max(min, fallback);
  if (raw === '' || Number(raw) !== value) {
    input.value = String(value);
  }
  return value;
}

function buildStartSessionPayload() {
  const speakerNum = optionalNumber('speakerNum');
  const vadThreshold = optionalNumber('vadThreshold');
  const vadMinSilence = optionalNumber('vadMinSilenceMs');
  const groupIds = parseListInput($('realtimeSpeakerGroupIds').value);
  const profileIds = parseListInput($('realtimeSpeakerProfileIds').value);
  const payload = {
    type: 'StartSession',
    audio_encoding: $('audioEncoding').value,
    sample_rate: Number($('sampleRate').value || 16000),
    hotword_id: optionalText('realtimeHotwordId'),
    context: optionalText('realtimeContext'),
    enable_speaker: $('enableSpeaker').value === 'true',
    speaker_num: speakerNum,
    allowed_output_languages: optionalText('realtimeAllowedLanguages'),
    number_normalization_mode: Number($('realtimeNumberMode').value || 1),
    filler_filter_mode: Number($('realtimeFillerMode').value || 0),
    profanity_filter_mode: Number($('realtimeProfanityMode').value || 0),
  };
  if (payload.speaker_num == null) delete payload.speaker_num;
  if (payload.allowed_output_languages == null) delete payload.allowed_output_languages;
  if (groupIds.length) payload.group_ids = groupIds;
  if (profileIds.length) payload.speaker_profile_ids = profileIds;
  if (vadThreshold != null) payload.vad_threshold = vadThreshold;
  if (vadMinSilence != null) payload.vad_min_silence_duration_ms = vadMinSilence;
  return payload;
}

function sendControl(type, detail = '') {
  const ws = realtime.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('WebSocket 未连接', 'error');
    return false;
  }
  const payload = { type };
  ws.send(JSON.stringify(payload));
  appendLog($('realtimeLog'), `>>> ${type}${detail ? ` (${detail})` : ''}`, 'log-sent', 'info');
  return true;
}

function clearRealtimeState() {
  realtime.chunksSent = 0;
  realtime.totalChunks = 0;
  realtime.messages = 0;
  realtime.session = null;
  realtime.completed = null;
  realtime.segments.clear();
  realtime.segNodes.clear();
  realtime.errors = [];
  resetTimeline();
  updateStats();
  updateProgress();
  renderRealtimeSummary();
  $('realtimeLog').innerHTML = '';
}

async function sendAudio(file) {
  const mode = $('streamMode').value;
  const audioEncoding = $('audioEncoding').value;
  const ws = realtime.ws;
  const chunkMs = readNumberInput('chunkMs', 100, 1);
  const sleepMs = readNumberInput('sleepMs', chunkMs, 0);
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
      appendLog($('realtimeLog'), `解码完成，共 ${bytes.length} 字节，将分 ${realtime.totalChunks} 块发送，间隔 ${sleepMs}ms`, 'log-info', 'info');
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
    } else {
      if (audioEncoding !== 'pcm_s16le') {
        throw new Error('原始文件分块只支持裸 PCM16LE；WAV/MP3/M4A/OPUS 请使用浏览器解码 PCM');
      }
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
      sendControl('FinishSession', '文件发送完成后自动结束会话');
    }
    toast('音频发送完成', 'success');
  } catch (err) {
    appendLog($('realtimeLog'), `发送失败: ${err.message}`, 'log-err', 'error');
    toast(`发送失败: ${err.message}`, 'error');
  } finally {
    realtime.sending = false;
  }
}

function renderRealtimeSummary() {
  const session = realtime.session || {};
  const completed = realtime.completed || {};
  const segs = sortedSegments();
  const finalCount = segs.filter(s => s.is_final).length;
  const draftCount = segs.filter(s => !s.is_final).length;
  const speakers = new Set(
    segs.filter(s => s.speaker_id != null && s.speaker_id !== '').map(s => String(s.speaker_id)),
  );
  const registeredSpeakers = new Set(
    segs
      .filter(s => s.speaker_match_status === 'matched')
      .map(s => s.speaker_profile_id || s.speaker_name)
      .filter(Boolean),
  );
  const unknownSpeakers = new Set(
    segs
      .filter(s => s.speaker_match_status === 'unknown' && s.speaker_id != null)
      .map(s => String(s.speaker_id)),
  );
  const speakerValue = session.session_id
    ? (session.enable_speaker ? `${speakers.size} 人` : 'disabled')
    : '-';
  const lastEnd = segs.reduce((max, s) => Math.max(max, Number(s.end_ms) || 0), 0);
  const duration = completed.audio_duration_ms != null
    ? formatMs(completed.audio_duration_ms)
    : formatMs(lastEnd);
  const items = [
    ['Session', session.session_id || '-'],
    ['最终', String(finalCount)],
    ['识别中', String(draftCount)],
    ['说话人', speakerValue],
    ['已注册', session.session_id ? `${registeredSpeakers.size} 人` : '-'],
    ['未知声纹', session.session_id ? `${unknownSpeakers.size} 人` : '-'],
    ['时长', duration],
  ];
  $('realtimeSummary').innerHTML = items.map(([label, value]) => `
    <div class="summary-cell">
      <div class="summary-label">${esc(label)}</div>
      <div class="summary-value">${esc(value)}</div>
    </div>
  `).join('');
}

// Inner HTML of one timeline row. A draft (is_final:false) and its final are
// the same row at different revisions -- the row just restyles in place.
function segmentRowInner(seg) {
  const isFinal = !!seg.is_final;
  const spkKnown = seg.speaker_id != null && seg.speaker_id !== '';
  const identity = speakerIdentity(seg);
  const badge = isFinal
    ? '<span class="badge badge-final">final</span>'
    : '<span class="badge badge-partial">识别中</span>';
  const stateCls = seg.speaker_state ? ` state-${esc(seg.speaker_state)}` : '';
  const matchCls = identity.status ? ` match-${esc(identity.status)}` : '';
  let body;
  if (Array.isArray(seg.words) && seg.words.length) {
    // Word-level timestamps: hover a character to see its time range.
    body = seg.words
      .map(w => `<span class="w" title="${esc(formatMsRange(w.start_ms, w.end_ms))}">${esc(w.word || '')}</span>`)
      .join('');
  } else {
    body = esc(seg.text || '') || '<span class="muted-text">空文本</span>';
  }
  return `
    <div class="live-time mono">${esc(formatMsRange(seg.start_ms, seg.end_ms))}</div>
    <div class="live-speaker${stateCls}${matchCls}">
      <span class="swatch" style="background:${spkKnown ? speakerColor(seg.speaker_id) : 'transparent'}"></span>
      <span class="speaker-identity">
        <span class="speaker-primary${spkKnown ? '' : ' muted-text'}">${esc(identity.primary)}</span>
        ${identity.secondary ? `<span class="speaker-secondary">${esc(identity.secondary)}</span>` : ''}
      </span>
    </div>
    <div class="live-body">
      <div class="live-meta">
        ${badge}
        <span class="mono">${esc(seg.segment_id || '')}</span>
        <span>rev ${esc(seg.revision ?? '')}</span>
        ${seg.source ? `<span class="src-tag">${esc(seg.source)}</span>` : ''}
      </div>
      <div class="live-text${isFinal ? '' : ' draft-text'}">${body}</div>
    </div>
  `;
}

function resetTimeline() {
  realtime.segNodes.clear();
  const timeline = $('realtimeTimeline');
  if (timeline) {
    timeline.innerHTML = '<div class="empty-state compact-empty">等待 TranscriptUpdate</div>';
  }
}

function insertRowSorted(timeline, node, startMs) {
  const start = Number(startMs) || 0;
  node.dataset.start = String(start);
  for (const row of timeline.querySelectorAll('.live-row')) {
    if ((Number(row.dataset.start) || 0) > start) {
      timeline.insertBefore(node, row);
      return;
    }
  }
  timeline.appendChild(node);
}

// Incremental: update the one row for this segment_id in place (no full
// rebuild), so text stays selectable and long sessions don't jank.
function upsertSegmentRow(seg) {
  const timeline = $('realtimeTimeline');
  if (!timeline) return;
  const stick = shouldStickToTimelineBottom(timeline);
  let node = realtime.segNodes.get(seg.segment_id);
  if (!node) {
    const empty = timeline.querySelector('.empty-state');
    if (empty) empty.remove();
    node = document.createElement('div');
    node.className = 'live-row';
    node.dataset.seg = seg.segment_id;
    insertRowSorted(timeline, node, seg.start_ms);
    realtime.segNodes.set(seg.segment_id, node);
  }
  node.dataset.final = String(!!seg.is_final);
  node.innerHTML = segmentRowInner(seg);
  if (stick) stickTimelineToBottom(timeline);
}

function removeSegmentRow(segmentId) {
  if (segmentId == null) return;
  const node = realtime.segNodes.get(segmentId);
  if (node) {
    node.remove();
    realtime.segNodes.delete(segmentId);
  }
  realtime.segments.delete(segmentId);
}

function shouldStickToTimelineBottom(timeline) {
  if (!timeline) return false;
  const distanceToBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
  return distanceToBottom <= TIMELINE_STICKY_BOTTOM_PX;
}

function stickTimelineToBottom(timeline) {
  if (!timeline) return;
  requestAnimationFrame(() => {
    timeline.scrollTop = timeline.scrollHeight;
  });
}

function renderRealtimeResults() {
  renderRealtimeSummary();
  if (realtime.segNodes.size === 0) {
    const timeline = $('realtimeTimeline');
    if (timeline && !timeline.querySelector('.empty-state')) {
      timeline.innerHTML = '<div class="empty-state compact-empty">等待 TranscriptUpdate</div>';
    }
  }
}

// Apply one TranscriptUpdate: keep the highest revision per segment_id, honour
// deletion/supersede. Draft/final/speaker/words are all just revisions here.
function applyTranscriptUpdate(json) {
  const id = json.segment_id;
  if (id == null) return;
  const cur = realtime.segments.get(id);
  if (cur && (json.revision ?? 0) <= (cur.revision ?? 0)) return; // stale
  if (json.supersedes_segment_id) removeSegmentRow(json.supersedes_segment_id);
  if (json.segment_deleted) {
    removeSegmentRow(id);
    return;
  }
  realtime.segments.set(id, json);
  upsertSegmentRow(json);
}

function handleRealtimeEvent(json) {
  const type = json.type || '';
  if (type === 'SessionStarted') {
    realtime.session = json;
    setWsStatus(json.enable_speaker ? '已连接 · speaker on' : '已连接 · speaker off', 'ok');
  } else if (type === 'TranscriptUpdate') {
    applyTranscriptUpdate(json);
  } else if (type === 'SessionCompleted') {
    realtime.completed = json;
  } else if (type === 'ErrorResponse') {
    realtime.errors.push(json);
  }
  renderRealtimeSummary();
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
    handleRealtimeEvent(json);
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

function startRealtimeSend(file) {
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
    const startPayload = buildStartSessionPayload();
    ws.send(JSON.stringify(startPayload));
    appendLog($('realtimeLog'), `>>> StartSession ${JSON.stringify(startPayload)}`, 'log-sent', 'info');
    setWsStatus('已连接 · 初始化', 'ok');
    appendLog($('realtimeLog'), '连接成功，开始发送 StartSession 和音频', 'log-sent', 'info');
    toast('WebSocket 已连接', 'success');
    await sendAudio(file);
  };
  setupWsHandlers(ws);
}

function connectAndSendFile() {
  startRealtimeSend($('realtimeFile').files[0]);
}

async function connectAndSendUrl() {
  const audioUrl = $('realtimeAudioUrl').value.trim();
  if (!audioUrl) {
    toast('请先输入音频 URL', 'error');
    return;
  }
  try {
    appendLog($('realtimeLog'), `加载音频 URL ${audioUrl}`, 'log-info', 'info');
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const pathname = new URL(audioUrl, window.location.href).pathname;
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || `realtime-url-${Date.now()}.wav`);
    const file = new File([blob], name, { type: blob.type || 'audio/wav' });
    await loadRealtimeFile(file);
    startRealtimeSend(file);
  } catch (err) {
    appendLog($('realtimeLog'), `URL 音频加载失败: ${err.message}`, 'log-err', 'error');
    toast(`URL 音频加载失败: ${err.message}`, 'error');
  }
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

function stopMic({ finish = false } = {}) {
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
  // Stop audio capture before flushing the stream, so no more PCM frames race
  // after FinishSession. Without this final control frame, short microphone
  // recordings can show "audio sent" but never produce a final transcript
  // because the server is still waiting for either trailing silence or finish.
  if (finish && realtime.ws?.readyState === WebSocket.OPEN) {
    sendControl('FinishSession', '录制结束，冲刷尾段');
  }
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
    const startPayload = buildStartSessionPayload();
    ws.send(JSON.stringify(startPayload));
    appendLog($('realtimeLog'), `>>> StartSession ${JSON.stringify(startPayload)}`, 'log-sent', 'info');
    setWsStatus('已连接 · 麦克风', 'ok');
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
  renderRealtimeResults();
  $('realtimeFile').addEventListener('change', handleRealtimeFileChange);
  $('playAudioBtn').addEventListener('click', playPreviewAudio);
  $('stopAudioBtn').addEventListener('click', stopPreviewAudio);
  window.addEventListener('resize', () => {
    if (realtime.previewAudioBuffer) drawWaveform($('waveformCanvas'), realtime.previewAudioBuffer);
  });
  $('connectBtn').addEventListener('click', connectAndSendFile);
  $('connectUrlBtn').addEventListener('click', connectAndSendUrl);
  $('micBtn').addEventListener('click', startMic);
  $('micStopBtn').addEventListener('click', () => {
    stopMic({ finish: true });
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
    sendControl('Ping');
  });
  $('stopBtn').addEventListener('click', () => {
    sendControl('FinishSession');
  });
  $('closeBtn').addEventListener('click', () => {
    if (realtime.micRecording) {
      stopMic({ finish: true });
      return;
    }
    realtime.ws?.close();
  });
  $('clearSegBtn').addEventListener('click', () => {
    realtime.session = null;
    realtime.completed = null;
    realtime.errors = [];
    realtime.segments.clear();
    realtime.segNodes.clear();
    resetTimeline();
    updateStats();
    renderRealtimeSummary();
  });
  $('clearRealtimeLogBtn').addEventListener('click', () => { $('realtimeLog').innerHTML = ''; });
  $('syncWsBtn').addEventListener('click', syncWsUrlFromHttp);
  $('streamMode').addEventListener('change', () => {
    if ($('streamMode').value === 'decode_pcm') {
      $('audioEncoding').value = 'pcm_s16le';
    }
  });
}
