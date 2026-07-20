import { $ } from '../core/dom.js';
import { dataOrNull, httpJson } from '../core/api.js';
import { esc, formatBoolZh, pretty } from '../core/format.js';
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
    const [routeRes, statsRes] = await Promise.all([
      httpJson('/api/system/route_status'),
      httpJson('/api/asr/task_stats'),
    ]);
    $('routeJson').textContent = routeRes.json ? pretty(routeRes.json) : routeRes.text;
    $('taskStatsJson').textContent = statsRes.json ? pretty(statsRes.json) : statsRes.text;
    const route = dataOrNull(routeRes);
    if (route) {
      renderKv('routeKv', [
        ['授权开关', formatBoolZh(route.LicenseEnabled), ''],
        ['授权有效', formatBoolZh(route.LicenseValid), route.LicenseValid ? 'green' : 'red'],
        ['授权路数', route.LicensedRoutes ?? route.TotalRoutes, ''],
        ['实时预留', route.RealtimeReservedRoutes, ''],
        ['实时占用', route.RealtimeActiveRoutes, ''],
        ['离线占用', route.OfflineActiveRoutes, ''],
        ['可用路数', route.AvailableRoutes, Number(route.AvailableRoutes) > 0 ? 'green' : 'red'],
        ['到期时间', route.ExpirationTime || '未设置', ''],
        ['授权信息', route.LicenseMessage || '无', ''],
      ]);
    }
    const stats = dataOrNull(statsRes);
    if (stats) {
      renderKv('taskStatsKv', [
        ['排队中', stats.QueuedTasks, Number(stats.QueuedTasks) > 0 ? 'yellow' : 'green'],
        ['运行中', stats.RunningTasks, Number(stats.RunningTasks) > 0 ? 'yellow' : 'green'],
        ['已成功', stats.SucceededTasks, 'green'],
        ['已失败', stats.FailedTasks, Number(stats.FailedTasks) > 0 ? 'red' : 'green'],
        ['已取消', stats.CanceledTasks, ''],
        ['总任务', stats.TotalTasks, ''],
        ['回调失败', stats.CallbackFailedTasks, Number(stats.CallbackFailedTasks) > 0 ? 'red' : 'green'],
      ]);
    }
    toast('系统状态已刷新', 'success');
  } catch (err) {
    $('routeJson').textContent = `请求失败：${err.message}`;
    $('taskStatsJson').textContent = `请求失败：${err.message}`;
    toast(`请求失败: ${err.message}`, 'error');
  }
}

export function registerStatus() {
  $('refreshStatusBtn').addEventListener('click', refreshSystemStatus);
}
