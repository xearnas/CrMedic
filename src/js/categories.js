// Catégories de frais : celles des lignes de dépenses de la déclaration 2035-A (BNC, déclaration contrôlée).
// Liste fermée : l'utilisateur ne peut plus en ajouter, ce qui garantit que chaque frais se reporte sur une ligne de la 2035.
// Numéros de ligne : formulaire 2035-A, millésime 2026 (revenus 2025). À revérifier si l'administration renumérote.

/**
 * `line` : numéro de ligne de la 2035-A ; `sub` : sous-ligne éventuelle (25 : « dont obligatoires » / « dont facultatives ») ;
 * `kind: 'retro'` : honoraires rétrocédés, qui se déduisent des recettes (ligne 3) au lieu de figurer dans les dépenses.
 */
export const CATEGORIES = [
  { name: 'Honoraires rétrocédés (remplaçant)', line: 3, kind: 'retro', hint: 'Part des honoraires reversée à un remplaçant ou un collaborateur' },
  { name: 'Achats', line: 8, hint: 'Matériel à usage unique, consommables, pharmacie du cabinet' },
  { name: 'Salaires nets', line: 9, hint: 'Salaire net d’un employé (secrétaire…)' },
  { name: 'Charges sociales sur salaires', line: 10, hint: 'Cotisations patronales (URSSAF…) sur les salaires' },
  { name: 'Contribution économique territoriale', line: 12, hint: 'CFE (cotisation foncière des entreprises)' },
  { name: 'Autres impôts', line: 13, hint: 'Taxe foncière, taxe sur les salaires, droits divers' },
  { name: 'CSG déductible', line: 14, hint: 'Part déductible de la CSG' },
  { name: 'Loyer et charges locatives', line: 15, hint: 'Loyer du cabinet et charges de copropriété' },
  { name: 'Location de matériel et mobilier', line: 16, hint: 'Location de matériel, logiciels, abonnements, lecteur de cartes' },
  { name: 'Entretien et réparations', line: 17, hint: 'Ménage, maintenance, petits travaux' },
  { name: 'Personnel intérimaire', line: 18, hint: 'Intérim, remplacement de personnel' },
  { name: 'Petit outillage', line: 19, hint: 'Petit matériel de moins de 500 € HT' },
  { name: 'Chauffage, eau, gaz, électricité', line: 20, hint: 'Énergie et eau du cabinet' },
  { name: 'Honoraires (comptable, avocat…)', line: 21, hint: 'Honoraires versés, hors rétrocessions : expert-comptable, avocat, notaire' },
  { name: 'Primes d’assurances', line: 22, hint: 'Responsabilité civile professionnelle, multirisque cabinet' },
  { name: 'Frais de véhicules', line: 23, hint: 'Carburant, entretien, assurance du véhicule ou indemnités kilométriques' },
  { name: 'Autres frais de déplacements', line: 24, hint: 'Train, avion, hôtel, repas hors du cabinet' },
  { name: 'Charges sociales personnelles', line: 25, sub: 'obligatoires', hint: 'URSSAF, CARMF, retraite et maladie obligatoires du praticien' },
  { name: 'Mutuelle et prévoyance (Madelin)', line: 25, sub: 'facultatives', hint: 'Mutuelle, prévoyance et retraite facultatives (contrats Madelin)' },
  { name: 'Réception, représentation, congrès', line: 26, hint: 'Congrès, repas d’affaires, cadeaux de représentation' },
  { name: 'Fournitures, documentation, téléphone', line: 27, hint: 'Papeterie, revues, abonnements, téléphone, internet, ports' },
  { name: 'Frais d’actes et de contentieux', line: 28, hint: 'Frais d’actes, de procédure, de recouvrement' },
  { name: 'Cotisations syndicales et professionnelles', line: 29, hint: 'Ordre des médecins, syndicats, associations professionnelles' },
  { name: 'Autres frais divers de gestion', line: 30, hint: 'Formation, cadeaux, tout ce qui ne rentre pas ailleurs' },
  { name: 'Frais financiers', line: 31, hint: 'Intérêts d’emprunt, frais bancaires' },
  { name: 'Pertes diverses', line: 32, hint: 'Chèques impayés, pertes exceptionnelles' },
];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
export const FALLBACK_CATEGORY = 'Autres frais divers de gestion';

/** Anciennes catégories libres (avant la liste 2035) et leur équivalent. */
const LEGACY = {
  consommables: 'Achats',
  'loyer & charges': 'Loyer et charges locatives',
  loyer: 'Loyer et charges locatives',
  deplacements: 'Autres frais de déplacements',
  logiciels: 'Location de matériel et mobilier',
  formation: 'Autres frais divers de gestion',
  mutuelle: 'Mutuelle et prévoyance (Madelin)',
  vehicule: 'Frais de véhicules',
  fonctionnement: 'Fournitures, documentation, téléphone',
  autre: FALLBACK_CATEGORY,
};

const key = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
const BY_KEY = new Map([...CATEGORY_NAMES.map((n) => [key(n), n]), ...Object.entries(LEGACY).map(([k, v]) => [key(k), v])]);

/** Nom canonique d'une catégorie connue (liste 2035 ou ancien nom), ou `null`. */
export function knownCategory(name) {
  return BY_KEY.get(key(name)) ?? null;
}

/**
 * Remet d'aplomb la catégorie d'un frais déjà enregistré. Une catégorie personnalisée inconnue devient
 * « Autres frais divers de gestion » et son ancien nom est conservé dans la note : rien n'est perdu.
 */
export function migrateCategory(category, note = '') {
  const known = knownCategory(category);
  if (known) return { category: known, note };
  const old = String(category ?? '').trim();
  if (!old) return { category: FALLBACK_CATEGORY, note };
  return { category: FALLBACK_CATEGORY, note: note ? `${old} · ${note}`.slice(0, 200) : old.slice(0, 200) };
}

export function categoryInfo(name) {
  return CATEGORIES.find((c) => c.name === knownCategory(name)) ?? null;
}

/** Libellé affiché dans les listes : « Loyer et charges locatives (ligne 15) ». */
export function categoryLabel(name) {
  const c = categoryInfo(name);
  return c ? `${c.name} (ligne ${c.line})` : name;
}
