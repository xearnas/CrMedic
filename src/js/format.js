// Fonctions pures de formatage et de dates (aucune dépendance au navigateur).

export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
export const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const WEEKDAY_HEADS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

const pad = (n) => String(n).padStart(2, '0');

/** 1234.5 -> "1 234,50 €" : les montants ne sont jamais arrondis, toujours 2 décimales. */
export function eur(n) {
  return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/** Alias historique de `eur`. */
export const eur2 = eur;

/** Montant compact pour une case de calendrier : "405" si entier, sinon "405,50" (jamais arrondi). */
export function amountCompact(n) {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Pourcentage entier, ou "—" si la base est nulle. */
export function pct(part, total) {
  return total > 0 ? Math.round((100 * part) / total) + ' %' : '—';
}

/** Lit un montant saisi ("12,5", "1 200.00 €"). Renvoie null si invalide. */
export function parseAmount(input) {
  const t = String(input ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

/** Lit un entier positif ou nul. Renvoie null si invalide. */
export function parseCount(input) {
  const t = String(input ?? '').trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

export function toISO(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Nombre de jours du mois (m de 1 à 12). */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Décalage du 1er du mois par rapport au lundi (lundi = 0). */
export function firstWeekdayOffset(y, m) {
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

/** "2026-10-29" -> "jeudi 29 octobre" (première lettre en majuscule). */
export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WEEKDAYS_FR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const s = `${wd} ${d} ${MONTHS_FR[m - 1]}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2026-10-29" -> "29 oct." */
export function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1].toLowerCase()}.`;
}

export function monthLabel(y, m) {
  const s = MONTHS_FR[m - 1];
  return `${s.charAt(0).toUpperCase() + s.slice(1)} ${y}`;
}

/** Décale (y, m) de `delta` mois. */
export function shiftMonth(y, m, delta) {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Initiales du nom affiché, sans le préfixe "Dr". */
export function initials(name) {
  const words = String(name ?? '').replace(/^Dr\.?\s*/i, '').split(/[^\p{L}]+/u).filter(Boolean);
  return (words.map((w) => w[0]).join('').slice(0, 2) || 'Dr').toUpperCase();
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
