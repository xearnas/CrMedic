import test from 'node:test';
import assert from 'node:assert/strict';
import { addExpense, emptyState, setRevenue } from '../src/js/store.js';
import * as k from '../src/js/stats.js';

function fixture() {
  let st = emptyState();
  st = setRevenue(st, '2026-09-30', 1000, 30);
  st = setRevenue(st, '2026-10-01', 400, 14);
  st = setRevenue(st, '2026-10-02', 200, 7);
  st = setRevenue(st, '2026-11-01', 999, 1);
  st = addExpense(st, { date: '2026-10-02', amount: 100, category: 'Consommables' }).state;
  st = addExpense(st, { date: '2026-10-15', amount: 300, category: 'Loyer & charges' }).state;
  st = addExpense(st, { date: '2026-10-20', amount: 50, category: 'Consommables' }).state;
  st = addExpense(st, { date: '2026-09-01', amount: 77, category: 'Formation' }).state;
  return st;
}

test('monthRange et yearRange', () => {
  assert.deepEqual(k.monthRange(2026, 2), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(k.yearRange(2026, 10), { from: '2026-01-01', to: '2026-10-31' });
});

test('periodStats : bornes incluses, autres mois exclus', () => {
  const s = k.periodStats(fixture(), k.monthRange(2026, 10));
  assert.equal(s.ca, 600);
  assert.equal(s.jours, 2);
  assert.equal(s.moyJour, 300);
  assert.equal(s.frais, 450);
  assert.equal(s.nbFrais, 3);
  assert.equal(s.solde, 150);
});

test('periodStats sur période vide ne divise pas par zéro', () => {
  const s = k.periodStats(emptyState(), k.monthRange(2026, 10));
  assert.deepEqual(s, { ca: 0, jours: 0, moyJour: 0, frais: 0, nbFrais: 0, solde: 0 });
});

test('année en cours : exclut les mois futurs', () => {
  const s = k.periodStats(fixture(), k.yearRange(2026, 10));
  assert.equal(s.ca, 1600);
  assert.equal(s.frais, 527);
});

test('dailySeries : longueur du mois et zéros pour les jours sans saisie', () => {
  const d = k.dailySeries(fixture(), 2026, 10);
  assert.equal(d.length, 31);
  assert.deepEqual(d.slice(0, 3), [400, 200, 0]);
});

test('monthlySeries : une entrée par mois jusqu’au mois demandé', () => {
  const m = k.monthlySeries(fixture(), 2026, 10);
  assert.equal(m.length, 10);
  assert.deepEqual(m[9], { label: 'Oct', ca: 600, frais: 450 });
  assert.deepEqual(m[8], { label: 'Sep', ca: 1000, frais: 77 });
});

test('categoryTotals : cumul et tri décroissant', () => {
  const c = k.categoryTotals(fixture(), k.monthRange(2026, 10));
  assert.deepEqual(c, [
    { name: 'Loyer & charges', total: 300 },
    { name: 'Consommables', total: 150 },
  ]);
});

test('recentEntries : CA et frais mélangés, récents d’abord, limités', () => {
  const r = k.recentEntries(fixture(), 3);
  assert.equal(r.length, 3);
  assert.equal(r[0].date, '2026-11-01');
  assert.ok(r.every((x, i) => i === 0 || r[i - 1].date >= x.date));
  assert.equal(r[0].kind, 'ca');
});
