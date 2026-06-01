import { $ } from '../core/dom.js';
import { dataOrNull, httpJson, summarizeHttpResponse } from '../core/api.js';
import { appendLog, appendLogRaw } from '../core/logger.js';
import { pretty } from '../core/format.js';
import { toast } from '../core/toast.js';

async function hotwordReq(kind) {
  const hwId = $('hotwordId').value.trim();
  const content = $('hotwordContent').value;
  const logEl = $('hotwordLog');
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
      res = await httpJson('/api/hotwords/list');
    } else {
      res = await httpJson('/api/hotwords/delete', {
        method: 'POST',
        body: { HotwordId: hwId },
      });
    }
    appendLog(logEl, summarizeHttpResponse(res), res.ok ? 'log-recv' : 'log-err', 'info');
    appendLogRaw(logEl, pretty(res.json || res.text), res.ok ? 'log-recv' : 'log-err', 'debug');
    const got = dataOrNull(res)?.Content;
    if (typeof got === 'string') $('hotwordContent').value = got;
    toast(`${kind} 操作完成`, res.ok ? 'success' : 'error');
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
}
