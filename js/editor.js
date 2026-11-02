// Fenêtre de réglage d'un pad ou d'une cue.
// Ordre : nom (titre), couleur, volume, mode de fin, début/fin sur la frise, fondus, puis options de conduite.

import { h, modal, fmtTime, parseNum, numStr, pickAudio, toast } from './dom.js';
import { COLORS, RETRIGGER, FOLLOW, CUE_KINDS, clone } from './model.js';
import { dbToGain, gainToDb } from './audio.js';
import { Timeline } from './timeline.js';

// app : { engine, importFile(file), onSave(item), onDelete(item), onDuplicate(item), onMove(item), tabs, cues }
export function openEditor(app, original, type) {
  const item = clone(original);
  const isCue = type === 'cue';
  const isText = isCue && item.kind === 'text';
  const isAction = isCue && item.kind !== 'sound' && !isText;
  const isSound = !isText && !isAction;
  let preview = null;
  let rafId = 0;
  let timeline = null;

  // ---- Titre : nom éditable ----

  const nameText = h('h2', { class: 'title-name', text: item.name || 'Sans nom' });
  const nameInput = h('input', { class: 'input title-input', type: 'text', value: item.name });
  const editName = h('button', { class: 'btn icon ghost small-icon', 'aria-label': 'Renommer', text: '✎' });
  function showNameInput(on) {
    nameText.style.display = on ? 'none' : '';
    editName.style.display = on ? 'none' : '';
    nameInput.style.display = on ? '' : 'none';
    if (on) { nameInput.focus(); nameInput.select(); }
  }
  function commitName() {
    item.name = nameInput.value.trim() || item.fileName || item.name || 'Son';
    nameInput.value = item.name;
    nameText.textContent = item.name;
    showNameInput(false);
  }
  editName.addEventListener('click', () => showNameInput(true));
  nameText.addEventListener('click', () => showNameInput(true));
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitName(); } });
  nameInput.addEventListener('blur', commitName);
  nameInput.style.display = 'none';
  const title = isText ? 'Texte' : [nameText, editName, nameInput];

  // ---- Petits composants ----

  const field = (label, ...ctrl) => h('div', { class: 'field' }, h('span', { text: label }), h('div', { class: 'ctrl' }, ctrl));
  const check = (input, label) => h('label', { class: 'check' }, input, h('span', { text: label }));
  const num = (v, placeholder) => h('input', { class: 'input num', type: 'text', inputmode: 'decimal', value: v ? numStr(v) : (placeholder ? '' : '0'), placeholder: placeholder || '' });
  const select = (options, value) => {
    const s = h('select', { class: 'input' });
    Object.keys(options).forEach(k => s.appendChild(h('option', { value: k, text: options[k], selected: k === value })));
    return s;
  };
  // Bouton-icône à bascule (boucle, ducking).
  const toggle = (icon, label, on, onChange) => {
    const b = h('button', { class: 'icon-btn' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' },
      h('span', { class: 'icon-btn-icon', text: icon }), h('span', { class: 'icon-btn-label', text: label }));
    b.addEventListener('click', () => {
      const v = !b.classList.contains('on');
      b.classList.toggle('on', v);
      b.setAttribute('aria-pressed', v ? 'true' : 'false');
      onChange(v);
    });
    return b;
  };

  // ---- Couleur ----

  const swatches = h('div', { class: 'swatches' });
  function drawSwatches() {
    swatches.innerHTML = '';
    COLORS.forEach(c => swatches.appendChild(h('button', {
      class: 'swatch' + (c === item.color ? ' on' : ''),
      style: { background: c },
      'aria-label': 'Couleur ' + c,
      onclick: () => { item.color = c; drawSwatches(); if (timeline) timeline.draw(); }
    })));
  }
  drawSwatches();

  // ---- Volume ----

  const volLabel = h('span', { class: 'value' });
  const volInput = h('input', { type: 'range', min: '-40', max: '6', step: '0.5', value: String(Math.round(gainToDb(item.volume) * 2) / 2), class: 'range' });
  function showVol() {
    const db = parseFloat(volInput.value);
    volLabel.textContent = db <= -40 ? '−∞ dB' : (db > 0 ? '+' : '') + numStr(db) + ' dB';
  }
  volInput.addEventListener('input', showVol);
  showVol();
  const duckBtn = toggle('↧', 'Ducking', !!item.duck, v => { item.duck = v; });
  duckBtn.title = 'Baisser les autres sons pendant la lecture';

  // ---- Mode de fin (pads) et boucle ----

  const stopFadeInput = num(item.stopFade != null ? item.stopFade : 3);
  const stopFadeRow = h('div', { class: 'ctrl stop-fade' }, h('span', { text: 'Durée du fondu' }), stopFadeInput, h('span', { text: 's' }));
  const modeGroup = h('div', { class: 'icon-group' });
  function drawModes() {
    modeGroup.innerHTML = '';
    Object.keys(RETRIGGER).forEach(k => {
      const [icon, label, desc] = RETRIGGER[k];
      modeGroup.appendChild(h('button', {
        class: 'icon-btn' + (item.retrigger === k ? ' on' : ''),
        title: desc,
        onclick: () => {
          item.retrigger = k;
          if (k === 'fade' && !(parseNum(stopFadeInput.value, 0) > 0)) stopFadeInput.value = '3';
          drawModes();
        }
      }, h('span', { class: 'icon-btn-icon', text: icon }), h('span', { class: 'icon-btn-label', text: label })));
    });
    stopFadeRow.style.display = item.retrigger === 'fade' ? '' : 'none';
    modeDesc.textContent = 'Second appui pendant la lecture : ' + RETRIGGER[item.retrigger][2].toLowerCase() + '.';
  }
  const modeDesc = h('div', { class: 'muted small' });
  const loopBtn = toggle('⟲', 'Boucle', !!item.loop, v => { item.loop = v; });
  if (!isCue) drawModes();

  // ---- Fichier, écoute et frise ----

  const fileLabel = h('span', { class: 'file-name', text: fileText() });
  function fileText() {
    if (!item.fileId) return 'Aucun fichier';
    return (item.fileName || 'Fichier') + ' — ' + fmtTime(item.duration, true);
  }

  const posLabel = h('span', { class: 'pos-label' });
  const previewBtn = h('button', { class: 'btn', text: '▶ Écouter', onclick: () => {
    if (preview) { stopPreview(); return; }
    if (!item.fileId) return;
    readFields();
    app.engine.play(Object.assign({}, item, { fadeIn: 0, duck: false }), { origin: 'preview', refId: 'preview' }).then(v => {
      preview = v;
      previewBtn.textContent = '■ Arrêter';
      const tick = () => {
        if (!preview || !preview.active) { stopPreview(); return; }
        const t = preview.inP + preview.position();
        posLabel.textContent = fmtTime(t, true);
        if (timeline) timeline.setPlayhead(t);
        rafId = requestAnimationFrame(tick);
      };
      tick();
    }, err => toast(err.message || 'Lecture impossible', 'error'));
  } });

  function stopPreview() {
    if (preview) { preview.stop(0.05); preview = null; }
    cancelAnimationFrame(rafId);
    previewBtn.textContent = '▶ Écouter';
    posLabel.textContent = '';
    if (timeline) timeline.setPlayhead(null);
  }

  const inInput = num(item.inPoint);
  const outInput = num(item.outPoint, 'fin');
  const fadeInInput = num(item.fadeIn);
  const fadeOutInput = num(item.fadeOut);

  function syncPointInputs() {
    inInput.value = numStr(item.inPoint || 0);
    outInput.value = item.outPoint > 0 ? numStr(item.outPoint) : '';
  }

  function loadWave() {
    if (!timeline) return;
    if (!item.fileId) { timeline.setBuffer(null, null); return; }
    app.engine.load(item.fileId).then(buf => {
      if (!item.duration) item.duration = buf.duration;
      timeline.setBuffer(item.fileId, buf);
    }, () => timeline.setBuffer(null, null));
  }

  if (isSound) {
    timeline = new Timeline(item, syncPointInputs);
    [inInput, outInput, fadeInInput, fadeOutInput].forEach(inp => inp.addEventListener('input', () => {
      readPoints();
      timeline.draw();
    }));
  }

  const replaceBtn = h('button', { class: 'btn', text: item.fileId ? 'Remplacer…' : 'Choisir un fichier…', onclick: () => {
    pickAudio(false).then(files => {
      if (!files.length) return;
      stopPreview();
      app.importFile(files[0]).then(f => {
        const wasDefaultName = !item.name || item.name === 'Son' || item.name === item.fileName;
        item.fileId = f.fileId;
        item.fileName = f.name;
        item.duration = f.duration;
        item.inPoint = 0;
        item.outPoint = 0;
        if (wasDefaultName) { item.name = f.name; nameInput.value = f.name; nameText.textContent = f.name; }
        syncPointInputs();
        fileLabel.textContent = fileText();
        replaceBtn.textContent = 'Remplacer…';
        loadWave();
      }, err => toast(err.message || 'Import impossible', 'error'));
    });
  } });

  // ---- Conduite ----

  const noteInput = h('textarea', {
    class: 'input',
    rows: isText ? 5 : 2,
    placeholder: isText ? 'Ex. : JEANNE — « …et je ne reviendrai jamais ! » (elle sort côté jardin)' : 'Ex. : au noir, sur la réplique « … »'
  });
  noteInput.value = item.note || '';

  // Position dans la conduite : « avant telle cue » ou « à la fin ».
  let positionSelect = null;
  if (isCue && app.cues) {
    const cues = app.cues;
    const idx = cues.findIndex(c => c.id === item.id);
    const opts = {};
    let n = 0;
    cues.forEach(c => {
      if (c.kind !== 'text') n++;
      if (c.id === item.id) return;
      const label = c.kind === 'text'
        ? '« ' + (c.note || '').slice(0, 40) + ((c.note || '').length > 40 ? '…' : '') + ' »'
        : n + '. ' + c.name;
      opts[c.id] = 'Avant ' + label;
    });
    opts[''] = 'À la fin';
    const next = idx >= 0 ? cues[idx + 1] : null;
    positionSelect = select(opts, item.before != null ? item.before : (next ? next.id : ''));
  }
  const followSelect = select(FOLLOW, item.follow);
  const delayInput = num(item.delay);
  const stopOthersInput = h('input', { type: 'checkbox', checked: item.stopOthers >= 0 });
  const stopOthersFade = num(item.stopOthers >= 0 ? item.stopOthers : 2);
  let tabSelect = null;
  if (!isCue && app.tabs.length > 1) {
    const opts = {};
    app.tabs.forEach(t => { opts[t.id] = t.name; });
    tabSelect = select(opts, item.tabId);
  }

  // ---- Lecture des champs ----

  function readPoints() {
    item.inPoint = Math.max(0, parseNum(inInput.value, 0));
    item.outPoint = Math.max(0, parseNum(outInput.value, 0));
    if (item.duration && item.outPoint >= item.duration) item.outPoint = 0;
    if (item.outPoint && item.outPoint <= item.inPoint) item.outPoint = 0;
    item.fadeIn = Math.max(0, parseNum(fadeInInput.value, 0));
    item.fadeOut = Math.max(0, parseNum(fadeOutInput.value, 0));
  }

  function readFields() {
    if (positionSelect) item.before = positionSelect.value;
    if (isText) {
      item.note = noteInput.value.trim();
      return;
    }
    if (nameInput.style.display !== 'none') commitName();
    item.volume = dbToGain(parseFloat(volInput.value) <= -40 ? -60 : parseFloat(volInput.value));
    readPoints();
    if (isCue) {
      item.note = noteInput.value.trim();
      item.follow = followSelect.value;
      item.delay = Math.max(0, parseNum(delayInput.value, 0));
      item.stopOthers = stopOthersInput.checked ? Math.max(0, parseNum(stopOthersFade.value, 0)) : -1;
    } else {
      item.stopFade = Math.max(0.1, parseNum(stopFadeInput.value, 3));
      if (tabSelect && tabSelect.value !== item.tabId) { item.tabId = tabSelect.value; item.slot = -1; }
    }
  }

  // ---- Mise en page ----

  const section = (label, ...content) => h('div', { class: 'ed-section' }, h('div', { class: 'ed-label', text: label }), content);
  const body = h('div', { class: 'editor' });

  if (isText) {
    body.appendChild(field('Réplique, mouvement ou repère qui annonce la suite', noteInput));
    body.appendChild(section('Couleur', swatches));
  } else {
    if (isCue) body.appendChild(h('div', { class: 'kind-label', text: 'Type : ' + CUE_KINDS[item.kind] }));
    body.appendChild(section('Couleur', swatches));
  }

  if (isSound) {
    body.appendChild(section('Volume', h('div', { class: 'ctrl' }, volInput, volLabel, duckBtn)));

    if (!isCue) {
      body.appendChild(section('Mode de fin',
        h('div', { class: 'mode-row' }, modeGroup, h('div', { class: 'mode-sep' }), loopBtn),
        stopFadeRow,
        modeDesc
      ));
    } else {
      body.appendChild(section('Lecture', h('div', { class: 'mode-row' }, loopBtn)));
    }

    body.appendChild(section('Début et fin',
      h('div', { class: 'row wrap file-row' }, fileLabel, h('div', { class: 'spacer' }), replaceBtn, previewBtn, posLabel),
      timeline.el,
      h('div', { class: 'row wrap points' },
        h('label', { class: 'ctrl' }, h('span', { text: 'Début' }), inInput, h('span', { text: 's' })),
        h('label', { class: 'ctrl' }, h('span', { text: 'Fin' }), outInput, h('span', { text: 's' }))
      )
    ));

    body.appendChild(section('Fondus',
      h('div', { class: 'row wrap points' },
        h('label', { class: 'ctrl' }, h('span', { text: 'Entrée' }), fadeInInput, h('span', { text: 's' })),
        h('label', { class: 'ctrl' }, h('span', { text: 'Fin du son' }), fadeOutInput, h('span', { text: 's' }))
      )
    ));

    if (tabSelect) body.appendChild(field('Onglet', tabSelect));
  } else if (item.kind === 'fadeall') {
    body.appendChild(field('Durée du fondu (s)', fadeOutInput));
  }

  if (isCue && !isText) {
    body.appendChild(field('Note de régie', noteInput));
    body.appendChild(h('div', { class: 'grid2' },
      field('Départ', followSelect),
      field('Délai (s)', delayInput)
    ));
    if (!isAction) {
      body.appendChild(h('div', { class: 'row' },
        check(stopOthersInput, 'Au départ, arrêter les autres sons en fondu de'),
        stopOthersFade, h('span', { text: 's' })
      ));
    }
  }
  if (positionSelect) body.appendChild(field('Position dans la conduite', positionSelect));

  const buttons = [];
  buttons.push({ label: 'Supprimer', class: 'danger left', action: () => { stopPreview(); app.onDelete(original); } });
  buttons.push({ label: 'Dupliquer', action: () => { stopPreview(); readFields(); app.onDuplicate(item); } });
  if (!isCue) buttons.push({ label: 'Déplacer', action: () => { stopPreview(); readFields(); app.onSave(item); app.onMove(item); } });
  buttons.push({ label: 'Enregistrer', class: 'primary', action: () => { stopPreview(); readFields(); app.onSave(item); } });

  modal(title, body, buttons, {
    wide: true,
    onClose: () => { stopPreview(); if (timeline) timeline.destroy(); }
  });

  // La frise se dessine une fois la fenêtre affichée (il faut connaître sa largeur).
  if (timeline) requestAnimationFrame(() => { timeline.draw(); loadWave(); });
}
