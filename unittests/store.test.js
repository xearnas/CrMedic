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

test('setRevenue refuse montant nul, date invalide, compteur invalide', () => {
  const st = s.emptyState();
  assert.throws(() => s.setRevenue(st, '2026-10-29', 0), s.ValidationError);
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

test('sampleState est déterministe, borné à aujourd’hui et sans week-end', () => {
  const now = new Date(2026, 9, 29);
  const a = s.sampleState(now);
  const b = s.sampleState(now);
  assert.deepEqual(a.revenues, b.revenues);
  assert.ok(Object.keys(a.revenues).length > 100);
  assert.ok(Object.keys(a.revenues).every((d) => d <= '2026-10-29'));
  assert.ok(a.expenses.every((e) => e.date <= '2026-10-29'));
  for (const d of Object.keys(a.revenues)) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    assert.ok(dow !== 0 && dow !== 6, d);
  }
});
