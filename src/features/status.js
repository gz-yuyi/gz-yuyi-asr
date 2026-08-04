import { $ } from '../core/dom.js';
import { dataOrNull, httpJson } from '../core/api.js';
import { esc } from '../core/format.js';
import { toast } from '../core/toast.js';

function renderKv(target, entries) {
  $(target).innerHTML = entries.map(([label, val, cls]) =>
    `<div class="kv-item">
          <div class="kv-label">${esc(label)}</div>
          <div class="kv-value ${cls || ''}">${esc(val ?? '')}</div>
        </div>`
  ).join('');
}

function formatExpiration(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ');
}

async function refreshSystemStatus() {
  try {
    const routeRes = await httpJson('/api/system/route_status');
    const route = dataOrNull(routeRes);
    if (!route) throw new Error(routeRes.text || '无法读取授权信息');
    renderKv('routeKv', [
      ['总的授权路数', route.TotalRoutes ?? route.LicensedRoutes ?? '-', ''],
      ['实时使用', route.RealtimeActiveRoutes ?? 0, ''],
      ['离线使用', route.OfflineActiveRoutes ?? 0, ''],
      ['到期时间', formatExpiration(route.ExpirationTime), ''],
    ]);
    toast('授权信息已刷新', 'success');
  } catch (err) {
    toast(`请求失败: ${err.message}`, 'error');
  }
}

export function registerStatus() {
  $('refreshStatusBtn').addEventListener('click', refreshSystemStatus);
}
