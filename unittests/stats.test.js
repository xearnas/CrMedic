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

test('année complète : réalisé / prévu, les échéances futures des frais récurrents sont projetées', () => {
  let st = emptyState();
  st = setRevenue(st, '2026-02-10', 1000, 5);
  st = addExpense(st, { date: '2025-11-15', amount: 300, category: 'Autre', recur: { every: 'month', end: '' } }).state;
  st = addExpense(st, { date: '2026-03-01', amount: 50, category: 'Autre' }).state;
  const now = '2026-06-20';
  const y25 = k.yearOverview(st, 2025, now);
  assert.equal(y25.fraisReel, 600); // nov. + déc. 2025
  assert.equal(y25.fraisPrevu, 0);
  const y26 = k.yearOverview(st, 2026, now);
  assert.equal(y26.months[1].ca, 1000);
  assert.equal(y26.fraisReel, 300 * 6 + 50); // 15 janv. → 15 juin + le frais ponctuel
  assert.equal(y26.fraisPrevu, 300 * 6); // 15 juil. → 15 déc.
  assert.equal(y26.months[5].fraisReel, 300);
  assert.equal(y26.months[6].fraisPrevu, 300);
  assert.equal(y26.solde, 1000 - 1850);
  assert.equal(y26.soldeProjete, 1000 - 1850 - 1800);
  const y27 = k.yearOverview(st, 2027, now);
  assert.equal(y27.ca, 0);
  assert.equal(y27.fraisPrevu, 3600);
  assert.equal(y27.fraisReel, 0);
});

test('les totaux « réels » (période, catégories) ne comptent toujours pas les échéances à venir', () => {
  const { state } = addExpense(emptyState(), { date: '2026-01-15', amount: 300, category: 'Autre', recur: { every: 'month', end: '' } });
  const upToNow = k.periodStats(state, { from: '2099-01-01', to: '2099-12-31' });
  assert.equal(upToNow.frais, 0);
});

test('weekBuckets : semaines lundi-dimanche tronquées aux bornes de l’année', () => {
  const w = k.weekBuckets(2026);
  assert.equal(w.length, 53);
  assert.deepEqual([w[0].from, w[0].to, w[0].week], ['2026-01-01', '2026-01-04', 1]);
  assert.deepEqual([w[1].from, w[1].to], ['2026-01-05', '2026-01-11']);
  assert.deepEqual([w[52].from, w[52].to, w[52].week], ['2026-12-28', '2026-12-31', 53]);
  assert.equal(w[0].monthStart, 0);
});

test('yearOverview : les semaines totalisent exactement les mois', () => {
  let st = setRevenue(emptyState(), '2026-01-04', 100, 1);
  st = setRevenue(st, '2026-01-05', 200, 1);
  st = setRevenue(st, '2026-12-31', 50, 1);
  st = addExpense(st, { date: '2026-03-10', amount: 70, category: 'Autre' }).state;
  const ov = k.yearOverview(st, 2026, '2026-06-01');
  assert.equal(ov.weeks[0].ca, 100);
  assert.equal(ov.weeks[1].ca, 200);
  assert.equal(ov.weeks[52].ca, 50);
  assert.equal(ov.weeks.reduce((t, x) => t + x.ca, 0), ov.ca);
  assert.equal(ov.weeks.reduce((t, x) => t + x.frais, 0), ov.frais);
});
