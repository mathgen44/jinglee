'use strict';
// Application de bureau (Windows, Mac) : la même application web que sur tablette,
// dans une fenêtre Electron, avec ses fichiers embarqués (aucune connexion nécessaire).
const { app, BrowserWindow, protocol, net, ipcMain, shell, powerSaveBlocker, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const updates = require('./updates');

const ROOT = path.join(__dirname, '..');
const isMac = process.platform === 'darwin';
// Test automatique : npm run selftest (vérifie le démarrage, enregistre une capture et quitte).
const SELFTEST = process.argv.includes('--selftest');

// Adresse fixe app://jinglee/ : les projets et les sons sont stockés (IndexedDB) pour cette origine,
// dans le dossier de données de l'application. Elle doit donc rester la même d'une version à l'autre.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Une seule instance : deux Jinglee ouverts se disputeraient le même stockage.
if (!SELFTEST && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let allowClose = false;
let pendingOpen = findProjectArg(process.argv);

process.on('uncaughtException', (err) => logError(err));
process.on('unhandledRejection', (err) => logError(err));

function logError(err) {
  try {
    const line = `[${new Date().toISOString()}] ${err && err.stack ? err.stack : String(err)}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'jinglee.log'), line);
  } catch { /* rien à faire */ }
  console.error(err);
}

function findProjectArg(argv) {
  return argv.find((a) => /\.(jinglee|zip)$/i.test(a) && fs.existsSync(a)) || null;
}

// Sert les fichiers de l'application, sans jamais sortir de son dossier.
function handleAppProtocol() {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Interdit', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// Mémoire réservée aux sons décodés : un quart de la mémoire de l'ordinateur, entre 350 Mo et 2 Go.
function memoryBudget() {
  return Math.round(Math.min(2e9, Math.max(350e6, os.totalmem() / 4)));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#111317',
    title: 'Jinglee',
    icon: path.join(ROOT, 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required',
      // Le son ne doit pas ralentir quand la fenêtre passe derrière une autre.
      backgroundThrottling: false,
    },
  });
  win.loadURL('app://jinglee/index.html');
  if (SELFTEST) win.webContents.once('did-finish-load', () => runSelftest());

  // Liens externes (rapport de problème, page de téléchargement) : ouverts dans le navigateur,
  // et seulement vers le projet sur GitHub.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (updates.isAllowedUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://jinglee/')) e.preventDefault();
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    logError(new Error(`Fenêtre arrêtée (${details.reason})`));
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) win.reload();
  });

  // Fermer pendant un spectacle : on demande d'abord à la page (sons en cours, enregistrement).
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('close-requested');
  });
  win.on('closed', () => { win = null; });
}

function openPending() {
  if (!pendingOpen || !win) return;
  const file = pendingOpen;
  pendingOpen = null;
  fs.promises.readFile(file).then(
    (buf) => win.webContents.send('open-project', {
      name: path.basename(file),
      data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    }),
    (err) => logError(err)
  );
}

ipcMain.on('desktop-info', (e) => {
  e.returnValue = { version: app.getVersion(), platform: process.platform, memoryBudget: memoryBudget() };
});
ipcMain.on('renderer-ready', () => openPending());
ipcMain.on('confirm-close', () => {
  allowClose = true;
  if (win) win.close();
});
ipcMain.handle('check-updates', () => updates.check());
ipcMain.handle('open-external', (_e, url) => {
  if (updates.isAllowedUrl(url)) shell.openExternal(url);
});
ipcMain.on('toggle-fullscreen', () => {
  if (win) win.setFullScreen(!win.isFullScreen());
});

async function runSelftest() {
  const out = path.join(process.cwd(), 'selftest-out');
  let result;
  try {
    await new Promise((r) => setTimeout(r, 3000));
    result = await win.webContents.executeJavaScript(`({
      desktop: !!window.jingleeDesktop,
      version: window.jingleeDesktop && window.jingleeDesktop.version,
      memoryBudget: window.jingleeDesktop && window.jingleeDesktop.memoryBudget,
      title: document.title,
      pads: document.querySelectorAll('.pad').length,
      share: typeof navigator.share,
      errors: JSON.parse(localStorage.getItem('jinglee.errors') || '[]')
    })`);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'capture.png'), (await win.webContents.capturePage()).toPNG());
  } catch (err) {
    result = { error: err.message };
  }
  console.log('SELFTEST ' + JSON.stringify(result));
  app.exit(result.error || !result.desktop ? 1 : 0);
}

// Ouverture d'un fichier .jinglee : double-clic sous Windows (deuxième instance) ou sur Mac.
app.on('second-instance', (_e, argv) => {
  const file = findProjectArg(argv);
  if (file) { pendingOpen = file; openPending(); }
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('open-file', (e, file) => {
  e.preventDefault();
  pendingOpen = file;
  openPending();
});

function buildMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  // Sur Mac, un menu est nécessaire pour copier / coller et quitter au clavier.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Présentation', submenu: [{ role: 'togglefullscreen', label: 'Plein écran' }] },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  handleAppProtocol();
  buildMenu();
  // Pas de mise en veille de l'écran tant que Jinglee est ouvert.
  powerSaveBlocker.start('prevent-display-sleep');
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
}).catch((err) => {
  logError(err);
  dialog.showErrorBox('Jinglee', 'Démarrage impossible : ' + err.message);
});

app.on('window-all-closed', () => app.quit());
