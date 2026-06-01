import { $ } from './dom.js';
import { pretty, safeParse, speakerQualitySummaryText } from './format.js';

export function buildHttpUrl(path) {
  return $('httpBase').value.trim().replace(/\/+$/, '') + path;
}

export function initializeEndpointDefaults() {
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
  $('httpBase').value = window.location.origin;
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
