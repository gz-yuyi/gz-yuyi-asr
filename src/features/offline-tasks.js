import { $ } from '../core/dom.js';
import { state } from '../core/state.js';
import { httpJson, httpUpload, dataOrNull, downloadFile, summarizeHttpResponse } from '../core/api.js';
import { appendLog, appendLogRaw } from '../core/logger.js';
import { buildQuery, esc, formatBytes, formatUploadProgress, parseListInput, pretty } from '../core/format.js';
import { toast } from '../core/toast.js';
import { refreshHotwordList } from './hotwords.js';

function currentHotwordItems() {
  return state.hotwords.items || [];
}

function renderOfflineHotwordOptions() {
  const select = $('offlineHotwordSelect');
  if (!select) return;
  const currentId = $('offlineHotwordId').value.trim();
  const items = currentHotwordItems();
  if (!items.length) {
    select.innerHTML = '<option value="">未加载热词</option>';
    return;
  }
  const selectedExists = items.some(item => item.HotwordId === currentId);
  select.innerHTML = [
    `<option value="">${selectedExists ? '手动输入' : '请选择热词'}</option>`,
    ...items.map(item => {
      const label = item.Content ? `${item.HotwordId} - ${item.Content}` : item.HotwordId;
      return `<option value="${esc(item.HotwordId)}">${esc(label)}</option>`;
    }),
  ].join('');
  select.value = selectedExists ? currentId : '';
}

function applyOfflineHotword(item) {
  if (!item) return;
  $('offlineHotwordId').value = item.HotwordId;
  $('offlineContext').value = item.Content || '';
  renderOfflineHotwordOptions();
}

async function refreshOfflineHotwords() {
  try {
    const items = await refreshHotwordList({ log: false, toastResult: false });
    renderOfflineHotwordOptions();
    toast(`已加载 ${items.length} 条热词`, 'success');
  } catch (err) {
    toast(`热词加载失败: ${err.message}`, 'error');
  }
}

function speakerRecognitionValue() {
  const value = $('offlineSpeakerRecognition').value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function optionalSelectValue(id) {
  const value = $(id)?.value?.trim() || '';
  return value || undefined;
}

function optionalNumberValue(id) {
  const raw = $(id)?.value?.trim() || '';
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function offlineSpeakerAdvancedOptions() {
  const options = {};
  const overlap = optionalSelectValue('offlineEnableSpeakerOverlap');
  if (overlap === 'true') options.EnableSpeakerOverlap = true;
  if (overlap === 'false') options.EnableSpeakerOverlap = false;

  const numberFields = {
    SpeakerNum: 'offlineSpeakerNum',
    SpeakerClusterMergeCosineThreshold: 'offlineSpeakerClusterMergeCosineThreshold',
    SpeakerClusterPValue: 'offlineSpeakerClusterPValue',
    SpeakerClusterMinNumSpeakers: 'offlineSpeakerClusterMinNumSpeakers',
    SpeakerClusterMaxNumSpeakers: 'offlineSpeakerClusterMaxNumSpeakers',
    SpeakerClusterMinClusterSize: 'offlineSpeakerClusterMinClusterSize',
  };
  Object.entries(numberFields).forEach(([key, id]) => {
    const value = optionalNumberValue(id);
    if (value !== undefined) options[key] = value;
  });

  const clusterType = optionalSelectValue('offlineSpeakerClusterType');
  if (clusterType) options.SpeakerClusterType = clusterType;
  const segmentationMode = optionalSelectValue('offlineAsrSegmentationMode');
  if (segmentationMode) options.AsrSegmentationMode = segmentationMode;
  return options;
}

async function handleCreatedOfflineTask(res, logEl) {
  appendLog(logEl, summarizeHttpResponse(res), res.ok ? 'log-recv' : 'log-err', 'info');
  appendLogRaw(logEl, pretty(res.json || res.text), res.ok ? 'log-recv' : 'log-err', 'debug');
  const taskId = dataOrNull(res)?.TaskId;
  if (!taskId) {
    toast('任务创建失败，查看日志详情', 'error');
    return;
  }
  $('offlineTaskId').value = taskId;
  toast(`任务已创建: ${taskId}`, 'success');
  await queryOfflineTask();
  startOfflinePolling();
}

async function createOfflineTask() {
  const logEl = $('offlineLog');
  const payload = {
    SourceType: Number($('offlineSourceType').value),
    Url: $('offlineUrl').value.trim(),
    Extra: $('offlineExtra').value.trim(),
    CallbackUrl: $('offlineCallbackUrl').value.trim(),
    HotwordId: $('offlineHotwordId').value.trim() || 'default',
    Context: $('offlineContext').value.trim(),
    NumberNormalizationMode: Number($('offlineNumberMode').value),
    FillerFilterMode: Number($('offlineFillerMode').value),
    ProfanityFilterMode: Number($('offlineProfanityMode').value),
  };
  const recognition = speakerRecognitionValue();
  const groupIds = parseListInput($('offlineSpeakerGroupIds').value);
  const profileIds = parseListInput($('offlineSpeakerProfileIds').value);
  if (recognition !== null) payload.EnableSpeakerRecognition = recognition;
  if (groupIds.length) payload.GroupIds = groupIds;
  if (profileIds.length) payload.SpeakerProfileIds = profileIds;
  Object.assign(payload, offlineSpeakerAdvancedOptions());
  try {
    appendLog(logEl, '创建任务...', 'log-sent', 'info');
    const res = await httpJson('/api/asr/create_task', { method: 'POST', body: payload });
    await handleCreatedOfflineTask(res, logEl);
  } catch (err) {
    appendLog(logEl, `请求失败: ${err.message}`, 'log-err', 'error');
    toast(`请求失败: ${err.message}`, 'error');
  }
}

function updateUploadStatus() {
  const file = $('uploadFile').files[0];
  $('uploadStatus').value = file ? `${file.name} · ${formatBytes(file.size)}` : '未选择文件';
}

async function uploadAndCreateTask() {
  const file = $('uploadFile').files[0];
  const logEl = $('offlineLog');
  if (!file) {
    toast('请先选择音频文件', 'error');
    return;
  }
  const query = buildQuery({
    filename: file.name,
    callback_url: $('offlineCallbackUrl').value.trim(),
    hotword_id: $('offlineHotwordId').value.trim() || 'default',
    context: $('offlineContext').value.trim(),
    number_normalization_mode: $('offlineNumberMode').value,
    filler_filter_mode: $('offlineFillerMode').value,
    profanity_filter_mode: $('offlineProfanityMode').value,
    EnableSpeakerRecognition: speakerRecognitionValue(),
    GroupIds: parseListInput($('offlineSpeakerGroupIds').value),
    SpeakerProfileIds: parseListInput($('offlineSpeakerProfileIds').value),
    ...offlineSpeakerAdvancedOptions(),
  });
  try {
    const uploadBtn = $('uploadCreateBtn');
    uploadBtn.disabled = true;
    $('uploadStatus').value = '准备上传...';
    appendLog(logEl, `上传并创建任务: ${file.name} (${file.size} bytes)`, 'log-sent', 'info');
    const res = await httpUpload(`/api/asr/create_task_upload${query}`, {
      body: file,
      contentType: file.type || 'application/octet-stream',
      onProgress: progress => {
        $('uploadStatus').value = formatUploadProgress(progress);
      },
    });
    $('uploadStatus').value = dataOrNull(res)?.TaskId ? '已上传并创建任务' : '上传失败';
    await handleCreatedOfflineTask(res, logEl);
  } catch (err) {
    $('uploadStatus').value = '上传失败';
    appendLog(logEl, `上传失败: ${err.message}`, 'log-err', 'error');
    toast(`上传失败: ${err.message}`, 'error');
  } finally {
    $('uploadCreateBtn').disabled = false;
  }
}

async function queryOfflineTask() {
  const taskId = $('offlineTaskId').value.trim();
  const logEl = $('offlineLog');
  if (!taskId) {
    toast('请先填写 TaskId', 'error');
    return;
  }
  try {
    const res = await httpJson(`/api/asr/task_status?TaskId=${encodeURIComponent(taskId)}`);
    appendLog(logEl, summarizeHttpResponse(res), res.ok ? 'log-recv' : 'log-err', 'info');
    appendLogRaw(logEl, pretty(res.json || res.text), res.ok ? 'log-recv' : 'log-err', 'debug');
    const status = dataOrNull(res)?.Status;
    if (status === 2 || status === 3) {
      stopOfflinePolling(status === 2 ? '任务已完成，自动轮询已停止' : '任务失败，自动轮询已停止');
    }
  } catch (err) {
    appendLog(logEl, `请求失败: ${err.message}`, 'log-err', 'error');
  }
}

function stopOfflinePolling(message) {
  if (!state.pollTimer) return;
  clearInterval(state.pollTimer);
  state.pollTimer = null;
  $('togglePollBtn').textContent = '开启自动轮询';
  $('togglePollBtn').className = 'btn-warn';
  if (message) toast(message, 'info');
}

function startOfflinePolling(intervalMs) {
  stopOfflinePolling();
  const interval = Math.max(500, Number(intervalMs || $('offlinePollMs').value || 3000));
  state.pollTimer = setInterval(() => {
    if ($('offlineTaskId').value.trim()) queryOfflineTask();
  }, interval);
  $('togglePollBtn').textContent = '停止自动轮询';
  $('togglePollBtn').className = 'btn-danger';
  toast(`自动轮询已开启 (${interval}ms)`, 'success');
}

async function cancelTask() {
  const taskId = $('offlineTaskId').value.trim();
  const logEl = $('offlineLog');
  if (!taskId) {
    toast('请先填写 TaskId', 'error');
    return;
  }
  try {
    const res = await httpJson('/api/asr/cancel_task', {
      method: 'POST',
      body: { TaskId: Number(taskId) },
    });
    appendLog(logEl, summarizeHttpResponse(res), res.ok ? 'log-recv' : 'log-err', 'info');
    appendLogRaw(logEl, pretty(res.json || res.text), res.ok ? 'log-recv' : 'log-err', 'debug');
    toast('取消请求已发送', 'info');
  } catch (err) {
    appendLog(logEl, `取消失败: ${err.message}`, 'log-err', 'error');
  }
}

async function downloadTask(format) {
  const taskId = $('offlineTaskId').value.trim();
  const logEl = $('offlineLog');
  if (!taskId) {
    toast('请先填写 TaskId', 'error');
    return;
  }
  try {
    const filename = await downloadFile(
      `/api/asr/task_result_download?TaskId=${encodeURIComponent(taskId)}&Format=${format}`,
    );
    appendLog(logEl, `下载结果: ${filename}`, 'log-info', 'info');
    toast(`已下载 ${filename}`, 'success');
  } catch (err) {
    appendLog(logEl, `下载失败: ${err.message}`, 'log-err', 'error');
    toast(`下载失败: ${err.message}`, 'error');
  }
}

export function registerOfflineTasks() {
  renderOfflineHotwordOptions();
  $('offlineHotwordSelect').addEventListener('change', () => {
    const item = currentHotwordItems().find(entry => entry.HotwordId === $('offlineHotwordSelect').value);
    applyOfflineHotword(item);
  });
  $('offlineHotwordId').addEventListener('input', renderOfflineHotwordOptions);
  $('refreshOfflineHotwordsBtn').addEventListener('click', refreshOfflineHotwords);
  document.addEventListener('hotwords:updated', renderOfflineHotwordOptions);
  document.addEventListener('hotword:selected', event => {
    applyOfflineHotword(event.detail?.item);
  });
  $('createOfflineBtn').addEventListener('click', createOfflineTask);
  $('uploadFile').addEventListener('change', updateUploadStatus);
  $('uploadCreateBtn').addEventListener('click', uploadAndCreateTask);
  $('queryOfflineBtn').addEventListener('click', queryOfflineTask);
  $('togglePollBtn').addEventListener('click', () => {
    if (state.pollTimer) stopOfflinePolling('自动轮询已停止');
    else startOfflinePolling();
  });
  $('cancelTaskBtn').addEventListener('click', cancelTask);
  $('downloadJsonBtn').addEventListener('click', () => downloadTask('json'));
  $('downloadTextBtn').addEventListener('click', () => downloadTask('txt'));
  $('downloadRttmBtn').addEventListener('click', () => downloadTask('rttm'));
  $('clearOfflineLogBtn').addEventListener('click', () => { $('offlineLog').innerHTML = ''; });
}
