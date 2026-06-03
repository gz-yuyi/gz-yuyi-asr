import { BROWSER_MAX_CANVAS_WIDTH, BROWSER_PALETTE } from '../core/constants.js';
import { $, qsa } from '../core/dom.js';
import { state } from '../core/state.js';
import { apiErrorMessage, buildHttpUrl, dataOrNull, httpJson, requestBlob } from '../core/api.js';
import { buildQuery, esc, formatBrowserDuration, formatBrowserTime, formatMatchScore } from '../core/format.js';
import { toast } from '../core/toast.js';

function sourceSummary(task) {
  const source = task?.SourceUrl || task?.LocalPath || '';
  if (!source) return '无来源';
  return source.length > 72 ? `...${source.slice(-69)}` : source;
}

function browserSpeakerLabel(speaker) {
  const match = state.browser.speakerMatches.find(item => String(item?.SpeakerId) === String(speaker));
  if (match?.SpeakerMatchStatus === 'matched') {
    return match.SpeakerName || match.SpeakerProfileId || `speaker_${speaker}`;
  }
  return `speaker_${speaker}`;
}

function browserSegmentSpeakerLabel(seg) {
  if (seg?.speakerMatchStatus === 'matched') {
    return seg.speakerName || seg.speakerProfileId || browserSpeakerLabel(seg.speaker);
  }
  return browserSpeakerLabel(seg?.speaker);
}

function matchStatusClass(status) {
  const normalized = String(status || 'unknown').toLowerCase();
  if (normalized === 'matched') return 'matched';
  if (normalized === 'disabled') return 'disabled';
  return 'unknown';
}

function browserSegmentMatchHtml(seg) {
  const hasMatchData = Boolean(seg?.speakerMatchStatus || seg?.speakerProfileId || seg?.speakerMatchScore != null);
  if (!hasMatchData) return '';
  return `
        <div class="speaker-match">
          <span class="match-badge ${matchStatusClass(seg.speakerMatchStatus)}">${esc(seg.speakerMatchStatus || 'unknown')}</span>
          ${seg.speakerProfileId ? ` <span class="mono">${esc(seg.speakerProfileId)}</span>` : ''}
          ${seg.speakerMatchScore != null ? ` score=${esc(formatMatchScore(seg.speakerMatchScore))}` : ''}
        </div>
      `;
}

function browserSpeakerColor(speaker) {
  const speakers = [...new Set(state.browser.segments.map(seg => seg.speaker))];
  const idx = Math.max(0, speakers.indexOf(String(speaker)));
  return BROWSER_PALETTE[idx % BROWSER_PALETTE.length];
}

function setBrowserListStatus(message) {
  $('browserListStatus').textContent = message || '';
}

function setBrowserViewerStatus(message) {
  $('browserViewerStatus').textContent = message || '';
}

function renderTaskList() {
  const items = state.browser.tasks;
  $('browserListCount').textContent = String(items.length);
  if (!items.length) {
    $('browserTaskList').innerHTML = '<div class="empty-state">没有匹配的任务</div>';
    return;
  }
  $('browserTaskList').innerHTML = items.map(task => {
    const active = String(task.TaskId) === String(state.browser.selectedTaskId) ? ' active' : '';
    const duration = task.AudioDuration != null ? formatBrowserDuration(task.AudioDuration) : '-';
    const preview = task.Preview || sourceSummary(task);
    const audioMark = task.HasAudio ? '音频' : '无音频';
    return `
          <button class="task-item${active}" data-task-id="${esc(task.TaskId)}">
            <div class="task-line">
              <span class="task-id">#${esc(task.TaskId)}</span>
              <span class="task-badge">${esc(task.StatusStr || '')}</span>
            </div>
            <div class="task-preview">${esc(preview || '无识别文本')}</div>
            <div class="task-meta">
              <span>${esc(duration)}</span>
              <span>${esc(task.ResultSegmentCount ?? 0)} 段</span>
              <span>${esc(audioMark)}</span>
              <span>${esc(task.FinishedAt || task.UpdatedAt || '')}</span>
            </div>
          </button>
        `;
  }).join('');
  qsa('#browserTaskList .task-item').forEach(item => {
    item.addEventListener('click', () => loadBrowserTask(item.dataset.taskId));
  });
}

export async function refreshTaskList() {
  const status = $('browserStatus').value;
  const limit = Math.max(1, Math.min(200, Number($('browserLimit').value || 50)));
  const query = buildQuery({ Status: status, Limit: limit });
  try {
    setBrowserListStatus('加载任务列表...');
    const res = await httpJson(`/api/asr/task_list${query}`);
    if (!res.ok || res?.json?.Response?.Error) throw new Error(apiErrorMessage(res));
    const data = dataOrNull(res) || {};
    state.browser.tasks = Array.isArray(data.Items) ? data.Items : [];
    renderTaskList();
    setBrowserListStatus(`共 ${data.Total ?? state.browser.tasks.length} 个匹配任务`);
  } catch (err) {
    state.browser.tasks = [];
    renderTaskList();
    setBrowserListStatus(`加载失败: ${err.message}`);
    toast(`任务列表加载失败: ${err.message}`, 'error');
  }
}

function clearBrowserAudio() {
  if (state.browser.audioUrl) URL.revokeObjectURL(state.browser.audioUrl);
  state.browser.audioUrl = null;
  state.browser.audioBuffer = null;
  state.browser.audioPlayable = false;
  state.browser.playSegment = null;
  const player = $('browserPlayer');
  player.pause();
  player.dataset.taskId = '';
  player.removeAttribute('src');
  player.load();
}

async function loadBrowserAudio(taskId) {
  clearBrowserAudio();
  const audioPath = `/api/asr/task_audio?TaskId=${encodeURIComponent(taskId)}`;
  const player = $('browserPlayer');
  player.dataset.taskId = String(taskId);
  player.src = buildHttpUrl(audioPath);
  player.load();

  const blob = await requestBlob(audioPath);
  if (!blob.size) throw new Error('音频响应为空');
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContext();
  try {
    state.browser.audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    if (ctx.close) ctx.close().catch(() => {});
  }
}

function normalizeBrowserSegments(task) {
  const detail = Array.isArray(task?.ResultDetail) ? task.ResultDetail : [];
  return detail.map((item, index) => {
    const startMs = Number(item?.StartMs ?? 0);
    const endMs = Number(item?.EndMs ?? startMs);
    return {
      index,
      start: startMs / 1000,
      end: endMs / 1000,
      startMs,
      endMs,
      speaker: String(item?.SpeakerId ?? 0),
      speakerProfileId: item?.SpeakerProfileId || '',
      speakerName: item?.SpeakerName || '',
      speakerMatchScore: item?.SpeakerMatchScore,
      speakerMatchStatus: item?.SpeakerMatchStatus || '',
      text: String(item?.FinalSentence ?? ''),
      words: Array.isArray(item?.Words) ? item.Words : [],
    };
  }).filter(seg => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
}

function renderBrowserSummary(task) {
  const speakers = new Set(state.browser.segments.map(seg => seg.speaker));
  const matches = state.browser.speakerMatches;
  const matched = matches.filter(item => item?.SpeakerMatchStatus === 'matched').length;
  const entries = [
    ['TaskId', task?.TaskId ?? '-'],
    ['状态', task?.StatusStr || '-'],
    ['时长', task?.AudioDuration != null ? formatBrowserDuration(task.AudioDuration) : '-'],
    ['段数 / 说话人', `${state.browser.segments.length} / ${speakers.size}`],
    ['声纹匹配', matches.length ? `${matched} / ${matches.length}` : '-'],
  ];
  $('browserSummary').innerHTML = entries.map(([label, value]) => `
        <div class="summary-cell">
          <div class="summary-label">${esc(label)}</div>
          <div class="summary-value">${esc(value)}</div>
        </div>
      `).join('');
}

function renderBrowserSpeakerMatches() {
  const matches = state.browser.speakerMatches;
  if (!matches.length) {
    $('browserSpeakerMatches').innerHTML = '';
    return;
  }
  $('browserSpeakerMatches').innerHTML = matches.map(match => {
    const status = match.SpeakerMatchStatus || 'unknown';
    const label = status === 'matched'
      ? (match.SpeakerName || match.SpeakerProfileId || `speaker_${match.SpeakerId}`)
      : `speaker_${match.SpeakerId}`;
    return `
          <div class="match-card">
            <div class="match-head">
              <div class="match-title">
                <span class="swatch" style="background:${browserSpeakerColor(match.SpeakerId)}"></span>
                ${esc(`speaker_${match.SpeakerId}`)} -> ${esc(label)}
              </div>
              <span class="match-badge ${matchStatusClass(status)}">${esc(status)}</span>
            </div>
            <div class="match-sub">
              ProfileId: <span class="mono">${esc(match.SpeakerProfileId || '-')}</span> · score=${esc(formatMatchScore(match.SpeakerMatchScore))}
            </div>
          </div>
        `;
  }).join('');
}

function renderBrowserLegend() {
  const speakers = [...new Set(state.browser.segments.map(seg => seg.speaker))];
  $('browserLegend').innerHTML = speakers.map(speaker => `
        <span class="item">
          <span class="swatch" style="background:${browserSpeakerColor(speaker)}"></span>
          <span>${esc(browserSpeakerLabel(speaker))}</span>
        </span>
      `).join('');
}

function renderBrowserSegments() {
  const segments = state.browser.segments;
  if (!segments.length) {
    $('browserSegmentList').innerHTML = '<div class="empty-state">这个任务没有可浏览的识别段落</div>';
    return;
  }
  $('browserSegmentList').innerHTML = segments.map((seg, index) => `
        <div class="segment-row" data-index="${index}">
          <div class="seg-time">${esc(formatBrowserTime(seg.start))} - ${esc(formatBrowserTime(seg.end))}</div>
          <div class="speaker-meta">
            <div class="speaker-name">
              <span class="swatch" style="background:${browserSpeakerColor(seg.speaker)}"></span>
              ${esc(browserSegmentSpeakerLabel(seg))}
            </div>
            ${browserSegmentMatchHtml(seg)}
          </div>
          <div class="seg-text">${esc(seg.text || '无识别文本')}</div>
          <button class="seg-play btn-ghost" data-index="${index}">播放本段</button>
        </div>
      `).join('');
  qsa('#browserSegmentList .segment-row').forEach(row => {
    row.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      seekBrowserSegment(Number(row.dataset.index), false);
    });
  });
  qsa('#browserSegmentList .seg-play').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      seekBrowserSegment(Number(btn.dataset.index), true);
    });
  });
}

function getBrowserDuration() {
  const audioDuration = state.browser.audioBuffer?.duration;
  if (Number.isFinite(audioDuration) && audioDuration > 0) return audioDuration;
  const taskDuration = Number(state.browser.currentTask?.AudioDuration);
  if (Number.isFinite(taskDuration) && taskDuration > 0) return taskDuration;
  return state.browser.segments.reduce((max, seg) => Math.max(max, seg.end), 0);
}

function setupBrowserCanvases(duration) {
  const width = Math.min(
    Math.max(240, Math.floor(duration * state.browser.pxPerSec)),
    BROWSER_MAX_CANVAS_WIDTH,
  );
  const height = 230;
  $('browserTimelineWrap').style.width = `${width}px`;
  $('browserTimelineWrap').style.height = `${height}px`;
  $('browserWave').width = width;
  $('browserWave').height = height;
  $('browserSegmentCanvas').width = width;
  $('browserSegmentCanvas').height = height;
  return { width, height };
}

function drawBrowserWaveform() {
  const duration = getBrowserDuration();
  if (!duration) {
    setupBrowserCanvases(3);
    $('browserWave').getContext('2d').clearRect(0, 0, $('browserWave').width, $('browserWave').height);
    $('browserSegmentCanvas').getContext('2d').clearRect(0, 0, $('browserSegmentCanvas').width, $('browserSegmentCanvas').height);
    $('browserPlayhead').style.left = '0px';
    return;
  }
  const { width, height } = setupBrowserCanvases(duration);
  const ctx = $('browserWave').getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, width, height);

  const audioBuffer = state.browser.audioBuffer;
  const mid = height / 2;
  if (!audioBuffer) {
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.strokeStyle = '#3f3f46';
    ctx.stroke();
    drawBrowserSegmentCanvas(duration);
    updateBrowserPlayhead();
    return;
  }

  const channelData = audioBuffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(channelData.length / width));
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const start = x * samplesPerPixel;
    let min = 1.0;
    let max = -1.0;
    for (let i = 0; i < samplesPerPixel; i++) {
      const v = channelData[start + i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.moveTo(x, mid + min * mid);
    ctx.lineTo(x, mid + max * mid);
  }
  ctx.strokeStyle = '#d4d4d8';
  ctx.stroke();
  drawBrowserSegmentCanvas(duration);
  updateBrowserPlayhead();
}

function drawBrowserSegmentCanvas(duration = getBrowserDuration()) {
  const canvas = $('browserSegmentCanvas');
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  if (!duration) return;
  state.browser.segments.forEach(seg => {
    const x = Math.max(0, (seg.start / duration) * width);
    const w = Math.max(1, ((seg.end - seg.start) / duration) * width);
    ctx.fillStyle = browserSpeakerColor(seg.speaker);
    ctx.globalAlpha = 0.34;
    ctx.fillRect(x, 0, w, height);
    ctx.globalAlpha = 1.0;
  });
}

function updateBrowserPlayhead() {
  const duration = getBrowserDuration();
  const width = $('browserWave').width;
  if (!duration || !width) return;
  const player = $('browserPlayer');
  const time = Math.max(0, Number(player.currentTime || 0));
  const x = Math.min(width, Math.max(0, (time / duration) * width));
  $('browserPlayhead').style.left = `${x}px`;

  const scroll = $('browserScroll');
  const viewWidth = scroll.clientWidth;
  const leftBound = scroll.scrollLeft + viewWidth * 0.1;
  const rightBound = scroll.scrollLeft + viewWidth * 0.9;
  if (x < leftBound) {
    scroll.scrollLeft = Math.max(0, x - viewWidth * 0.1);
  } else if (x > rightBound) {
    scroll.scrollLeft = Math.max(0, x - viewWidth * 0.9);
  }

  highlightBrowserSegment(time);
  const playingSeg = state.browser.playSegment;
  if (playingSeg && time >= playingSeg.end - 0.03) {
    player.pause();
    state.browser.playSegment = null;
  }
}

function highlightBrowserSegment(time) {
  const activeIndex = state.browser.segments.findIndex(seg => time >= seg.start && time < seg.end);
  qsa('#browserSegmentList .segment-row').forEach(row => {
    row.classList.toggle('active', Number(row.dataset.index) === activeIndex);
  });
}

function seekBrowserSegment(index, play) {
  const seg = state.browser.segments[index];
  if (!seg) return;
  const player = $('browserPlayer');
  player.currentTime = seg.start;
  state.browser.playSegment = play ? seg : null;
  updateBrowserPlayhead();
  if (play) {
    if (!player.src) {
      toast('当前任务没有可播放音频', 'error');
      return;
    }
    player.play().catch(err => toast(`播放失败: ${err.message}`, 'error'));
  }
}

async function loadBrowserTask(taskId) {
  const safeTaskId = String(taskId || '').trim();
  if (!safeTaskId) {
    toast('请填写 TaskId', 'error');
    return;
  }
  state.browser.selectedTaskId = safeTaskId;
  $('browserTaskId').value = safeTaskId;
  renderTaskList();
  $('browserEmpty').hidden = true;
  $('browserViewer').hidden = false;
  setBrowserViewerStatus('加载任务详情...');
  clearBrowserAudio();

  try {
    const res = await httpJson(`/api/asr/task_result?TaskId=${encodeURIComponent(safeTaskId)}`);
    if (!res.ok || res?.json?.Response?.Error) throw new Error(apiErrorMessage(res));
    const task = dataOrNull(res);
    state.browser.currentTask = task;
    state.browser.speakerMatches = Array.isArray(task?.SpeakerProfileMatches) ? task.SpeakerProfileMatches : [];
    state.browser.segments = normalizeBrowserSegments(task);
    renderBrowserSummary(task);
    renderBrowserLegend();
    renderBrowserSpeakerMatches();
    renderBrowserSegments();

    try {
      setBrowserViewerStatus('加载音频...');
      await loadBrowserAudio(safeTaskId);
      setBrowserViewerStatus(`已加载 ${state.browser.segments.length} 段识别结果`);
    } catch (audioErr) {
      const prefix = state.browser.audioPlayable ? '音频可试听，波形不可用' : '播放器已直连音频接口，波形暂不可用';
      setBrowserViewerStatus(`${prefix}: ${audioErr.message}`);
    }
    drawBrowserWaveform();
  } catch (err) {
    state.browser.currentTask = null;
    state.browser.segments = [];
    state.browser.speakerMatches = [];
    renderBrowserSummary({});
    renderBrowserLegend();
    renderBrowserSpeakerMatches();
    renderBrowserSegments();
    setBrowserViewerStatus(`加载失败: ${err.message}`);
    toast(`任务加载失败: ${err.message}`, 'error');
  }
}

function seekFromTimelineClick(event) {
  const duration = getBrowserDuration();
  const width = $('browserWave').width;
  if (!duration || !width) return;
  const rect = $('browserTimelineWrap').getBoundingClientRect();
  const x = event.clientX - rect.left;
  if (x < 0 || x > width) return;
  $('browserPlayer').currentTime = (x / width) * duration;
  state.browser.playSegment = null;
  updateBrowserPlayhead();
}

export function registerTaskBrowser() {
  $('refreshTaskListBtn').addEventListener('click', refreshTaskList);
  $('browserStatus').addEventListener('change', refreshTaskList);
  $('browserLimit').addEventListener('change', refreshTaskList);
  $('loadBrowserTaskBtn').addEventListener('click', () => loadBrowserTask($('browserTaskId').value));
  $('browserTaskId').addEventListener('keydown', event => {
    if (event.key === 'Enter') loadBrowserTask($('browserTaskId').value);
  });
  $('browserScale').addEventListener('input', () => {
    state.browser.pxPerSec = Number($('browserScale').value);
    $('browserScaleVal').textContent = String(state.browser.pxPerSec);
    drawBrowserWaveform();
  });
  $('browserPlayer').addEventListener('timeupdate', updateBrowserPlayhead);
  $('browserPlayer').addEventListener('seeked', updateBrowserPlayhead);
  $('browserPlayer').addEventListener('loadedmetadata', updateBrowserPlayhead);
  $('browserPlayer').addEventListener('canplay', () => {
    state.browser.audioPlayable = true;
    setBrowserViewerStatus(`已加载 ${state.browser.segments.length} 段识别结果，音频可试听`);
  });
  $('browserPlayer').addEventListener('error', () => {
    const player = $('browserPlayer');
    if (!player.getAttribute('src')) return;
    const messages = {
      1: '加载被取消',
      2: '网络错误',
      3: '音频解码失败',
      4: '音频格式或地址不支持',
    };
    const message = messages[player.error?.code] || '未知错误';
    setBrowserViewerStatus(`音频加载失败: ${message}`);
  });
  $('browserScroll').addEventListener('click', seekFromTimelineClick);

  return { refreshTaskList };
}
