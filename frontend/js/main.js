import { Router } from './router.js';
import { mountConsent } from './views/consent.js';
import { mountSetup } from './views/setup.js';
import { mountRecording } from './views/recording.js';

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
    '/results': () => { renderTemplate('view-results'); },
  },
  '/consent',
);

router.start();
