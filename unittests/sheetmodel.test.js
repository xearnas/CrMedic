import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addExpense, emptyState, sampleState, setRevenue, updateProfile } from '../src/js/store.js';
import {
  FILE_NAME, HEADERS, SheetFormatError, TABS, planSync, stateToTables, tablesAreEmpty, tablesToState,
} from '../src/js/sheetmodel.js';

const NOW = new Date(2026, 9, 29);

test('le nom du fichier est fixe', () => {
  assert.equal(FILE_NAME, 'CrMedic - Données');
});

test('un état vide donne des onglets avec seulement leurs en-têtes', () => {
  const t = stateToTables(emptyState(), NOW);
  assert.deepEqual(t[TABS.ca], [HEADERS[TABS.ca]]);
  assert.deepEqual(t[TABS.frais], [HEADERS[TABS.frais]]);
  assert.ok(tablesAreEmpty(t));
});

test('aller-retour état -> tables -> état (données d’exemple)', () => {
  const state = sampleState(NOW);
  const { state: back, ignored } = tablesToState(stateToTables(state, NOW), state);
  assert.equal(ignored, 0);
  assert.deepEqual(back.revenues, state.revenues);
  assert.deepEqual(back.categories, state.categories);
  assert.deepEqual(
    [...back.expenses].sort((a, b) => (a.id < b.id ? -1 : 1)).map(({ id, date, amount, category, note }) => ({ id, date, amount, category, note })),
    [...state.expenses].sort((a, b) => (a.id < b.id ? -1 : 1)).map(({ id, date, amount, category, note }) => ({ id, date, amount, category, note })),
  );
  assert.equal(back.profile.name, state.profile.name);
});

test('la photo de profil et les images en attente restent locales ; les photos du Drive sont dans le classeur', () => {
  let s = updateProfile(emptyState(), { photo: 'data:image/jpeg;base64,AAAA' });
  s = addExpense(s, { date: '2026-10-02', amount: 12.5, category: 'Autres frais divers de gestion', docs: [
    { id: 'p1', name: 'ticket.jpg', size: 10, type: 'image/jpeg', dataUrl: 'data:x' },
    { id: 'p2', name: 'facture.jpg', size: 20, type: 'image/jpeg', driveId: 'DRV2' },
  ] }).state;
  const tables = stateToTables(s, NOW);
  assert.ok(!JSON.stringify(tables).includes('data:'), 'aucune donnée image dans le classeur');
  assert.equal(tables[TABS.frais][1][5], 'ticket.jpg ; facture.jpg');
  assert.deepEqual(tables[TABS.docs].slice(1), [[s.expenses[0].id, 'DRV2', 'facture.jpg', 'image/jpeg']]);
  const { state: back } = tablesToState(tables, s);
  assert.equal(back.profile.photo, s.profile.photo);
  assert.equal(back.expenses[0].docs.find((d) => !d.driveId).dataUrl, 'data:x'); // en attente : conservée
  assert.equal(back.expenses[0].docs.find((d) => d.driveId).driveId, 'DRV2');
  const { state: other } = tablesToState(tables, null); // autre appareil : ne voit que ce qui est dans le Drive
  assert.deepEqual(other.expenses[0].docs.map((d) => d.driveId), ['DRV2']);
});

test('une photo supprimée depuis un autre appareil disparaît ici aussi', () => {
  let s = addExpense(emptyState(), { date: '2026-10-02', amount: 12.5, category: 'Autres frais divers de gestion', docs: [{ name: 'a.jpg', driveId: 'D1' }] }).state;
  const tables = stateToTables(s, NOW);
  tables[TABS.docs] = [HEADERS[TABS.docs]];
  assert.deepEqual(tablesToState(tables, s).state.expenses[0].docs, []);
});

test('sans justificatif et récurrence font l’aller-retour', () => {
  let s = addExpense(emptyState(), { date: '2026-10-02', amount: 300, category: 'Autres frais divers de gestion', note: 'Crédit voiture', noDoc: true, recur: { every: 'month', end: '2027-10-02' } }).state;
  s = addExpense(s, { date: '2026-10-03', amount: 20, category: 'Autres frais divers de gestion', recur: { every: 'week', end: '' } }).state;
  const tables = stateToTables(s, NOW);
  assert.deepEqual(tables[TABS.frais][1].slice(6), ['oui', 'mois', '2027-10-02']);
  assert.deepEqual(tables[TABS.frais][2].slice(6), ['', 'semaine', '']);
  const { state: back } = tablesToState(tables, null);
  const byDate = Object.fromEntries(back.expenses.map((e) => [e.date, e]));
  assert.equal(byDate['2026-10-02'].noDoc, true);
  assert.deepEqual(byDate['2026-10-02'].recur, { every: 'month', end: '2027-10-02' });
  assert.deepEqual(byDate['2026-10-03'].recur, { every: 'week', end: '' });
});

test('un classeur créé avant ces colonnes (en-tête de 6 colonnes) reste lisible', () => {
  const t = stateToTables(addExpense(emptyState(), { date: '2026-10-02', amount: 12.5, category: 'Autres frais divers de gestion' }).state, NOW);
  t[TABS.frais] = t[TABS.frais].map((r) => r.slice(0, 6));
  delete t[TABS.docs];
  const { state, ignored } = tablesToState(t, null);
  assert.equal(ignored, 0);
  assert.equal(state.expenses.length, 1);
  assert.equal(state.expenses[0].recur, null);
});

test('des en-têtes modifiés lèvent une erreur explicite', () => {
  const t = stateToTables(setRevenue(emptyState(), '2026-10-01', 300, 10), NOW);
  t[TABS.ca][0] = ['Jour', 'Montant (€)', 'Consultations'];
  assert.throws(() => tablesToState(t), (e) => e instanceof SheetFormatError && /CA/.test(e.message));
});

test('un onglet absent ou vide est toléré', () => {
  const { state } = tablesToState({}, null);
  assert.deepEqual(state.revenues, {});
  assert.deepEqual(state.expenses, []);
});

test('les lignes invalides sont ignorées et comptées', () => {
  const t = stateToTables(emptyState(), NOW);
  t[TABS.ca].push(['2026-10-01', 400, 12], ['pas une date', 10, ''], ['2026-10-02', -5, ''], ['2026-10-03', '1 234,50', '']);
  t[TABS.frais].push(['x1', '2026-10-04', 20, '', 'sans catégorie', ''], ['x2', '2026-10-05', 30, 'Autre', 'ok', '']);
  const { state, ignored } = tablesToState(t, null);
  assert.equal(ignored, 3);
  assert.deepEqual(Object.keys(state.revenues), ['2026-10-01', '2026-10-03']);
  assert.equal(state.revenues['2026-10-03'].amount, 1234.5);
  assert.equal(state.expenses.length, 1);
});

test('les dates Sheets (numéros de série) sont comprises', () => {
  const t = stateToTables(emptyState(), NOW);
  t[TABS.ca].push([46327, 250, '']); // 2026-11-01
  const { state } = tablesToState(t, null);
  assert.ok(state.revenues['2026-11-01']);
});

test('planSync choisit le sens de la synchronisation', () => {
  assert.equal(planSync({ localEmpty: true, remoteEmpty: true }), 'none');
  assert.equal(planSync({ localEmpty: false, remoteEmpty: true }), 'push');
  assert.equal(planSync({ localEmpty: true, remoteEmpty: false }), 'pull');
  assert.equal(planSync({ localEmpty: false, remoteEmpty: false }), 'ask');
  assert.equal(planSync({ localEmpty: false, remoteEmpty: false, same: true }), 'pull');
});
