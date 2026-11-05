import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync, mergeLocalEdits, resumeAction } from '../src/js/sync.js';
import { DriveError, emptyTables } from '../src/js/drive.js';
import { stateToTables } from '../src/js/sheetmodel.js';
import { addExpense, emptyState, sampleState, setRevenue, updateProfile } from '../src/js/store.js';

const NOW = new Date(2026, 9, 29, 10, 0, 0);

function setup({ local = emptyState(), remote = null, saved = null, askAnswer = 'cancel' } = {}) {
  const env = { state: local, tables: remote ? stateToTables(remote, new Date(2026, 9, 1)) : emptyTables(), saved, saves: 0, signIns: [], statuses: [], timers: [] };
  const drive = {
    getOrCreate: async () => ({ id: 'book1', created: false }),
    readTables: async () => { env.onRead?.(); return env.tables; },
    saveState: async (id, state, now) => {
      if (env.failSave) throw env.failSave;
      env.saves += 1;
      env.tables = stateToTables(state, now);
      return env.tables['_meta'].find((r) => r[0] === 'maj')[1];
    },
  };
  const auth = {
    signIn: async (o) => { env.signIns.push(o); if (env.failSignIn) throw Object.assign(new Error('Session Google expirée'), { name: 'AuthError' }); },
    fetchEmail: async () => 'dr@exemple.fr',
    signOut: () => { env.signedOut = true; },
  };
  const persist = { read: () => env.saved, write: (v) => { env.saved = v; } };
  env.sync = createSync({
    drive, auth, persist, now: () => NOW,
    getState: () => env.state,
    setState: (s) => { env.state = s; },
    askConflict: async () => askAnswer,
    onStatus: (s) => env.statuses.push(s.phase),
    schedule: (fn) => { env.timers.push(fn); return env.timers.length; },
    cancel: (id) => { env.timers[id - 1] = null; },
  });
  return env;
}

test('resumeAction décide du sens au démarrage', () => {
  assert.equal(resumeAction({ dirty: false, remoteMaj: 'a', lastMaj: 'a' }), 'none');
  assert.equal(resumeAction({ dirty: true, remoteMaj: 'a', lastMaj: 'a' }), 'push');
  assert.equal(resumeAction({ dirty: false, remoteMaj: 'b', lastMaj: 'a' }), 'pull');
  assert.equal(resumeAction({ dirty: true, remoteMaj: 'b', lastMaj: 'a' }), 'ask');
});

test('connexion : appareil rempli et classeur vide -> envoi vers le Drive', async () => {
  const env = setup({ local: sampleState(NOW) });
  await env.sync.connect();
  assert.equal(env.saves, 1);
  assert.equal(env.sync.getStatus().phase, 'synced');
  assert.equal(env.saved.fileId, 'book1');
  assert.equal(env.saved.email, 'dr@exemple.fr');
  assert.equal(env.saved.dirty, false);
});

test('connexion : appareil vide et classeur rempli -> chargement du Drive', async () => {
  const remote = sampleState(NOW);
  const env = setup({ remote });
  await env.sync.connect();
  assert.equal(env.saves, 0);
  assert.deepEqual(env.state.revenues, remote.revenues);
});

test('connexion : deux jeux de données -> l’utilisateur tranche', async () => {
  const local = setRevenue(emptyState(), '2026-10-01', 111, 3);
  const remote = sampleState(NOW);
  let env = setup({ local, remote, askAnswer: 'pull' });
  await env.sync.connect();
  assert.deepEqual(env.state.revenues, remote.revenues);

  env = setup({ local, remote, askAnswer: 'push' });
  await env.sync.connect();
  assert.equal(env.saves, 1);
  assert.deepEqual(env.state.revenues, local.revenues);

  env = setup({ local, remote, askAnswer: 'cancel' });
  await env.sync.connect();
  assert.equal(env.saves, 0);
  assert.equal(env.saved, null);
  assert.equal(env.sync.getStatus().phase, 'off');
  assert.deepEqual(env.state.revenues, local.revenues);
});

test('pushSoon regroupe les modifications en un seul envoi', async () => {
  const env = setup({ local: sampleState(NOW) });
  await env.sync.connect();
  const before = env.saves;
  env.state = setRevenue(env.state, '2026-10-30', 400, 12);
  env.sync.pushSoon();
  env.sync.pushSoon();
  env.sync.pushSoon();
  assert.equal(env.sync.getStatus().phase, 'pending');
  assert.equal(env.saved.dirty, true);
  assert.equal(env.timers.filter(Boolean).length, 1, 'un seul envoi planifié');
  await Promise.all(env.timers.filter(Boolean).map((fn) => fn()));
  assert.equal(env.saves, before + 1);
  assert.equal(env.sync.getStatus().phase, 'synced');
  assert.equal(env.saved.dirty, false);
});

test('pushSoon ne fait rien quand on n’est pas connecté', () => {
  const env = setup();
  env.sync.pushSoon();
  assert.equal(env.timers.length, 0);
  assert.equal(env.saved, null);
});

test('hors ligne : la modification reste en attente et sera renvoyée', async () => {
  const env = setup({ local: sampleState(NOW) });
  await env.sync.connect();
  env.failSave = new DriveError('Réseau indisponible.', 0);
  env.sync.pushSoon();
  await env.sync.flush();
  assert.equal(env.sync.getStatus().phase, 'offline');
  assert.equal(env.saved.dirty, true);
  env.failSave = null;
  await env.sync.flush();
  assert.equal(env.sync.getStatus().phase, 'synced');
  assert.equal(env.saved.dirty, false);
});

test('reprise : classeur modifié ailleurs -> rechargé ; inchangé -> rien', async () => {
  const remote = sampleState(NOW);
  const env = setup({ local: emptyState(), remote, saved: { email: 'x', fileId: 'book1', lastMaj: 'ancienne', dirty: false }, askAnswer: 'pull' });
  await env.sync.resume();
  assert.deepEqual(env.state.revenues, remote.revenues);
  assert.deepEqual(env.signIns, [{ silent: true }]);

  const maj = env.saved.lastMaj;
  env.state = setRevenue(env.state, '2026-10-30', 1, null);
  await env.sync.resume();
  assert.equal(env.saved.lastMaj, maj);
  assert.ok(env.state.revenues['2026-10-30'], 'rien n’est écrasé quand le classeur n’a pas changé');
});

test('reprise : modifications locales non envoyées -> envoyées', async () => {
  const env = setup({ local: sampleState(NOW), remote: sampleState(NOW) });
  const maj = env.tables['_meta'].find((r) => r[0] === 'maj')[1];
  env.saved = { email: 'x', fileId: 'book1', lastMaj: maj, dirty: true };
  await env.sync.resume();
  assert.equal(env.saves, 1);
  assert.equal(env.saved.dirty, false);
});

test('reprise : session Google expirée -> phase « login », données locales intactes', async () => {
  const local = sampleState(NOW);
  const env = setup({ local, saved: { email: 'x', fileId: 'book1', lastMaj: '', dirty: false } });
  env.failSignIn = true;
  await env.sync.resume();
  assert.equal(env.sync.getStatus().phase, 'login');
  assert.equal(env.state, local);
});

test('reprise : classeur renommé ou supprimé -> recréé vide puis alimenté depuis l’appareil', async () => {
  const local = sampleState(NOW);
  const env = setup({ local, saved: { email: 'x', fileId: 'ancien-id', lastMaj: 'x', dirty: false } });
  await env.sync.resume();
  assert.equal(env.saves, 1);
  assert.equal(env.saved.fileId, 'book1');
  assert.deepEqual(env.state.revenues, local.revenues);
});

test('en-têtes modifiés dans le classeur -> erreur explicite, données locales intactes', async () => {
  const local = setRevenue(emptyState(), '2026-10-01', 100, 2);
  const env = setup({ local });
  env.tables['CA'][0] = ['Jour', 'Somme', 'Nb'];
  env.tables['CA'].push(['2026-10-02', 10, 1]);
  await env.sync.connect();
  assert.equal(env.sync.getStatus().phase, 'error');
  assert.match(env.sync.getStatus().message, /CA/);
  assert.equal(env.state, local);
});

test('déconnexion : le jeton est révoqué, les données locales restent', async () => {
  const env = setup({ local: sampleState(NOW) });
  await env.sync.connect();
  const keep = env.state;
  await env.sync.disconnect();
  assert.equal(env.saved, null);
  assert.ok(env.signedOut);
  assert.equal(env.state, keep);
  assert.equal(env.sync.getStatus().phase, 'off');
});

test('profil modifié pendant la connexion : la lecture du Drive ne l’écrase pas', async () => {
  const remote = updateProfile(setRevenue(emptyState(), '2026-10-01', 100, 2), { name: 'Dr Ancien', accent: '#0B6E8A' });
  const env = setup({ local: emptyState(), remote });
  env.onRead = () => { env.state = updateProfile(env.state, { name: 'Dr Nouveau', accent: '#4B5BB5' }); };
  await env.sync.connect();
  assert.equal(env.state.profile.name, 'Dr Nouveau');
  assert.equal(env.state.profile.accent, '#4B5BB5');
  assert.equal(env.state.revenues['2026-10-01'].amount, 100); // données du Drive conservées
  assert.equal(env.saved.dirty, true); // l'édition part vers le Drive
  assert.equal(env.timers.length, 1);
});

test('reprise : modification faite pendant l’attente -> envoyée, pas écrasée', async () => {
  const base = updateProfile(setRevenue(emptyState(), '2026-10-01', 100, 2), { name: 'Dr A' });
  const env = setup({ local: base, remote: updateProfile(base, { name: 'Dr A', cabinet: 'Distant' }), saved: { email: 'x', fileId: 'book1', lastMaj: 'ancienne', dirty: false }, askAnswer: 'pull' });
  env.onRead = () => { env.state = updateProfile(env.state, { name: 'Dr B' }); env.saved = { ...env.saved, dirty: true }; };
  await env.sync.resume();
  assert.equal(env.state.profile.name, 'Dr B');
  assert.equal(env.state.profile.cabinet, 'Distant');
});

test('mergeLocalEdits : ajouts, modifications et suppressions locaux par-dessus le Drive', () => {
  let base = setRevenue(setRevenue(emptyState(), '2026-10-01', 100, 1), '2026-10-02', 200, 2);
  const local = setRevenue(base, '2026-10-03', 300, 3);
  delete local.revenues['2026-10-01'];
  const remote = setRevenue(base, '2026-10-09', 900, 9);
  const merged = mergeLocalEdits(base, local, remote);
  assert.deepEqual(Object.keys(merged.revenues).sort(), ['2026-10-02', '2026-10-03', '2026-10-09']);
});

test('reconnexion par clic : fenêtre Google (non silencieuse), session et données conservées', async () => {
  const local = setRevenue(emptyState(), '2026-10-01', 100, 2);
  const env = setup({ local, saved: { email: 'x', fileId: 'book1', lastMaj: '', dirty: true } });
  env.tables = stateToTables(local, new Date(2026, 9, 1));
  await env.sync.resume({ silent: false });
  assert.deepEqual(env.signIns, [{ silent: false }]);
  assert.equal(env.sync.getStatus().phase, 'synced');
  assert.equal(env.state.revenues['2026-10-01'].amount, 100);
});

test('refresh : un frais ajouté depuis un autre appareil apparaît sans recharger la page', async () => {
  const local = setRevenue(emptyState(), '2026-10-01', 100, 2);
  const env = setup({ local, saved: { email: 'x', fileId: 'book1', lastMaj: '2026-10-01T00:00:00.000Z', dirty: false } });
  env.sync.getStatus().phase; // 'off' : rien à faire
  await env.sync.refresh();
  assert.equal(env.state, local);
  await env.sync.connect(); // session active, phase « synced »
  const lastMaj = env.saved.lastMaj;
  const other = addExpense(env.state, { date: '2026-10-05', amount: 42.5, category: 'Loyer', note: 'tel' }).state;
  env.tables = stateToTables(other, new Date(2026, 9, 6)); // l'autre appareil a écrit
  await env.sync.refresh();
  assert.equal(env.state.expenses.length, 1);
  assert.equal(env.state.expenses[0].amount, 42.5);
  assert.notEqual(env.saved.lastMaj, lastMaj);
});

test('refresh : sans changement distant, rien n’est remplacé ; envoi en attente : pas de lecture', async () => {
  const env = setup({ local: setRevenue(emptyState(), '2026-10-01', 100, 2) });
  await env.sync.connect();
  const keep = env.state;
  await env.sync.refresh();
  assert.equal(env.state, keep);
  env.sync.pushSoon(); // modification locale en attente
  let reads = 0;
  env.onRead = () => { reads += 1; };
  await env.sync.refresh();
  assert.equal(reads, 0);
});

test('syncNow : relit le classeur avant d’envoyer (ne masque pas ce qu’un autre appareil a écrit)', async () => {
  const env = setup({ local: setRevenue(emptyState(), '2026-10-01', 100, 2) });
  await env.sync.connect();
  const other = addExpense(env.state, { date: '2026-10-05', amount: 42.5, category: 'Loyer' }).state;
  env.tables = stateToTables(other, new Date(2026, 9, 6));
  await env.sync.syncNow();
  assert.equal(env.state.expenses.length, 1);
  assert.equal(env.tables['Frais'].length, 2); // le frais distant est toujours dans le classeur
});
