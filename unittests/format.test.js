import test from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/js/format.js';

test('parseAmount accepte virgule, espaces et symbole euro', () => {
  assert.equal(f.parseAmount('12,5'), 12.5);
  assert.equal(f.parseAmount('1 200.00 €'), 1200);
  assert.equal(f.parseAmount('405'), 405);
});

test('parseAmount refuse les saisies invalides', () => {
  for (const bad of ['', 'abc', '-5', '1,234', '1.2.3', null, undefined]) assert.equal(f.parseAmount(bad), null, String(bad));
});

test('parseCount : vide -> null, nombre -> entier, texte -> NaN', () => {
  assert.equal(f.parseCount(''), null);
  assert.equal(f.parseCount('14'), 14);
  assert.ok(Number.isNaN(f.parseCount('x')));
});

test('eur affiche toujours 2 décimales sans arrondir, et pct gère la base nulle', () => {
  assert.match(f.eur(1234.6), /^1\s?234,60\s€$/);
  assert.match(f.eur(405), /^405,00\s€$/);
  assert.match(f.eur(0.1 + 0.2), /^0,30\s€$/);
  assert.equal(f.amountCompact(405), '405');
  assert.equal(f.amountCompact(405.5), '405,50');
  assert.equal(f.pct(30, 100), '30 %');
  assert.equal(f.pct(5, 0), '—');
});

test('isValidISO rejette les dates impossibles', () => {
  assert.ok(f.isValidISO('2026-10-29'));
  assert.ok(f.isValidISO('2028-02-29'));
  assert.ok(!f.isValidISO('2026-02-29'));
  assert.ok(!f.isValidISO('2026-13-01'));
  assert.ok(!f.isValidISO('29/10/2026'));
});

test('calendrier : octobre 2026 commence un jeudi et compte 31 jours', () => {
  assert.equal(f.daysInMonth(2026, 10), 31);
  assert.equal(f.daysInMonth(2026, 2), 28);
  assert.equal(f.firstWeekdayOffset(2026, 10), 3);
});

test('longDate et monthLabel', () => {
  assert.equal(f.longDate('2026-10-29'), 'Jeudi 29 octobre');
  assert.equal(f.monthLabel(2026, 10), 'Octobre 2026');
  assert.equal(f.shortDate('2026-10-27'), '27 oct.');
});

test('shiftMonth traverse les années', () => {
  assert.deepEqual(f.shiftMonth(2026, 1, -1), { y: 2025, m: 12 });
  assert.deepEqual(f.shiftMonth(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(f.shiftMonth(2026, 10, 0), { y: 2026, m: 10 });
});

test('initials ignore le préfixe Dr', () => {
  assert.equal(f.initials('Dr Jean Dupont'), 'JD');
  assert.equal(f.initials('Dr.'), 'DR');
  assert.equal(f.initials(''), 'DR');
  assert.equal(f.initials('Dr [Nom]'), 'N');
  assert.equal(f.initials('Dr Élodie Martin-Roux'), 'ÉM');
});

test('escapeHtml neutralise le balisage', () => {
  assert.equal(f.escapeHtml('<b a="x">&\''), '&lt;b a=&quot;x&quot;&gt;&amp;&#39;');
});

test('todayISO utilise la date locale', () => {
  assert.equal(f.todayISO(new Date(2026, 9, 29, 23, 59)), '2026-10-29');
});
