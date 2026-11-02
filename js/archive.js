// Export / import d'un projet complet (réglages + sons) dans un fichier .jinglee (ZIP).

import { db } from './db.js';
import { makeZip, readZip } from './zip.js';
import { fileIdsOf, normalizeProject, uid, clone } from './model.js';
import { readFile } from './dom.js';

function extOf(name, type) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
  if (m) return m[1].toLowerCase();
  const t = (type || '').split('/')[1] || 'bin';
  return t.replace('mpeg', 'mp3').replace('x-', '');
}

function safeName(s) {
  return (s || 'projet').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'projet';
}

export async function exportProject(project) {
  const entries = [];
  const files = [];
  for (const id of fileIdsOf(project)) {
    const f = await db.getFile(id);
    if (!f) continue;
    const path = 'audio/' + id + '.' + extOf(f.name, f.type);
    files.push({ id, name: f.name, type: f.type, path });
    entries.push({ name: path, data: new Uint8Array(f.data) });
  }
  const manifest = { app: 'Jinglee', format: 1, exported: new Date().toISOString(), project, files };
  entries.unshift({ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  const blob = makeZip(entries);
  return { blob, filename: safeName(project.name) + '.jinglee' };
}

// Propose le fichier à l'utilisateur : partage (iOS) ou téléchargement.
export async function deliverFile(blob, filename) {
  try {
    const file = new File([blob], filename, { type: 'application/zip' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}

export async function importArchive(file, existingIds) {
  const buf = await readFile(file);
  const entries = readZip(buf);
  const json = entries.get('project.json');
  if (!json) throw new Error('Ce fichier n’est pas un projet Jinglee');
  const manifest = JSON.parse(new TextDecoder().decode(json));
  const project = normalizeProject(clone(manifest.project));

  const known = new Set(await db.fileIds());
  for (const f of manifest.files || []) {
    if (known.has(f.id)) continue;
    const data = entries.get(f.path);
    if (!data) continue;
    // Copie dans un ArrayBuffer indépendant de l'archive.
    await db.putFile({ id: f.id, name: f.name, type: f.type, data: data.slice().buffer });
  }

  if (existingIds.has(project.id)) {
    project.id = uid();
    project.name += ' (import)';
  }
  project.updated = Date.now();
  await db.putProject(project);
  return project;
}
