import assert from 'node:assert/strict';
import {
  applyTranscriptUpdateToMap,
  stageTranscriptUpdateBatch,
} from '../src/core/transcript-state.js';

const sessionId = 'sess_test';
const update = (segmentId, revision, extra = {}) => ({
  type: 'TranscriptUpdate',
  session_id: sessionId,
  source: 'speaker_refine',
  segment_id: segmentId,
  revision,
  segment_deleted: false,
  ...extra,
});
const batch = (batchId, updates) => ({
  type: 'TranscriptUpdateBatch',
  session_id: sessionId,
  batch_id: batchId,
  source: 'speaker_refine',
  reason: 'speaker_resegmentation',
  atomic: true,
  updates,
});

const parent = update('seg_000001', 4, { text: '你好谢谢', speaker_id: 0 });
const original = new Map([[parent.segment_id, parent]]);
const split = batch('batch_000001', [
  update('seg_000001', 5, { segment_deleted: true }),
  update('seg_000001_01', 1, {
    text: '你好', speaker_id: 0, parent_segment_id: 'seg_000001',
    supersedes_segment_id: 'seg_000001',
  }),
  update('seg_000001_02', 1, {
    text: '谢谢', speaker_id: 1, parent_segment_id: 'seg_000001',
    supersedes_segment_id: 'seg_000001',
  }),
]);

const splitResult = stageTranscriptUpdateBatch(original, split, new Set());
assert.equal(splitResult.duplicate, false);
assert.deepEqual([...original.keys()], ['seg_000001'], 'staging must not mutate official state');
assert.deepEqual([...splitResult.segments.keys()].sort(), ['seg_000001_01', 'seg_000001_02']);
assert.deepEqual([...splitResult.touched].sort(), ['seg_000001', 'seg_000001_01', 'seg_000001_02']);

const committed = splitResult.segments;
const seen = new Set(['batch_000001']);
const replay = stageTranscriptUpdateBatch(committed, split, seen);
assert.equal(replay.duplicate, true);
assert.equal(replay.segments, committed);

const restore = batch('batch_000002', [
  update('seg_000001_01', 2, { segment_deleted: true, parent_segment_id: 'seg_000001' }),
  update('seg_000001_02', 2, { segment_deleted: true, parent_segment_id: 'seg_000001' }),
  update('seg_000001', 6, { text: '你好谢谢', speaker_id: 0 }),
]);
const restored = stageTranscriptUpdateBatch(committed, restore, seen);
assert.deepEqual([...restored.segments.keys()], ['seg_000001']);
assert.equal(restored.segments.get('seg_000001').revision, 6);

const malformed = batch('batch_bad', [
  update('seg_000001', 7, { segment_deleted: true }),
  update('seg_bad', 'not-an-integer'),
]);
assert.throws(() => stageTranscriptUpdateBatch(restored.segments, malformed, seen),
  /invalid TranscriptUpdateBatch child/);
assert.deepEqual([...restored.segments.keys()], ['seg_000001'],
  'malformed batch must not partially mutate official state');

const standalone = new Map(restored.segments);
assert.deepEqual(applyTranscriptUpdateToMap(standalone,
  update('seg_000001', 6, { text: 'stale' })), []);
assert.equal(standalone.get('seg_000001').text, '你好谢谢');
assert.deepEqual(applyTranscriptUpdateToMap(standalone,
  update('seg_000001', 7, { text: 'new' })), ['seg_000001']);
assert.equal(standalone.get('seg_000001').text, 'new');

console.log('realtime atomic batch tests passed');
