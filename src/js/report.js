// Modèle (pur) du classeur Excel destiné au comptable : synthèse, détail du CA, détail des frais.
// Le même modèle sert à l'aperçu à l'écran et à l'écriture du fichier .xlsx (voir xlsx.js), donc
// l'aperçu montre exactement ce qui sera téléchargé.
//
// Cellule : { v, f?, fmt?, kind? }
//   v    valeur affichée (nombre, texte ou date ISO « AAAA-MM-JJ »)
//   f    formule Excel (noms de fonctions anglais, comme dans le fichier) ; v en est le résultat
//   fmt  'text' | 'money' | 'int' | 'pct' | 'date' | 'month'
//   kind 'title' | 'sub' | 'head' | 'total' | 'note'
import { MONTHS_FR, WEEKDAYS_FR, daysInMonth, toISO } from './format.js';
import { categoryTotals, monthRange, periodStats } from './stats.js';

export const SHEET_SUMMARY = 'Synthèse';
export const SHEET_CA = 'CA';
export const SHEET_EXPENSES = 'Frais';

/** Périodes proposées : année entière, trimestres, mois. */
export function periodOptions() {
  const opts = [{ id: 'year', label: 'Année entière', m1: 1, m2: 12 }];
  for (let q = 0; q < 4; q++) opts.push({ id: `t${q + 1}`, label: `T${q + 1} (${MONTHS_FR[q * 3]} – ${MONTHS_FR[q * 3 + 2]})`, m1: q * 3 + 1, m2: q * 3 + 3 });
  for (let m = 1; m <= 12; m++) opts.push({ id: `m${m}`, label: MONTHS_FR[m - 1].charAt(0).toUpperCase() + MONTHS_FR[m - 1].slice(1), m1: m, m2: m });
  return opts;
}

export function resolvePeriod(y, id) {
  const o = periodOptions().find((p) => p.id === id) ?? periodOptions()[0];
  const label = o.m1 === 1 && o.m2 === 12 ? `Année ${y}` : o.m1 === o.m2 ? `${o.label} ${y}` : `${o.label.split(' (')[0]} ${y}`;
  return { y, m1: o.m1, m2: o.m2, id: o.id, label };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const weekday = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return cap(WEEKDAYS_FR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]);
};

const c = (v, fmt = 'text', extra = {}) => ({ v, fmt, ...extra });
const head = (labels) => labels.map((l) => c(l, 'text', { kind: 'head' }));

/** Nom de fichier téléchargé (ASCII, sans espace). */
export function reportFileName(period) {
  return `CrMedic_${period.y}_${period.id === 'year' ? 'annee' : period.id.toUpperCase()}.xlsx`;
}

/** Construit le classeur d'une période (mois entiers `m1` à `m2` de l'année `y`). */
export function buildReport(state, period) {
  const { y, m1, m2, label } = period;
  const range = { from: toISO(y, m1, 1), to: toISO(y, m2, daysInMonth(y, m2)) };
  const who = [state.profile.cabinet, state.profile.name, state.profile.rpps ? `RPPS ${state.profile.rpps}` : ''].filter(Boolean).join(' · ');

  const revenues = Object.entries(state.revenues)
    .filter(([iso]) => iso >= range.from && iso <= range.to)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const expenses = state.expenses
    .filter((e) => e.date >= range.from && e.date <= range.to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));

  const FIRST = 5; // première ligne de données des onglets de détail
  const caLast = FIRST + Math.max(revenues.length, 1) - 1;
  const exLast = FIRST + Math.max(expenses.length, 1) - 1;
  const caTotal = revenues.reduce((s, [, r]) => s + r.amount, 0);
  const caCount = revenues.reduce((s, [, r]) => s + (r.count ?? 0), 0);
  const exTotal = expenses.reduce((s, e) => s + e.amount, 0);

  // --- Onglet CA ---
  const caRows = [
    [c(`Chiffre d'affaires — ${label}`, 'text', { kind: 'title' })],
    [c(who, 'text', { kind: 'sub' })],
    [],
    head(['Date', 'Jour', 'Montant (€)', 'Consultations']),
  ];
  if (revenues.length) {
    for (const [iso, r] of revenues) caRows.push([c(iso, 'date'), c(weekday(iso)), c(r.amount, 'money'), c(r.count ?? '', 'int')]);
  } else {
    caRows.push([c('Aucune saisie sur la période', 'text', { kind: 'note' })]);
  }
  caRows.push([
    c('Total', 'text', { kind: 'total' }), c('', 'text', { kind: 'total' }),
    c(caTotal, 'money', { kind: 'total', f: `SUM(C${FIRST}:C${caLast})` }),
    c(caCount, 'int', { kind: 'total', f: `SUM(D${FIRST}:D${caLast})` }),
  ]);

  // --- Onglet Frais ---
  const exRows = [
    [c(`Frais — ${label}`, 'text', { kind: 'title' })],
    [c(who, 'text', { kind: 'sub' })],
    [],
    head(['Date', 'Catégorie', 'Note', 'Justificatif', 'Montant TTC (€)']),
  ];
  if (expenses.length) {
    for (const e of expenses) exRows.push([c(e.date, 'date'), c(e.category), c(e.note || ''), c(e.doc?.name ?? 'Non'), c(e.amount, 'money')]);
  } else {
    exRows.push([c('Aucun frais sur la période', 'text', { kind: 'note' })]);
  }
  exRows.push([
    c('Total', 'text', { kind: 'total' }), c('', 'text', { kind: 'total' }), c('', 'text', { kind: 'total' }), c('', 'text', { kind: 'total' }),
    c(exTotal, 'money', { kind: 'total', f: `SUM(E${FIRST}:E${exLast})` }),
  ]);

  // --- Onglet Synthèse ---
  const sumRows = [
    [c(`Synthèse CA & frais — ${label}`, 'text', { kind: 'title' })],
    [c(who, 'text', { kind: 'sub' })],
    [],
    head(['Mois', 'CA (€)', 'Frais (€)', 'Solde (€)']),
  ];
  const mFirst = sumRows.length + 1;
  for (let m = m1; m <= m2; m++) {
    const r = sumRows.length + 1;
    const s = periodStats(state, monthRange(y, m));
    sumRows.push([
      c(toISO(y, m, 1), 'month'),
      c(s.ca, 'money', { f: `SUMIFS(${SHEET_CA}!$C$${FIRST}:$C$${caLast},${SHEET_CA}!$A$${FIRST}:$A$${caLast},">="&$A${r},${SHEET_CA}!$A$${FIRST}:$A$${caLast},"<"&EDATE($A${r},1))` }),
      c(s.frais, 'money', { f: `SUMIFS(${SHEET_EXPENSES}!$E$${FIRST}:$E$${exLast},${SHEET_EXPENSES}!$A$${FIRST}:$A$${exLast},">="&$A${r},${SHEET_EXPENSES}!$A$${FIRST}:$A$${exLast},"<"&EDATE($A${r},1))` }),
      c(s.solde, 'money', { f: `B${r}-C${r}` }),
    ]);
  }
  const mLast = sumRows.length;
  const tr = sumRows.length + 1;
  sumRows.push([
    c('Total', 'text', { kind: 'total' }),
    c(caTotal, 'money', { kind: 'total', f: `SUM(B${mFirst}:B${mLast})` }),
    c(exTotal, 'money', { kind: 'total', f: `SUM(C${mFirst}:C${mLast})` }),
    c(caTotal - exTotal, 'money', { kind: 'total', f: `B${tr}-C${tr}` }),
  ]);
  sumRows.push([c('Solde avant charges sociales et impôts.', 'text', { kind: 'note' })]);
  sumRows.push([]);

  const cats = categoryTotals(state, range);
  sumRows.push(head(['Catégorie de frais', 'Total (€)', '% des frais']));
  const cFirst = sumRows.length + 1;
  const cTotalRow = cFirst + Math.max(cats.length, 1);
  if (cats.length) {
    for (const k of cats) {
      const r = sumRows.length + 1;
      sumRows.push([
        c(k.name),
        c(k.total, 'money', { f: `SUMIFS(${SHEET_EXPENSES}!$E$${FIRST}:$E$${exLast},${SHEET_EXPENSES}!$B$${FIRST}:$B$${exLast},$A${r})` }),
        c(exTotal ? k.total / exTotal : 0, 'pct', { f: `IF($B$${cTotalRow}=0,0,B${r}/$B$${cTotalRow})` }),
      ]);
    }
  } else {
    sumRows.push([c('Aucun frais sur la période', 'text', { kind: 'note' })]);
  }
  sumRows.push([
    c('Total', 'text', { kind: 'total' }),
    c(exTotal, 'money', { kind: 'total', f: `SUM(B${cFirst}:B${cTotalRow - 1})` }),
    c(exTotal ? 1 : 0, 'pct', { kind: 'total', f: `IF(B${cTotalRow}=0,0,1)` }),
  ]);

  return {
    title: `Comptabilité ${label}`,
    period,
    sheets: [
      { name: SHEET_SUMMARY, widths: [26, 16, 16, 16], rows: sumRows, freezeRow: 4 },
      { name: SHEET_CA, widths: [14, 14, 16, 16], rows: caRows, freezeRow: 4 },
      { name: SHEET_EXPENSES, widths: [14, 24, 34, 28, 18], rows: exRows, freezeRow: 4 },
    ],
  };
}
