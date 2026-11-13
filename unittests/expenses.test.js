import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, addExpense, emptyState, expandExpenses, normalize, occurrences, updateExpense } from '../src/js/store.js';
import { categoryTotals, periodStats } from '../src/js/stats.js';
import { buildReport, resolvePeriod } from '../src/js/report.js';

const base = { amount: 300, category: 'Autre' };
const withRecur = (date, every, end = '') => addExpense(emptyState(), { ...base, date, recur: { every, end } }).expense;

test('ancien format : un champ doc devient une liste docs, sans justificatif par défaut', () => {
  const s = normalize({ expenses: [{ id: 'a', date: '2026-01-05', amount: 10, category: 'X', doc: { name: 't.jpg', dataUrl: 'data:x' } }, { id: 'b', date: '2026-01-06', amount: 5, category: 'X' }] });
  assert.equal(s.expenses[0].docs.length, 1);
  assert.equal(s.expenses[0].docs[0].name, 't.jpg');
  assert.ok(s.expenses[0].docs[0].id);
  assert.deepEqual(s.expenses[1].docs, []);
  assert.equal(s.expenses[1].noDoc, false);
  assert.equal(s.expenses[1].recur, null);
});

test('« sans justificatif » est exclusif des photos', () => {
  const { expense } = addExpense(emptyState(), { ...base, date: '2026-01-05', noDoc: true, docs: [{ name: 'a.jpg' }] });
  assert.equal(expense.noDoc, false);
  assert.equal(expense.docs.length, 1);
  const { expense: e2 } = addExpense(emptyState(), { ...base, date: '2026-01-05', noDoc: true });
  assert.equal(e2.noDoc, true);
});

test('récurrence mensuelle : une échéance par mois jusqu’à la date de fin incluse', () => {
  const e = withRecur('2026-01-15', 'month', '2026-04-15');
  assert.deepEqual(occurrences(e, '2026-12-31'), ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
});

test('récurrence : jamais d’échéance future, même sans date de fin', () => {
  const e = withRecur('2026-01-15', 'month');
  assert.deepEqual(occurrences(e, '2026-03-14'), ['2026-01-15', '2026-02-15']);
  assert.deepEqual(occurrences(e, '2026-03-15'), ['2026-01-15', '2026-02-15', '2026-03-15']);
});

test('récurrence hebdomadaire et annuelle', () => {
  assert.deepEqual(occurrences(withRecur('2026-01-30', 'week'), '2026-02-20'), ['2026-01-30', '2026-02-06', '2026-02-13', '2026-02-20']);
  assert.deepEqual(occurrences(withRecur('2024-02-29', 'year'), '2026-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28']);
});

test('récurrence mensuelle le 31 : ramenée à la fin des mois courts, puis retour au 31', () => {
  assert.deepEqual(occurrences(withRecur('2026-01-31', 'month'), '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('un frais ponctuel reste une seule ligne, même daté dans le futur', () => {
  const { expense } = addExpense(emptyState(), { ...base, date: '2099-01-01' });
  assert.deepEqual(occurrences(expense, '2026-01-01'), ['2099-01-01']);
});

test('les échéances comptent dans les totaux, par période et par catégorie', () => {
  const { state } = addExpense(emptyState(), { ...base, date: '2026-01-15', recur: { every: 'month', end: '2026-03-31' } });
  assert.equal(expandExpenses(state, '2026-12-31').length, 3);
  assert.equal(periodStats(state, { from: '2026-02-01', to: '2026-02-28' }).frais, 300);
  assert.equal(periodStats(state, { from: '2026-01-01', to: '2026-12-31' }).frais, 900);
  assert.deepEqual(categoryTotals(state, { from: '2026-01-01', to: '2026-12-31' }), [{ name: 'Autre', total: 900 }]);
});

test('validation : fréquence, dates de fin', () => {
  const add = (recur) => addExpense(emptyState(), { ...base, date: '2026-05-10', recur });
  assert.throws(() => add({ every: 'jour', end: '' }), ValidationError);
  assert.throws(() => add({ every: 'month', end: '2026-05-09' }), /postérieure/);
  assert.throws(() => add({ every: 'month', end: '31/12/2026' }), /invalide/);
  assert.doesNotThrow(() => add({ every: 'month', end: '' }));
});

test('modifier un frais : champs remplacés, photos conservées, validation rejouée', () => {
  let { state, expense } = addExpense(emptyState(), { ...base, date: '2026-05-10', docs: [{ name: 'a.jpg', driveId: 'D1' }] });
  ({ state } = updateExpense(state, expense.id, { amount: 99.5, note: 'maj', recur: { every: 'year', end: '' } }));
  const e = state.expenses[0];
  assert.equal(e.amount, 99.5);
  assert.equal(e.note, 'maj');
  assert.equal(e.docs[0].driveId, 'D1');
  assert.equal(e.recur.every, 'year');
  assert.throws(() => updateExpense(state, expense.id, { amount: 0 }), ValidationError);
  assert.throws(() => updateExpense(state, 'inconnu', { amount: 1 }), /introuvable/);
});

test('l’export Excel contient les échéances et la mention de récurrence', () => {
  const { state } = addExpense(emptyState(), { ...base, date: '2026-01-15', note: 'Crédit voiture', recur: { every: 'month', end: '2026-03-31' }, noDoc: true });
  const report = buildReport(state, resolvePeriod(2026, 'annee'));
  const frais = report.sheets.find((s) => s.name === 'Frais');
  const data = frais.rows.filter((r) => r[0] && r[0].fmt === 'date');
  assert.equal(data.length, 3);
  assert.equal(data[0][2].v, 'Crédit voiture (mensuel)');
  assert.equal(data[0][3].v, 'Sans justificatif');
});
