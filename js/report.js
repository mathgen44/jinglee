// Journal des erreurs et rapport de problème (issue GitHub pré-remplie).
// Le journal reste sur l'appareil ; rien n'est envoyé sans action de l'utilisateur.

export const REPO = 'mathgen44/jinglee';
const KEY = 'jinglee.errors';
const MAX = 20;

export function getErrors() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
}

export function clearErrors() {
  try { localStorage.removeItem(KEY); } catch (e) { /* stockage indisponible */ }
}

export function logError(message, source) {
  if (!message) return;
  const list = getErrors();
  list.push({ t: Date.now(), m: String(message).slice(0, 300), s: source ? String(source).slice(0, 120) : '' });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* stockage plein ou indisponible */ }
}

// Erreurs non prévues : on les garde pour le rapport et on les signale (onError affiche un message).
export function installErrorHandlers(onError) {
  window.addEventListener('error', e => {
    const where = e.filename ? e.filename.split('/').pop() + ':' + e.lineno : '';
    logError(e.message || 'Erreur', where);
    if (onError) onError(e.message || 'Erreur inattendue');
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    const msg = r && r.message ? r.message : String(r);
    logError(msg, 'promesse');
    if (onError) onError(msg);
  });
}

// Description lisible de l'appareil à partir du navigateur.
export function deviceInfo() {
  const ua = navigator.userAgent;
  const ios = /OS (\d+)_(\d+)(?:_(\d+))? like Mac OS X/.exec(ua);
  const safari = /Version\/([\d.]+)/.exec(ua);
  const android = /Android ([\d.]+)/.exec(ua);
  const chrome = /(?:Chrome|CriOS)\/([\d.]+)/.exec(ua);
  let device = 'Ordinateur';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) device = 'iPad';
  else if (/iPhone/.test(ua)) device = 'iPhone';
  else if (android) device = /Mobile/.test(ua) ? 'Téléphone Android' : 'Tablette Android';
  let os = '';
  if (ios) os = 'iOS ' + ios[1] + '.' + ios[2] + (ios[3] ? '.' + ios[3] : '');
  else if (device === 'iPad' && safari) os = 'iPadOS (Safari ' + safari[1] + ')';
  else if (android) os = 'Android ' + android[1];
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let browser = '';
  if (/CriOS/.test(ua)) browser = 'Chrome iOS';
  else if (/FxiOS/.test(ua)) browser = 'Firefox iOS';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (chrome) browser = 'Chrome ' + chrome[1].split('.')[0];
  else if (safari) browser = 'Safari ' + safari[1];
  return { device, os, browser, ua };
}

function fmtDate(t) {
  const d = new Date(t);
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ctx : { version, standalone, project, storage, keepAwake } — sans noms de projets ni de fichiers.
export function buildReport(description, ctx) {
  const d = deviceInfo();
  const errs = getErrors();
  const lines = [
    '### Description',
    '',
    description.trim() || '(non renseignée)',
    '',
    '### Environnement',
    '',
    '- Jinglee : ' + ctx.version,
    '- Appareil : ' + d.device + (d.os ? ' — ' + d.os : ''),
    '- Navigateur : ' + (d.browser || 'inconnu') + (ctx.standalone ? ' (application installée)' : ' (dans le navigateur)'),
    '- Écran : ' + window.innerWidth + '×' + window.innerHeight + ' px, densité ' + (window.devicePixelRatio || 1),
    '- Projet : ' + ctx.project,
    '- Anti-veille : ' + ctx.keepAwake
  ];
  if (ctx.storage) lines.push('- Stockage : ' + ctx.storage);
  if (ctx.memory) lines.push('- Sons en mémoire : ' + ctx.memory);
  lines.push('', '### Dernières erreurs', '');
  if (!errs.length) lines.push('Aucune erreur enregistrée.');
  errs.slice().reverse().forEach(e => lines.push('- `' + fmtDate(e.t) + '` ' + e.m + (e.s ? ' _(' + e.s + ')_' : '')));
  lines.push('', '<details><summary>User agent</summary>', '', d.ua, '', '</details>');
  return lines.join('\n');
}

// Adresse de création d'issue pré-remplie. GitHub refuse les adresses trop longues :
// on retire les erreurs les plus anciennes si besoin.
export function issueUrl(title, body) {
  const base = 'https://github.com/' + REPO + '/issues/new?labels=bug&title=' + encodeURIComponent(title) + '&body=';
  let b = body;
  while (encodeURIComponent(b).length > 6500) {
    const lines = b.split('\n');
    const i = lines.map(l => l.indexOf('- `') === 0).lastIndexOf(true);
    if (i < 0) { b = b.slice(0, 3000) + '\n\n(rapport tronqué)'; break; }
    lines.splice(i, 1);
    b = lines.join('\n');
  }
  return base + encodeURIComponent(b);
}

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok ? Promise.resolve() : Promise.reject(new Error('Copie impossible'));
}
