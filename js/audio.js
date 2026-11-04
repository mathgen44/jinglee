// Moteur audio basé sur la Web Audio API.
// Chaque lecture est une « voix » : source -> enveloppe (fondus) -> ducking -> master.
// Les fichiers sont décodés en mémoire pour un départ instantané, avec un cache limité :
// au-delà du budget, les sons les moins prioritaires sont libérés et rechargés à la demande.

const AC = window.AudioContext || window.webkitAudioContext;

export function dbToGain(db) { return db <= -60 ? 0 : Math.pow(10, db / 20); }
export function gainToDb(g) { return g <= 0.001 ? -60 : 20 * Math.log10(g); }

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function decode(ctx, ab) {
  return new Promise((resolve, reject) => {
    // Forme à callbacks : seule disponible sur les anciens Safari.
    const p = ctx.decodeAudioData(ab, resolve, e => reject(e || new Error('Format audio non pris en charge')));
    if (p && p.catch) p.catch(reject);
  });
}

// Rampe linéaire dont on connaît toujours la valeur courante.
// On ne se fie ni à AudioParam.value ni à cancelAndHoldAtTime : selon les navigateurs,
// ils renvoient une valeur fausse et le fondu démarre par une chute brutale du volume.
class Ramp {
  constructor(ctx, param, value) {
    this.ctx = ctx;
    this.param = param;
    this.v0 = this.v1 = value;
    this.t0 = this.t1 = 0;
    param.setValueAtTime(value, ctx.currentTime);
  }

  valueAt(t) {
    if (t >= this.t1) return this.v1;
    if (t <= this.t0) return this.v0;
    return this.v0 + (this.v1 - this.v0) * (t - this.t0) / (this.t1 - this.t0);
  }

  to(target, d) {
    const now = this.ctx.currentTime;
    const cur = this.valueAt(now);
    this.param.cancelScheduledValues(0);
    this.param.setValueAtTime(cur, now);
    if (d > 0) this.param.linearRampToValueAtTime(target, now + d);
    else this.param.setValueAtTime(target, now);
    this.v0 = cur;
    this.v1 = target;
    this.t0 = now;
    this.t1 = now + Math.max(0, d);
  }
}

let nextVoiceId = 1;

class Voice {
  constructor(engine, sound, buffer, meta) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.id = nextVoiceId++;
    this.sound = sound;
    this.buffer = buffer;
    this.meta = meta || {};
    const dur = buffer.duration;
    this.inP = clamp(sound.inPoint || 0, 0, dur);
    this.outP = sound.outPoint > 0 ? clamp(sound.outPoint, this.inP, dur) : dur;
    if (this.outP - this.inP < 0.02) { this.inP = 0; this.outP = dur; }
    this.length = this.outP - this.inP;
    this.loop = !!sound.loop;
    this.level = sound.volume == null ? 1 : sound.volume;
    // source -> env (fondus programmés du son) -> fader (pause, arrêts, fondus manuels) -> duck -> master
    this.env = this.ctx.createGain();
    this.fader = this.ctx.createGain();
    this.duck = this.ctx.createGain();
    this.faderRamp = new Ramp(this.ctx, this.fader.gain, 1);
    this.duckRamp = new Ramp(this.ctx, this.duck.gain, 1);
    this.duckTarget = 1;
    this.env.connect(this.fader);
    this.fader.connect(this.duck);
    this.duck.connect(engine.master);
    this.state = 'idle';
    this.src = null;
    this.startAt = 0;
    this.offset = 0;
    this.pausedAt = 0;
  }

  get active() { return this.state === 'playing' || this.state === 'paused' || this.state === 'stopping'; }

  _startSource(offset, fadeIn) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.env);
    const g = this.env.gain;
    g.cancelScheduledValues(0);
    // Plan de l'enveloppe, gardé pour pouvoir la figer exactement (voir _freezeEnv).
    const plan = { start: now, fadeIn: fadeIn || 0, foStart: 0, foEnd: 0 };
    if (fadeIn > 0) {
      g.setValueAtTime(0, now);
      g.linearRampToValueAtTime(this.level, now + fadeIn);
    } else {
      g.setValueAtTime(this.level, now);
    }
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.inP;
      src.loopEnd = this.outP;
      src.start(now, this.inP + offset);
    } else {
      const rest = Math.max(0.01, this.length - offset);
      src.start(now, this.inP + offset, rest);
      const fo = Math.min(this.sound.fadeOut || 0, rest);
      if (fo > 0) {
        plan.foStart = Math.max(now + plan.fadeIn, now + rest - fo);
        plan.foEnd = now + rest;
        g.setValueAtTime(this.level, plan.foStart);
        g.linearRampToValueAtTime(0, plan.foEnd);
      }
    }
    this.envPlan = plan;
    src.onended = () => { if (this.src === src) this._ended(); };
    this.src = src;
    this.startAt = now;
    this.offset = offset;
    this.state = 'playing';
  }

  _envAt(t) {
    const p = this.envPlan;
    if (!p) return this.level;
    let v = this.level;
    if (p.fadeIn > 0 && t < p.start + p.fadeIn) v = this.level * Math.max(0, t - p.start) / p.fadeIn;
    if (p.foEnd > 0 && t > p.foStart) {
      v = Math.min(v, this.level * Math.max(0, (p.foEnd - t) / (p.foEnd - p.foStart)));
    }
    return v;
  }

  // Arrête les fondus programmés à leur valeur actuelle : un arrêt ne doit jamais faire remonter le son.
  _freezeEnv() {
    const now = this.ctx.currentTime;
    const v = this._envAt(now);
    this.env.gain.cancelScheduledValues(0);
    this.env.gain.setValueAtTime(v, now);
    this.envPlan = { start: now, fadeIn: 0, foStart: 0, foEnd: 0 };
    this.level = v;
  }

  _killSource(fade) {
    const src = this.src;
    if (!src) return;
    this.src = null;
    this.faderRamp.to(0, fade);
    try { src.stop(this.ctx.currentTime + fade + 0.02); } catch (e) { /* déjà arrêtée */ }
  }

  position() {
    if (this.state === 'paused') return this.pausedAt;
    if (this.state === 'idle') return 0;
    let p = this.offset + Math.max(0, this.ctx.currentTime - this.startAt);
    if (this.loop) p = p % this.length;
    return Math.min(p, this.length);
  }

  progress() { return this.length > 0 ? this.position() / this.length : 0; }
  remaining() { return Math.max(0, this.length - this.position()); }

  play(offset) {
    this._startSource(offset || 0, this.sound.fadeIn || 0);
    this.engine._started(this);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.pausedAt = this.position();
    this._killSource(0.03);
    this.state = 'paused';
    this.engine._changed();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.faderRamp.to(1, 0);
    this._startSource(this.pausedAt, 0.03);
    this.engine._changed();
  }

  stop(fade) {
    if (!this.active) return;
    if (this.state === 'paused') { this._ended(); return; }
    const d = Math.max(0.03, fade || 0);
    // Un nouvel arrêt ne peut que raccourcir un fondu en cours.
    if (this.state === 'stopping' && this.stopEnd && this.ctx.currentTime + d >= this.stopEnd) return;
    const now = this.ctx.currentTime;
    this._freezeEnv();
    this.faderRamp.to(0, d);
    if (this.src) { try { this.src.stop(now + d + 0.02); } catch (e) { /* déjà arrêtée */ } }
    this.state = 'stopping';
    this.stopEnd = now + d;
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => this._ended(), (d + 0.1) * 1000);
    this.engine._changed();
  }

  setDuck(target, time) {
    if (target === this.duckTarget) return;
    this.duckTarget = target;
    this.duckRamp.to(target, time);
  }

  _ended() {
    if (this.state === 'ended') return;
    const natural = this.state === 'playing';
    this.state = 'ended';
    clearTimeout(this.stopTimer);
    if (this.src) { try { this.src.stop(); } catch (e) { /* déjà arrêtée */ } this.src = null; }
    try { this.env.disconnect(); this.fader.disconnect(); this.duck.disconnect(); } catch (e) { /* déjà déconnecté */ }
    this.engine._ended(this, natural);
  }
}

export class Engine {
  // loader : fileId -> Promise<ArrayBuffer>
  constructor(loader) {
    this.loader = loader;
    this.ctx = null;
    this.master = null;
    this.voices = [];
    this.cache = new Map();   // fileId -> { buffer, bytes, used }
    this.pending = new Map(); // fileId -> Promise<AudioBuffer>
    this.priority = [];       // fileIds à garder prêts, du plus important au moins important
    this.budget = 350e6;      // octets de PCM décodé gardés en mémoire (limite stricte)
    this.duckLevel = 0.3;
    this.duckTime = 0.5;
    this.listeners = {};
    this.unlocked = false;
  }

  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
  emit(evt, a, b) { (this.listeners[evt] || []).forEach(fn => fn(a, b)); }

  init() {
    if (!this.ctx) {
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // À appeler dans un geste utilisateur (iOS n'autorise le son qu'après un toucher).
  unlock() {
    const ctx = this.init();
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) { /* ignoré */ } }
    if (!this.unlocked) {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
      this.unlocked = true;
    }
  }

  load(fileId) {
    if (!fileId) return Promise.reject(new Error('Aucun fichier associé'));
    const c = this.cache.get(fileId);
    if (c) { c.used = Date.now(); return Promise.resolve(c.buffer); }
    if (this.pending.has(fileId)) return this.pending.get(fileId);
    const ctx = this.init();
    const p = this.loader(fileId)
      .then(ab => {
        if (!ab) throw new Error('Fichier audio introuvable');
        return decode(ctx, ab);
      })
      .then(buffer => {
        this.pending.delete(fileId);
        this.cache.set(fileId, { buffer, bytes: buffer.length * buffer.numberOfChannels * 4, used: Date.now() });
        this._evict();
        return buffer;
      }, err => {
        this.pending.delete(fileId);
        throw err;
      });
    this.pending.set(fileId, p);
    return p;
  }

  // Décode des données déjà en mémoire (import) et les met en cache, sans relire le stockage.
  decodeInto(fileId, arrayBuffer) {
    const ctx = this.init();
    return decode(ctx, arrayBuffer).then(buffer => {
      this.cache.set(fileId, { buffer, bytes: buffer.length * buffer.numberOfChannels * 4, used: Date.now() });
      this._evict();
      return buffer;
    });
  }

  // Décode à l'avance les sons prioritaires, un fichier à la fois pour limiter les pics de mémoire.
  // On s'arrête dès que la mémoire est pleine : décoder la suite ne ferait que chasser les sons
  // plus importants (ou être aussitôt libéré).
  setPriority(fileIds) {
    const seen = new Set();
    this.priority = Array.from(fileIds).filter(id => id && !seen.has(id) && seen.add(id));
    const gen = this._gen = (this._gen || 0) + 1;
    const next = i => {
      if (gen !== this._gen || i >= this.priority.length) return Promise.resolve();
      const id = this.priority[i];
      return this.load(id).catch(() => null).then(() => {
        if (!this.cache.has(id)) return;
        return next(i + 1);
      });
    };
    this._evict();
    return next(0);
  }

  forget(fileId) { this.cache.delete(fileId); }
  clearCache() { this.cache.clear(); }

  // Respecte strictement le budget : on libère d'abord les sons hors priorité (les plus anciens),
  // puis les sons prioritaires en partant des moins importants. Seuls les sons en cours de lecture
  // sont gardés quoi qu'il arrive.
  _evict() {
    let total = 0;
    this.cache.forEach(c => { total += c.bytes; });
    if (total <= this.budget) return;
    const inUse = new Set(this.voices.map(v => v.sound.fileId));
    const rank = new Map(this.priority.map((id, i) => [id, i]));
    const entries = Array.from(this.cache.entries())
      .filter(([id]) => !inUse.has(id))
      .sort((a, b) => {
        const ra = rank.has(a[0]) ? rank.get(a[0]) : -1;
        const rb = rank.has(b[0]) ? rank.get(b[0]) : -1;
        if (ra < 0 && rb < 0) return a[1].used - b[1].used;
        if (ra < 0 || rb < 0) return ra < 0 ? -1 : 1;
        return rb - ra;
      });
    for (const [id, c] of entries) {
      if (total <= this.budget) break;
      this.cache.delete(id);
      total -= c.bytes;
    }
  }

  // Mémoire occupée par les sons décodés (octets), pour l'affichage dans les réglages.
  cacheBytes() {
    let total = 0;
    this.cache.forEach(c => { total += c.bytes; });
    return total;
  }

  // prepare() est appelé une fois le son chargé, juste avant son départ
  // (pour arrêter les autres sons sans créer de blanc pendant le chargement) ;
  // il peut renvoyer une variante des réglages du son (ex. fondu d'entrée).
  play(sound, meta, prepare) {
    this.unlock();
    return this.load(sound.fileId).then(buffer => {
      if (prepare) sound = prepare() || sound;
      const v = new Voice(this, sound, buffer, meta);
      this.voices.push(v);
      // Un son en cours reste en cache (la mémoire est occupée de toute façon) :
      // le relancer est instantané. Il sera libéré à la fin de la lecture si besoin.
      if (!this.cache.has(sound.fileId)) {
        this.cache.set(sound.fileId, { buffer, bytes: buffer.length * buffer.numberOfChannels * 4, used: Date.now() });
      }
      v.play(0);
      return v;
    });
  }

  voicesFor(refId) { return this.voices.filter(v => v.meta.refId === refId && v.active); }
  activeVoices() { return this.voices.filter(v => v.active); }

  fadeAll(d) { this.activeVoices().forEach(v => v.stop(d)); }
  stopAll() { this.activeVoices().forEach(v => v.stop(0.03)); }

  setMasterVolume(g) {
    this.init();
    this.master.gain.setValueAtTime(g, this.ctx.currentTime);
  }

  _updateDuck() {
    const ducking = this.voices.some(v => v.state === 'playing' && v.sound.duck);
    this.voices.forEach(v => {
      if (v.state === 'ended') return;
      v.setDuck(ducking && !v.sound.duck ? this.duckLevel : 1, this.duckTime);
    });
  }

  _started(v) { this._updateDuck(); this.emit('change'); }
  _changed() { this._updateDuck(); this.emit('change'); }

  _ended(v, natural) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    this._evict();
    this._updateDuck();
    this.emit('end', v, natural);
    this.emit('change');
  }
}
