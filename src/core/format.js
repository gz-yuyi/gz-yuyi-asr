export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ts() {
  const d = new Date();
  return d.toLocaleTimeString('en-GB', { hour12: false })
    + '.'
    + String(d.getMilliseconds()).padStart(3, '0');
}

export function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

export function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (item != null && String(item).trim() !== '') search.append(key, String(item).trim());
      });
    } else if (value != null && String(value).trim() !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function parseListInput(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function formatBoolZh(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  return String(value ?? '');
}

export function formatBrowserTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const secs = (safe - minutes * 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${secs}`;
}

export function formatBrowserDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return '-';
  return formatBrowserTime(Number(seconds));
}

export function speakerScoreText(score) {
  if (score == null || score === '') return '-';
  const value = Number(score);
  return Number.isFinite(value) ? value.toFixed(3) : String(score);
}

export function speakerMsText(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return '-';
  return `${(value / 1000).toFixed(2)}s`;
}

export function speakerQualitySummaryText(data) {
  if (!data || data.QualityScore == null || data.QualityScore === '') return '';
  const parts = [`QualityScore=${speakerScoreText(data.QualityScore)}`];
  if (data.MinQualityScore != null && data.MinQualityScore !== '') {
    parts.push(`MinQualityScore=${speakerScoreText(data.MinQualityScore)}`);
  }
  return parts.join(' · ');
}

export function formatMatchScore(score) {
  return speakerScoreText(score);
}
