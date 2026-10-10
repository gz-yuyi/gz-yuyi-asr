import { LOG_LEVELS } from './constants.js';
import { $ } from './dom.js';
import { esc, ts } from './format.js';

// 事件日志是排查工具，不需要无限保留；长会话（小时级）下必须设上限。
const MAX_LOG_ENTRIES = 400;

export function currentLogLevel() {
  return $('logLevel')?.value || 'info';
}

export function shouldLog(level) {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLogLevel()];
}

// 长会话下事件日志会无限增长并拖慢页面，只保留最近若干条。
export function trimLogEntries(el, max = MAX_LOG_ENTRIES) {
  while (el.childElementCount > max && el.lastElementChild) {
    el.lastElementChild.remove();
  }
}

export function appendLog(el, msg, cls = 'log-info', level = 'info') {
  if (!shouldLog(level)) return;
  const line = document.createElement('div');
  line.className = 'log-entry';
  line.innerHTML = `<span class="log-ts">${ts()}</span> <span class="${cls}">${esc(msg)}</span>`;
  el.prepend(line);
  trimLogEntries(el);
}

export function appendLogRaw(el, msg, cls = 'log-recv', level = 'debug') {
  appendLog(el, msg, cls, level);
}
