import { Router } from './router.js';
import { mountConsent } from './views/tempo_consent.js';
import { mountSetup } from './views/tempo_setup.js';
import { mountRecording } from './views/tempo_recording.js';
import { mountResults } from './views/results.js';

const app = document.getElementById('app');

function renderTemplate(id) {
  const tpl = document.getElementById(id);
  app.innerHTML = '';
  app.appendChild(tpl.content.cloneNode(true));
}

const router = new Router(
  {
    '/consent': () => { renderTemplate('view-consent'); mountConsent(router); },
    '/setup': () => { renderTemplate('view-setup'); mountSetup(router); },
    '/recording': () => { renderTemplate('view-recording'); mountRecording(router); },
    '/results': () => { renderTemplate('view-results'); mountResults(router); },
  },
  '/consent',
);

router.start();
