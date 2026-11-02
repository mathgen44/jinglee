// Logique de spectacle : déclenchement des pads et déroulement de la conduite.

import { isPlayable } from './model.js';

export class Show {
  constructor(engine, getProject, onChange, onError) {
    this.engine = engine;
    this.getProject = getProject;
    this.onChange = onChange;
    this.onError = onError;
    this.standby = 0;          // index de la prochaine cue jouée par GO (jamais une ligne de texte)
    this.played = new Set();   // ids des cues déjà jouées
    this.armed = new Set();    // cues dont la fin naturelle déclenchera la suivante
    this.timers = [];
    this.lastGo = 0;
    engine.on('end', (v, natural) => this._voiceEnded(v, natural));
  }

  get cues() { return this.getProject().cues; }

  // ---- Pads ----

  triggerPad(pad) {
    if (!pad.fileId) return;
    const playing = this.engine.voicesFor(pad.id);
    if (playing.length && pad.retrigger !== 'overlap') {
      switch (pad.retrigger) {
        case 'fade':
          playing.forEach(v => v.stop(pad.stopFade || this.getProject().settings.fadeAll));
          return;
        case 'pause': {
          const v = playing[playing.length - 1];
          if (v.state === 'paused') v.resume(); else if (v.state === 'playing') v.pause(); else this._play(pad, 'pad', true);
          return;
        }
        case 'restart':
          playing.forEach(v => v.stop(0.03));
          break;
        default:
          playing.forEach(v => v.stop(0.03));
          return;
      }
    }
    this._play(pad, 'pad', true);
  }

  // transition : appliquer le mode de transition du projet aux sons déjà en cours.
  // stopOthers : durée d'arrêt imposée par la cue (prioritaire), -1 sinon.
  _play(sound, origin, transition, stopOthers) {
    const settings = this.getProject().settings;
    const prepare = () => {
      const others = this.engine.activeVoices().filter(v => v.meta.origin !== 'preview');
      let fade = -1;
      if (stopOthers >= 0) fade = stopOthers;
      else if (transition && settings.transition === 'cut') fade = 0.03;
      else if (transition && settings.transition === 'crossfade') fade = settings.crossfade;
      if (fade < 0 || !others.length) return sound;
      others.forEach(v => v.stop(fade));
      // Fondu enchaîné : le nouveau son monte pendant que les autres descendent.
      if (stopOthers < 0 && settings.transition === 'crossfade' && !(sound.fadeIn > 0)) {
        return Object.assign({}, sound, { fadeIn: settings.crossfade });
      }
      return sound;
    };
    return this.engine.play(sound, { origin, refId: sound.id }, prepare).catch(err => {
      this.onError('« ' + (sound.name || 'Son') + ' » : ' + (err && err.message ? err.message : 'lecture impossible'));
      return null;
    });
  }

  // ---- Conduite ----

  // Première cue jouable à partir de i (inclus).
  _playableFrom(i) {
    const cues = this.cues;
    while (i < cues.length && !isPlayable(cues[i])) i++;
    return i;
  }

  _nextPlayable(i) { return this._playableFrom(i + 1); }

  setStandby(i) {
    this.standby = this._playableFrom(Math.max(0, Math.min(i, this.cues.length)));
    this.onChange();
  }

  move(delta) {
    const cues = this.cues;
    let i = this.standby;
    if (delta > 0) {
      i = this._nextPlayable(Math.min(i, cues.length - 1));
    } else {
      let j = Math.min(i, cues.length) - 1;
      while (j >= 0 && !isPlayable(cues[j])) j--;
      if (j >= 0) i = j;
    }
    this.setStandby(i);
  }

  go() {
    const now = Date.now();
    if (now - this.lastGo < 250) return; // anti double-appui
    this.lastGo = now;
    const cues = this.cues;
    const i = this._playableFrom(this.standby);
    if (i >= cues.length) return;
    this._fire(i, false);
    let k = this._nextPlayable(i);
    while (k < cues.length && cues[k].follow !== 'manual') k = this._nextPlayable(k);
    this.standby = k;
    this.onChange();
  }

  // chained : déclenchée « avec la précédente » (pas de transition, les deux sons doivent jouer ensemble).
  _fire(i, chained) {
    const cues = this.cues;
    const cue = cues[i];
    if (!cue || !isPlayable(cue)) return;
    this.played.add(cue.id);
    const settings = this.getProject().settings;

    if (cue.kind === 'fadeall') {
      this.engine.fadeAll(cue.fadeOut || settings.fadeAll);
    } else if (cue.kind === 'stopall') {
      this.engine.stopAll();
    } else {
      this.armed.add(cue.id);
      this._play(cue, 'cue', !chained, cue.stopOthers);
    }

    const next = cues[this._nextPlayable(i)];
    if (next && (next.follow === 'with' || (next.follow === 'after' && cue.kind !== 'sound'))) {
      this._schedule(next.id, next.delay, next.follow === 'with');
    }
    this.onChange();
  }

  _schedule(cueId, delay, chained) {
    const run = () => {
      const i = this.cues.findIndex(c => c.id === cueId);
      if (i >= 0) this._fire(i, chained);
    };
    if (delay > 0) {
      const t = setTimeout(() => {
        this.timers = this.timers.filter(x => x !== t);
        run();
      }, delay * 1000);
      this.timers.push(t);
    } else {
      run();
    }
  }

  _voiceEnded(v, natural) {
    if (v.meta.origin !== 'cue') return;
    const id = v.meta.refId;
    if (!this.armed.has(id)) return;
    this.armed.delete(id);
    if (!natural) return;
    const cues = this.cues;
    const i = cues.findIndex(c => c.id === id);
    if (i < 0) return;
    const next = cues[this._nextPlayable(i)];
    if (next && next.follow === 'after') this._schedule(next.id, next.delay, false);
  }

  cancelPending() {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    this.armed.clear();
  }

  reset() {
    this.cancelPending();
    this.standby = this._playableFrom(0);
    this.played.clear();
    this.onChange();
  }

  // ---- Commandes générales ----

  fadeAll() {
    this.armed.clear();
    this.engine.fadeAll(this.getProject().settings.fadeAll);
  }

  stopAll() {
    this.cancelPending();
    this.engine.stopAll();
  }
}
