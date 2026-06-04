import { $, qsa } from '../core/dom.js';
import { state } from '../core/state.js';
import { apiErrorMessage, dataOrNull, httpJson, summarizeHttpResponse } from '../core/api.js';
import { appendLog, appendLogRaw } from '../core/logger.js';
import { esc, pretty } from '../core/format.js';
import { toast } from '../core/toast.js';

function hasApiError(res) {
  return Boolean(res?.json?.Response?.Error);
}

function hotwordErrorMessage(res) {
  return hasApiError(res) ? apiErrorMessage(res) : summarizeHttpResponse(res);
}

function normalizeHotwordItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      HotwordId: String(item?.HotwordId || '').trim(),
      Content: String(item?.Content || ''),
      CreatedAt: item?.CreatedAt || '',
      UpdatedAt: item?.UpdatedAt || '',
    }))
    .filter(item => item.HotwordId)
    .sort((a, b) => a.HotwordId.localeCompare(b.HotwordId, 'zh-Hans-CN'));
}

function setHotwordItems(items) {
  state.hotwords.items = normalizeHotwordItems(items);
  state.hotwords.loaded = true;
  document.dispatchEvent(new CustomEvent('hotwords:updated', {
    detail: { items: state.hotwords.items },
  }));
}

function renderHotwordList() {
  const panel = $('hotwordListPanel');
  const status = $('hotwordListStatus');
  if (!panel || !status) return;
  const items = state.hotwords.items;
  if (!items.length) {
    panel.innerHTML = '<div class="empty-state compact-empty">没有热词数据</div>';
    status.textContent = state.hotwords.loaded ? '共 0 条热词' : '点击“列出全部”加载热词数据';
    return;
  }
  status.textContent = `共 ${items.length} 条热词`;
  panel.innerHTML = items.map(item => `
    <div class="hotword-item" data-hotword-id="${esc(item.HotwordId)}">
      <div class="hotword-main">
        <div class="hotword-title">${esc(item.HotwordId)}</div>
        <div class="hotword-content">${esc(item.Content || '无内容')}</div>
        <div class="hotword-meta">更新于 ${esc(item.UpdatedAt || '-')}</div>
      </div>
      <button class="btn-ghost compact-btn use-hotword-btn" type="button">使用</button>
    </div>
  `).join('');
  qsa('#hotwordListPanel .use-hotword-btn').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.closest('.hotword-item')?.dataset.hotwordId || '';
      const item = state.hotwords.items.find(entry => entry.HotwordId === id);
      if (!item) return;
      $('hotwordId').value = item.HotwordId;
      $('hotwordContent').value = item.Content;
      document.dispatchEvent(new CustomEvent('hotword:selected', { detail: { item } }));
      toast(`已选择热词 ${item.HotwordId}`, 'success');
    });
  });
}

export async function refreshHotwordList({ log = false, toastResult = false } = {}) {
  const logEl = $('hotwordLog');
  const res = await httpJson('/api/hotwords/list');
  const effectiveOk = res.ok && !hasApiError(res);
  if (log && logEl) {
    appendLog(logEl, hotwordErrorMessage(res), effectiveOk ? 'log-recv' : 'log-err', 'info');
    appendLogRaw(logEl, pretty(res.json || res.text), effectiveOk ? 'log-recv' : 'log-err', 'debug');
  }
  if (!effectiveOk) throw new Error(hotwordErrorMessage(res));
  const items = dataOrNull(res)?.Items || [];
  setHotwordItems(items);
  renderHotwordList();
  if (toastResult) toast(`已加载 ${state.hotwords.items.length} 条热词`, 'success');
  return state.hotwords.items;
}

async function hotwordReq(kind) {
  const hwId = $('hotwordId').value.trim();
  const content = $('hotwordContent').value;
  const logEl = $('hotwordLog');
  if (kind !== 'list' && !hwId) {
    appendLog(logEl, '请先填写 HotwordId', 'log-err', 'error');
    toast('请先填写 HotwordId', 'error');
    $('hotwordId').focus();
    return;
  }
  try {
    let res;
    if (kind === 'upsert') {
      res = await httpJson('/api/hotwords/upsert', {
        method: 'POST',
        body: { HotwordId: hwId, Content: content },
      });
    } else if (kind === 'get') {
      res = await httpJson(`/api/hotwords/get?HotwordId=${encodeURIComponent(hwId)}`);
    } else if (kind === 'list') {
      await refreshHotwordList({ log: true, toastResult: true });
      return;
    } else {
      res = await httpJson('/api/hotwords/delete', {
        method: 'POST',
        body: { HotwordId: hwId },
      });
    }
    const effectiveOk = res.ok && !hasApiError(res);
    appendLog(logEl, hotwordErrorMessage(res), effectiveOk ? 'log-recv' : 'log-err', 'info');
    appendLogRaw(logEl, pretty(res.json || res.text), effectiveOk ? 'log-recv' : 'log-err', 'debug');
    if (!effectiveOk) throw new Error(hotwordErrorMessage(res));
    const got = dataOrNull(res)?.Content;
    if (typeof got === 'string') $('hotwordContent').value = got;
    if (kind === 'upsert' || kind === 'delete') {
      await refreshHotwordList({ log: false });
    }
    toast(`${kind} 操作完成`, 'success');
  } catch (err) {
    appendLog(logEl, `请求失败: ${err.message}`, 'log-err', 'error');
    toast(`请求失败: ${err.message}`, 'error');
  }
}

export function registerHotwords() {
  $('upsertHwBtn').addEventListener('click', () => hotwordReq('upsert'));
  $('getHwBtn').addEventListener('click', () => hotwordReq('get'));
  $('listHwBtn').addEventListener('click', () => hotwordReq('list'));
  $('deleteHwBtn').addEventListener('click', () => hotwordReq('delete'));
  $('clearHwLogBtn').addEventListener('click', () => { $('hotwordLog').innerHTML = ''; });
  renderHotwordList();
}
