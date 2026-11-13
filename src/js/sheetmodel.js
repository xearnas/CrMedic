// Correspondance (pure) entre l'état de l'application et les onglets du classeur Google Sheets.
// Le classeur sert de base de données : une ligne par opération, colonnes fixes, valeurs « brutes »
// (dates ISO en texte, montants en nombres). La mise en forme pour le comptable est faite par l'export.
import { ACCENTS, normalize, newId } from './store.js';
import { isValidISO, parseAmount } from './format.js';

/** Nom du fichier dans le Drive de l'utilisateur. Ne pas le renommer : l'application le retrouve par ce nom. */
export const FILE_NAME = 'CrMedic - Données';
export const SCHEMA_VERSION = 1;

export const TABS = {
  ca: 'CA',
  frais: 'Frais',
  categories: 'Catégories',
  profil: 'Profil',
  docs: 'Justificatifs',
  meta: '_meta',
};

export const HEADERS = {
  [TABS.ca]: ['Date', 'Montant (€)', 'Consultations'],
  [TABS.frais]: ['ID', 'Date', 'Montant TTC (€)', 'Catégorie', 'Note', 'Justificatif', 'Sans justificatif', 'Récurrence', 'Fin de récurrence'],
  [TABS.categories]: ['Catégorie'],
  [TABS.profil]: ['Clé', 'Valeur'],
  [TABS.docs]: ['ID frais', 'ID fichier Drive', 'Nom', 'Type'],
  [TABS.meta]: ['Clé', 'Valeur'],
};

/** Colonnes obligatoires de l'en-tête : les classeurs créés avant les colonnes ajoutées restent lisibles. */
const REQUIRED_COLS = { [TABS.frais]: 6 };
const RECUR_TO_SHEET = { week: 'semaine', month: 'mois', year: 'an' };
const RECUR_FROM_SHEET = { semaine: 'week', mois: 'month', an: 'year' };

const PROFILE_KEYS = ['name', 'cabinet', 'email', 'rpps', 'accent'];

export class SheetFormatError extends Error {}

/** Tables { onglet: [en-têtes, ...lignes] } décrivant l'état. La photo de profil et les images restent locales. */
export function stateToTables(state, now = new Date()) {
  const ca = Object.entries(state.revenues)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, r]) => [date, r.amount, r.count ?? '']);
  const frais = [...state.expenses]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))
    .map((e) => [
      e.id, e.date, e.amount, e.category, e.note ?? '', (e.docs ?? []).map((d) => d.name).join(' ; '),
      e.noDoc ? 'oui' : '', e.recur ? RECUR_TO_SHEET[e.recur.every] : '', e.recur?.end ?? '',
    ]);
  // Une ligne par photo déjà envoyée dans le Drive (les images en attente d'envoi restent sur l'appareil).
  const justificatifs = state.expenses.flatMap((e) => (e.docs ?? []).filter((d) => d.driveId).map((d) => [e.id, d.driveId, d.name, d.type ?? '']));
  return {
    [TABS.ca]: [HEADERS[TABS.ca], ...ca],
    [TABS.frais]: [HEADERS[TABS.frais], ...frais],
    [TABS.docs]: [HEADERS[TABS.docs], ...justificatifs],
    [TABS.categories]: [HEADERS[TABS.categories], ...state.categories.map((c) => [c])],
    [TABS.profil]: [HEADERS[TABS.profil], ...PROFILE_KEYS.map((k) => [k, state.profile[k] ?? ''])],
    [TABS.meta]: [HEADERS[TABS.meta], ['schema', SCHEMA_VERSION], ['application', 'CrMedic'], ['maj', now.toISOString()]],
  };
}

/** Vrai si le classeur ne contient aucune donnée utilisateur (seulement les en-têtes). */
export function tablesAreEmpty(tables) {
  return [TABS.ca, TABS.frais].every((t) => !tables?.[t] || tables[t].length <= 1);
}

const cell = (v) => (v === undefined || v === null ? '' : v);
const sameHeader = (row, expected, required = expected.length) =>
  expected.every((h, i) => String(cell(row?.[i])).trim() === h || (i >= required && String(cell(row?.[i])).trim() === ''));

/** Une table lue du classeur peut manquer de l'onglet (créé vide) : seules des en-têtes modifiées sont une erreur. */
function checkHeader(tables, tab) {
  const rows = tables[tab];
  if (!rows || rows.length === 0) return [];
  if (!sameHeader(rows[0], HEADERS[tab], REQUIRED_COLS[tab])) {
    throw new SheetFormatError(`L'onglet « ${tab} » a été modifié : les en-têtes de colonnes ne correspondent plus (attendu : ${HEADERS[tab].join(' | ')}).`);
  }
  return rows.slice(1).filter((r) => r.some((c) => String(cell(c)).trim() !== ''));
}

/** Nombre lu d'une cellule (nombre natif ou texte « 12,5 »). Renvoie null si invalide. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return parseAmount(String(cell(v)));
}

/** Date ISO lue d'une cellule : texte ISO, ou date Sheets (nombre de jours depuis le 30/12/1899). */
function isoOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(cell(v)).trim();
  return isValidISO(s) ? s : null;
}

/**
 * Reconstruit un état à partir des tables lues. Les lignes invalides sont ignorées et comptées dans `ignored`.
 * `base` fournit ce qui n'est pas stocké dans le classeur (photo de profil, justificatifs image).
 */
export function tablesToState(tables, base = null) {
  const caRows = checkHeader(tables, TABS.ca);
  const fraisRows = checkHeader(tables, TABS.frais);
  const catRows = checkHeader(tables, TABS.categories);
  const profRows = checkHeader(tables, TABS.profil);
  const docRows = checkHeader(tables, TABS.docs);
  let ignored = 0;

  const revenues = {};
  for (const r of caRows) {
    const iso = isoOf(r[0]);
    const amount = num(r[1]);
    const count = String(cell(r[2])).trim() === '' ? null : num(r[2]);
    if (iso && amount !== null && amount > 0) revenues[iso] = { amount, count: count !== null && Number.isInteger(count) && count >= 0 ? count : null };
    else ignored += 1;
  }

  // Justificatifs : ceux du Drive font foi ; les images pas encore envoyées (et les PDF) ne vivent que sur l'appareil.
  const remoteDocs = new Map();
  for (const r of docRows) {
    const expenseId = String(cell(r[0])).trim();
    const driveId = String(cell(r[1])).trim();
    if (!expenseId || !driveId) continue;
    const list = remoteDocs.get(expenseId) ?? [];
    list.push({ id: driveId, driveId, name: String(cell(r[2])) || 'justificatif.jpg', type: String(cell(r[3])), size: 0 });
    remoteDocs.set(expenseId, list);
  }
  const localExpenses = new Map((base?.expenses ?? []).map((e) => [e.id, e]));
  const expenses = [];
  for (const r of fraisRows) {
    const date = isoOf(r[1]);
    const amount = num(r[2]);
    const category = String(cell(r[3])).trim();
    if (!date || amount === null || amount <= 0 || !category) {
      ignored += 1;
      continue;
    }
    const id = String(cell(r[0])).trim() || newId();
    const local = localExpenses.get(id);
    const known = new Map((local?.docs ?? []).filter((d) => d.driveId).map((d) => [d.driveId, d]));
    const docs = [
      ...(remoteDocs.get(id) ?? []).map((d) => ({ ...d, ...(known.get(d.driveId) ?? {}) })),
      ...(local?.docs ?? []).filter((d) => !d.driveId),
    ];
    const recurKey = String(cell(r[7])).trim().toLowerCase();
    const endCell = String(cell(r[8])).trim();
    expenses.push({
      id,
      date,
      amount,
      category,
      note: String(cell(r[4])),
      docs,
      noDoc: String(cell(r[6])).trim().toLowerCase() === 'oui',
      recur: RECUR_FROM_SHEET[recurKey] ? { every: RECUR_FROM_SHEET[recurKey], end: isoOf(endCell) ?? '' } : null,
    });
  }

  const profile = { ...(base?.profile ?? {}) };
  for (const [k, v] of profRows) {
    if (!PROFILE_KEYS.includes(k)) continue;
    if (k === 'accent' && !ACCENTS.some((a) => a.hex === v)) continue;
    profile[k] = String(cell(v));
  }

  const raw = { profile, revenues, expenses };
  if (catRows.length) raw.categories = catRows.map((r) => String(cell(r[0])));
  const state = normalize(raw);
  if (!catRows.length && base?.categories) state.categories = [...base.categories];
  return { state, ignored };
}

/**
 * Que faire à la connexion, selon que l'appareil et le classeur contiennent déjà des données ?
 * - 'none' : rien à échanger ; 'push' : envoyer l'appareil vers le Drive ; 'pull' : charger le Drive ;
 * - 'ask' : les deux contiennent des données différentes, l'utilisateur tranche.
 */
export function planSync({ localEmpty, remoteEmpty, same = false }) {
  if (localEmpty && remoteEmpty) return 'none';
  if (remoteEmpty) return 'push';
  if (localEmpty || same) return 'pull';
  return 'ask';
}
