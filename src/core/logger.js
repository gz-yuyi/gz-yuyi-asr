import { LOG_LEVELS } from './constants.js';
import { $ } from './dom.js';
import { esc, ts } from './format.js';

export function currentLogLevel() {
  return $('logLevel')?.value || 'info';
}

export function shouldLog(level) {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLogLevel()];
}

export function appendLog(el, msg, cls = 'log-info', level = 'info') {
  if (!shouldLog(level)) return;
  const line = document.createElement('div');
  line.className = 'log-entry';
  line.innerHTML = `<span class="log-ts">${ts()}</span> <span class="${cls}">${esc(msg)}</span>`;
  el.prepend(line);
}

export function appendLogRaw(el, msg, cls = 'log-recv', level = 'debug') {
  appendLog(el, msg, cls, level);
}
