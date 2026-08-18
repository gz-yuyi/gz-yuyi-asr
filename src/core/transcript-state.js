// Pure state transitions for realtime TranscriptUpdate events. Keeping this
// independent from the DOM makes atomic batch semantics unit-testable.

export function applyTranscriptUpdateToMap(segments, update) {
  const id = update?.segment_id;
  if (id == null) return [];
  const current = segments.get(id);
  if (current && (update.revision ?? 0) <= (current.revision ?? 0)) return [];

  const touched = [id];
  if (update.supersedes_segment_id) {
    segments.delete(update.supersedes_segment_id);
    touched.push(update.supersedes_segment_id);
  }
  if (update.segment_deleted) segments.delete(id);
  else segments.set(id, update);
  return touched;
}

export function stageTranscriptUpdateBatch(currentSegments, batch, committedBatchIds) {
  if (typeof batch?.batch_id !== 'string' || !batch.batch_id || batch.atomic !== true ||
      batch.source !== 'speaker_refine' || batch.reason !== 'speaker_resegmentation' ||
      !Array.isArray(batch.updates) || batch.updates.length === 0) {
    throw new Error('invalid TranscriptUpdateBatch envelope');
  }
  if (committedBatchIds?.has(batch.batch_id)) {
    return { duplicate: true, segments: currentSegments, touched: new Set() };
  }

  // Validate every child before staging any mutation. The official map is
  // never modified by this function, including on malformed input.
  for (const update of batch.updates) {
    if (!update || update.type !== 'TranscriptUpdate' ||
        update.session_id !== batch.session_id || update.source !== batch.source ||
        typeof update.segment_id !== 'string' || !update.segment_id ||
        !Number.isInteger(update.revision) || update.revision < 1) {
      throw new Error(`invalid TranscriptUpdateBatch child in ${batch.batch_id}`);
    }
  }

  const next = new Map(currentSegments);
  const touched = new Set();
  for (const update of batch.updates) {
    for (const id of applyTranscriptUpdateToMap(next, update)) touched.add(id);
  }
  return { duplicate: false, segments: next, touched };
}
