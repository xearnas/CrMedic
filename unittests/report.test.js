import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addExpense, emptyState, sampleState, setRevenue } from '../src/js/store.js';
import { monthRange, periodStats } from '../src/js/stats.js';
import { buildReport, periodOptions, reportFileName, resolvePeriod } from '../src/js/report.js';

const NOW = new Date(2026, 9, 29);
const sheet = (rep, name) => rep.sheets.find((s) => s.name === name);
const totalOf = (sh) => sh.rows.find((r) => r[0]?.kind === 'total');

test('périodes : année, trimestres et mois', () => {
  const ids = periodOptions().map((p) => p.id);
  assert.equal(ids.length, 17);
  assert.deepEqual(resolvePeriod(2026, 't3'), { y: 2026, m1: 7, m2: 9, id: 't3', label: 'T3 2026' });
  assert.equal(resolvePeriod(2026, 'year').label, 'Année 2026');
  assert.equal(resolvePeriod(2026, 'm10').label, 'Octobre 2026');
  assert.equal(resolvePeriod(2026, 'inconnu').id, 'year');
});

test('nom de fichier ASCII selon la période', () => {
  assert.equal(reportFileName(resolvePeriod(2026, 'year')), 'CrMedic_2026_annee.xlsx');
  assert.equal(reportFileName(resolvePeriod(2026, 't2')), 'CrMedic_2026_T2.xlsx');
});

test('les totaux du rapport correspondent aux statistiques', () => {
  const state = sampleState(NOW);
  const rep = buildReport(state, resolvePeriod(2026, 'year'));
  const exp = periodStats(state, { from: '2026-01-01', to: '2026-12-31' });
  const syn = sheet(rep, 'Synthèse');
  const tot = totalOf(syn);
  assert.ok(Math.abs(tot[1].v - exp.ca) < 1e-6);
  assert.ok(Math.abs(tot[2].v - exp.frais) < 1e-6);
  assert.ok(Math.abs(tot[3].v - exp.solde) < 1e-6);
  assert.ok(Math.abs(totalOf(sheet(rep, 'CA'))[2].v - exp.ca) < 1e-6);
  assert.ok(Math.abs(totalOf(sheet(rep, 'Frais'))[4].v - exp.frais) < 1e-6);
});

test('une ligne par mois de la période avec formules', () => {
  const state = sampleState(NOW);
  const rep = buildReport(state, resolvePeriod(2026, 't3'));
  const rows = sheet(rep, 'Synthèse').rows.filter((r) => r[0]?.fmt === 'month');
  assert.deepEqual(rows.map((r) => r[0].v), ['2026-07-01', '2026-08-01', '2026-09-01']);
  for (const r of rows) {
    assert.match(r[1].f, /^SUMIFS\(CA!/);
    assert.match(r[2].f, /^SUMIFS\(Frais!/);
    assert.match(r[3].f, /^B\d+-C\d+$/);
  }
  const jul = periodStats(state, monthRange(2026, 7));
  assert.equal(rows[0][1].v, jul.ca);
});

test('seules les opérations de la période figurent dans le détail', () => {
  let s = setRevenue(emptyState(), '2026-03-10', 300, 10);
  s = setRevenue(s, '2026-04-02', 500, 15);
  s = addExpense(s, { date: '2026-03-11', amount: 40, category: 'Autre', note: 'a' }).state;
  s = addExpense(s, { date: '2026-05-11', amount: 60, category: 'Autre', note: 'b' }).state;
  const rep = buildReport(s, resolvePeriod(2026, 'm3'));
  const ca = sheet(rep, 'CA').rows.filter((r) => r[0]?.fmt === 'date');
  const fr = sheet(rep, 'Frais').rows.filter((r) => r[0]?.fmt === 'date');
  assert.equal(ca.length, 1);
  assert.equal(ca[0][0].v, '2026-03-10');
  assert.equal(ca[0][1].v, 'Mardi');
  assert.equal(fr.length, 1);
  assert.equal(fr[0][4].v, 40);
});

test('période sans donnée : tableaux valides, totaux nuls, plages de formules cohérentes', () => {
  const rep = buildReport(emptyState(), resolvePeriod(2026, 'm1'));
  const ca = sheet(rep, 'CA');
  assert.equal(totalOf(ca)[2].v, 0);
  assert.equal(totalOf(ca)[2].f, 'SUM(C5:C5)');
  assert.equal(totalOf(sheet(rep, 'Synthèse'))[1].v, 0);
  assert.equal(totalOf(sheet(rep, 'Frais'))[4].f, 'SUM(E5:E5)');
});

test('la part de chaque catégorie somme à 100 %', () => {
  const state = sampleState(NOW);
  const rep = buildReport(state, resolvePeriod(2026, 'year'));
  const rows = sheet(rep, 'Synthèse').rows.filter((r) => r[2]?.fmt === 'pct' && r[0].kind !== 'total');
  assert.ok(rows.length >= 2);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r[2].v, 0) - 1) < 1e-9);
});
