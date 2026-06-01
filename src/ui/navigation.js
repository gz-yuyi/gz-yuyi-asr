import { $, qsa } from '../core/dom.js';
import { state } from '../core/state.js';

let panelHooks = {};

export function showPanel(panel) {
  const item = document.querySelector(`.nav-item[data-panel="${panel}"]`);
  const panelEl = $(`panel-${panel}`);
  if (!item || !panelEl) return;
  qsa('.nav-item').forEach(n => n.classList.remove('active'));
  qsa('.panel').forEach(p => p.classList.remove('active'));
  item.classList.add('active');
  panelEl.classList.add('active');
  if (panel === 'browser' && state.browser.tasks.length === 0) {
    panelHooks.refreshTaskList?.();
  }
  if (panel === 'speakers') {
    panelHooks.listSpeakerProfiles?.();
  }
}

export function registerNavigation({ refreshTaskList, listSpeakerProfiles }) {
  panelHooks = { refreshTaskList, listSpeakerProfiles };
  qsa('.nav-item[data-panel]').forEach(item => {
    item.addEventListener('click', () => showPanel(item.dataset.panel));
  });
}
