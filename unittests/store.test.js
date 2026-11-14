import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/js/store.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

test('setRevenue enregistre sans muter l’état d’origine', () => {
  const a = s.emptyState();
  const b = s.setRevenue(a, '2026-10-29', 405, 14);
  assert.deepEqual(b.revenues['2026-10-29'], { amount: 405, count: 14 });
  assert.deepEqual(a.revenues, {});
});

test('setRevenue remplace la saisie du même jour', () => {
  let st = s.setRevenue(s.emptyState(), '2026-10-29', 100);
  st = s.setRevenue(st, '2026-10-29', 250, 8);
  assert.equal(Object.keys(st.revenues).length, 1);
  assert.equal(st.revenues['2026-10-29'].amount, 250);
});

test('setRevenue accepte un CA à 0, refuse montant négatif, date invalide, compteur invalide', () => {
  const st = s.emptyState();
  assert.equal(s.setRevenue(st, '2026-10-29', 0).revenues['2026-10-29'].amount, 0);
  assert.throws(() => s.setRevenue(st, '2026-10-29', -5), s.ValidationError);
  assert.throws(() => s.setRevenue(st, '2026-02-30', 10), s.ValidationError);
  assert.throws(() => s.setRevenue(st, '2026-10-29', 10, -1), s.ValidationError);
});

test('removeRevenue supprime le jour', () => {
  const st = s.removeRevenue(s.setRevenue(s.emptyState(), '2026-10-29', 100), '2026-10-29');
  assert.deepEqual(st.revenues, {});
});

test('addExpense ajoute un frais avec identifiant et nettoie la note', () => {
  const { state, expense } = s.addExpense(s.emptyState(), { date: '2026-10-28', amount: 86, category: 'Consommables', note: '  Pharmacie  ' });
  assert.equal(state.expenses.length, 1);
  assert.equal(expense.note, 'Pharmacie');
  assert.ok(expense.id);
});

test('addExpense valide ses champs', () => {
  const st = s.emptyState();
  assert.throws(() => s.addExpense(st, { date: 'x', amount: 5, category: 'A' }), s.ValidationError);
  assert.throws(() => s.addExpense(st, { date: '2026-10-28', amount: 0, category: 'A' }), s.ValidationError);
  assert.throws(() => s.addExpense(st, { date: '2026-10-28', amount: 5, category: ' ' }), s.ValidationError);
});

test('removeExpense retire uniquement le frais ciblé', () => {
  let st = s.emptyState();
  const a = s.addExpense(st, { date: '2026-10-01', amount: 1, category: 'A' });
  const b = s.addExpense(a.state, { date: '2026-10-02', amount: 2, category: 'B' });
  st = s.removeExpense(b.state, a.expense.id);
  assert.deepEqual(st.expenses.map((e) => e.id), [b.expense.id]);
});

test('catégories : ajout, doublon (insensible à la casse), suppression', () => {
  let st = s.addCategory(s.emptyState(), 'Assurance RCP');
  assert.ok(st.categories.includes('Assurance RCP'));
  assert.throws(() => s.addCategory(st, 'assurance rcp'), s.ValidationError);
  assert.throws(() => s.addCategory(st, '  '), s.ValidationError);
  st = s.removeCategory(st, 'Assurance RCP');
  assert.ok(!st.categories.includes('Assurance RCP'));
});

test('supprimer une catégorie conserve les frais existants', () => {
  const { state } = s.addExpense(s.emptyState(), { date: '2026-10-01', amount: 10, category: 'Formation' });
  assert.equal(s.removeCategory(state, 'Formation').expenses.length, 1);
});

test('normalize écarte les données invalides', () => {
  const st = s.normalize({
    profile: { name: 5, accent: '#123456' },
    categories: ['A', 'A', ' ', 3],
    revenues: { '2026-10-01': { amount: 10 }, 'nope': { amount: 5 }, '2026-10-02': { amount: -1 } },
    expenses: [{ date: '2026-10-01', amount: 5, category: 'A' }, { date: 'bad', amount: 5, category: 'A' }],
  });
  assert.equal(st.profile.name, 'Dr [Nom]');
  assert.equal(st.profile.accent, s.ACCENTS[0].hex);
  assert.deepEqual(st.categories, ['A']);
  assert.deepEqual(Object.keys(st.revenues), ['2026-10-01']);
  assert.equal(st.expenses.length, 1);
  assert.ok(st.expenses[0].id);
});

test('normalize(null) renvoie un état vide', () => {
  assert.ok(s.isEmpty(s.normalize(null)));
});

test('save puis load restitue les données', () => {
  const storage = memoryStorage();
  const st = s.setRevenue(s.emptyState(), '2026-10-29', 405, 14);
  assert.equal(s.save(storage, st), true);
  assert.deepEqual(s.load(storage).revenues, st.revenues);
});

test('load tolère un stockage corrompu ou absent', () => {
  const bad = { getItem: () => '{pas du json', setItem() {} };
  assert.ok(s.isEmpty(s.load(bad)));
  assert.ok(s.isEmpty(s.load(null)));
});

test('save renvoie false quand le stockage refuse (quota)', () => {
  const full = { setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(s.save(full, s.emptyState()), false);
});

test('export puis import est sans perte ; un fichier étranger est refusé', () => {
  const st = s.sampleState(new Date(2026, 9, 29));
  const back = s.importJSON(s.exportJSON(st));
  assert.deepEqual(back.revenues, st.revenues);
  assert.equal(back.expenses.length, st.expenses.length);
  assert.throws(() => s.importJSON('pas du json'), s.ValidationError);
  assert.throws(() => s.importJSON('{"a":1}'), s.ValidationError);
});

test('sampleState : 3 jours par semaine, 45 semaines, 3 gardes, aucun frais, borné à aujourd’hui', () => {
  const now = new Date(2026, 11, 31);
  const a = s.sampleState(now);
  assert.deepEqual(a.revenues, s.sampleState(now).revenues);
  assert.equal(a.expenses.length, 0);
  const byWeek = {};
  for (const [d, r] of Object.entries(a.revenues)) {
    const dt = new Date(d + 'T00:00:00Z');
    const dow = (dt.getUTCDay() + 6) % 7;
    const doy = Math.round((dt - Date.UTC(2026, 0, 1)) / 86400000);
    const w = Math.floor((doy - 4) / 7); // le 1er lundi 2026 est le 5 janvier
    (byWeek[w] ??= []).push({ dow, amount: r.amount });
  }
  const weeks = Object.values(byWeek);
  const guards = weeks.filter((x) => x.some((j) => j.dow >= 5));
  assert.equal(guards.length, 3);
  const open = Object.keys(byWeek).length;
  assert.equal(open, 45);
  for (const wk of weeks) {
    const days = wk.filter((j) => j.dow < 5);
    assert.deepEqual(days.map((j) => j.dow).sort(), [0, 1, 3]);
    days.forEach((j) => assert.ok(j.amount >= 500 && j.amount <= 900, j.amount));
    const we = wk.filter((j) => j.dow >= 5).reduce((t, j) => t + j.amount, 0);
    if (we) assert.ok(we >= 300 && we <= 900, we);
  }
  const early = s.sampleState(new Date(2026, 9, 29));
  assert.ok(Object.keys(early.revenues).every((d) => d <= '2026-10-29'));
});

test('nouvelles catégories par défaut, et ajout unique aux listes existantes (avant « Autre »)', () => {
  assert.ok(['Mutuelle', 'Véhicule', 'Fonctionnement'].every((c) => s.DEFAULT_CATEGORIES.includes(c)));
  assert.equal(s.DEFAULT_CATEGORIES.at(-1), 'Autre');
  const old = { ...s.emptyState(), categories: ['Consommables', 'mutuelle', 'Autre'] };
  const next = s.withCategories(old, s.CATEGORIES_ADDED_V2);
  assert.deepEqual(next.categories, ['Consommables', 'mutuelle', 'Véhicule', 'Fonctionnement', 'Autre']);
  assert.equal(s.withCategories(next, s.CATEGORIES_ADDED_V2), next); // rien à ajouter : même objet
  assert.deepEqual(s.withCategories({ ...old, categories: ['X'] }, ['Y']).categories, ['X', 'Y']);
});
