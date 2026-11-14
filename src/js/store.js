// Modèle de données : fonctions pures (état immuable) + persistance localStorage.
import { daysInMonth, isValidISO, toISO, todayISO } from './format.js';

export const STORAGE_KEY = 'crmedic.v1';
export const DEFAULT_CATEGORIES = ['Consommables', 'Loyer & charges', 'Déplacements', 'Logiciels', 'Formation', 'Mutuelle', 'Véhicule', 'Fonctionnement', 'Autre'];
/** Catégories ajoutées aux listes déjà enregistrées (une seule fois, voir `withCategories`). */
export const CATEGORIES_ADDED_V2 = ['Mutuelle', 'Véhicule', 'Fonctionnement'];
export const ACCENTS = [
  { hex: '#0B6E8A', label: 'Bleu océan' },
  { hex: '#2E7D5B', label: 'Vert sapin' },
  { hex: '#4B5BB5', label: 'Indigo' },
  { hex: '#8A4B8F', label: 'Prune' },
  { hex: '#3F5A6B', label: 'Ardoise' },
];

export class ValidationError extends Error {}

export function emptyState() {
  return {
    version: 1,
    profile: { name: 'Dr [Nom]', cabinet: 'Cabinet médical', email: '', rpps: '', accent: ACCENTS[0].hex, photo: '' },
    categories: [...DEFAULT_CATEGORIES],
    revenues: {}, // { 'YYYY-MM-DD': { amount, count } }
    // [{ id, date, amount, category, note, docs: [{ id, name, type, size, driveId?, dataUrl? }], noDoc, recur }]
    // recur : null, ou { every: 'week' | 'month' | 'year', end: 'YYYY-MM-DD' | '' } — `date` est alors la date de début.
    expenses: [],
  };
}

export const EVERY = { week: 'Chaque semaine', month: 'Chaque mois', year: 'Chaque année' };

/** Justificatif : une image (envoyée dans le Drive : `driveId`, ou en attente d'envoi : `dataUrl`) ou un nom de PDF. */
export function normalizeDoc(d) {
  if (!d || typeof d !== 'object' || typeof d.name !== 'string' || !d.name) return null;
  const doc = { id: typeof d.id === 'string' && d.id ? d.id : newId(), name: d.name, type: typeof d.type === 'string' ? d.type : '', size: isNum(d.size) ? d.size : 0 };
  if (typeof d.driveId === 'string' && d.driveId) doc.driveId = d.driveId;
  if (typeof d.dataUrl === 'string' && d.dataUrl) doc.dataUrl = d.dataUrl;
  return doc;
}

export function normalizeRecur(r, start) {
  if (!r || typeof r !== 'object' || !(r.every in EVERY)) return null;
  const end = typeof r.end === 'string' && isValidISO(r.end) && r.end >= start ? r.end : '';
  return { every: r.every, end };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Reconstruit un état valide à partir de données quelconques (import, ancien stockage). */
export function normalize(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
  const str = (v, d) => (typeof v === 'string' ? v : d);
  base.profile = {
    name: str(p.name, base.profile.name),
    cabinet: str(p.cabinet, base.profile.cabinet),
    email: str(p.email, ''),
    rpps: str(p.rpps, ''),
    accent: ACCENTS.some((a) => a.hex === p.accent) ? p.accent : base.profile.accent,
    photo: str(p.photo, ''),
  };
  if (Array.isArray(raw.categories)) {
    const cats = raw.categories.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim());
    base.categories = [...new Set(cats)];
  }
  if (raw.revenues && typeof raw.revenues === 'object') {
    for (const [iso, r] of Object.entries(raw.revenues)) {
      if (isValidISO(iso) && r && isNum(r.amount) && r.amount > 0) {
        base.revenues[iso] = { amount: r.amount, count: isNum(r.count) && r.count >= 0 ? Math.floor(r.count) : null };
      }
    }
  }
  if (Array.isArray(raw.expenses)) {
    base.expenses = raw.expenses
      .filter((e) => e && isValidISO(e.date) && isNum(e.amount) && e.amount > 0 && typeof e.category === 'string')
      .map((e) => ({
        id: typeof e.id === 'string' && e.id ? e.id : newId(),
        date: e.date,
        amount: e.amount,
        category: e.category,
        note: typeof e.note === 'string' ? e.note : '',
        ...normalizeProof(e),
        recur: normalizeRecur(e.recur, e.date),
      }));
  }
  return base;
}

/** `docs` (ou l'ancien champ `doc`) et `noDoc` : une dépense « sans justificatif » n'a pas de photo. */
function normalizeProof(e) {
  const list = Array.isArray(e.docs) ? e.docs : e.doc ? [e.doc] : [];
  const docs = list.map(normalizeDoc).filter(Boolean);
  return { docs, noDoc: docs.length === 0 && e.noDoc === true };
}

let counter = 0;
export function newId() {
  counter += 1;
  return 'e' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Enregistre (ou remplace) le CA d'un jour. */
export function setRevenue(state, iso, amount, count = null) {
  if (!isValidISO(iso)) throw new ValidationError('Date invalide.');
  if (!isNum(amount) || amount <= 0) throw new ValidationError('Saisissez un montant supérieur à 0.');
  if (count !== null && (!Number.isInteger(count) || count < 0)) throw new ValidationError('Nombre de consultations invalide.');
  return { ...state, revenues: { ...state.revenues, [iso]: { amount, count } } };
}

export function removeRevenue(state, iso) {
  const { [iso]: _removed, ...rest } = state.revenues;
  return { ...state, revenues: rest };
}

function checkExpense({ date, amount, category, recur }) {
  if (!isValidISO(date)) throw new ValidationError('Date du frais invalide.');
  if (!isNum(amount) || amount <= 0) throw new ValidationError('Saisissez un montant TTC supérieur à 0.');
  if (typeof category !== 'string' || !category.trim()) throw new ValidationError('Choisissez une catégorie.');
  if (recur) {
    if (!(recur.every in EVERY)) throw new ValidationError('Choisissez la fréquence du frais récurrent.');
    if (recur.end && !isValidISO(recur.end)) throw new ValidationError('Date de fin invalide.');
    if (recur.end && recur.end < date) throw new ValidationError('La date de fin doit être postérieure à la date de début.');
  }
}

const buildExpense = (id, { date, amount, category, note = '', docs = [], noDoc = false, recur = null }) => ({
  id, date, amount, category: category.trim(), note: String(note).trim().slice(0, 200),
  ...normalizeProof({ docs, noDoc }),
  recur: recur ? { every: recur.every, end: recur.end || '' } : null,
});

export function addExpense(state, fields) {
  checkExpense(fields);
  const expense = buildExpense(newId(), fields);
  return { state: { ...state, expenses: [...state.expenses, expense] }, expense };
}

/** Modifie un frais existant (champs fournis uniquement). Pour un frais récurrent, vaut pour toute la série. */
export function updateExpense(state, id, patch) {
  const cur = state.expenses.find((e) => e.id === id);
  if (!cur) throw new ValidationError('Frais introuvable.');
  const next = { ...cur, ...patch };
  checkExpense(next);
  const expense = buildExpense(id, next);
  return { state: { ...state, expenses: state.expenses.map((e) => (e.id === id ? expense : e)) }, expense };
}

/** Met à jour un justificatif d'un frais (par exemple après son envoi dans le Drive). `undefined` retire un champ. */
export function patchDoc(state, expenseId, docId, patch) {
  return {
    ...state,
    expenses: state.expenses.map((e) => (e.id !== expenseId ? e : {
      ...e,
      docs: e.docs.map((d) => {
        if (d.id !== docId) return d;
        const next = { ...d, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next;
      }),
    })),
  };
}

/** Photos en attente d'envoi dans le Drive : images présentes sur l'appareil, pas encore dans le classeur. */
export function pendingDocs(state) {
  return state.expenses.flatMap((e) => e.docs.filter((d) => d.dataUrl && !d.driveId).map((d) => ({ expenseId: e.id, doc: d })));
}

// --- Frais récurrents ------------------------------------------------------

/** k-ième échéance d'une série (le jour du mois est ramené à la fin du mois si besoin : 31 -> 30, 29 févr. -> 28). */
function nthDate(start, every, k) {
  const [y, m, d] = start.split('-').map(Number);
  if (every === 'week') {
    const t = new Date(Date.UTC(y, m - 1, d + 7 * k));
    return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const months = every === 'month' ? k : 12 * k;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Échéances d'un frais jusqu'à `upTo` (aujourd'hui par défaut) : une seule pour un frais ponctuel. */
export function occurrences(e, upTo = todayISO()) {
  if (!e.recur) return [e.date];
  const limit = e.recur.end && e.recur.end < upTo ? e.recur.end : upTo;
  const out = [];
  for (let k = 0; k < 5000; k++) {
    const d = nthDate(e.date, e.recur.every, k);
    if (d > limit) break;
    out.push(d);
  }
  return out;
}

/** Tous les frais à compter : chaque échéance échue d'un frais récurrent devient une ligne (même `id` que la série). */
export function expandExpenses(state, upTo = todayISO()) {
  const out = [];
  for (const e of state.expenses) {
    for (const date of occurrences(e, upTo)) out.push({ ...e, date, startDate: e.date, recurring: !!e.recur });
  }
  return out;
}

export function removeExpense(state, id) {
  return { ...state, expenses: state.expenses.filter((e) => e.id !== id) };
}

export function addCategory(state, name) {
  const v = String(name ?? '').trim();
  if (!v) throw new ValidationError('Saisissez un nom de catégorie.');
  if (state.categories.some((c) => c.toLowerCase() === v.toLowerCase())) throw new ValidationError('Cette catégorie existe déjà.');
  return { ...state, categories: [...state.categories, v] };
}

/** Les frais déjà saisis conservent leur catégorie (affichée telle quelle). */
/** Ajoute les catégories manquantes (sans tenir compte de la casse), avant « Autre » s'il existe. */
export function withCategories(state, names) {
  const have = new Set(state.categories.map((c) => c.toLowerCase()));
  const add = names.filter((n) => !have.has(n.toLowerCase()));
  if (!add.length) return state;
  const i = state.categories.findIndex((c) => c === 'Autre');
  const cats = [...state.categories];
  cats.splice(i === -1 ? cats.length : i, 0, ...add);
  return { ...state, categories: cats };
}

export function removeCategory(state, name) {
  return { ...state, categories: state.categories.filter((c) => c !== name) };
}

export function updateProfile(state, patch) {
  return { ...state, profile: { ...state.profile, ...patch } };
}

export function isEmpty(state) {
  return Object.keys(state.revenues).length === 0 && state.expenses.length === 0;
}

/** Données d'exemple déterministes, jusqu'à `now` inclus. */
export function sampleState(now = new Date()) {
  let seed = 20260101;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  let state = { ...emptyState(), revenues: {}, expenses: [] };
  const today = todayISO(now);
  const y = now.getFullYear();
  for (let m = 1; m <= now.getMonth() + 1; m++) {
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const iso = toISO(y, m, d);
      if (iso > today) break;
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (dow === 0 || dow === 6 || rnd() < 0.08) continue;
      const amount = Math.round((240 + rnd() * 280) / 5) * 5;
      state = setRevenue(state, iso, amount, Math.max(1, Math.round(amount / 29)));
    }
    const plan = [
      [1, 'Loyer & charges', 1050, 'Loyer du cabinet'],
      [Math.min(8, daysInMonth(y, m)), 'Consommables', 80 + Math.round(rnd() * 500), 'Pharmacie'],
      [Math.min(15, daysInMonth(y, m)), 'Déplacements', 40 + Math.round(rnd() * 80), 'Carburant'],
      [Math.min(22, daysInMonth(y, m)), 'Consommables', 60 + Math.round(rnd() * 400), 'Matériel médical'],
      [25, 'Logiciels', 49, 'Abonnement logiciel'],
    ];
    for (const [d, category, amount, note] of plan) {
      const date = toISO(y, m, d);
      if (date <= today) state = addExpense(state, { date, amount, category, note }).state;
    }
  }
  return state;
}

// --- Persistance -----------------------------------------------------------

export function load(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

/** Renvoie false si l'écriture échoue (quota dépassé, stockage indisponible). */
export function save(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ValidationError('Fichier illisible : ce n’est pas un export CrMedic valide.');
  }
  if (!data || typeof data !== 'object' || !('revenues' in data || 'expenses' in data)) {
    throw new ValidationError('Fichier illisible : ce n’est pas un export CrMedic valide.');
  }
  return normalize(data);
}
