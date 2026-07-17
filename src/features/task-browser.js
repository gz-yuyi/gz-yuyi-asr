import { BROWSER_MAX_CANVAS_WIDTH, BROWSER_PALETTE } from '../core/constants.js';
import { $, qsa } from '../core/dom.js';
import { state } from '../core/state.js';
import { apiErrorMessage, buildHttpUrl, dataOrNull, httpJson, requestBlob } from '../core/api.js';
import { buildQuery, esc, formatBrowserDuration, formatBrowserTime, formatBytes, formatMatchScore } from '../core/format.js';
import { toast } from '../core/toast.js';

let browserLoadGeneration = 0;
let browserAudioAbortController = null;

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

function browserSpeakers() {
  const source = state.browser.timelineSegments.length
    ? state.browser.timelineSegments
    : state.browser.segments;
  return [...new Set(source.map(seg => seg.speaker))];
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
  const speakers = browserSpeakers();
  const idx = Math.max(0, speakers.indexOf(String(speaker)));
  return BROWSER_PALETTE[idx % BROWSER_PALETTE.length];
}

function setBrowserListStatus(message) {
  $('browserListStatus').textContent = message || '';
}

function setBrowserViewerStatus(message) {
  $('browserViewerStatus').textContent = message || '';
}

function updateBrowserRttmButton(task = state.browser.currentTask) {
  const button = $('browserDownloadRttmBtn');
  const available = Boolean(task?.TaskId && task?.Artifacts?.SpeakerRttm);
  button.disabled = !available;
  button.title = available ? '导出当前任务的 RTTM 说话人时间轴' : '当前任务没有可导出的 RTTM 结果';
}

async function downloadBrowserRttm() {
  const taskId = state.browser.currentTask?.TaskId;
  if (!taskId) {
    toast('请先加载任务详情', 'error');
    return;
  }
  const button = $('browserDownloadRttmBtn');
  button.disabled = true;
  button.textContent = '导出中...';
  try {
    const blob = await requestBlob(
      `/api/asr/task_result_download?TaskId=${encodeURIComponent(taskId)}&Format=rttm`,
    );
    if (!blob.size) throw new Error('RTTM 响应为空');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `yuyi-asr-task-${taskId}.rttm`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast(`已导出任务 #${taskId} 的 RTTM`, 'success');
  } catch (err) {
    toast(`RTTM 导出失败: ${err.message}`, 'error');
  } finally {
    button.textContent = '导出 RTTM';
    updateBrowserRttmButton();
  }
}

function audioFetchMessage(error) {
  if (error?.name === 'AbortError') return '请求超时';
  if (String(error?.message || '').includes('Failed to fetch')) return '浏览器 fetch 无法读取音频响应';
  return error?.message || '未知错误';
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
    const taskName = String(task.Context || '').trim() || sourceSummary(task);
    const preview = task.Preview || sourceSummary(task);
    const audioMark = task.HasAudio ? '音频' : '无音频';
    return `
          <button class="task-item${active}" data-task-id="${esc(task.TaskId)}">
            <div class="task-line">
              <span class="task-id">#${esc(task.TaskId)}</span>
              <span class="task-badge">${esc(task.StatusStr || '')}</span>
            </div>
            <div class="task-name" title="${esc(taskName)}">${esc(taskName)}</div>
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

function isCurrentBrowserLoad(generation, taskId) {
  return generation === browserLoadGeneration
    && String(taskId) === String(state.browser.selectedTaskId);
}

function resetBrowserAudioProgress() {
  const container = $('browserAudioProgress');
  const bar = $('browserAudioProgressBar');
  container.hidden = true;
  bar.value = 0;
  bar.setAttribute('value', '0');
  $('browserAudioProgressText').textContent = '';
}

function updateBrowserAudioProgress(progress) {
  const container = $('browserAudioProgress');
  const bar = $('browserAudioProgressBar');
  const loaded = formatBytes(progress?.loaded || 0);
  container.hidden = false;
  if (progress?.lengthComputable) {
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    bar.value = percent;
    bar.setAttribute('value', String(percent));
    $('browserAudioProgressText').textContent = progress?.done
      ? `波形下载完成 · ${formatBytes(progress.total)}，正在解析...`
      : `加载波形 ${percent}% · ${loaded} / ${formatBytes(progress.total)}`;
  } else {
    bar.removeAttribute('value');
    $('browserAudioProgressText').textContent = progress?.done
      ? `波形下载完成 · ${loaded}，正在解析...`
      : `加载波形 · ${loaded}`;
  }
}

function clearBrowserAudio() {
  browserAudioAbortController?.abort();
  browserAudioAbortController = null;
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
  resetBrowserAudioProgress();
}

async function loadBrowserAudio(taskId, generation) {
  const audioPath = `/api/asr/task_audio?TaskId=${encodeURIComponent(taskId)}`;
  const player = $('browserPlayer');
  player.dataset.taskId = String(taskId);
  player.src = buildHttpUrl(audioPath);
  player.load();

  const controller = new AbortController();
  browserAudioAbortController = controller;
  try {
    const configuredTimeout = Number($('httpTimeoutMs').value || 30000);
    const blob = await requestBlob(audioPath, {
      signal: controller.signal,
      timeoutMs: Math.max(300000, configuredTimeout),
      onProgress: progress => {
        if (isCurrentBrowserLoad(generation, taskId)) updateBrowserAudioProgress(progress);
      },
    });
    if (!blob.size) throw new Error('音频响应为空');
    const arrayBuffer = await blob.arrayBuffer();
    if (!isCurrentBrowserLoad(generation, taskId)) return false;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      if (!isCurrentBrowserLoad(generation, taskId)) return false;
      state.browser.audioBuffer = audioBuffer;
      resetBrowserAudioProgress();
    } finally {
      if (ctx.close) ctx.close().catch(() => {});
    }
    return true;
  } finally {
    if (browserAudioAbortController === controller) browserAudioAbortController = null;
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

function normalizeBrowserTimelineSegments(task, fallback) {
  const speakerSegments = Array.isArray(task?.SpeakerSegments) ? task.SpeakerSegments : [];
  if (!speakerSegments.length) return fallback;
  return speakerSegments.map((item, index) => {
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
      text: '',
      words: [],
    };
  }).filter(seg => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
}

function browserOverlapSlices() {
  const eventsByTime = new Map();
  state.browser.timelineSegments.forEach(seg => {
    if (!eventsByTime.has(seg.start)) eventsByTime.set(seg.start, []);
    if (!eventsByTime.has(seg.end)) eventsByTime.set(seg.end, []);
    eventsByTime.get(seg.start).push([seg.speaker, 1]);
    eventsByTime.get(seg.end).push([seg.speaker, -1]);
  });
  const times = [...eventsByTime.keys()].sort((a, b) => a - b);
  const active = new Map();
  const slices = [];
  times.forEach((time, index) => {
    eventsByTime.get(time).forEach(([speaker, delta]) => {
      const count = (active.get(speaker) || 0) + delta;
      if (count > 0) active.set(speaker, count);
      else active.delete(speaker);
    });
    const nextTime = times[index + 1];
    if (nextTime > time && active.size > 1) {
      slices.push({ start: time, end: nextTime, speakers: [...active.keys()] });
    }
  });
  return slices;
}

function browserOverlapRegions() {
  const regions = [];
  browserOverlapSlices().forEach(slice => {
    const previous = regions[regions.length - 1];
    if (previous && Math.abs(previous.end - slice.start) < 0.0001) previous.end = slice.end;
    else regions.push({ start: slice.start, end: slice.end });
  });
  return regions;
}

function renderBrowserSummary(task) {
  const speakers = new Set(browserSpeakers());
  const overlapRegions = browserOverlapRegions();
  const matches = state.browser.speakerMatches;
  const matched = matches.filter(item => item?.SpeakerMatchStatus === 'matched').length;
  const entries = [
    ['TaskId', task?.TaskId ?? '-'],
    ['状态', task?.StatusStr || '-'],
    ['时长', task?.AudioDuration != null ? formatBrowserDuration(task.AudioDuration) : '-'],
    ['说话人段 / 说话人', `${state.browser.timelineSegments.length} / ${speakers.size}`],
    ['重叠区间', overlapRegions.length],
    ['声纹匹配', matches.length ? `${matched} / ${matches.length}` : '-'],
  ];
  $('browserSummary').innerHTML = entries.map(([label, value]) => `
        <div class="summary-cell">
          <div class="summary-label">${esc(label)}</div>
          <div class="summary-value">${esc(value)}</div>
        </div>
      `).join('');
}

function renderMatchedEnrollmentAudio(match) {
  if (match?.SpeakerMatchStatus !== 'matched' || !match?.SpeakerProfileId) return '';
  const enrollmentState = state.browser.profileEnrollments[match.SpeakerProfileId];
  if (!enrollmentState) return '<div class="match-sample-status">加载注册样本...</div>';
  if (enrollmentState.error) return '<div class="match-sample-status">注册样本加载失败</div>';
  const enrollments = Array.isArray(enrollmentState.items) ? enrollmentState.items : [];
  if (!enrollments.length) return '<div class="match-sample-status">该 Profile 没有注册样本</div>';
  return `
        <div class="match-enrollment-list">
          ${enrollments.map(item => item.AudioUrl
            ? `<audio class="enrollment-audio" controls preload="metadata" src="${esc(buildHttpUrl(item.AudioUrl))}"></audio>`
            : '<div class="match-sample-status">注册音频不可用</div>'
          ).join('')}
        </div>
      `;
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
            ${renderMatchedEnrollmentAudio(match)}
          </div>
        `;
  }).join('');
}

async function loadMatchedProfileEnrollments(matches, generation, taskId) {
  const profileIds = [...new Set(matches
    .filter(match => match?.SpeakerMatchStatus === 'matched')
    .map(match => String(match.SpeakerProfileId || '').trim())
    .filter(Boolean))];
  if (!isCurrentBrowserLoad(generation, taskId)) return;
  state.browser.profileEnrollments = {};
  renderBrowserSpeakerMatches();
  const loaded = await Promise.all(profileIds.map(async profileId => {
    try {
      const res = await httpJson(`/api/speakers/get${buildQuery({ SpeakerProfileId: profileId })}`);
      if (!res.ok || res?.json?.Response?.Error) throw new Error(apiErrorMessage(res));
      const profile = dataOrNull(res) || {};
      return [profileId, {
        items: Array.isArray(profile.Enrollments) ? profile.Enrollments : [],
      }];
    } catch {
      return [profileId, { error: true }];
    }
  }));
  if (!isCurrentBrowserLoad(generation, taskId)) return;
  state.browser.profileEnrollments = Object.fromEntries(loaded);
  renderBrowserSpeakerMatches();
}

function renderBrowserLegend() {
  const speakers = browserSpeakers();
  const overlapCount = browserOverlapRegions().length;
  const speakerItems = speakers.map(speaker => `
        <span class="item">
          <span class="swatch" style="background:${browserSpeakerColor(speaker)}"></span>
          <span>${esc(browserSpeakerLabel(speaker))}</span>
        </span>
      `).join('');
  const overlapItem = state.browser.timelineMode === 'tracks' && overlapCount ? `
        <span class="item">
          <span class="swatch" style="background:#facc15"></span>
          <span>${esc(`重叠区间 (${overlapCount})`)}</span>
        </span>
      ` : '';
  $('browserLegend').innerHTML = speakerItems + overlapItem;
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
  const source = state.browser.timelineSegments.length
    ? state.browser.timelineSegments
    : state.browser.segments;
  return source.reduce((max, seg) => Math.max(max, seg.end), 0);
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
  const separated = state.browser.timelineMode === 'tracks';
  const speakers = browserSpeakers();
  const laneHeight = speakers.length ? height / speakers.length : height;
  state.browser.timelineSegments.forEach(seg => {
    const x = Math.max(0, (seg.start / duration) * width);
    const w = Math.max(1, ((seg.end - seg.start) / duration) * width);
    const lane = Math.max(0, speakers.indexOf(seg.speaker));
    const y = separated ? lane * laneHeight + 1 : 0;
    const h = separated ? Math.max(1, laneHeight - 2) : height;
    ctx.fillStyle = browserSpeakerColor(seg.speaker);
    ctx.globalAlpha = separated ? 0.5 : 0.34;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1.0;
  });
  if (separated) {
    browserOverlapRegions().forEach(region => {
      const x = Math.max(0, (region.start / duration) * width);
      const w = Math.max(2, ((region.end - region.start) / duration) * width);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x, 0, w, 4);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
      ctx.strokeRect(x + 0.5, 0.5, Math.max(1, w - 1), height - 1);
    });
  } else {
    browserOverlapSlices().forEach(region => {
      const x = Math.max(0, (region.start / duration) * width);
      const w = Math.max(1, ((region.end - region.start) / duration) * width);
      ctx.clearRect(x, 0, w, height);

      region.speakers.forEach(speaker => {
        ctx.fillStyle = browserSpeakerColor(speaker);
        ctx.globalAlpha = 0.18;
        ctx.fillRect(x, 0, w, height);
      });

      const stripeWidth = 9;
      const stripeCycle = stripeWidth * region.speakers.length;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, w, height);
      ctx.clip();
      ctx.lineWidth = stripeWidth + 1;
      ctx.globalAlpha = 0.72;
      region.speakers.forEach((speaker, index) => {
        ctx.strokeStyle = browserSpeakerColor(speaker);
        for (let offset = -height + index * stripeWidth; offset < w + height; offset += stripeCycle) {
          ctx.beginPath();
          ctx.moveTo(x + offset, height);
          ctx.lineTo(x + offset + height, 0);
          ctx.stroke();
        }
      });
      ctx.restore();
      ctx.globalAlpha = 1.0;
    });
  }
}

function hideBrowserTimelineTooltip() {
  $('browserTimelineTooltip').hidden = true;
}

function updateBrowserTimelineTooltip(event) {
  const duration = getBrowserDuration();
  const width = $('browserWave').width;
  if (!duration || !width) {
    hideBrowserTimelineTooltip();
    return;
  }
  const wrap = $('browserTimelineWrap');
  const rect = wrap.getBoundingClientRect();
  const x = event.clientX - rect.left;
  if (x < 0 || x > width) {
    hideBrowserTimelineTooltip();
    return;
  }
  const time = (x / width) * duration;
  const speakers = [...new Set(state.browser.timelineSegments
    .filter(seg => time >= seg.start && time < seg.end)
    .map(seg => seg.speaker))];
  const tooltip = $('browserTimelineTooltip');
  tooltip.innerHTML = `
        <div class="timeline-tooltip-time">${esc(formatBrowserTime(time))}</div>
        <div class="timeline-tooltip-speakers">
          ${speakers.length ? speakers.map(speaker => `
            <span><i style="background:${browserSpeakerColor(speaker)}"></i>${esc(browserSpeakerLabel(speaker))}</span>
          `).join('') : '<span>无说话人</span>'}
        </div>
      `;
  tooltip.hidden = false;
  const scroll = $('browserScroll');
  const tooltipWidth = tooltip.offsetWidth;
  const visibleRight = scroll.scrollLeft + scroll.clientWidth;
  const left = x + tooltipWidth + 16 > visibleRight
    ? Math.max(scroll.scrollLeft + 8, x - tooltipWidth - 12)
    : x + 12;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = '10px';
}

function setBrowserTimelineMode(mode) {
  hideBrowserTimelineTooltip();
  state.browser.timelineMode = mode === 'tracks' ? 'tracks' : 'merged';
  qsa('#browserTimelineMode button').forEach(button => {
    const active = button.dataset.mode === state.browser.timelineMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderBrowserLegend();
  drawBrowserSegmentCanvas();
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
  const generation = ++browserLoadGeneration;
  state.browser.selectedTaskId = safeTaskId;
  $('browserTaskId').value = safeTaskId;
  renderTaskList();
  $('browserEmpty').hidden = true;
  $('browserViewer').hidden = false;
  setBrowserViewerStatus('加载任务详情...');
  clearBrowserAudio();
  state.browser.currentTask = null;
  state.browser.segments = [];
  state.browser.timelineSegments = [];
  state.browser.speakerMatches = [];
  state.browser.profileEnrollments = {};
  updateBrowserRttmButton(null);
  renderBrowserSummary({});
  renderBrowserLegend();
  renderBrowserSpeakerMatches();
  renderBrowserSegments();
  drawBrowserWaveform();

  try {
    const res = await httpJson(`/api/asr/task_result?TaskId=${encodeURIComponent(safeTaskId)}`);
    if (!isCurrentBrowserLoad(generation, safeTaskId)) return;
    if (!res.ok || res?.json?.Response?.Error) throw new Error(apiErrorMessage(res));
    const task = dataOrNull(res);
    state.browser.currentTask = task;
    state.browser.speakerMatches = Array.isArray(task?.SpeakerProfileMatches) ? task.SpeakerProfileMatches : [];
    state.browser.profileEnrollments = {};
    state.browser.segments = normalizeBrowserSegments(task);
    state.browser.timelineSegments = normalizeBrowserTimelineSegments(task, state.browser.segments);
    updateBrowserRttmButton(task);
    renderBrowserSummary(task);
    renderBrowserLegend();
    renderBrowserSpeakerMatches();
    renderBrowserSegments();
    drawBrowserWaveform();
    void loadMatchedProfileEnrollments(state.browser.speakerMatches, generation, safeTaskId);

    try {
      setBrowserViewerStatus('加载音频...');
      const loaded = await loadBrowserAudio(safeTaskId, generation);
      if (!loaded || !isCurrentBrowserLoad(generation, safeTaskId)) return;
      setBrowserViewerStatus(`已加载 ${state.browser.segments.length} 段识别结果`);
    } catch (audioErr) {
      if (!isCurrentBrowserLoad(generation, safeTaskId)) return;
      resetBrowserAudioProgress();
      const prefix = state.browser.audioPlayable ? '音频可试听，波形不可用' : '播放器已直连音频接口，等待浏览器加载';
      setBrowserViewerStatus(`${prefix}: ${audioFetchMessage(audioErr)}`);
    }
    drawBrowserWaveform();
  } catch (err) {
    if (!isCurrentBrowserLoad(generation, safeTaskId)) return;
    state.browser.currentTask = null;
    state.browser.segments = [];
    state.browser.timelineSegments = [];
    state.browser.speakerMatches = [];
    state.browser.profileEnrollments = {};
    updateBrowserRttmButton(null);
    renderBrowserSummary({});
    renderBrowserLegend();
    renderBrowserSpeakerMatches();
    renderBrowserSegments();
    drawBrowserWaveform();
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
  $('browserDownloadRttmBtn').addEventListener('click', downloadBrowserRttm);
  $('browserTaskId').addEventListener('keydown', event => {
    if (event.key === 'Enter') loadBrowserTask($('browserTaskId').value);
  });
  $('browserScale').addEventListener('input', () => {
    state.browser.pxPerSec = Number($('browserScale').value);
    $('browserScaleVal').textContent = String(state.browser.pxPerSec);
    drawBrowserWaveform();
  });
  qsa('#browserTimelineMode button').forEach(button => {
    button.addEventListener('click', () => setBrowserTimelineMode(button.dataset.mode));
  });
  setBrowserTimelineMode(state.browser.timelineMode);
  $('browserPlayer').addEventListener('timeupdate', updateBrowserPlayhead);
  $('browserPlayer').addEventListener('seeked', updateBrowserPlayhead);
  $('browserPlayer').addEventListener('loadedmetadata', updateBrowserPlayhead);
  $('browserPlayer').addEventListener('canplay', () => {
    if ($('browserPlayer').dataset.taskId !== String(state.browser.selectedTaskId)) return;
    state.browser.audioPlayable = true;
    setBrowserViewerStatus(`已加载 ${state.browser.segments.length} 段识别结果，音频可试听`);
  });
  $('browserPlayer').addEventListener('error', () => {
    const player = $('browserPlayer');
    if (!player.getAttribute('src')) return;
    if (player.dataset.taskId !== String(state.browser.selectedTaskId)) return;
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
  $('browserScroll').addEventListener('mouseleave', hideBrowserTimelineTooltip);
  $('browserTimelineWrap').addEventListener('mousemove', updateBrowserTimelineTooltip);
  $('browserTimelineWrap').addEventListener('mouseleave', hideBrowserTimelineTooltip);
  document.addEventListener('mousemove', event => {
    if (!$('browserTimelineWrap').contains(event.target)) hideBrowserTimelineTooltip();
  });

  return { refreshTaskList };
}
