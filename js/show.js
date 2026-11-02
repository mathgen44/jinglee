// Logique de spectacle : déclenchement des pads et déroulement de la conduite.

export class Show {
  constructor(engine, getProject, onChange, onError) {
    this.engine = engine;
    this.getProject = getProject;
    this.onChange = onChange;
    this.onError = onError;
    this.standby = 0;          // index de la prochaine cue jouée par GO
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
          playing.forEach(v => v.stop(pad.fadeOut || this.getProject().settings.fadeAll));
          return;
        case 'pause': {
          const v = playing[playing.length - 1];
          if (v.state === 'paused') v.resume(); else if (v.state === 'playing') v.pause(); else this._play(pad, 'pad');
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
    this._play(pad, 'pad');
  }

  _play(sound, origin) {
    return this.engine.play(sound, { origin, refId: sound.id }).catch(err => {
      this.onError('« ' + sound.name + ' » : ' + (err && err.message ? err.message : 'lecture impossible'));
      return null;
    });
  }

  // ---- Conduite ----

  setStandby(i) {
    this.standby = Math.max(0, Math.min(i, this.cues.length));
    this.onChange();
  }

  move(delta) { this.setStandby(this.standby + delta); }

  go() {
    const now = Date.now();
    if (now - this.lastGo < 250) return; // anti double-appui
    this.lastGo = now;
    const cues = this.cues;
    const i = this.standby;
    if (i >= cues.length) return;
    this._fire(i);
    let k = i + 1;
    while (k < cues.length && cues[k].follow !== 'manual') k++;
    this.standby = k;
    this.onChange();
  }

  _fire(i) {
    const cues = this.cues;
    const cue = cues[i];
    if (!cue) return;
    this.played.add(cue.id);
    const settings = this.getProject().settings;

    if (cue.kind === 'fadeall') {
      this.engine.fadeAll(cue.fadeOut || settings.fadeAll);
    } else if (cue.kind === 'stopall') {
      this.engine.stopAll();
    } else {
      if (cue.stopOthers >= 0) this.engine.fadeAll(cue.stopOthers);
      this.armed.add(cue.id);
      this._play(cue, 'cue');
    }

    const next = cues[i + 1];
    if (!next) return;
    if (next.follow === 'with' || (next.follow === 'after' && cue.kind !== 'sound')) {
      this._schedule(next.id, next.delay);
    }
    this.onChange();
  }

  _schedule(cueId, delay) {
    const run = () => {
      const i = this.cues.findIndex(c => c.id === cueId);
      if (i >= 0) this._fire(i);
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
    const next = cues[i + 1];
    if (i >= 0 && next && next.follow === 'after') this._schedule(next.id, next.delay);
  }

  cancelPending() {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    this.armed.clear();
  }

  reset() {
    this.cancelPending();
    this.standby = 0;
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
