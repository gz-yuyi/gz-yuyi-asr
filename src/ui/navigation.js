import { $, qsa } from '../core/dom.js';
import { state } from '../core/state.js';

export function registerNavigation({ refreshTaskList, listSpeakerProfiles }) {
  qsa('.nav-item[data-panel]').forEach(item => {
    item.addEventListener('click', () => {
      qsa('.nav-item').forEach(n => n.classList.remove('active'));
      qsa('.panel').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      $(`panel-${item.dataset.panel}`).classList.add('active');
      if (item.dataset.panel === 'browser' && state.browser.tasks.length === 0) {
        refreshTaskList();
      }
      if (item.dataset.panel === 'speakers') {
        listSpeakerProfiles();
      }
    });
  });
}
