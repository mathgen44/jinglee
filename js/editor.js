// Fenêtre de réglage d'un pad ou d'une cue.

import { h, modal, fmtTime, parseNum, numStr, pickFiles, toast } from './dom.js';
import { COLORS, RETRIGGER, FOLLOW, CUE_KINDS, clone } from './model.js';
import { dbToGain, gainToDb } from './audio.js';

// app : { engine, importFile(file), onSave(item), onDelete(item), onDuplicate(item), onMove(item), tabs }
export function openEditor(app, original, type) {
  const item = clone(original);
  const isCue = type === 'cue';
  const isAction = isCue && item.kind !== 'sound';
  let preview = null;
  let rafId = 0;

  function stopPreview() {
    if (preview) { preview.stop(0.05); preview = null; }
    cancelAnimationFrame(rafId);
    previewBtn.textContent = '▶ Écouter';
    posLabel.textContent = '';
  }

  // ---- Champs ----

  const nameInput = h('input', { class: 'input', type: 'text', value: item.name });

  const swatches = h('div', { class: 'swatches' });
  function drawSwatches() {
    swatches.innerHTML = '';
    COLORS.forEach(c => swatches.appendChild(h('button', {
      class: 'swatch' + (c === item.color ? ' on' : ''),
      style: { background: c },
      'aria-label': 'Couleur ' + c,
      onclick: () => { item.color = c; drawSwatches(); }
    })));
  }
  drawSwatches();

  const fileLabel = h('span', { class: 'file-name', text: fileText() });
  function fileText() {
    if (!item.fileId) return 'Aucun fichier';
    return (item.fileName || 'Fichier') + ' — ' + fmtTime(item.duration, true);
  }

  const previewBtn = h('button', { class: 'btn', text: '▶ Écouter', onclick: () => {
    if (preview) { stopPreview(); return; }
    if (!item.fileId) return;
    readFields();
    app.engine.play(Object.assign({}, item, { fadeIn: 0, duck: false }), { origin: 'preview', refId: 'preview' }).then(v => {
      preview = v;
      previewBtn.textContent = '■ Arrêter';
      const tick = () => {
        if (!preview || !preview.active) { stopPreview(); return; }
        posLabel.textContent = fmtTime(preview.inP + preview.position(), true);
        rafId = requestAnimationFrame(tick);
      };
      tick();
    }, err => toast(err.message || 'Lecture impossible', 'error'));
  } });
  const posLabel = h('span', { class: 'pos-label' });

  const replaceBtn = h('button', { class: 'btn', text: item.fileId ? 'Remplacer…' : 'Choisir un fichier…', onclick: () => {
    pickFiles('audio/*', false).then(files => {
      if (!files.length) return;
      stopPreview();
      app.importFile(files[0]).then(f => {
        const wasDefaultName = !item.name || item.name === 'Son' || item.name === item.fileName;
        item.fileId = f.fileId;
        item.fileName = f.name;
        item.duration = f.duration;
        item.inPoint = 0;
        item.outPoint = 0;
        if (wasDefaultName) { item.name = f.name; nameInput.value = f.name; }
        inInput.value = '0';
        outInput.value = '';
        fileLabel.textContent = fileText();
        replaceBtn.textContent = 'Remplacer…';
      }, err => toast(err.message || 'Import impossible', 'error'));
    });
  } });

  const volLabel = h('span', { class: 'value' });
  const volInput = h('input', { type: 'range', min: '-40', max: '6', step: '0.5', value: String(Math.round(gainToDb(item.volume) * 2) / 2), class: 'range' });
  function showVol() {
    const db = parseFloat(volInput.value);
    volLabel.textContent = db <= -40 ? '−∞ dB' : (db > 0 ? '+' : '') + numStr(db) + ' dB';
  }
  volInput.addEventListener('input', showVol);
  showVol();

  const num = (v, placeholder) => h('input', { class: 'input num', type: 'text', inputmode: 'decimal', value: v ? numStr(v) : (placeholder ? '' : '0'), placeholder: placeholder || '' });
  const inInput = num(item.inPoint);
  const outInput = num(item.outPoint, 'fin');
  const fadeInInput = num(item.fadeIn);
  const fadeOutInput = num(item.fadeOut);

  const setHere = (input, which) => h('button', { class: 'btn small', text: 'Ici', title: 'Prendre la position de l’écoute', onclick: () => {
    if (!preview) { toast('Lancez l’écoute pour choisir un point'); return; }
    const t = preview.inP + preview.position();
    input.value = numStr(t);
    if (which === 'out') stopPreview();
  } });

  const loopInput = h('input', { type: 'checkbox', checked: !!item.loop });
  const duckInput = h('input', { type: 'checkbox', checked: !!item.duck });

  const select = (options, value) => {
    const s = h('select', { class: 'input' });
    Object.keys(options).forEach(k => s.appendChild(h('option', { value: k, text: options[k], selected: k === value })));
    return s;
  };

  const retriggerSelect = select(RETRIGGER, item.retrigger);
  const noteInput = h('textarea', { class: 'input', rows: 2, placeholder: 'Ex. : au noir, sur la réplique « … »' });
  noteInput.value = item.note || '';
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

  function readFields() {
    item.name = nameInput.value.trim() || item.fileName || 'Son';
    item.volume = dbToGain(parseFloat(volInput.value) <= -40 ? -60 : parseFloat(volInput.value));
    item.inPoint = Math.max(0, parseNum(inInput.value, 0));
    item.outPoint = Math.max(0, parseNum(outInput.value, 0));
    if (item.outPoint && item.outPoint <= item.inPoint) item.outPoint = 0;
    item.fadeIn = Math.max(0, parseNum(fadeInInput.value, 0));
    item.fadeOut = Math.max(0, parseNum(fadeOutInput.value, 0));
    item.loop = loopInput.checked;
    item.duck = duckInput.checked;
    if (isCue) {
      item.note = noteInput.value.trim();
      item.follow = followSelect.value;
      item.delay = Math.max(0, parseNum(delayInput.value, 0));
      item.stopOthers = stopOthersInput.checked ? Math.max(0, parseNum(stopOthersFade.value, 0)) : -1;
    } else {
      item.retrigger = retriggerSelect.value;
      if (tabSelect && tabSelect.value !== item.tabId) { item.tabId = tabSelect.value; item.slot = -1; }
    }
  }

  // ---- Mise en page ----

  const field = (label, ...ctrl) => h('label', { class: 'field' }, h('span', { text: label }), h('div', { class: 'ctrl' }, ctrl));
  const check = (input, label) => h('label', { class: 'check' }, input, h('span', { text: label }));

  const body = h('div', { class: 'editor' });
  if (isCue) body.appendChild(h('div', { class: 'kind-label', text: 'Type : ' + CUE_KINDS[item.kind] }));
  body.appendChild(field('Nom', nameInput));
  body.appendChild(field('Couleur', swatches));

  if (!isAction) {
    body.appendChild(h('div', { class: 'section' },
      h('div', { class: 'file-row' }, fileLabel),
      h('div', { class: 'row' }, replaceBtn, previewBtn, posLabel)
    ));
    body.appendChild(field('Volume', volInput, volLabel));
    body.appendChild(h('div', { class: 'grid2' },
      field('Début (s)', inInput, setHere(inInput, 'in')),
      field('Fin (s)', outInput, setHere(outInput, 'out')),
      field('Fondu d’entrée (s)', fadeInInput),
      field('Fondu de sortie (s)', fadeOutInput)
    ));
    body.appendChild(check(loopInput, 'Lecture en boucle'));
    body.appendChild(check(duckInput, 'Baisser les autres sons pendant la lecture (ducking)'));
    if (!isCue) body.appendChild(field('Si on touche le pad pendant la lecture', retriggerSelect));
    if (tabSelect) body.appendChild(field('Onglet', tabSelect));
  } else if (item.kind === 'fadeall') {
    body.appendChild(field('Durée du fondu (s)', fadeOutInput));
  }

  if (isCue) {
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

  const buttons = [];
  buttons.push({ label: 'Supprimer', class: 'danger left', action: () => { stopPreview(); app.onDelete(original); } });
  buttons.push({ label: 'Dupliquer', action: () => { stopPreview(); readFields(); app.onDuplicate(item); } });
  if (!isCue) buttons.push({ label: 'Déplacer', action: () => { stopPreview(); readFields(); app.onSave(item); app.onMove(item); } });
  buttons.push({ label: 'Enregistrer', class: 'primary', action: () => { stopPreview(); readFields(); app.onSave(item); } });

  modal(isCue ? 'Cue' : 'Pad', body, buttons, { wide: true, onClose: stopPreview });
}
