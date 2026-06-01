import './styles.css';
import template from './template.html?raw';
import { initializeEndpointDefaults } from './core/api.js';
import { registerHotwords } from './features/hotwords.js';
import { registerOfflineTasks } from './features/offline-tasks.js';
import { registerRealtime } from './features/realtime.js';
import { registerSpeakers } from './features/speakers.js';
import { registerStatus } from './features/status.js';
import { registerTaskBrowser } from './features/task-browser.js';
import { registerNavigation } from './ui/navigation.js';

function bootstrap() {
  document.getElementById('app-root').innerHTML = template;

  initializeEndpointDefaults();
  registerOfflineTasks();
  registerRealtime();
  const browser = registerTaskBrowser();
  const speakers = registerSpeakers();
  registerHotwords();
  registerStatus();
  registerNavigation({
    refreshTaskList: browser.refreshTaskList,
    listSpeakerProfiles: speakers.listSpeakerProfiles,
  });
}

bootstrap();
