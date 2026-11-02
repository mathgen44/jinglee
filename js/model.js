// Modèle de données d'un projet Jinglee.
// Un projet contient des onglets de pads et une conduite (liste de cues).
// Pads et cues partagent les mêmes réglages de son (voir defaultSound).

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const COLORS = [
  '#d64541', '#e67e22', '#f1c40f', '#27ae60', '#16a085',
  '#2e86de', '#8e44ad', '#e84393', '#7f8c8d', '#3d4f63'
];

// Comportement d'un pad quand on le touche alors qu'il joue déjà.
export const RETRIGGER = {
  stop: 'Arrêter',
  fade: 'Arrêter en fondu',
  restart: 'Relancer du début',
  pause: 'Pause / reprise',
  overlap: 'Superposer une nouvelle lecture'
};

// Enchaînement d'une cue par rapport à la précédente.
export const FOLLOW = {
  manual: 'Sur GO',
  with: 'Avec la précédente',
  after: 'À la fin de la précédente'
};

export const CUE_KINDS = {
  sound: 'Son',
  fadeall: 'Fondu de tous les sons',
  stopall: 'Arrêt de tous les sons'
};

export function defaultSound(fileId, name, duration) {
  return {
    id: uid(),
    name: name || 'Son',
    fileId: fileId || null,
    fileName: '',
    duration: duration || 0,
    color: COLORS[5],
    volume: 1,        // gain linéaire
    inPoint: 0,       // secondes
    outPoint: 0,      // secondes, 0 = fin du fichier
    fadeIn: 0,
    fadeOut: 0,
    loop: false,
    duck: false,      // baisse les autres sons pendant sa lecture
    retrigger: 'stop'
  };
}

export function newPad(tabId, slot, fileId, name, duration) {
  return Object.assign(defaultSound(fileId, name, duration), { tabId: tabId, slot: slot });
}

export function newCue(kind, fileId, name, duration) {
  const cue = Object.assign(defaultSound(fileId, name, duration), {
    kind: kind || 'sound',
    note: '',
    follow: 'manual',
    delay: 0,
    stopOthers: -1    // -1 = ne rien faire, sinon durée du fondu (s)
  });
  if (kind === 'fadeall') { cue.name = 'Fondu général'; cue.color = COLORS[1]; cue.fadeOut = 3; }
  if (kind === 'stopall') { cue.name = 'Arrêt général'; cue.color = COLORS[0]; }
  return cue;
}

export function newProject(name) {
  return {
    id: uid(),
    name: name || 'Nouveau projet',
    format: 1,
    created: Date.now(),
    updated: Date.now(),
    tabs: [{ id: uid(), name: 'Jingles' }],
    pads: [],
    cues: [],
    settings: {
      cols: 4,
      rows: 4,
      fadeAll: 3,      // durée du bouton « Fondu » (s)
      duckLevel: 0.3,  // niveau des autres sons pendant un ducking
      duckTime: 0.5    // durée de la baisse/remontée (s)
    }
  };
}

// Complète un projet chargé (ancienne version, import) avec les champs manquants.
export function normalizeProject(p) {
  const base = newProject(p.name);
  p.settings = Object.assign(base.settings, p.settings || {});
  if (!p.tabs || !p.tabs.length) p.tabs = base.tabs;
  p.pads = (p.pads || []).map(x => Object.assign(newPad(x.tabId, x.slot), x));
  p.cues = (p.cues || []).map(x => Object.assign(newCue(x.kind), x));
  return p;
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// Fichiers audio référencés par un projet.
export function fileIdsOf(p) {
  const ids = new Set();
  p.pads.forEach(x => x.fileId && ids.add(x.fileId));
  p.cues.forEach(x => x.fileId && ids.add(x.fileId));
  return ids;
}
