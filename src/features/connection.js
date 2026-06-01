import { $ } from '../core/dom.js';
import { persistEndpointSettings, probeServiceConnection } from '../core/api.js';
import { toast } from '../core/toast.js';
import { showPanel } from '../ui/navigation.js';

function setConnectionStatus(result, checking = false) {
  const chip = $('connectionStatusChip');
  const label = $('connectionStatusLabel');
  const detail = $('connectionStatusDetail');
  if (!chip || !label || !detail) return;
  chip.classList.remove('ok', 'warn', 'error');
  if (checking) {
    chip.classList.add('warn');
    label.textContent = '检测中';
    detail.textContent = '正在检测服务连接...';
    return;
  }
  chip.classList.add(result.ok ? 'ok' : 'error');
  label.textContent = result.ok ? '连接正常' : '连接失败';
  const statusText = result.status ? `HTTP ${result.status} · ` : '';
  detail.textContent = `${statusText}${result.message || ''}`;
}

export async function verifyConnection({ switchOnFailure = false, silent = false, timeoutMs = 2500 } = {}) {
  setConnectionStatus({}, true);
  persistEndpointSettings();
  const result = await probeServiceConnection({ timeoutMs });
  setConnectionStatus(result);
  if (!result.ok && switchOnFailure) {
    showPanel('settings');
  }
  if (!silent) {
    toast(result.ok ? '连接检测成功' : `连接检测失败: ${result.message}`, result.ok ? 'success' : 'error');
  }
  return result;
}

export function routeInitialPanelByConnection() {
  const base = $('httpBase')?.value?.trim();
  if (!base) {
    setConnectionStatus({ ok: false, message: 'HTTP Base URL 未配置' });
    showPanel('settings');
    return;
  }
  verifyConnection({ switchOnFailure: true, silent: true });
}

export function registerConnectionSettings() {
  ['httpBase', 'wsBase', 'httpTimeoutMs', 'logLevel'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', persistEndpointSettings);
  });
  $('testConnectionBtn').addEventListener('click', () => {
    verifyConnection({ timeoutMs: 5000 });
  });
}
