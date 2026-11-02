// Stockage local (IndexedDB) : projets et fichiers audio.
// Les fichiers sont stockés en ArrayBuffer, plus fiable que Blob sur les vieux Safari.

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('jinglee', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
  }));
}

export const db = {
  listProjects: () => run('projects', 'readonly', s => s.getAll()),
  getProject: id => run('projects', 'readonly', s => s.get(id)),
  putProject: p => run('projects', 'readwrite', s => s.put(p)),
  deleteProject: id => run('projects', 'readwrite', s => s.delete(id)),

  // fichier : { id, name, type, data: ArrayBuffer }
  getFile: id => run('files', 'readonly', s => s.get(id)),
  putFile: f => run('files', 'readwrite', s => s.put(f)),
  deleteFile: id => run('files', 'readwrite', s => s.delete(id)),
  fileIds: () => run('files', 'readonly', s => s.getAllKeys())
};

// Demande au navigateur de ne pas purger les données (si possible).
export function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return navigator.storage.persist();
  } catch (e) { /* non supporté */ }
  return Promise.resolve(false);
}

export function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate();
  } catch (e) { /* non supporté */ }
  return Promise.resolve(null);
}
