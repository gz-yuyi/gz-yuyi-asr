import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRouteStatusEntries, buildSchedulingEntries } from '../src/features/status.js';

for (const count of [0, 5, 200, 205]) {
  const route = { LicensedRoutes: 200, OfflineProcessingTasks: count, OfflineRunningTasks: Math.min(count, 32), QueuedTasks: Math.max(0, count - 32), OfflineJobConcurrency: 32 };
  const main = new Map(buildRouteStatusEntries(route).map(([k, v]) => [k, v]));
  assert.equal(main.get('离线处理中任务'), count, '按实际处理中数量展示，不补齐也不截断');
  assert.equal(main.get('总的授权路数'), 200);
  assert.equal(main.has('实际执行任务'), false, '内部调度不混作业务授权');
  const detail = new Map(buildSchedulingEntries(route).map(([k, v]) => [k, v]));
  assert.equal(detail.get('实际执行任务'), route.OfflineRunningTasks);
  assert.equal(detail.get('等待调度任务'), route.QueuedTasks);
}
assert.equal(new Map(buildRouteStatusEntries({}).map(([k,v]) => [k,v])).get('离线处理中任务'), '-', '缺失数据不能伪装成零');
const template = readFileSync(new URL('../src/template.html', import.meta.url), 'utf8');
assert.ok(template.includes('<option value="processing">处理中</option>'));
assert.ok(!template.includes('<option value="queued">'));
assert.ok(!template.includes('<option value="running">'));
assert.ok(template.includes('id="routeSchedulingKv"'));
assert.ok(template.includes('不代表所有任务同时推理'));
console.log('离线业务处理中展示回归通过');
