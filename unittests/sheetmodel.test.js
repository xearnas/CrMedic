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

test('la photo de profil et les images de justificatifs restent locales', () => {
  let s = updateProfile(emptyState(), { photo: 'data:image/jpeg;base64,AAAA' });
  const withDoc = addExpense(s, { date: '2026-10-02', amount: 12.5, category: 'Autre', doc: { name: 'ticket.jpg', size: 10, type: 'image/jpeg', dataUrl: 'data:x' } });
  s = withDoc.state;
  const tables = stateToTables(s, NOW);
  assert.ok(!JSON.stringify(tables).includes('data:'), 'aucune donnée image dans le classeur');
  assert.equal(tables[TABS.frais][1][5], 'ticket.jpg');
  const { state: back } = tablesToState(tables, s);
  assert.equal(back.profile.photo, s.profile.photo);
  assert.equal(back.expenses[0].doc.dataUrl, 'data:x');
  const { state: fromScratch } = tablesToState(tables, null);
  assert.deepEqual(fromScratch.expenses[0].doc, { name: 'ticket.jpg' });
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
