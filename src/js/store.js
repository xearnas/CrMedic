// Modèle de données : fonctions pures (état immuable) + persistance localStorage.
import { daysInMonth, isValidISO, toISO, todayISO } from './format.js';

export const STORAGE_KEY = 'crmedic.v1';
export const DEFAULT_CATEGORIES = ['Consommables', 'Loyer & charges', 'Déplacements', 'Logiciels', 'Formation', 'Autre'];
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
    expenses: [], // [{ id, date, amount, category, note, doc }]
  };
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
        doc: e.doc && typeof e.doc.name === 'string' ? e.doc : null,
      }));
  }
  return base;
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

export function addExpense(state, { date, amount, category, note = '', doc = null }) {
  if (!isValidISO(date)) throw new ValidationError('Date du frais invalide.');
  if (!isNum(amount) || amount <= 0) throw new ValidationError('Saisissez un montant TTC supérieur à 0.');
  if (typeof category !== 'string' || !category.trim()) throw new ValidationError('Choisissez une catégorie.');
  const expense = { id: newId(), date, amount, category: category.trim(), note: String(note).trim().slice(0, 200), doc };
  return { state: { ...state, expenses: [...state.expenses, expense] }, expense };
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
