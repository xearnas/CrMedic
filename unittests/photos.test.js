import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotos } from '../src/js/photos.js';
import { addExpense, emptyState, pendingDocs } from '../src/js/store.js';

function setup({ docs, online = true } = {}) {
  const env = { state: addExpense(emptyState(), { date: '2026-10-02', amount: 10, category: 'Autre', docs }).state, uploads: [], deleted: [], online, changes: 0 };
  const drive = {
    uploadImage: async ({ name }) => {
      if (!env.online) throw new Error('offline');
      env.uploads.push(name);
      return `D${env.uploads.length}`;
    },
    downloadImage: async (id) => ({ id }),
    deleteFile: async (id) => { if (env.failDelete) throw new Error('x'); env.deleted.push(id); },
  };
  env.photos = createPhotos({
    drive, getState: () => env.state, setState: (s) => { env.state = s; }, canUpload: () => env.online,
    toUrl: (blob) => `blob:${blob.id}`, onChange: () => { env.changes += 1; },
  });
  return env;
}

const docs = [{ name: 'a.jpg', type: 'image/jpeg', dataUrl: 'data:A' }, { name: 'b.jpg', type: 'image/jpeg', dataUrl: 'data:B' }, { name: 'c.pdf', type: 'application/pdf' }];

test('envoi des photos en attente : identifiant Drive enregistré, image locale libérée, PDF ignoré', async () => {
  const env = setup({ docs });
  assert.equal(pendingDocs(env.state).length, 2);
  assert.equal(await env.photos.uploadPending(), 2);
  assert.deepEqual(env.uploads, ['a.jpg', 'b.jpg']);
  const d = env.state.expenses[0].docs;
  assert.deepEqual(d.map((x) => x.driveId), ['D1', 'D2', undefined]);
  assert.ok(d.every((x) => !x.dataUrl));
  assert.equal(pendingDocs(env.state).length, 0);
  assert.equal(env.changes, 1);
});

test('hors ligne : les photos restent sur l’appareil, rien n’est perdu', async () => {
  const env = setup({ docs, online: false });
  assert.equal(await env.photos.uploadPending(), 0);
  assert.equal(pendingDocs(env.state).length, 2);
  env.online = true;
  assert.equal(await env.photos.uploadPending(), 2);
});

test('affichage : image locale, cache après envoi, téléchargement pour une photo d’un autre appareil', async () => {
  const env = setup({ docs: [{ name: 'a.jpg', dataUrl: 'data:A' }, { name: 'x.jpg', driveId: 'REMOTE' }] });
  const [local, remote] = env.state.expenses[0].docs;
  assert.equal(await env.photos.urlOf(local), 'data:A');
  assert.equal(await env.photos.urlOf(remote), 'blob:REMOTE');
  await env.photos.uploadPending();
  const sent = env.state.expenses[0].docs[0];
  assert.equal(await env.photos.urlOf(sent), 'data:A'); // gardée en cache, sans retéléchargement
});

test('suppression : fichiers Drive supprimés, erreurs réseau sans conséquence', async () => {
  const env = setup({ docs: [{ name: 'x.jpg', driveId: 'R1' }, { name: 'y.jpg', dataUrl: 'data:Y' }] });
  await env.photos.removeRemote(env.state.expenses[0].docs);
  assert.deepEqual(env.deleted, ['R1']);
  env.failDelete = true;
  await assert.doesNotReject(env.photos.removeRemote([{ name: 'z', driveId: 'R2' }]));
});

test('modification pendant l’envoi : la photo envoyée est rattachée à l’état le plus récent', async () => {
  const env = setup({ docs: [{ name: 'a.jpg', dataUrl: 'data:A' }] });
  const slow = env.photos;
  const origUpload = env.state; // état au démarrage
  const p = slow.uploadPending();
  env.state = { ...env.state, profile: { ...env.state.profile, name: 'Dr Neuf' } }; // l'utilisateur modifie pendant l'envoi
  await p;
  assert.equal(env.state.profile.name, 'Dr Neuf');
  assert.equal(env.state.expenses[0].docs[0].driveId, 'D1');
  assert.notEqual(origUpload, env.state);
});
