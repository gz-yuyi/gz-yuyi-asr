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

async function refreshSystemStatus() {
  try {
    const routeRes = await httpJson('/api/system/route_status');
    const route = dataOrNull(routeRes);
    if (!route) throw new Error(routeRes.text || '无法读取授权并发');
    renderKv('routeKv', [
      ['授权并发', route.LicensedRoutes ?? route.TotalRoutes, ''],
    ]);
    toast('授权并发已刷新', 'success');
  } catch (err) {
    toast(`请求失败: ${err.message}`, 'error');
  }
}

export function registerStatus() {
  $('refreshStatusBtn').addEventListener('click', refreshSystemStatus);
}
