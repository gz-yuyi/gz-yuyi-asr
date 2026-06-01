import { $ } from './dom.js';
import { pretty, safeParse, speakerQualitySummaryText } from './format.js';

const STORAGE_KEYS = {
  httpBase: 'yuyi-asr:http-base',
  wsBase: 'yuyi-asr:ws-base',
  timeoutMs: 'yuyi-asr:http-timeout-ms',
  logLevel: 'yuyi-asr:log-level',
};

function storageGet(key) {
  try {
    return window.localStorage?.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

function storageSet(key, value) {
  try {
    if (value) window.localStorage?.setItem(key, value);
    else window.localStorage?.removeItem(key);
  } catch (_) {
    // localStorage can be blocked in private/file contexts; the console still works without persistence.
  }
}

export function buildHttpUrl(path) {
  return $('httpBase').value.trim().replace(/\/+$/, '') + path;
}

function wsUrlFromHttpBase(base) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/realtime/ws';
  url.search = '';
  return url.toString();
}

export function initializeEndpointDefaults() {
  const savedHttpBase = storageGet(STORAGE_KEYS.httpBase);
  const savedWsBase = storageGet(STORAGE_KEYS.wsBase);
  const savedTimeoutMs = storageGet(STORAGE_KEYS.timeoutMs);
  const savedLogLevel = storageGet(STORAGE_KEYS.logLevel);
  if (savedHttpBase) {
    $('httpBase').value = savedHttpBase;
    if ($('wsBase')) {
      try {
        $('wsBase').value = savedWsBase || wsUrlFromHttpBase(savedHttpBase);
      } catch (_) {
        $('wsBase').value = savedWsBase || '';
      }
    }
    if (savedTimeoutMs) $('httpTimeoutMs').value = savedTimeoutMs;
    if (savedLogLevel) $('logLevel').value = savedLogLevel;
    return;
  }
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
  $('httpBase').value = window.location.origin;
  if ($('wsBase')) {
    $('wsBase').value = wsUrlFromHttpBase(window.location.origin);
  }
}

export function persistEndpointSettings() {
  storageSet(STORAGE_KEYS.httpBase, $('httpBase')?.value?.trim() || '');
  storageSet(STORAGE_KEYS.wsBase, $('wsBase')?.value?.trim() || '');
  storageSet(STORAGE_KEYS.timeoutMs, $('httpTimeoutMs')?.value?.trim() || '');
  storageSet(STORAGE_KEYS.logLevel, $('logLevel')?.value || '');
}

export async function probeServiceConnection({ timeoutMs = 2500 } = {}) {
  const base = $('httpBase')?.value?.trim();
  if (!base) {
    return { ok: false, message: 'HTTP Base URL 未配置' };
  }
  try {
    new URL(base);
  } catch (err) {
    return { ok: false, message: `HTTP Base URL 无效: ${err.message}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/system/route_status`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const text = await res.text();
    const json = safeParse(text);
    const err = json?.Response?.Error;
    if (!res.ok || err) {
      return {
        ok: false,
        status: res.status,
        message: err?.Message || `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, message: '连接正常' };
  } catch (err) {
    const message = err.name === 'AbortError' ? '连接检测超时' : err.message;
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestText(path, options = {}) {
  const ctrl = new AbortController();
  const timeout = Number($('httpTimeoutMs').value || 30000);
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(buildHttpUrl(path), { ...options, signal: ctrl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, json: safeParse(text), headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

export async function httpJson(path, { method = 'GET', body } = {}) {
  return requestText(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function httpBinary(path, { method = 'POST', body, contentType = 'application/octet-stream' } = {}) {
  return requestText(path, {
    method,
    headers: { 'Content-Type': contentType },
    body,
  });
}

export async function downloadFile(path) {
  const ctrl = new AbortController();
  const timeout = Number($('httpTimeoutMs').value || 30000);
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(buildHttpUrl(path), { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : `offline-asr-${Date.now()}.json`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return filename;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestBlob(path) {
  const ctrl = new AbortController();
  const timeout = Number($('httpTimeoutMs').value || 30000);
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(buildHttpUrl(path), { signal: ctrl.signal });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await res.json();
      const err = payload?.Response?.Error;
      throw new Error(err?.Message || pretty(payload));
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return await res.blob();
  } finally {
    clearTimeout(timer);
  }
}

export function dataOrNull(res) {
  return res?.json?.Response?.Data || null;
}

export function summarizeHttpResponse(res) {
  const reqId = res?.json?.Response?.RequestId || '';
  const taskId = res?.json?.Response?.Data?.TaskId;
  const data = res?.json?.Response?.Data;
  const err = res?.json?.Response?.Error;
  const parts = [`HTTP ${res?.status ?? ''}`];
  if (reqId) parts.push(`RequestId=${reqId}`);
  if (taskId != null) parts.push(`TaskId=${taskId}`);
  if (data?.ProgressPercent != null) {
    const stage = data.ProgressStage ? ` ${data.ProgressStage}` : '';
    parts.push(`Progress=${data.ProgressPercent}%${stage}`);
  }
  const qualityText = speakerQualitySummaryText(data);
  if (qualityText) parts.push(qualityText);
  if (err?.Code) parts.push(`Error=${err.Code}`);
  return parts.join(' · ');
}

export function apiErrorMessage(res) {
  const err = res?.json?.Response?.Error;
  const qualityText = speakerQualitySummaryText(res?.json?.Response?.Data);
  if (err?.Message) {
    const suffix = qualityText ? ` (${qualityText})` : '';
    return `${err.Code || 'Error'}: ${err.Message}${suffix}`;
  }
  return `HTTP ${res?.status ?? ''}`;
}
