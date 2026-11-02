// Point d'entrée : état de l'application, rendu de l'écran principal et commandes.

import { db, requestPersistence, storageEstimate } from './db.js';
import { Engine, gainToDb, dbToGain } from './audio.js';
import { Show } from './show.js';
import { h, modal, modalOpen, closeTopModal, confirmBox, promptBox, toast, pickFiles, pickAudio, readFile, onPress, anyFilePicker, setAnyFilePicker, fmtTime, fmtClock, parseNum, numStr } from './dom.js';
import { uid, newProject, newPad, newCue, normalizeProject, fileIdsOf, clone, isPlayable, FOLLOW, TRANSITIONS } from './model.js';
import { openEditor } from './editor.js';
import { exportProject, importArchive, deliverFile } from './archive.js';
import { keepAwake, keepAwakeStatus, setupAudioSession, isStandalone, isIOS } from './device.js';
import { setupInstallPrompt } from './install.js';
import { showProgress, closeProgress } from './progress.js';
import { installErrorHandlers, buildReport, issueUrl, copyText, clearErrors, getErrors } from './report.js';

const VERSION = '1.5.0';

function pref(key, def) {
  try { const v = localStorage.getItem('jinglee.' + key); return v == null ? def : v; } catch (e) { return def; }
}
function setPref(key, v) {
  try { localStorage.setItem('jinglee.' + key, v); } catch (e) { /* stockage indisponible */ }
}

const state = {
  project: null,
  mode: 'show',               // 'show' | 'edit'
  view: pref('view', 'mixed'), // 'mixed' | 'cues' | 'pads'
  tabId: null,
  locked: false,
  moving: null,               // pad en cours de déplacement
  timer: { running: false, start: 0, acc: 0 }
};

const engine = new Engine(id => db.getFile(id).then(f => f && f.data));
const show = new Show(engine, () => state.project, () => { renderCues(); warmCache(); }, msg => toast(msg, 'error'));

const $ = id => document.getElementById(id);

// ---------- Sauvegarde ----------

let saveTimer = null;
function save() {
  const p = state.project;
  p.updated = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.putProject(p).catch(err => toast('Sauvegarde impossible : ' + err.message, 'error'));
  }, 300);
}

function flushSave() {
  if (!saveTimer) return Promise.resolve();
  clearTimeout(saveTimer);
  saveTimer = null;
  return db.putProject(state.project);
}

// ---------- Import de sons ----------

function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

function sizeText(bytes) {
  return bytes >= 1e6 ? numStr(Math.round(bytes / 1e5) / 10) + ' Mo' : Math.max(1, Math.round(bytes / 1e3)) + ' ko';
}

// step(libellé, avancement 0..1) : informe la fenêtre de progression.
// Le décodage (l'étape la plus longue) et l'écriture sur l'appareil se font en parallèle,
// à partir des données déjà en mémoire.
async function importFile(file, step) {
  step = step || (() => {});
  step('Lecture du fichier (' + sizeText(file.size) + ')…', 0.05);
  const data = await readFile(file);
  const id = uid();
  step('Analyse du son et enregistrement sur l’appareil…', 0.25);
  const decoding = engine.decodeInto(id, data.slice(0));
  const storing = db.putFile({ id, name: file.name, type: file.type, data });
  let buffer;
  try {
    buffer = await decoding;
  } catch (e) {
    engine.forget(id);
    await storing.catch(() => {});
    await db.deleteFile(id).catch(() => {});
    throw new Error('« ' + file.name + ' » n’est pas un son lisible sur cet appareil (préférez MP3, M4A ou WAV)');
  }
  step('Enregistrement sur l’appareil…', 0.9);
  await storing;
  step('Terminé', 1);
  return { fileId: id, name: baseName(file.name), duration: buffer.duration };
}

async function importMany(files, create) {
  let ok = 0;
  const errors = [];
  const n = files.length;
  for (let i = 0; i < n; i++) {
    const file = files[i];
    const step = (label, frac) => showProgress(
      n > 1 ? 'Import des sons (' + (i + 1) + ' / ' + n + ')' : 'Import du son',
      file.name, label, (i + frac) / n);
    try {
      create(await importFile(file, step));
      ok++;
    } catch (e) {
      errors.push(e.message);
    }
  }
  closeProgress();
  if (ok) { save(); render(); toast(ok + (ok > 1 ? ' sons importés' : ' son importé')); }
  if (errors.length) toast(errors.join(' — '), 'error');
}

// Import d'un seul fichier (remplacement dans l'éditeur), avec sa fenêtre de progression.
function importOne(file) {
  const step = (label, frac) => showProgress('Import du son', file.name, label, frac);
  return importFile(file, step).then(
    f => { closeProgress(); return f; },
    e => { closeProgress(); throw e; }
  );
}

// Supprime les fichiers audio qui ne sont plus utilisés par aucun projet.
async function collectGarbage() {
  const projects = await db.listProjects();
  const used = new Set();
  projects.forEach(p => fileIdsOf(normalizeProject(p)).forEach(id => used.add(id)));
  if (state.project) fileIdsOf(state.project).forEach(id => used.add(id));
  const ids = await db.fileIds();
  for (const id of ids) {
    if (!used.has(id)) { await db.deleteFile(id); engine.forget(id); }
  }
}

// ---------- Préchargement ----------

let warmTimer = null;
function warmCache() {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    const p = state.project;
    if (!p) return;
    const ids = [];
    p.cues.slice(show.standby, show.standby + 4).forEach(c => c.fileId && ids.push(c.fileId));
    p.pads.filter(x => x.tabId === state.tabId).forEach(x => x.fileId && ids.push(x.fileId));
    engine.pinned = new Set(ids);
    engine.preload(ids).then(() => engine.preload(Array.from(fileIdsOf(p))));
  }, 200);
}

// ---------- Projet ----------

async function openProject(project) {
  if (state.project) await flushSave();
  engine.stopAll();
  show.cancelPending();
  state.project = normalizeProject(project);
  state.tabId = state.project.tabs[0].id;
  state.moving = null;
  show.standby = 0;
  show.played.clear();
  engine.clearCache();
  applySettings();
  setPref('project', project.id);
  render();
  warmCache();
}

function applySettings() {
  const s = state.project.settings;
  engine.duckLevel = s.duckLevel;
  engine.duckTime = s.duckTime;
}

async function createProject(name) {
  const p = newProject(name);
  await db.putProject(p);
  await openProject(p);
  return p;
}

// ---------- Rendu ----------

function render() {
  if (!state.project) return;
  document.body.classList.toggle('editing', state.mode === 'edit');
  document.body.classList.toggle('locked', state.locked);
  document.body.classList.toggle('moving', !!state.moving);
  $('project-name').textContent = state.project.name;
  $('workspace').className = 'workspace view-' + state.view;
  document.querySelectorAll('#view-seg button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  $('btn-edit').classList.toggle('on', state.mode === 'edit');
  $('btn-edit').disabled = state.locked;
  $('btn-menu').disabled = state.locked;
  $('btn-lock').textContent = state.locked ? '🔒' : '🔓';
  $('btn-lock').classList.toggle('on', state.locked);
  renderTransition();
  renderCues();
  renderTabs();
  renderGrid();
  renderNowPlaying();
}

function regionLength(s) {
  const end = s.outPoint > 0 ? Math.min(s.outPoint, s.duration || s.outPoint) : s.duration;
  return Math.max(0, (end || 0) - (s.inPoint || 0));
}

function badges(s) {
  const b = [];
  if (s.loop) b.push(h('span', { class: 'badge', title: 'Boucle', text: '⟲' }));
  if (s.duck) b.push(h('span', { class: 'badge', title: 'Ducking', text: '↧' }));
  if (s.fadeIn > 0 || s.fadeOut > 0) b.push(h('span', { class: 'badge', title: 'Fondus', text: '◢' }));
  return b;
}

// ---- Conduite ----

function renderCues() {
  const list = $('cue-list');
  const cues = state.project.cues;
  list.innerHTML = '';
  if (!cues.length) {
    list.appendChild(h('div', { class: 'empty-hint' },
      state.mode === 'edit'
        ? 'Ajoutez des sons à la conduite avec « + Sons ».'
        : 'La conduite est vide. Passez en mode Édition pour ajouter des cues.'));
  }
  let standbyRow = null;
  let num = 0;
  const reorder = i => state.mode === 'edit' ? h('div', { class: 'reorder' },
    h('button', { class: 'btn small', text: '▲', onclick: e => { e.stopPropagation(); moveCue(i, -1); } }),
    h('button', { class: 'btn small', text: '▼', onclick: e => { e.stopPropagation(); moveCue(i, 1); } })
  ) : null;
  cues.forEach((c, i) => {
    if (c.kind === 'text') {
      list.appendChild(h('div', {
        class: 'cue text' + (i < show.standby && cues.slice(i + 1, show.standby).every(x => x.kind === 'text') ? ' cue-ahead' : ''),
        'data-cue': c.id,
        style: { '--c': c.color },
        onclick: () => onCueClick(c, i)
      },
        h('div', { class: 'cue-text', text: c.note || '(texte vide)' }),
        reorder(i)
      ));
      return;
    }
    num++;
    const playing = engine.voicesFor(c.id).length > 0;
    const row = h('div', {
      class: 'cue' + (i === show.standby ? ' standby' : '') + (show.played.has(c.id) ? ' played' : '') + (playing ? ' playing' : '') + (c.kind !== 'sound' ? ' action' : ''),
      'data-cue': c.id,
      style: { '--c': c.color },
      onclick: () => onCueClick(c, i)
    },
      h('span', { class: 'cue-num', text: String(num) }),
      h('div', { class: 'cue-main' },
        h('div', { class: 'cue-name' }, c.name, badges(c)),
        c.note ? h('div', { class: 'cue-note', text: c.note }) : null,
        c.follow !== 'manual' ? h('div', { class: 'cue-follow', text: '↳ ' + FOLLOW[c.follow] + (c.delay > 0 ? ' + ' + numStr(c.delay) + ' s' : '') }) : null
      ),
      h('span', { class: 'cue-time time', text: c.kind === 'sound' ? fmtTime(regionLength(c)) : '' }),
      h('span', { class: 'cue-state' }),
      reorder(i)
    );
    if (i === show.standby) standbyRow = row;
    list.appendChild(row);
  });
  if (show.standby >= cues.length && cues.length) {
    list.appendChild(h('div', { class: 'cue end standby', text: '— Fin de la conduite —' }));
  }
  if (standbyRow && standbyRow.scrollIntoView) {
    const r = standbyRow.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    if (r.top < lr.top || r.bottom > lr.bottom) standbyRow.scrollIntoView({ block: 'center' });
  }
  const next = cues[show.standby];
  const nextNum = cues.slice(0, show.standby + 1).filter(isPlayable).length;
  $('go-next').textContent = next ? nextNum + '. ' + next.name : (cues.length ? 'Fin de la conduite' : '');
  $('btn-go').disabled = !next;
  $('cue-edit-tools').style.display = state.mode === 'edit' ? '' : 'none';
}

function onCueClick(cue, i) {
  if (state.mode === 'edit') {
    openEditor(editorApi('cue'), cue, 'cue');
  } else {
    show.setStandby(i);
  }
}

function moveCue(i, d) {
  const cues = state.project.cues;
  const j = i + d;
  if (j < 0 || j >= cues.length) return;
  const tmp = cues[i]; cues[i] = cues[j]; cues[j] = tmp;
  if (show.standby === i) show.standby = j; else if (show.standby === j) show.standby = i;
  save();
  renderCues();
}

// ---- Pads ----

function renderTabs() {
  const bar = $('tabs');
  bar.innerHTML = '';
  state.project.tabs.forEach(t => {
    const playing = engine.activeVoices().some(v => v.meta.origin === 'pad' && padById(v.meta.refId) && padById(v.meta.refId).tabId === t.id);
    bar.appendChild(h('button', {
      class: 'tab' + (t.id === state.tabId ? ' on' : '') + (playing ? ' playing' : ''),
      text: t.name,
      onclick: () => {
        if (t.id === state.tabId && state.mode === 'edit') { editTab(t); return; }
        state.tabId = t.id;
        renderTabs();
        renderGrid();
        warmCache();
      }
    }));
  });
  if (state.mode === 'edit') {
    bar.appendChild(h('button', { class: 'tab add', text: '+ Onglet', onclick: addTab }));
    bar.appendChild(h('div', { class: 'spacer' }));
    bar.appendChild(h('button', { class: 'btn small', text: '+ Sons', onclick: addPadsFromFiles }));
  }
}

function padById(id) { return state.project.pads.find(p => p.id === id); }

function gridSize() {
  const s = state.project.settings;
  const pads = state.project.pads.filter(p => p.tabId === state.tabId);
  const maxSlot = pads.reduce((m, p) => Math.max(m, p.slot), -1);
  const rows = Math.max(s.rows, Math.ceil((maxSlot + 1) / s.cols));
  return { cols: s.cols, rows, count: s.cols * rows };
}

function renderGrid() {
  const grid = $('grid');
  const { cols, rows, count } = gridSize();
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
  grid.style.gridTemplateRows = 'repeat(' + rows + ', minmax(64px, 1fr))';
  const bySlot = {};
  state.project.pads.filter(p => p.tabId === state.tabId).forEach(p => { bySlot[p.slot] = p; });

  for (let slot = 0; slot < count; slot++) {
    const pad = bySlot[slot];
    if (!pad) {
      grid.appendChild(h('div', {
        class: 'pad empty',
        onclick: () => onEmptySlot(slot)
      }, state.mode === 'edit' || state.moving ? h('span', { class: 'plus', text: state.moving ? '⇲' : '+' }) : null));
      continue;
    }
    const active = engine.voicesFor(pad.id);
    const el = h('div', {
      class: 'pad' + (active.length ? ' playing' : '') + (state.moving === pad.id ? ' selected' : '') + (!pad.fileId ? ' nofile' : ''),
      'data-pad': pad.id,
      style: { '--c': pad.color }
    },
      h('div', { class: 'fill' }),
      h('div', { class: 'pad-name', text: pad.name }),
      h('div', { class: 'pad-info' }, h('span', { class: 'time', text: fmtTime(regionLength(pad)) }), badges(pad))
    );
    onPress(el, () => {
      if (state.mode !== 'show' || state.moving) return false; // le clic qui suit ouvre l'éditeur ou dépose le pad
      show.triggerPad(pad);
    });
    el.addEventListener('click', () => {
      if (state.moving) { dropPad(slot); return; }
      if (state.mode === 'edit') openEditor(editorApi('pad'), pad, 'pad');
    });
    grid.appendChild(el);
  }
}

function freeSlot(tabId) {
  const used = new Set(state.project.pads.filter(p => p.tabId === tabId).map(p => p.slot));
  let s = 0;
  while (used.has(s)) s++;
  return s;
}

function onEmptySlot(slot) {
  if (state.moving) { dropPad(slot); return; }
  if (state.mode !== 'edit') return;
  pickAudio(false).then(files => {
    if (!files.length) return;
    importMany(files, f => state.project.pads.push(Object.assign(newPad(state.tabId, slot, f.fileId, f.name, f.duration), { fileName: f.name })));
  });
}

function addPadsFromFiles() {
  pickAudio(true).then(files => {
    if (!files.length) return;
    importMany(files, f => {
      const pad = newPad(state.tabId, freeSlot(state.tabId), f.fileId, f.name, f.duration);
      pad.fileName = f.name;
      state.project.pads.push(pad);
    });
  });
}

function dropPad(slot) {
  const pad = padById(state.moving);
  state.moving = null;
  if (pad) {
    const other = state.project.pads.find(p => p.tabId === state.tabId && p.slot === slot && p !== pad);
    if (other) { other.tabId = pad.tabId; other.slot = pad.slot; }
    pad.tabId = state.tabId;
    pad.slot = slot;
    save();
  }
  render();
}

function addTab() {
  promptBox('Nouvel onglet', 'Nom de l’onglet', 'Onglet ' + (state.project.tabs.length + 1), 'Créer').then(name => {
    if (!name) return;
    const t = { id: uid(), name };
    state.project.tabs.push(t);
    state.tabId = t.id;
    save();
    render();
  });
}

function editTab(tab) {
  const tabs = state.project.tabs;
  const idx = tabs.indexOf(tab);
  const input = h('input', { class: 'input', type: 'text', value: tab.name });
  const buttons = [];
  if (tabs.length > 1) {
    buttons.push({ label: 'Supprimer', class: 'danger left', action: () => {
      const n = state.project.pads.filter(p => p.tabId === tab.id).length;
      confirmBox('Supprimer l’onglet', 'Supprimer « ' + tab.name + ' »' + (n ? ' et ses ' + n + ' pads' : '') + ' ?', 'Supprimer', true).then(ok => {
        if (!ok) return;
        state.project.pads = state.project.pads.filter(p => p.tabId !== tab.id);
        tabs.splice(idx, 1);
        state.tabId = tabs[Math.max(0, idx - 1)].id;
        save();
        render();
      });
    } });
  }
  if (idx > 0) buttons.push({ label: '◀', action: () => { tabs.splice(idx, 1); tabs.splice(idx - 1, 0, tab); save(); render(); } });
  if (idx < tabs.length - 1) buttons.push({ label: '▶', action: () => { tabs.splice(idx, 1); tabs.splice(idx + 1, 0, tab); save(); render(); } });
  buttons.push({ label: 'Renommer', class: 'primary', action: () => { tab.name = input.value.trim() || tab.name; save(); render(); } });
  modal('Onglet', h('label', { class: 'field' }, h('span', { text: 'Nom' }), input), buttons);
}

// ---- Éditeur (pads et cues) ----

function editorApi(type) {
  const list = () => (type === 'cue' ? state.project.cues : state.project.pads);
  return {
    engine,
    tabs: state.project.tabs,
    cues: type === 'cue' ? state.project.cues : null,
    importFile: importOne,
    onSave: item => {
      const arr = list();
      const i = arr.findIndex(x => x.id === item.id);
      if (type === 'pad' && item.slot < 0) item.slot = freeSlot(item.tabId);
      if (type === 'cue') {
        // La cue en attente doit rester la même après un déplacement.
        const standbyId = arr[show.standby] ? arr[show.standby].id : null;
        const before = item.before;
        delete item.before;
        if (i >= 0) arr.splice(i, 1);
        const j = before ? arr.findIndex(x => x.id === before) : -1;
        arr.splice(j >= 0 ? j : arr.length, 0, item);
        const s = standbyId ? arr.findIndex(x => x.id === standbyId) : -1;
        show.standby = s >= 0 ? s : show._playableFrom(Math.min(show.standby, arr.length));
      } else if (i >= 0) {
        arr[i] = item;
      }
      if (item.fileId) engine.pinned.add(item.fileId);
      save();
      render();
    },
    onDelete: item => {
      const arr = list();
      const i = arr.findIndex(x => x.id === item.id);
      if (i < 0) return;
      engine.voicesFor(item.id).forEach(v => v.stop(0.05));
      arr.splice(i, 1);
      if (type === 'cue' && show.standby > i) show.standby--;
      save();
      render();
    },
    onDuplicate: item => {
      const copy = clone(item);
      copy.id = uid();
      delete copy.before;
      if (copy.kind !== 'text') copy.name = item.name + ' (copie)';
      const arr = list();
      if (type === 'pad') {
        copy.slot = freeSlot(copy.tabId);
        arr.push(copy);
      } else {
        const i = arr.findIndex(x => x.id === item.id);
        arr.splice(i + 1, 0, copy);
      }
      save();
      render();
    },
    onMove: item => {
      state.moving = item.id;
      render();
      toast('Touchez la case de destination (Échap pour annuler)');
    }
  };
}

function addCuesFromFiles() {
  pickAudio(true).then(files => {
    if (!files.length) return;
    importMany(files, f => {
      const cue = newCue('sound', f.fileId, f.name, f.duration);
      cue.fileName = f.name;
      state.project.cues.push(cue);
    });
  });
}

function addTextCue() {
  openEditor(editorApi('cue'), newCue('text'), 'cue');
}

function addActionCue() {
  const add = kind => { state.project.cues.push(newCue(kind)); save(); render(); };
  modal('Ajouter une action', h('p', { text: 'Une action se déclenche sur GO comme une cue sonore.' }), [
    { label: 'Fondu de tous les sons', action: () => add('fadeall') },
    { label: 'Arrêt de tous les sons', action: () => add('stopall') }
  ]);
}

// ---- Sons en cours ----

function renderNowPlaying() {
  const bar = $('nowplaying');
  const voices = engine.activeVoices().filter(v => v.meta.origin !== 'preview');
  bar.innerHTML = '';
  bar.classList.toggle('idle', !voices.length);
  if (!voices.length) {
    bar.appendChild(h('span', { class: 'np-empty', text: 'Aucun son en cours' }));
    return;
  }
  voices.forEach(v => {
    const s = v.sound;
    bar.appendChild(h('div', { class: 'np' + (v.state === 'paused' ? ' paused' : '') + (v.state === 'stopping' ? ' stopping' : ''), 'data-voice': v.id, style: { '--c': s.color } },
      h('div', { class: 'np-bar' }),
      h('div', { class: 'np-text' },
        h('span', { class: 'np-name', text: s.name }),
        h('span', { class: 'np-remain', text: '-' + fmtTime(v.remaining()) })
      ),
      h('div', { class: 'np-btns' },
        h('button', { class: 'btn small', text: v.state === 'paused' ? '▶' : '❚❚', title: 'Pause / reprise', onclick: () => { if (v.state === 'paused') v.resume(); else v.pause(); } }),
        h('button', { class: 'btn small', text: '◢', title: 'Fondu de sortie', onclick: () => v.stop(s.fadeOut || state.project.settings.fadeAll) }),
        h('button', { class: 'btn small danger', text: '■', title: 'Arrêter', onclick: () => v.stop(0.03) })
      )
    ));
  });
}

// ---- Animation de la progression ----

let rafId = 0;
let touched = new Set();

function tick() {
  rafId = 0;
  const now = new Set();
  const voices = engine.activeVoices();
  voices.forEach(v => {
    const p = v.progress();
    const remain = '-' + fmtTime(v.remaining());
    const chip = document.querySelector('[data-voice="' + v.id + '"]');
    if (chip) {
      chip.querySelector('.np-bar').style.width = (p * 100).toFixed(2) + '%';
      chip.querySelector('.np-remain').textContent = remain;
    }
    const sel = v.meta.origin === 'pad' ? '[data-pad="' + v.meta.refId + '"]' : '[data-cue="' + v.meta.refId + '"]';
    const el = document.querySelector(sel);
    if (el) {
      el.style.setProperty('--p', p.toFixed(4));
      const t = el.querySelector('.time');
      if (t) t.textContent = remain;
      el.classList.add('playing');
      el.classList.toggle('paused', v.state === 'paused');
      now.add(el);
    }
  });
  touched.forEach(el => {
    if (now.has(el)) return;
    el.style.removeProperty('--p');
    el.classList.remove('playing', 'paused');
    const id = el.getAttribute('data-pad') || el.getAttribute('data-cue');
    const item = padById(id) || state.project.cues.find(c => c.id === id);
    const t = el.querySelector('.time');
    if (t && item) t.textContent = item.kind && item.kind !== 'sound' ? '' : fmtTime(regionLength(item));
  });
  touched = now;
  if (voices.length || touched.size) rafId = requestAnimationFrame(tick);
}

function startTick() { if (!rafId) rafId = requestAnimationFrame(tick); }

engine.on('change', () => {
  renderNowPlaying();
  renderTabs();
  startTick();
});
engine.on('end', v => {
  if (v.meta.origin === 'cue') renderCues();
});

// ---------- Chronomètre et horloge ----------

function timerValue() {
  const t = state.timer;
  return t.acc + (t.running ? (Date.now() - t.start) / 1000 : 0);
}

function toggleTimer() {
  const t = state.timer;
  if (t.running) { t.acc = timerValue(); t.running = false; } else { t.start = Date.now(); t.running = true; }
  updateClock();
}

function resetTimer() {
  state.timer = { running: false, start: 0, acc: 0 };
  updateClock();
}

function updateClock() {
  const d = new Date();
  $('clock').textContent = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  const tm = $('timer');
  tm.textContent = fmtClock(timerValue());
  tm.classList.toggle('on', state.timer.running);
}

// ---------- Commandes générales ----------

function go() {
  if (state.mode !== 'show') return;
  if (!state.timer.running && timerValue() === 0) toggleTimer();
  show.go();
}

function toggleEdit() {
  if (state.locked) return;
  state.mode = state.mode === 'edit' ? 'show' : 'edit';
  state.moving = null;
  render();
}

function toggleLock() {
  if (!state.locked) {
    state.locked = true;
    state.mode = 'show';
    state.moving = null;
    render();
    toast('Mode spectacle verrouillé');
    return;
  }
  confirmBox('Déverrouiller', 'Déverrouiller pour pouvoir modifier le projet ?', 'Déverrouiller').then(ok => {
    if (!ok) return;
    state.locked = false;
    render();
  });
}

// ---- Mode de transition ----

const TRANSITION_ICONS = { mix: '⧉', crossfade: '⤨', cut: '✂' };

function renderTransition() {
  const s = state.project.settings;
  const btn = $('btn-transition');
  btn.innerHTML = '';
  btn.appendChild(h('span', { class: 'tr-icon', text: TRANSITION_ICONS[s.transition] }));
  btn.appendChild(h('span', { class: 'lbl', text: TRANSITIONS[s.transition] + (s.transition === 'crossfade' ? ' ' + numStr(s.crossfade) + ' s' : '') }));
  btn.className = 'btn transition tr-' + s.transition;
  btn.title = 'Mode de transition : ' + TRANSITIONS[s.transition];
}

function openTransition() {
  const s = state.project.settings;
  const help = {
    mix: 'Les sons se superposent : un nouveau son ne touche pas à ceux qui jouent.',
    crossfade: 'Le nouveau son monte pendant que les autres descendent puis s’arrêtent.',
    cut: 'Les autres sons sont coupés net quand un nouveau son démarre.'
  };
  const dur = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', value: numStr(s.crossfade) });
  const choices = h('div', { class: 'choices' });
  let m = null;
  Object.keys(TRANSITIONS).forEach(k => {
    choices.appendChild(h('button', {
      class: 'choice' + (s.transition === k ? ' on' : ''),
      onclick: () => {
        s.transition = k;
        s.crossfade = Math.max(0.1, parseNum(dur.value, s.crossfade));
        save();
        render();
        m.close();
      }
    },
      h('span', { class: 'choice-icon', text: TRANSITION_ICONS[k] }),
      h('span', { class: 'choice-text' }, h('strong', { text: TRANSITIONS[k] }), h('span', { text: help[k] }))
    ));
  });
  m = modal('Mode de transition', h('div', { class: 'editor' },
    choices,
    h('label', { class: 'field' }, h('span', { text: 'Durée du fondu enchaîné' }), h('div', { class: 'ctrl' }, dur, h('span', { text: 's' }))),
    h('p', { class: 'muted small', text: 'S’applique aux pads et aux cues lancées par GO. Les cues « avec la précédente » jouent toujours ensemble, et le réglage « arrêter les autres sons » d’une cue reste prioritaire.' })
  ), [], { onClose: () => {
    const v = Math.max(0.1, parseNum(dur.value, s.crossfade));
    if (v !== s.crossfade) { s.crossfade = v; save(); render(); }
  } });
}

function setView(v) {
  state.view = v;
  setPref('view', v);
  render();
}

function resetCues() {
  if (!show.played.size) { show.reset(); return; }
  confirmBox('Revenir au début', 'Remettre la conduite au début ? Les sons en cours continuent.', 'Revenir au début').then(ok => {
    if (ok) show.reset();
  });
}

// ---------- Menu : projets, réglages, aide ----------

async function openMenu() {
  if (state.locked) return;
  await flushSave();
  const projects = (await db.listProjects()).sort((a, b) => b.updated - a.updated);
  const list = h('div', { class: 'project-list' });
  projects.forEach(p => {
    const current = p.id === state.project.id;
    list.appendChild(h('div', { class: 'project-row' + (current ? ' current' : '') },
      h('div', { class: 'project-info' },
        h('div', { class: 'project-name', text: p.name + (current ? ' (ouvert)' : '') }),
        h('div', { class: 'project-meta', text: (p.pads || []).length + ' pads · ' + (p.cues || []).length + ' cues · modifié le ' + new Date(p.updated).toLocaleDateString('fr-FR') })
      ),
      h('div', { class: 'row' },
        current ? null : h('button', { class: 'btn small primary', text: 'Ouvrir', onclick: () => { m.close(); openProject(p); } }),
        h('button', { class: 'btn small', text: 'Exporter', onclick: () => doExport(p) }),
        h('button', { class: 'btn small danger', text: 'Supprimer', onclick: () => deleteProject(p, m) })
      )
    ));
  });

  const body = h('div', {},
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', text: 'Renommer le projet', onclick: () => { m.close(); renameProject(); } }),
      h('button', { class: 'btn', text: 'Réglages', onclick: () => { m.close(); openSettings(); } }),
      h('button', { class: 'btn', text: 'Aide', onclick: () => { m.close(); openHelp(); } }),
      h('button', { class: 'btn', text: '⚠ Signaler un problème', onclick: () => { m.close(); openReport(); } })
    ),
    h('h3', { text: 'Projets' }),
    list,
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', text: '+ Nouveau projet', onclick: () => {
        promptBox('Nouveau projet', 'Nom du spectacle ou de l’émission', '', 'Créer').then(name => {
          if (name == null) return;
          m.close();
          createProject(name || 'Nouveau projet');
        });
      } }),
      h('button', { class: 'btn', text: 'Importer un projet…', onclick: () => doImport(m, projects) })
    ),
    h('p', { class: 'muted small', text: 'Jinglee ' + VERSION + ' — logiciel libre (licence MIT).' })
  );
  const m = modal('Menu', body, [], { wide: true });
}

async function doExport(p) {
  try {
    if (p.id === state.project.id) { await flushSave(); p = state.project; }
    toast('Préparation de l’export…');
    const { blob, filename } = await exportProject(p);
    const r = await deliverFile(blob, filename);
    if (r === 'downloaded') toast('Fichier « ' + filename + ' » enregistré');
  } catch (e) {
    toast('Export impossible : ' + e.message, 'error');
  }
}

function doImport(m, projects) {
  // iOS ne connaît pas l'extension .jinglee et la grise : pas de filtre, le contenu est vérifié à l'import.
  pickFiles(isIOS ? '' : '.jinglee,.zip,application/zip', false, true).then(async files => {
    if (!files.length) return;
    try {
      showProgress('Import du projet', files[0].name, 'Lecture et enregistrement des sons (' + sizeText(files[0].size) + ')…', null);
      const p = await importArchive(files[0], new Set(projects.map(x => x.id)));
      closeProgress();
      m.close();
      await openProject(p);
      toast('Projet « ' + p.name + ' » importé');
    } catch (e) {
      closeProgress();
      toast('Import impossible : ' + e.message, 'error');
    }
  });
}

async function deleteProject(p, m) {
  const ok = await confirmBox('Supprimer le projet', 'Supprimer définitivement « ' + p.name + ' » et ses sons ? Pensez à l’exporter avant si besoin.', 'Supprimer', true);
  if (!ok) return;
  await db.deleteProject(p.id);
  if (p.id === state.project.id) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const rest = await db.listProjects();
    state.project = null;
    if (rest.length) await openProject(rest[0]); else await createProject('Mon spectacle');
  }
  await collectGarbage();
  m.close();
  openMenu();
}

function renameProject() {
  promptBox('Renommer', 'Nom du projet', state.project.name, 'Renommer').then(name => {
    if (!name) return;
    state.project.name = name;
    save();
    render();
  });
}

async function openSettings() {
  const s = state.project.settings;
  const sel = (min, max, v) => {
    const el = h('select', { class: 'input' });
    for (let i = min; i <= max; i++) el.appendChild(h('option', { value: String(i), text: String(i), selected: i === v }));
    return el;
  };
  const cols = sel(2, 8, s.cols);
  const rows = sel(1, 10, s.rows);
  const fade = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', value: numStr(s.fadeAll) });
  const duck = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', value: numStr(Math.round(gainToDb(s.duckLevel))) });
  const duckTime = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', value: numStr(s.duckTime) });
  const field = (label, ctrl, unit) => h('label', { class: 'field' }, h('span', { text: label }), h('div', { class: 'ctrl' }, ctrl, unit ? h('span', { text: unit }) : null));

  const est = await storageEstimate();
  const anyFile = h('input', { type: 'checkbox', checked: anyFilePicker() });
  anyFile.addEventListener('change', () => setAnyFilePicker(anyFile.checked));
  const storage = est && est.usage != null
    ? 'Espace utilisé : ' + Math.round(est.usage / 1e6) + ' Mo' + (est.quota ? ' sur ' + Math.round(est.quota / 1e6) + ' Mo disponibles' : '')
    : '';

  modal('Réglages du projet', h('div', { class: 'editor' },
    h('div', { class: 'grid2' },
      field('Colonnes de pads', cols),
      field('Lignes de pads', rows)
    ),
    field('Durée du bouton « Fondu »', fade, 's'),
    h('div', { class: 'grid2' },
      field('Niveau des autres sons pendant un ducking', duck, 'dB'),
      field('Durée de la baisse', duckTime, 's')
    ),
    storage ? h('p', { class: 'muted small', text: storage }) : null,
    h('h3', { text: 'Cet appareil' }),
    h('label', { class: 'check' }, anyFile, h('span', { text: 'Montrer tous les fichiers à l’import (si vos MP3 apparaissent grisés)' })),
    h('p', { class: 'muted small', text: 'Anti-veille : ' + keepAwakeStatus() + '. Pour plus de sûreté, réglez aussi le verrouillage automatique de la tablette sur « Jamais ».' })
  ), [
    { label: 'Annuler' },
    { label: 'Enregistrer', class: 'primary', action: () => {
      s.cols = parseInt(cols.value, 10);
      s.rows = parseInt(rows.value, 10);
      s.fadeAll = Math.max(0.1, parseNum(fade.value, 3));
      s.duckLevel = dbToGain(Math.min(0, parseNum(duck.value, -10)));
      s.duckTime = Math.max(0.05, parseNum(duckTime.value, 0.5));
      applySettings();
      save();
      render();
    } }
  ], { wide: true });
}

// Rapport de problème : l'utilisateur voit tout ce qui sera envoyé (aucun nom de projet ni de fichier).
async function openReport() {
  const p = state.project;
  const est = await storageEstimate();
  const ctx = {
    version: VERSION,
    standalone: isStandalone(),
    project: p.pads.length + ' pads, ' + p.cues.length + ' cues, ' + p.tabs.length + ' onglet(s)',
    storage: est && est.usage != null ? Math.round(est.usage / 1e6) + ' Mo utilisés' + (est.quota ? ' sur ' + Math.round(est.quota / 1e6) + ' Mo' : '') : '',
    keepAwake: keepAwakeStatus()
  };
  const title = h('input', { class: 'input', type: 'text', placeholder: 'Ex. : l’import depuis Google Drive ne fait rien' });
  const desc = h('textarea', { class: 'input', rows: 4, placeholder: 'Que faisiez-vous ? Qu’attendiez-vous ? Que s’est-il passé à la place ?' });
  const preview = h('textarea', { class: 'input report-preview', rows: 8, readonly: true });
  const refresh = () => { preview.value = buildReport(desc.value, ctx); };
  desc.addEventListener('input', refresh);
  refresh();
  const field = (label, el) => h('label', { class: 'field' }, h('span', { text: label }), el);
  const errCount = getErrors().length;

  modal('Signaler un problème', h('div', { class: 'editor' },
    field('Titre', title),
    field('Description', desc),
    field('Rapport (relisez-le : c’est exactement ce qui sera envoyé)', preview),
    h('p', { class: 'muted small', text: '« Envoyer sur GitHub » ouvre une page déjà remplie : il suffit de la valider (compte GitHub gratuit nécessaire). Sans compte, copiez le rapport et envoyez-le par mail ou message à la personne qui maintient Jinglee.' })
  ), [
    errCount ? { label: 'Effacer le journal (' + errCount + ')', class: 'left', action: () => { clearErrors(); refresh(); toast('Journal des erreurs effacé'); return false; } } : null,
    { label: 'Copier le rapport', action: () => {
      copyText('# ' + (title.value.trim() || 'Problème signalé') + '\n\n' + preview.value).then(
        () => toast('Rapport copié'),
        () => toast('Copie impossible : sélectionnez le texte du rapport à la main', 'error', true));
      return false;
    } },
    { label: 'Envoyer sur GitHub', class: 'primary', action: () => {
      refresh();
      window.open(issueUrl(title.value.trim() || 'Problème signalé depuis Jinglee', preview.value), '_blank');
    } }
  ].filter(Boolean), { wide: true });
}

function openHelp() {
  const li = t => h('li', { text: t });
  const body = h('div', { class: 'help' },
    h('h3', { text: 'Principe' }),
    h('ul', {},
      li('Les pads (à droite) se déclenchent d’un simple toucher. Un second toucher arrête, met en pause ou relance le son selon son réglage.'),
      li('La conduite (à gauche) se déroule avec le bouton GO. Touchez une ligne pour la placer en attente.'),
      li('Les lignes de texte de la conduite (répliques, mouvements) servent de repères : GO les saute, et le texte qui précède la cue en attente est surligné.'),
      li('Le bouton de transition (barre du haut) choisit ce qui arrive aux sons en cours quand un nouveau démarre : superposer, fondu enchaîné ou couper.'),
      li('Le bandeau « En cours » montre tous les sons qui jouent, avec leur temps restant.'),
      li('FONDU baisse tous les sons en douceur ; STOP coupe tout immédiatement et annule les enchaînements.')
    ),
    h('h3', { text: 'Préparer un projet' }),
    h('ul', {},
      li('Passez en mode « Édition », puis touchez une case vide ou « + Sons » pour importer vos fichiers.'),
      li('« + Texte » ajoute une réplique ou un repère dans la conduite ; choisissez sa place avec « Position dans la conduite ».'),
      li('En mode Édition, touchez un pad ou une cue pour régler volume, début/fin, fondus, boucle, ducking et enchaînements.'),
      li('Exportez régulièrement vos projets depuis le menu : le fichier .jinglee contient tous les sons.')
    ),
    h('h3', { text: 'Pendant le spectacle' }),
    h('ul', {},
      li('Le cadenas verrouille l’application : impossible de modifier quoi que ce soit par erreur.'),
      li('Clavier ou pédale Bluetooth : Espace / Page suivante = GO, flèches haut/bas = cue en attente, Échap = fondu, Maj+Échap = stop.'),
      li('Réglez « Verrouillage automatique » sur « Jamais » dans les réglages de la tablette : le son s’arrête quand l’écran se verrouille.')
    ),
    isIOS && !isStandalone() ? h('p', { class: 'notice', text: 'Sur iPad : touchez le bouton Partager de Safari puis « Sur l’écran d’accueil » pour installer Jinglee. L’application fonctionnera alors hors-ligne et vos données seront mieux protégées.' }) : null
  );
  modal('Aide', body, [{ label: 'Fermer', class: 'primary' }], { wide: true });
}

// ---------- Clavier ----------

document.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape') {
    if (state.moving) { state.moving = null; render(); return; }
    if (modalOpen()) { closeTopModal(); return; }
    e.preventDefault();
    if (e.shiftKey) show.stopAll(); else show.fadeAll();
    return;
  }
  if (modalOpen()) return;
  switch (e.key) {
    case ' ':
    case 'PageDown':
    case 'ArrowRight':
      e.preventDefault();
      if (!e.repeat) { engine.unlock(); go(); }
      break;
    case 'ArrowDown':
      e.preventDefault(); show.move(1); break;
    case 'ArrowUp':
    case 'PageUp':
    case 'ArrowLeft':
      e.preventDefault(); show.move(-1); break;
  }
});

// ---------- Démarrage ----------

function bindStatic() {
  $('btn-menu').addEventListener('click', openMenu);
  $('btn-edit').addEventListener('click', toggleEdit);
  $('btn-lock').addEventListener('click', toggleLock);
  $('btn-fade').addEventListener('click', () => show.fadeAll());
  $('btn-stop').addEventListener('click', () => show.stopAll());
  onPress($('btn-go'), go);
  $('btn-reset').addEventListener('click', resetCues);
  $('btn-add-cues').addEventListener('click', addCuesFromFiles);
  $('btn-add-action').addEventListener('click', addActionCue);
  $('btn-add-text').addEventListener('click', addTextCue);
  $('btn-transition').addEventListener('click', openTransition);
  $('timer').addEventListener('click', toggleTimer);
  $('timer').addEventListener('dblclick', resetTimer);
  document.querySelectorAll('#view-seg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  // Chaque toucher : déverrouille l'audio (iOS) et (re)lance l'anti-veille.
  let first = true;
  const unlock = () => {
    engine.unlock();
    keepAwake();
    if (first) { first = false; setupAudioSession(); }
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('touchend', unlock, true);
  document.addEventListener('keydown', unlock, true);

  // Sauvegarde avant fermeture ou mise en arrière-plan.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', () => { flushSave(); });

  setInterval(updateClock, 500);
  updateClock();
}

// Mises à jour : une application installée restée ouverte ne vérifie presque jamais s'il existe
// une nouvelle version. On vérifie au démarrage et à chaque retour au premier plan, puis on propose
// de recharger (jamais automatiquement : un son peut être en cours).
function setupUpdates() {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || document.querySelector('.update-banner')) return;
    const bar = h('div', { class: 'update-banner' },
      h('span', { text: 'Une nouvelle version de Jinglee est disponible.' }),
      h('button', { class: 'btn small primary', text: 'Mettre à jour', onclick: () => {
        if (engine.activeVoices().length && !confirm('Des sons sont en cours : recharger les arrêtera. Continuer ?')) return;
        flushSave().then(() => location.reload(), () => location.reload());
      } }),
      h('button', { class: 'btn small ghost', text: 'Plus tard', onclick: () => bar.remove() })
    );
    document.body.appendChild(bar);
  });
}

// « gap » en flexbox n'existe qu'à partir de Safari 14.1 : sinon on espace avec des marges (classe no-flexgap).
function detectFlexGap() {
  const d = document.createElement('div');
  d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  d.appendChild(document.createElement('div'));
  d.appendChild(document.createElement('div'));
  document.body.appendChild(d);
  const ok = d.scrollHeight === 1;
  d.remove();
  if (!ok) document.documentElement.classList.add('no-flexgap');
}

async function boot() {
  installErrorHandlers(msg => toast('Erreur inattendue : ' + msg + ' — vous pouvez la signaler depuis le menu ☰.', 'error', true));
  detectFlexGap();
  bindStatic();
  // Pas de cache hors-ligne en développement local : on veut toujours la dernière version des fichiers.
  if ('serviceWorker' in navigator && location.protocol === 'https:') setupUpdates();
  requestPersistence();
  setupInstallPrompt();
  try {
    const projects = await db.listProjects();
    const lastId = pref('project', null);
    const last = projects.find(p => p.id === lastId) || projects.sort((a, b) => b.updated - a.updated)[0];
    if (last) await openProject(last); else await createProject('Mon spectacle');
    collectGarbage().catch(() => {});
  } catch (e) {
    toast('Stockage local indisponible : ' + e.message, 'error');
    state.project = newProject('Mon spectacle');
    state.tabId = state.project.tabs[0].id;
    render();
  }
}

boot();
