// Feuilles d'aide au remplissage des déclarations fiscales d'un médecin au régime BNC (déclaration contrôlée) :
// la 2035 (résultat professionnel) et la 2042-C-PRO (report du résultat sur la déclaration de revenus).
// Même modèle de cellules que report.js (voir l'en-tête de ce fichier) ; kinds ajoutés : 'section' et 'input'.
// Numéros de ligne et de case : millésime 2026 (revenus 2025), à revérifier si l'administration les modifie.
import { CATEGORIES, knownCategory } from './categories.js';
import { expandExpenses } from './store.js';

export const SHEET_2035 = '2035';
export const SHEET_2042 = '2042-C-PRO';

const c = (v, fmt = 'text', extra = {}) => ({ v, fmt, ...extra });
const head = (labels) => labels.map((l) => c(l, 'text', { kind: 'head' }));
const section = (title) => [c('', 'text', { kind: 'section' }), c(title, 'text', { kind: 'section' }), c('', 'text', { kind: 'section' }), c('', 'text', { kind: 'section' })];
const note = (t) => [c(t, 'text', { kind: 'note' })];
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Intitulés des lignes de dépenses de la 2035-A (lignes 8 à 32). */
const EXPENSE_LINES = [
  [8, 'Achats'], [9, 'Salaires nets et avantages en nature'], [10, 'Charges sociales sur salaires'], [11, 'Taxe sur la valeur ajoutée'],
  [12, 'Contribution économique territoriale'], [13, 'Autres impôts'], [14, 'Contribution sociale généralisée déductible'],
  [15, 'Loyer et charges locatives'], [16, 'Location de matériel et de mobilier'], [17, 'Entretien et réparations'], [18, 'Personnel intérimaire'],
  [19, 'Petit outillage'], [20, 'Chauffage, eau, gaz, électricité'], [21, 'Honoraires ne constituant pas des rétrocessions'],
  [22, 'Primes d’assurances'], [23, 'Frais de véhicules'], [24, 'Autres frais de déplacements'], [25, 'Charges sociales personnelles de l’exploitant'],
  [26, 'Frais de réception, de représentation et de congrès'], [27, 'Fournitures de bureau, documentation, correspondance, téléphone'],
  [28, 'Frais d’actes et de contentieux'], [29, 'Cotisations syndicales et professionnelles'], [30, 'Autres frais divers de gestion'],
  [31, 'Frais financiers'], [32, 'Pertes diverses'],
];

const dateFr = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Construit les deux feuilles pour l'année civile `y` (toujours l'année entière, quelle que soit la période exportée). */
export function buildForms(state, y, { who = '', today = '' } = {}) {
  const from = `${y}-01-01`;
  const to = `${y}-12-31`;
  const ca = Object.entries(state.revenues).filter(([d]) => d >= from && d <= to);
  const caTotal = ca.reduce((s, [, r]) => s + r.amount, 0);
  const exp = expandExpenses(state).filter((e) => e.date >= from && e.date <= to);
  const byCat = new Map();
  for (const e of exp) {
    const k = knownCategory(e.category) ?? e.category;
    const t = byCat.get(k) ?? { total: 0, n: 0 };
    t.total += e.amount;
    t.n += 1;
    byCat.set(k, t);
  }
  const tot = (name) => byCat.get(name)?.total ?? 0;
  const cnt = (name) => byCat.get(name)?.n ?? 0;
  const inYear = today && today.slice(0, 4) === String(y);

  // ---------------- 2035 ----------------
  const r35 = [
    [c(`Déclaration 2035 — Année ${y}`, 'text', { kind: 'title' })],
    [c(who, 'text', { kind: 'sub' })],
    note('Aide au remplissage de la 2035 (BNC, déclaration contrôlée) : reportez chaque montant sur la ligne indiquée. À faire valider par votre comptable.'),
    note(`Numéros de ligne du millésime 2026 (revenus 2025). Cases jaunes : à compléter si vous êtes concerné.${inYear ? ` Année en cours : montants arrêtés au ${dateFr(today)}.` : ''}`),
    [],
    head(['Ligne', 'Rubrique de la 2035', 'Montant (€)', 'Ce que contient la ligne']),
  ];
  const freeze = r35.length;
  const row = () => r35.length + 1; // numéro de la prochaine ligne du classeur
  const money = (v, extra = {}) => c(v, 'money', extra);
  const line = (n, label, cell, help = '', kind) => r35.push([c(String(n), 'text', kind ? { kind } : {}), c(label, 'text', kind ? { kind } : {}), cell, c(help, 'text', kind ? { kind } : {})]);

  r35.push(section('RECETTES'));
  const R1 = row();
  line(1, 'Recettes encaissées, y compris remboursements de frais', money(caTotal), plural(ca.length, 'journée de CA saisie', 'journées de CA saisies'));
  const R2 = row();
  line(2, 'Débours payés pour le compte des clients (à déduire)', money(0, { kind: 'input' }), 'Rare en cabinet médical');
  const R3 = row();
  const retro = CATEGORIES.find((k) => k.kind === 'retro').name;
  line(3, 'Honoraires rétrocédés', money(tot(retro)), cnt(retro) ? plural(cnt(retro), 'frais « rétrocédés »', 'frais « rétrocédés »') : 'Part reversée à un remplaçant ou collaborateur');
  const R4 = row();
  line(4, 'Montant net des recettes', money(caTotal - tot(retro), { f: `C${R1}-C${R2}-C${R3}` }), 'Ligne 1 − ligne 2 − ligne 3');
  const R5 = row();
  line(5, 'Produits financiers', money(0, { kind: 'input' }), 'Intérêts perçus sur le compte professionnel');
  const R6 = row();
  line(6, 'Gains divers', money(0, { kind: 'input' }), 'Indemnités, gains exceptionnels');
  const R7 = row();
  line(7, 'Total des recettes', money(caTotal - tot(retro), { kind: 'total', f: `C${R4}+C${R5}+C${R6}` }), 'Lignes 4 à 6', 'total');

  r35.push(section('DÉPENSES'));
  const refs = [];
  let expTotal = 0;
  for (const [n, label] of EXPENSE_LINES) {
    const cats = CATEGORIES.filter((k) => k.line === n && k.kind !== 'retro');
    if (n === 25) {
      const obl = cats.find((k) => k.sub === 'obligatoires');
      const fac = cats.find((k) => k.sub === 'facultatives');
      const r = row();
      refs.push(`C${r}`);
      const sum = tot(obl.name) + tot(fac.name);
      expTotal += sum;
      line(n, label, money(sum, { f: `C${r + 1}+C${r + 2}` }), 'Total des deux lignes ci-dessous');
      line('', 'dont obligatoires (URSSAF, CARMF…)', money(tot(obl.name)), cnt(obl.name) ? plural(cnt(obl.name), 'opération', 'opérations') : obl.hint, 'dont');
      line('', 'dont facultatives (Madelin : mutuelle, prévoyance, retraite)', money(tot(fac.name)), cnt(fac.name) ? plural(cnt(fac.name), 'opération', 'opérations') : fac.hint, 'dont');
      continue;
    }
    const r = row();
    refs.push(`C${r}`);
    if (!cats.length) {
      line(n, label, money(0, { kind: 'input' }), n === 11 ? 'TVA non récupérable : laissez 0 si le cabinet n’est pas assujetti' : '');
      continue;
    }
    const sum = cats.reduce((s, k) => s + tot(k.name), 0);
    const nOps = cats.reduce((s, k) => s + cnt(k.name), 0);
    expTotal += sum;
    line(n, label, money(sum), nOps ? plural(nOps, 'opération', 'opérations') : cats[0].hint);
  }
  const R33 = row();
  line(33, 'Total des dépenses professionnelles', money(expTotal, { kind: 'total', f: refs.join('+') }), 'Lignes 8 à 32', 'total');

  r35.push(section('RÉSULTAT'));
  const diff = caTotal - tot(retro) - expTotal;
  const R34 = row();
  line(34, 'Excédent (ligne 7 − ligne 33)', money(Math.max(diff, 0), { f: `MAX(C${R7}-C${R33},0)` }), 'Résultat comptable positif');
  const R35 = row();
  line(35, 'Insuffisance (ligne 33 − ligne 7)', money(Math.max(-diff, 0), { f: `MAX(C${R33}-C${R7},0)` }), 'Résultat comptable négatif');
  const RADJ = row();
  line('36 à 45', 'Retraitements fiscaux nets (réintégrations − déductions)', money(0, { kind: 'input' }), 'Plus et moins-values, amortissements… à voir avec votre comptable (+ augmente le résultat)');
  const R46 = row();
  line(46, 'Bénéfice', money(Math.max(diff, 0), { kind: 'total', f: `MAX(C${R34}-C${R35}+C${RADJ},0)` }), 'À reporter sur la 2042-C-PRO, case 5QC', 'total');
  const R47 = row();
  line(47, 'Déficit', money(Math.max(-diff, 0), { kind: 'total', f: `MAX(-(C${R34}-C${R35}+C${RADJ}),0)` }), 'À reporter sur la 2042-C-PRO, case 5QE', 'total');
  r35.push([]);
  r35.push(note('Les lignes 36 à 45 (réintégrations et déductions) sont ramenées à un solde net : sans retraitement, bénéfice = excédent.'));

  // ---------------- 2042-C-PRO ----------------
  const ref = (r) => `'${SHEET_2035}'!C${r}`;
  const r42 = [
    [c(`Déclaration 2042-C-PRO — revenus ${y}`, 'text', { kind: 'title' })],
    [c(who, 'text', { kind: 'sub' })],
    note(`À déposer avec la déclaration de revenus du printemps ${y + 1}, section « Revenus non commerciaux professionnels — régime de la déclaration contrôlée ».`),
    note('Cases du déclarant 1 ; pour le conjoint, remplacez 5Q… par 5R… ; pour une personne à charge, par 5S…'),
    [],
    head(['Case', 'Rubrique de la 2042-C-PRO', 'Montant (€)', 'D’où vient le chiffre']),
  ];
  const l42 = (code, label, cell, help = '', kind) => r42.push([c(code, 'text', kind ? { kind } : {}), c(label, 'text', kind ? { kind } : {}), cell, c(help, 'text', kind ? { kind } : {})]);
  r42.push(section('BNC PROFESSIONNELS — DÉCLARATION CONTRÔLÉE'));
  l42('5QC', 'Revenus imposables, cas général', money(Math.max(diff, 0), { f: ref(R46) }), `Bénéfice de la 2035 (ligne 46)`);
  l42('5QE', 'Déficits', money(Math.max(-diff, 0), { f: ref(R47) }), 'Déficit de la 2035 (ligne 47)');
  r42.push(section('À COMPLÉTER SI VOUS ÊTES CONCERNÉ'));
  l42('5XP', 'dont plus-values à court terme', money(0, { kind: 'input' }), 'Ligne 36 de la 2035');
  l42('5XH', 'dont moins-values à court terme', money(0, { kind: 'input' }), 'Ligne 42 de la 2035');
  l42('5QD', 'Plus-values nettes à long terme', money(0, { kind: 'input' }), 'Cession d’éléments d’actif détenus plus de 2 ans');
  r42.push([]);
  r42.push(section('RAPPEL DES TOTAUX DE L’ANNÉE'));
  l42('', 'Recettes encaissées (2035, ligne 7)', money(caTotal - tot(retro), { f: ref(R7) }), '');
  l42('', 'Dépenses professionnelles (2035, ligne 33)', money(expTotal, { f: ref(R33) }), '');
  l42('', 'Résultat avant retraitements', money(diff, { f: `${ref(R7)}-${ref(R33)}` }), 'Avant cotisations Madelin éventuelles et autres retraitements');
  r42.push([]);
  r42.push(note('Cette feuille est une aide : vérifiez les cases sur le formulaire en vigueur (impots.gouv.fr) et faites valider par votre comptable.'));

  return [
    { name: SHEET_2035, widths: [10, 52, 16, 52], rows: r35, freezeRow: freeze },
    { name: SHEET_2042, widths: [10, 46, 16, 48], rows: r42, freezeRow: 6 },
  ];
}
