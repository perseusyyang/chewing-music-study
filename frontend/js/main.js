import { Router } from './router.js';
import { mountConsent } from './views/consent.js';

const app = document.getElementById('app');

function renderTemplate(id) {
  const tpl = document.getElementById(id);
  app.innerHTML = '';
  app.appendChild(tpl.content.cloneNode(true));
}

const router = new Router(
  {
    '/consent': () => { renderTemplate('view-consent'); mountConsent(router); },
    '/setup': () => { renderTemplate('view-setup'); },
    '/recording': () => { renderTemplate('view-recording'); },
    '/results': () => { renderTemplate('view-results'); },
  },
  '/consent',
);

router.start();
