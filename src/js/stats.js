// Calculs de synthèse (purs) pour le tableau de bord.
import { MONTHS_SHORT, daysInMonth, toISO } from './format.js';

export function monthRange(y, m) {
  return { from: toISO(y, m, 1), to: toISO(y, m, daysInMonth(y, m)) };
}

export function yearRange(y, upToMonth = 12) {
  return { from: toISO(y, 1, 1), to: toISO(y, upToMonth, daysInMonth(y, upToMonth)) };
}

const inRange = (iso, { from, to }) => iso >= from && iso <= to;

/** Totaux sur une période (bornes ISO incluses). */
export function periodStats(state, range) {
  let ca = 0;
  let jours = 0;
  for (const [iso, r] of Object.entries(state.revenues)) {
    if (inRange(iso, range)) {
      ca += r.amount;
      jours += 1;
    }
  }
  let frais = 0;
  let nbFrais = 0;
  for (const e of state.expenses) {
    if (inRange(e.date, range)) {
      frais += e.amount;
      nbFrais += 1;
    }
  }
  return { ca, jours, moyJour: jours ? ca / jours : 0, frais, nbFrais, solde: ca - frais };
}

/** CA de chaque jour du mois (0 si aucune saisie). */
export function dailySeries(state, y, m) {
  return Array.from({ length: daysInMonth(y, m) }, (_, i) => state.revenues[toISO(y, m, i + 1)]?.amount ?? 0);
}

/** CA et frais de chaque mois de janvier à `upToMonth`. */
export function monthlySeries(state, y, upToMonth) {
  return Array.from({ length: upToMonth }, (_, i) => {
    const { ca, frais } = periodStats(state, monthRange(y, i + 1));
    return { label: MONTHS_SHORT[i], ca, frais };
  });
}

/** Frais cumulés par catégorie, du plus élevé au plus faible. */
export function categoryTotals(state, range) {
  const totals = new Map();
  for (const e of state.expenses) {
    if (inRange(e.date, range)) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  }
  return [...totals].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'fr'));
}

/** Dernières saisies (CA et frais mélangés), la plus récente d'abord. */
export function recentEntries(state, limit = 5) {
  const items = [
    ...Object.entries(state.revenues).map(([date, r]) => ({ kind: 'ca', date, amount: r.amount, count: r.count, key: 'ca' + date })),
    ...state.expenses.map((e) => ({ kind: 'frais', date: e.date, amount: e.amount, category: e.category, note: e.note, hasDoc: !!e.doc, key: e.id })),
  ];
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key < b.key ? 1 : -1)).slice(0, limit);
}
