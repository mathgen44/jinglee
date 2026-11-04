// Spécificités des tablettes : empêcher la mise en veille, catégorie audio iOS.

import { KEEPAWAKE_MP4, SILENCE_MP3 } from './media.js';

const isIOS = /iP(ad|hone|od)/.test(navigator.platform || '') ||
  (navigator.userAgent.indexOf('Mac') >= 0 && 'ontouchend' in document);

let wakeLock = null;
let video = null;
let wanted = false;

function requestNative() {
  if (!('wakeLock' in navigator)) return Promise.resolve(false);
  return navigator.wakeLock.request('screen').then(lock => {
    wakeLock = lock;
    lock.addEventListener('release', () => { wakeLock = null; });
    return true;
  }, () => false);
}

// Repli pour les navigateurs sans Wake Lock (iOS < 16.4) : une vidéo muette en boucle.
function startVideo() {
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true;
    video.loop = true;
    video.src = KEEPAWAKE_MP4;
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
    document.body.appendChild(video);
  }
  const p = video.play();
  if (p && p.catch) p.catch(() => {});
}

// À appeler dans chaque geste utilisateur : Safari n'autorise video.play() que dans un geste,
// et met parfois la vidéo en pause (retour d'arrière-plan, appel…). On la relance donc à chaque toucher.
export function keepAwake() {
  wanted = true;
  if (window.jingleeDesktop) return; // l'application de bureau empêche elle-même la veille
  if (!('wakeLock' in navigator)) {
    if (!video || video.paused) startVideo();
    return;
  }
  if (!wakeLock) requestNative().then(ok => { if (!ok) startVideo(); });
}

export function keepAwakeStatus() {
  if (window.jingleeDesktop) return 'actif (application de bureau)';
  if (wakeLock) return 'actif (verrou d’écran du navigateur)';
  if (video && !video.paused) return 'actif (méthode vidéo, pour les iPad sous iOS 15 et antérieurs)';
  if (!wanted) return 'en attente du premier toucher';
  return 'non actif sur cet appareil';
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible' && !wakeLock && 'wakeLock' in navigator) {
    requestNative().then(ok => { if (!ok) startVideo(); });
  }
});

// Sur iPhone, la Web Audio API respecte le bouton silencieux : on bascule en mode « lecture ».
let sessionAudio = null;
export function setupAudioSession() {
  try {
    if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; }
  } catch (e) { /* non supporté */ }
  if (!isIOS || sessionAudio) return;
  sessionAudio = new Audio(SILENCE_MP3);
  sessionAudio.loop = true;
  const p = sessionAudio.play();
  if (p && p.catch) p.catch(() => {});
}

export function isStandalone() {
  return !!window.jingleeDesktop || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

export { isIOS };
