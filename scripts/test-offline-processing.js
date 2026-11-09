import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRouteStatusEntries, registerStatus } from '../src/features/status.js';

const labels = ['总的授权路数', '实时使用', '离线处理中任务', '到期时间'];
const removedLabels = ['授权RTF', '授权每路折算倍数', '离线总实时倍数', '实际执行任务', '等待调度任务', '内部执行并发上限'];

for (const count of [0, 5, 200, 205]) {
  const route = Object.freeze({
    LicensedRoutes: 5, RealtimeActiveRoutes: 3, OfflineProcessingTasks: count,
    RouteMinRtf: 0.4, OfflineAudioRatePerRoute: 2.5, OfflineTotalAudioRate: 12.5,
    OfflineRunningTasks: Math.min(count, 32), QueuedTasks: Math.max(0, count - 32),
    OfflineJobConcurrency: 32, ExpirationTime: '2026-12-04T23:59:59',
  });
  const before = JSON.stringify(route);
  const entries = buildRouteStatusEntries(route);
  assert.deepEqual(entries.map(([label]) => label), labels, '系统状态只展示四项白名单');
  const main = new Map(entries.map(([label, value]) => [label, value]));
  assert.equal(main.get('离线处理中任务'), count, '真实处理中数量不补齐、不按授权截断');
  assert.equal(main.get('总的授权路数'), 5);
  assert.equal(main.get('实时使用'), 3);
  assert.equal(main.get('到期时间'), '2026-12-04 23:59:59');
  for (const label of removedLabels) assert.equal(main.has(label), false);
  assert.equal(JSON.stringify(route), before, '不删除或修改后端返回字段');
}

const missing = new Map(buildRouteStatusEntries({}).map(([label, value]) => [label, value]));
assert.equal(missing.get('离线处理中任务'), '-', '缺失数据不能伪装成零');
assert.equal(missing.get('到期时间'), '-');
const denied = new Map(buildRouteStatusEntries({ LicensedRoutes: 0, OfflineProcessingTasks: 0 }).map(([label, value]) => [label, value]));
assert.equal(denied.get('总的授权路数'), 0);
assert.equal(denied.get('离线处理中任务'), 0);

const template = readFileSync(new URL('../src/template.html', import.meta.url), 'utf8');
assert.ok(template.includes('<option value="processing">处理中</option>'));
assert.ok(!template.includes('<option value="queued">'));
assert.ok(!template.includes('<option value="running">'));
const statusPanel = template.match(/<section class="panel" id="panel-status">([\s\S]*?)<\/section>/)?.[1];
assert.ok(statusPanel);
assert.ok(statusPanel.includes('id="routeKv"'));
assert.ok(statusPanel.includes('id="refreshStatusBtn"'));
for (const removed of ['routeSchedulingKv', '<details', '调度明细', '不代表所有任务同时推理', '授权路数用于折算总吞吐额度']) {
  assert.ok(!statusPanel.includes(removed), `已移除的区域不能只用样式隐藏：${removed}`);
}

// 仅保留新DOM节点，真实执行刷新入口，防止残留渲染访问已删除容器。
const original = { document: globalThis.document, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
const events = {};
const notifications = [];
const nodes = {
  refreshStatusBtn: { addEventListener: (name, handler) => { events[name] = handler; } },
  routeKv: { innerHTML: '' },
  httpBase: { value: 'http://status-test.invalid' },
  httpTimeoutMs: { value: 30000 },
  toasts: { appendChild: element => notifications.push(element) },
};
let payload = { LicensedRoutes: 5, RealtimeActiveRoutes: 1, OfflineProcessingTasks: 205,
  RouteMinRtf: 0.4, OfflineAudioRatePerRoute: 2.5, OfflineTotalAudioRate: 12.5,
  OfflineRunningTasks: 32, QueuedTasks: 173, OfflineJobConcurrency: 32 };
try {
  globalThis.document = {
    getElementById: id => { assert.ok(Object.hasOwn(nodes, id), `访问未知DOM：${id}`); return nodes[id]; },
    createElement: () => ({ className: '', textContent: '' }),
  };
  globalThis.setTimeout = () => 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://status-test.invalid/api/system/route_status');
    assert.equal(options.cache, 'no-store');
    return { ok: true, status: 200, headers: {}, text: async () => JSON.stringify({ Response: { Data: payload } }) };
  };
  registerStatus();
  await events.click();
  assert.equal(notifications.at(-1).className, 'toast success');
  assert.equal((nodes.routeKv.innerHTML.match(/class="kv-item"/g) || []).length, 4);
  assert.ok(nodes.routeKv.innerHTML.includes('205'));
  for (const label of removedLabels) assert.ok(!nodes.routeKv.innerHTML.includes(label));
  payload = { LicensedRoutes: 5, RealtimeActiveRoutes: 0, OfflineProcessingTasks: 0 };
  await events.click();
  assert.equal(notifications.at(-1).className, 'toast success');
  assert.ok(!nodes.routeKv.innerHTML.includes('205'), '刷新应移除旧计数');
} finally {
  globalThis.document = original.document;
  globalThis.fetch = original.fetch;
  globalThis.setTimeout = original.setTimeout;
}
console.log('系统状态四项展示、真实计数与移除调度区域后的刷新回归通过');
