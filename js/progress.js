// Fenêtre de progression des imports (une seule à la fois).

import { h } from './dom.js';

let box = null;
let parts = null;

// fraction : 0..1, ou null pour une barre animée sans fin connue.
// onCancel : affiche un bouton « Annuler » s'il est fourni.
export function showProgress(title, text, detail, fraction, onCancel) {
  if (!box) {
    parts = {
      title: h('h2'),
      text: h('div', { class: 'progress-text' }),
      detail: h('div', { class: 'progress-detail' }),
      fill: h('div', { class: 'progress-fill' }),
      actions: h('div', { class: 'progress-actions' })
    };
    box = h('div', { class: 'overlay progress-overlay' },
      h('div', { class: 'modal progress-box' },
        parts.title, parts.text,
        h('div', { class: 'progress-bar' }, parts.fill),
        parts.detail, parts.actions
      )
    );
    document.body.appendChild(box);
  }
  parts.title.textContent = title;
  parts.text.textContent = text || '';
  parts.detail.textContent = detail || '';
  const bar = parts.fill.parentNode;
  bar.classList.toggle('indeterminate', fraction == null);
  parts.fill.style.width = fraction == null ? '' : Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  parts.actions.innerHTML = '';
  if (onCancel) parts.actions.appendChild(h('button', { class: 'btn', text: 'Annuler', onclick: onCancel }));
}

export function closeProgress() {
  if (box) { box.remove(); box = null; parts = null; }
}
