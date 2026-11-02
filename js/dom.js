// Petits utilitaires d'interface : création d'éléments, fenêtres modales, messages.

import { showProgress, closeProgress } from './progress.js';
import { logError } from './report.js';

export function h(tag, attrs) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const p in v) {
          if (p.slice(0, 2) === '--') el.style.setProperty(p, v[p]); else el.style[p] = v[p];
        }
      }
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (typeof v !== 'string' && k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}

function append(el, c) {
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(x => append(el, x)); return; }
  el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
}

// Lecture d'un fichier en mémoire. Blob.arrayBuffer() n'existe qu'à partir d'iOS 14 : repli sur FileReader.
export function readFile(file) {
  if (file.arrayBuffer) return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Lecture du fichier impossible'));
    r.readAsArrayBuffer(file);
  });
}

// Déclenchement dès l'appui (sans attendre le relâchement) : pads et GO.
// Les événements « pointer » n'existent qu'à partir d'iOS 13 : repli sur touchstart / mousedown.
// fn peut renvoyer false pour laisser passer l'appui (le clic qui suit reste alors possible).
export function onPress(el, fn) {
  if (window.PointerEvent) {
    el.addEventListener('pointerdown', e => {
      if (e.button) return;
      if (fn(e) !== false) e.preventDefault();
    });
    return;
  }
  let lastTouch = 0;
  el.addEventListener('touchstart', e => {
    lastTouch = Date.now();
    if (fn(e) !== false) e.preventDefault();
  }, { passive: false });
  el.addEventListener('mousedown', e => {
    if (e.button || Date.now() - lastTouch < 800) return;
    if (fn(e) !== false) e.preventDefault();
  });
}

export function fmtTime(t, tenths) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (tenths) return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  const si = Math.floor(s);
  return m + ':' + (si < 10 ? '0' : '') + si;
}

export function fmtClock(sec) {
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor(sec / 60) % 60;
  const ss = Math.floor(sec) % 60;
  return [hh, mm, ss].map(n => (n < 10 ? '0' : '') + n).join(':');
}

// Lecture d'un nombre saisi au clavier français (virgule acceptée).
export function parseNum(str, def) {
  const v = parseFloat(String(str).replace(',', '.'));
  return isFinite(v) ? v : def;
}

export function numStr(v) {
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

// ---- Fenêtres modales ----

const stack = [];

export function modal(title, body, buttons, opts) {
  opts = opts || {};
  const root = document.getElementById('modal-root');
  const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
    h('div', { class: 'modal-head' },
      typeof title === 'string' ? h('h2', { text: title }) : h('div', { class: 'modal-title' }, title),
      h('button', { class: 'btn icon ghost', 'aria-label': 'Fermer', text: '✕', onclick: () => close() })
    ),
    h('div', { class: 'modal-body' }, body)
  );
  const foot = h('div', { class: 'modal-foot' });
  (buttons || []).forEach(b => {
    foot.appendChild(h('button', {
      class: 'btn ' + (b.class || ''),
      text: b.label,
      onclick: () => { if (b.action && b.action() === false) return; close(); }
    }));
  });
  if (buttons && buttons.length) box.appendChild(foot);
  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay && !opts.sticky) close(); } }, box);
  root.appendChild(overlay);
  const entry = { overlay, onClose: opts.onClose };
  stack.push(entry);

  function close() {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    overlay.remove();
    if (entry.onClose) entry.onClose();
  }
  return { close, box };
}

export function modalOpen() { return stack.length > 0; }

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top) top.overlay.querySelector('.modal-head .btn').click();
}

export function confirmBox(title, message, okLabel, danger) {
  return new Promise(resolve => {
    let done = false;
    modal(title, h('p', { text: message }), [
      { label: 'Annuler', action: () => { done = true; resolve(false); } },
      { label: okLabel || 'OK', class: danger ? 'danger' : 'primary', action: () => { done = true; resolve(true); } }
    ], { onClose: () => { if (!done) resolve(false); } });
  });
}

export function promptBox(title, label, value, okLabel) {
  return new Promise(resolve => {
    let done = false;
    const input = h('input', { type: 'text', value: value || '', class: 'input' });
    const m = modal(title, h('label', { class: 'field' }, h('span', { text: label }), input), [
      { label: 'Annuler', action: () => { done = true; resolve(null); } },
      { label: okLabel || 'OK', class: 'primary', action: () => { done = true; resolve(input.value.trim()); } }
    ], { onClose: () => { if (!done) resolve(null); } });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { done = true; resolve(input.value.trim()); m.close(); }
    });
    setTimeout(() => input.focus(), 50);
  });
}

let toastTimer = null;
// Les messages d'erreur sont gardés dans le journal du rapport de problème (sauf noLog : déjà journalisé).
export function toast(msg, kind, noLog) {
  if (kind === 'error' && !noLog) logError(msg, 'message affiché');
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 5000 : 2500);
}

// Types audio proposés au sélecteur de fichiers. Les extensions explicites aident iOS :
// avec « audio/* » seul, certains services (Google Drive…) affichent les MP3 grisés.
const AUDIO_ACCEPT = [
  '.mp3', '.m4a', '.aac', '.mp4', '.wav', '.aif', '.aiff', '.caf', '.flac', '.ogg', '.oga', '.opus',
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav',
  'audio/aiff', 'audio/x-aiff', 'audio/x-caf', 'audio/flac', 'audio/ogg', 'audio/*'
].join(',');

// Réglage de l'appareil : sans filtre, le sélecteur montre tous les fichiers (repli si l'audio apparaît grisé).
export function anyFilePicker() {
  try { return localStorage.getItem('jinglee.anyFile') === '1'; } catch (e) { return false; }
}

export function setAnyFilePicker(on) {
  try { localStorage.setItem('jinglee.anyFile', on ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
}

export const CLOUD_WAIT = 'Si le fichier est sur Google Drive ou un autre service en ligne, l’appareil doit d’abord ' +
  'le télécharger en entier avant de le transmettre à Jinglee : cela peut prendre un moment selon sa taille et la connexion.';

export function pickAudio(multiple) {
  return pickFiles(anyFilePicker() ? '' : AUDIO_ACCEPT, multiple, true);
}

// Ouvre le sélecteur de fichiers du système (doit être appelé dans un geste utilisateur).
// accept vide : aucun filtre.
// waiting : affiche la fenêtre de progression pendant que le système fournit le fichier
// (téléchargement depuis le cloud). Si des fichiers sont renvoyés, l'appelant doit la fermer (closeProgress).
//
// Le sélecteur peut se fermer (événement « cancel » sur les iPad récents) alors que le fichier
// choisi est encore en cours de téléchargement depuis Google Drive : il arrive alors quelques
// secondes plus tard. On ne considère donc jamais l'attente comme terminée tant qu'aucun fichier
// n'est arrivé ; « cancel » et le bouton Annuler ferment seulement la fenêtre d'attente.
// La promesse n'est résolue que si des fichiers arrivent.
let pendingInput = null;

export function pickFiles(accept, multiple, waiting) {
  // Un nouveau choix remplace un éventuel choix précédent resté sans réponse.
  if (pendingInput) pendingInput.remove();
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: accept || null, style: { display: 'none' } });
    pendingInput = input;
    if (multiple) input.multiple = true;
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      if (!files.length) { if (waiting) closeProgress(); return; }
      input.remove();
      if (pendingInput === input) pendingInput = null;
      resolve(files);
    });
    input.addEventListener('cancel', () => { if (waiting) closeProgress(); });
    document.body.appendChild(input);
    input.click();
    if (waiting) showProgress('Import', 'En attente du fichier…', CLOUD_WAIT, null, () => closeProgress());
  });
}
