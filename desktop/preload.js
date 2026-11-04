'use strict';
// Passerelle entre la page (application web) et l'application de bureau.
// La page détecte le bureau grâce à window.jingleeDesktop.
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('desktop-info');

contextBridge.exposeInMainWorld('jingleeDesktop', {
  version: info.version,
  platform: info.platform,
  memoryBudget: info.memoryBudget,
  ready: () => ipcRenderer.send('renderer-ready'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  // fn({ name, data }) : fichier .jinglee ouvert par double-clic.
  onOpenProject: (fn) => ipcRenderer.on('open-project', (_e, file) => fn(file)),
  // fn() : la fenêtre va se fermer ; appeler confirmClose() pour la fermer vraiment.
  onCloseRequested: (fn) => ipcRenderer.on('close-requested', () => fn()),
  confirmClose: () => ipcRenderer.send('confirm-close'),
});
