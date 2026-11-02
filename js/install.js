// Invitation à installer Jinglee sur l'écran d'accueil.
// iOS n'offre aucune installation automatique : on explique le geste à faire dans Safari.
// Android (Chrome) fournit l'événement beforeinstallprompt : on propose un bouton « Installer ».

import { h } from './dom.js';
import { isIOS, isStandalone } from './device.js';

const KEY = 'jinglee.installHidden';

function hidden() {
  try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
}

function hide() {
  try { localStorage.setItem(KEY, '1'); } catch (e) { /* stockage indisponible */ }
}

// Icône « Partager » de Safari (carré avec flèche vers le haut).
function shareIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'share-icon');
  svg.innerHTML = '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return svg;
}

let banner = null;

function close(forever) {
  if (forever) hide();
  if (banner) { banner.remove(); banner = null; }
}

function show(content, actions) {
  close(false);
  banner = h('div', { class: 'install-banner', role: 'dialog', 'aria-label': 'Installer Jinglee' },
    h('img', { class: 'install-icon', src: 'icons/icon-192.png', alt: '' }),
    h('div', { class: 'install-text' }, content),
    h('div', { class: 'install-actions' }, actions,
      h('button', { class: 'btn small ghost', text: 'Plus tard', onclick: () => close(false) }),
      h('button', { class: 'btn small ghost', text: 'Ne plus afficher', onclick: () => close(true) })
    )
  );
  document.body.appendChild(banner);
}

function iosContent() {
  // Avant iOS 16.4, seul Safari sait ajouter une page à l'écran d'accueil.
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
  if (otherBrowser) {
    return [
      h('strong', { text: 'Installez Jinglee depuis Safari' }),
      h('span', { text: 'Ouvrez cette page dans Safari pour l’ajouter à l’écran d’accueil : elle fonctionnera alors hors-ligne.' })
    ];
  }
  return [
    h('strong', { text: 'Installez Jinglee sur cet appareil' }),
    h('span', { class: 'install-steps' },
      'Touchez ', shareIcon(), ' Partager dans la barre de Safari, puis « Sur l’écran d’accueil ».'),
    h('span', { class: 'install-note', text: 'Jinglee fonctionnera hors-ligne, en plein écran, et vos sons seront mieux protégés. Attention : l’application installée ne voit pas les projets créés dans Safari ; exportez-les d’abord si besoin.' })
  ];
}

export function setupInstallPrompt() {
  if (isStandalone() || hidden()) return;

  if (isIOS) {
    // Laisse l'écran principal s'afficher avant l'invitation.
    setTimeout(() => show(iosContent(), null), 1200);
    return;
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    const deferred = e;
    show([
      h('strong', { text: 'Installez Jinglee sur cet appareil' }),
      h('span', { text: 'Elle fonctionnera hors-ligne, en plein écran, comme une application.' })
    ], h('button', { class: 'btn small primary', text: 'Installer', onclick: () => {
      close(false);
      deferred.prompt();
    } }));
  });
  window.addEventListener('appinstalled', () => close(true));
}
