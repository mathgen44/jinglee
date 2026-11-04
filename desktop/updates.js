'use strict';
// Recherche d'une nouvelle version parmi les publications GitHub du projet.
// Rien n'est installé automatiquement : on propose seulement le téléchargement,
// pour ne jamais modifier l'application pendant un spectacle.
const { app, net } = require('electron');

// Même dépôt que « build.publish » dans package.json. Ne pas le relire de package.json :
// electron-builder retire la section « build » du fichier embarqué dans l'application.
const owner = 'mathgen44';
const repo = 'jinglee';
const API = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
const PAGE_PREFIX = `https://github.com/${owner}/${repo}/`;

function parse(v) {
  return String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
}

function isNewer(latest, current) {
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// L'édition « macOS ancien » (10.13 à 11) est construite avec Electron 26, la dernière version
// compatible avec High Sierra ; elle doit proposer sa propre image disque.
const LEGACY = parseInt(process.versions.electron, 10) < 27;

// Fichier adapté à cet ordinateur : installateur, version portable ou image disque Mac.
function pickAsset(assets) {
  const names = assets.map((a) => ({ a, n: a.name.toLowerCase() }));
  let match;
  if (process.platform === 'darwin') match = names.find(({ n }) => n.endsWith('.dmg') && n.includes('ancien') === LEGACY);
  else if (process.env.PORTABLE_EXECUTABLE_FILE) match = names.find(({ n }) => n.includes('portable') && n.endsWith('.exe'));
  else match = names.find(({ n }) => n.includes('installation') && n.endsWith('.exe'));
  return match ? match.a : null;
}

async function check() {
  const current = app.getVersion();
  try {
    const res = await net.fetch(API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Jinglee/${current}` },
    });
    if (res.status === 404) return { status: 'none', current };
    if (!res.ok) return { status: 'error', current, message: `HTTP ${res.status}` };
    const rel = await res.json();
    if (!isNewer(rel.tag_name, current)) return { status: 'uptodate', current };
    const asset = pickAsset(rel.assets || []);
    return {
      status: 'available',
      current,
      version: String(rel.tag_name).replace(/^v/, ''),
      url: asset ? asset.browser_download_url : rel.html_url,
      page: rel.html_url,
    };
  } catch (err) {
    return { status: 'error', current, message: err.message };
  }
}

// N'ouvre dans le navigateur que des adresses du projet sur GitHub.
function isAllowedUrl(url) {
  return typeof url === 'string' && url.startsWith(PAGE_PREFIX);
}

module.exports = { check, isAllowedUrl, isNewer, LEGACY };
