// Frise d'un son : forme d'onde, poignées de début et de fin à faire glisser, fondus et tête de lecture.

import { h, fmtTime } from './dom.js';

const peaksCache = new Map(); // fileId -> Float32Array [min, max, min, max, …]
const RESOLUTION = 1500;

function computePeaks(buffer) {
  const n = RESOLUTION;
  const peaks = new Float32Array(n * 2);
  const len = buffer.length;
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(len, Math.floor((i + 1) * step));
    // Échantillonnage clairsemé sur les longs fichiers : l'allure suffit.
    const stride = Math.max(1, Math.floor((b - a) / 400));
    let mn = 0, mx = 0;
    for (const d of chans) {
      for (let j = a; j < b; j += stride) {
        const v = d[j];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    peaks[i * 2] = mn;
    peaks[i * 2 + 1] = mx;
  }
  // Agrandit les sons enregistrés faiblement pour que la forme reste lisible (gain limité à ×8).
  let top = 0;
  for (let i = 0; i < peaks.length; i++) top = Math.max(top, Math.abs(peaks[i]));
  if (top > 0) {
    const k = Math.min(8, 1 / top);
    for (let i = 0; i < peaks.length; i++) peaks[i] *= k;
  }
  return peaks;
}

// Auto-cue : repère le premier et le dernier passage au-dessus du seuil (silence avant/après).
// Renvoie { start, end } en secondes, ou null si le fichier est entièrement silencieux.
export function detectBounds(buffer, thresholdDb) {
  const thr = Math.pow(10, (thresholdDb == null ? -50 : thresholdDb) / 20);
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const len = buffer.length;
  const loud = i => chans.some(d => d[i] > thr || d[i] < -thr);
  let a = 0;
  while (a < len && !loud(a)) a++;
  if (a >= len) return null;
  let b = len - 1;
  while (b > a && !loud(b)) b--;
  const sr = buffer.sampleRate;
  // Petites marges : ne pas mordre l'attaque, laisser la queue de résonance.
  return {
    start: Math.max(0, a / sr - 0.005),
    end: Math.min(buffer.duration, b / sr + 0.05)
  };
}

export function peaksFor(fileId, buffer) {
  let p = peaksCache.get(fileId);
  if (!p) { p = computePeaks(buffer); peaksCache.set(fileId, p); }
  return p;
}

// item : objet son modifié en place (inPoint, outPoint, fadeIn, fadeOut, duration, color)
// onChange : appelé quand l'utilisateur déplace une poignée.
export class Timeline {
  constructor(item, onChange) {
    this.item = item;
    this.onChange = onChange;
    this.peaks = null;
    this.playhead = null;
    this.drag = null;
    this.canvas = h('canvas', { class: 'timeline-canvas' });
    this.info = h('div', { class: 'timeline-info' });
    this.el = h('div', { class: 'timeline' },
      h('div', { class: 'timeline-wrap' }, this.canvas, h('div', { class: 'timeline-msg', text: 'Chargement de la forme d’onde…' })),
      this.info
    );
    this.canvas.addEventListener('pointerdown', e => this._down(e));
    this.canvas.addEventListener('pointermove', e => this._move(e));
    this.canvas.addEventListener('pointerup', e => this._up(e));
    this.canvas.addEventListener('pointercancel', e => this._up(e));
    this._onResize = () => this.draw();
    window.addEventListener('resize', this._onResize);
  }

  destroy() { window.removeEventListener('resize', this._onResize); }

  setBuffer(fileId, buffer) {
    this.peaks = buffer ? peaksFor(fileId, buffer) : null;
    const msg = this.el.querySelector('.timeline-msg');
    if (msg) msg.style.display = this.peaks ? 'none' : '';
    if (!this.peaks && msg) msg.textContent = 'Aucun fichier';
    this.draw();
  }

  setPlayhead(t) { this.playhead = t; this.draw(); }

  get dur() { return this.item.duration || 0; }
  get inP() { return Math.min(this.item.inPoint || 0, this.dur); }
  get outP() { return this.item.outPoint > 0 ? Math.min(this.item.outPoint, this.dur) : this.dur; }

  _x(t, w) { return this.dur > 0 ? (t / this.dur) * w : 0; }

  draw() {
    const c = this.canvas;
    const w = c.clientWidth;
    const hgt = c.clientHeight;
    if (!w || !hgt) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    g.fillStyle = '#0b0d10';
    g.fillRect(0, 0, w, hgt);

    const color = this.item.color || '#2e86de';
    const mid = hgt / 2;
    const xi = this._x(this.inP, w);
    const xo = this._x(this.outP, w);

    // Forme d'onde : couleur du son dans la zone jouée, gris en dehors.
    if (this.peaks) {
      const n = this.peaks.length / 2;
      for (let x = 0; x < w; x++) {
        const a = Math.floor((x / w) * n);
        const b = Math.max(a + 1, Math.floor(((x + 1) / w) * n));
        let mn = 0, mx = 0;
        for (let i = a; i < b && i < n; i++) {
          if (this.peaks[i * 2] < mn) mn = this.peaks[i * 2];
          if (this.peaks[i * 2 + 1] > mx) mx = this.peaks[i * 2 + 1];
        }
        g.fillStyle = x >= xi && x <= xo ? color : '#3a404a';
        const top = mid - mx * (mid - 4);
        const bot = mid - mn * (mid - 4);
        g.fillRect(x, top, 1, Math.max(1, bot - top));
      }
    }

    // Zones exclues assombries.
    g.fillStyle = 'rgba(0, 0, 0, .55)';
    g.fillRect(0, 0, xi, hgt);
    g.fillRect(xo, 0, w - xo, hgt);

    // Fondus : lignes d'enveloppe.
    const fi = Math.min(this.item.fadeIn || 0, this.outP - this.inP);
    const fo = Math.min(this.item.fadeOut || 0, this.outP - this.inP);
    g.strokeStyle = 'rgba(255, 255, 255, .85)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(xi, fi > 0 ? hgt - 2 : 2);
    g.lineTo(this._x(this.inP + fi, w), 2);
    g.lineTo(this._x(this.outP - fo, w), 2);
    g.lineTo(xo, fo > 0 ? hgt - 2 : 2);
    g.stroke();

    // Poignées.
    [xi, xo].forEach((x, k) => {
      g.fillStyle = '#f1c40f';
      g.fillRect(x - 1.5, 0, 3, hgt);
      g.beginPath();
      const y = hgt - 2;
      if (k === 0) { g.moveTo(x, y - 18); g.lineTo(x + 12, y - 9); g.lineTo(x, y); }
      else { g.moveTo(x, y - 18); g.lineTo(x - 12, y - 9); g.lineTo(x, y); }
      g.fill();
    });

    // Tête de lecture de l'écoute.
    if (this.playhead != null) {
      const xp = this._x(this.playhead, w);
      g.fillStyle = '#27c46a';
      g.fillRect(xp - 1, 0, 2, hgt);
    }

    this.info.textContent = 'Début ' + fmtTime(this.inP, true) + '   ·   Fin ' + fmtTime(this.outP, true) +
      '   ·   Durée jouée ' + fmtTime(this.outP - this.inP, true) + ' sur ' + fmtTime(this.dur, true);
  }

  _time(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - r.left), r.width);
    return r.width ? (x / r.width) * this.dur : 0;
  }

  _down(e) {
    if (!this.dur) return;
    e.preventDefault();
    const t = this._time(e);
    // On attrape la poignée la plus proche du doigt.
    this.drag = Math.abs(t - this.inP) <= Math.abs(t - this.outP) ? 'in' : 'out';
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* non supporté */ }
    this._apply(t);
  }

  _move(e) {
    if (!this.drag) return;
    e.preventDefault();
    this._apply(this._time(e));
  }

  _up() { this.drag = null; }

  _apply(t) {
    t = Math.round(t * 100) / 100;
    const minLen = Math.min(0.1, this.dur);
    if (this.drag === 'in') {
      this.item.inPoint = Math.max(0, Math.min(t, this.outP - minLen));
    } else {
      const v = Math.min(this.dur, Math.max(t, this.inP + minLen));
      this.item.outPoint = v >= this.dur - 0.005 ? 0 : v; // 0 = jusqu'à la fin du fichier
    }
    this.draw();
    if (this.onChange) this.onChange();
  }
}
