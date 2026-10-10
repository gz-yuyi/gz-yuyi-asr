import assert from 'node:assert/strict';
import { applySegmentToStats, createRealtimeStats } from '../src/core/transcript-state.js';
import { trimLogEntries } from '../src/core/logger.js';

// 片段增量统计：长会话下用它替代“每条事件全量扫描 segments”。
const segment = extra => ({
  segment_id: 's',
  revision: 1,
  is_final: true,
  end_ms: 1000,
  speaker_id: 0,
  speaker_match_status: 'unknown',
  ...extra,
});

const stats = createRealtimeStats();

// 新增：final / 说话人 / 未知声纹 / 音频位置
applySegmentToStats(stats, segment({ end_ms: 5000 }), 1);
assert.equal(stats.finals, 1);
assert.equal(stats.drafts, 0);
assert.equal(stats.speakers.size, 1);
assert.equal(stats.unknown.size, 1);
assert.equal(stats.registered.size, 0);
assert.equal(stats.lastEndMs, 5000);

// 草稿与注册声纹
applySegmentToStats(stats, segment({
  segment_id: 's2',
  is_final: false,
  end_ms: 8000,
  speaker_id: 1,
  speaker_match_status: 'matched',
  speaker_profile_id: 'p1',
}), 1);
assert.equal(stats.finals, 1);
assert.equal(stats.drafts, 1);
assert.equal(stats.speakers.size, 2);
assert.equal(stats.registered.size, 1);
assert.equal(stats.unknown.size, 1);
assert.equal(stats.lastEndMs, 8000);

// 同一片段被更新：先撤销旧贡献再加新贡献，计数不能漂移
const revised = segment({ segment_id: 's3', end_ms: 9000, speaker_id: 2 });
applySegmentToStats(stats, revised, 1);
applySegmentToStats(stats, revised, -1);
assert.equal(stats.finals, 1, '撤销后 final 计数应还原');
assert.equal(stats.speakers.size, 2, '撤销后说话人计数应移除');

// 删除片段（segment_deleted）等价于撤销贡献
const removed = segment({ segment_id: 's4', end_ms: 12000, speaker_id: 3 });
applySegmentToStats(stats, removed, 1);
assert.equal(stats.finals, 2);
assert.equal(stats.speakers.size, 3);
assert.equal(stats.lastEndMs, 12000);
applySegmentToStats(stats, removed, -1);
assert.equal(stats.finals, 1);
assert.equal(stats.speakers.size, 2);
assert.equal(stats.lastEndMs, 12000, '音频位置不回退');

// 空值/异常输入不应破坏统计
applySegmentToStats(stats, null, 1);
applySegmentToStats(stats, segment({ speaker_id: null, speaker_match_status: null }), 1);
applySegmentToStats(stats, segment({ speaker_id: null, speaker_match_status: null }), -1);
assert.equal(stats.finals, 1);
assert.ok([...stats.speakers.values()].every(count => count > 0));
assert.ok([...stats.registered.values()].every(count => count > 0));
assert.ok([...stats.unknown.values()].every(count => count > 0));

// 重置
const fresh = createRealtimeStats();
assert.equal(fresh.finals, 0);
assert.equal(fresh.lastEndMs, 0);
assert.equal(fresh.speakers.size, 0);

// 日志条的 DOM 上限（长会话下日志不再无限增长）
function fakeLogElement() {
  const children = [];
  return {
    children,
    get childElementCount() { return children.length; },
    get lastElementChild() { return children[children.length - 1] || null; },
    prepend(node) { children.unshift(node); },
  };
}
const logEl = fakeLogElement();
for (let i = 0; i < 10; i++) {
  const node = { removed: false, remove() { this.removed = true; this.detached = true; const idx = logEl.children.indexOf(this); if (idx >= 0) logEl.children.splice(idx, 1); } };
  logEl.prepend(node);
  trimLogEntries(logEl, 4);
}
assert.equal(logEl.childElementCount, 4, '日志节点数应被裁剪到上限');
assert.ok(logEl.children.every(node => !node.detached), '保留的应是最近的节点');

console.log('realtime incremental stats tests passed');
