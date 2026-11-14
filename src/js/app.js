// Interface : routage par hash, rendu des vues, gestion des événements.
import {
  WEEKDAY_HEADS, amountCompact, daysInMonth, escapeHtml as esc, eur, eur2, firstWeekdayOffset, initials, longDate, monthLabel,
  parseAmount, parseCount, pct, shiftMonth, shortDate, todayISO, toISO,
} from './format.js';
import {
  ACCENTS, CATEGORIES_ADDED_V2, EVERY, ValidationError, addCategory, addExpense, expandExpenses, exportJSON, importJSON, isEmpty, load, removeCategory,
  removeExpense, removeRevenue, sampleState, save, setRevenue, updateExpense, updateProfile, withCategories,
} from './store.js';
import { categoryTotals, dailySeries, monthRange, monthlySeries, periodStats, recentEntries, yearOverview, yearRange } from './stats.js';
import { downloadText, downscaleImage, formatSize, readText } from './img.js';
import { MONTHS_FR } from './format.js';
import { buildReport, periodOptions, reportFileName, resolvePeriod } from './report.js';
import { downloadBinary, loadExcelJS, writeXlsx } from './xlsx.js';
import * as auth from './auth.js';
import { createDrive, fileUrl } from './drive.js';
import { createSync } from './sync.js';
import { createPhotos } from './photos.js';
import { FILE_NAME } from './sheetmodel.js';

// ---------- État ----------
function safeStorage() {
  try {
    localStorage.setItem('__crmedic_test', '1');
    localStorage.removeItem('__crmedic_test');
    return localStorage;
  } catch {
    return null;
  }
}
const storage = safeStorage();
let state = load(storage);
// Nouvelles catégories par défaut (Mutuelle, Véhicule, Fonctionnement) : ajoutées une seule fois aux listes existantes.
try {
  if (storage && !storage.getItem('crmedic.cats.v2')) {
    storage.setItem('crmedic.cats.v2', '1');
    const next = withCategories(state, CATEGORIES_ADDED_V2);
    if (next !== state) {
      state = next;
      save(storage, state);
      queueMicrotask(() => sync.pushSoon());
    }
  }
} catch { /* stockage indisponible */ }

const start = new Date();
const ui = {
  y: start.getFullYear(), m: start.getMonth() + 1, sel: todayISO(start),
  period: 'month', menu: false, cat: null, accent: null,
  form: newProofForm(), yearTab: 'all', edit: null, viewer: null, target: 'exp', expAll: false,
  exp: { y: start.getFullYear(), period: 'year', sheet: 0 },
};
const $ = (sel, root = document) => root.querySelector(sel);

/** Justificatifs et récurrence du frais en cours de saisie (formulaire d'ajout) ou de modification (fiche). */
function newProofForm() {
  return { docs: [], noDoc: false, recur: false, every: 'month', end: '' };
}

function commit(next) {
  state = next;
  if (storage && !save(storage, state)) {
    toast('Stockage du navigateur plein : exportez vos données (Profil) pour ne rien perdre.', true);
    return false;
  }
  sync.pushSoon();
  photos.uploadSoon();
  return true;
}

// ---------- Synchronisation Google Drive ----------
const PERSIST_KEY = 'crmedic.google.v1';
const persist = {
  read() {
    try { return JSON.parse(storage?.getItem(PERSIST_KEY)); } catch { return null; }
  },
  write(v) {
    try { if (v) storage?.setItem(PERSIST_KEY, JSON.stringify(v)); else storage?.removeItem(PERSIST_KEY); } catch { /* stockage indisponible */ }
  },
};

function askConflict() {
  if (confirm("Le fichier « " + FILE_NAME + " » du Drive contient déjà des données, différentes de celles de cet appareil.\n\nOK : charger les données du Drive (celles de cet appareil seront remplacées).\nAnnuler : autres choix.")) return 'pull';
  if (confirm('Remplacer le contenu du fichier Drive par les données de cet appareil ?\n\nOK : écraser le Drive.\nAnnuler : ne pas se connecter.')) return 'push';
  return 'cancel';
}

const drive = createDrive({ fetchFn: (...a) => fetch(...a), getToken: auth.getToken });
const sync = createSync({
  drive,
  auth,
  persist,
  getState: () => state,
  setState: (next) => {
    state = next;
    if (storage) save(storage, state);
    // Le Drive peut répondre pendant que l'utilisateur remplit un formulaire : on garde sa saisie en cours.
    const typed = [...document.querySelectorAll('form input[id], form textarea[id], form select[id]')]
      .filter((el) => el.type !== 'file' && el.value !== el.defaultValue)
      .map((el) => [el.id, el.value]);
    render();
    for (const [id, value] of typed) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }
  },
  askConflict,
  onStatus: (st) => {
    if (st.phase === 'synced') photos.uploadSoon();
    renderChrome();
    document.querySelectorAll('.mobile-sync').forEach((el) => { el.outerHTML = mobileSync(); });
    const sec = $('#sec-google');
    if (sec) sec.innerHTML = googleInner();
  },
});

// ---------- Photos des justificatifs (envoyées dans le Drive en arrière-plan) ----------
let uploadTimer = null;
const photos = {
  ...createPhotos({
    drive,
    getState: () => state,
    setState: (next) => { commit(next); },
    canUpload: () => ['synced', 'pending'].includes(sync.getStatus().phase),
    toUrl: (blob) => URL.createObjectURL(blob),
    onChange: () => { refreshExpList(); renderSheet(); },
  }),
  uploadSoon() {
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => photos.uploadPending(), 800);
  },
};

const isSyncing = () => sync.getStatus().phase !== 'off';

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 2600);
}

// ---------- Icônes ----------
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  euro: '<path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.8 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z"/>',
  tag: '<path d="M20 13l-7 7-9-9V4h7zM8 8h.01"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9z"/>',
  repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"/>',
};
const svg = (name, size = 20, sw = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------- Aides de rendu ----------
const today = () => todayISO(new Date());

function relDate(iso) {
  const t = today();
  if (iso === t) return "Aujourd'hui";
  const [y, m, d] = t.split('-').map(Number);
  if (iso === todayISO(new Date(y, m - 1, d - 1))) return 'Hier';
  return shortDate(iso);
}

function avatarHtml(cls = '', tag = 'div', attrs = '') {
  const p = state.profile;
  const inner = p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name));
  return `<${tag} class="avatar ${cls}" ${attrs}>${inner}</${tag}>`;
}

function mobileHead(eyebrow, title) {
  return `<div class="mobile-head"><div class="mobile-title"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div>
    <div class="mobile-tools">${mobileSync()}${avatarHtml('', 'a', 'href="#/profil" aria-label="Profil et réglages"')}</div></div>`;
}

function applyAccent(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  $('meta[name="theme-color"]')?.setAttribute('content', hex);
}

// ---------- Routage ----------
function parseRoute() {
  const [name = '', section = ''] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'ca' || name === 'frais' || name === 'profil' || name === 'export') return { name, section };
  return { name: 'dash', section: '' };
}

function render() {
  const route = parseRoute();
  ui.menu = false;
  ui.accent = null;
  applyAccent(state.profile.accent);
  const views = { dash: dashView, ca: () => saisieView('ca'), frais: () => saisieView('frais'), profil: profilView, export: exportView };
  const titles = { dash: 'Chiffres', ca: 'CA du jour', frais: 'Ajouter un frais', profil: 'Profil et réglages', export: 'Export pour le comptable' };
  $('#view').innerHTML = views[route.name]();
  renderChrome(route);
  document.body.classList.toggle('fit', route.name === 'dash'); // ordinateur : l'écran principal tient dans la fenêtre
  document.title = `${titles[route.name]} — CrMedic`;
  const target = route.section && $(`#sec-${route.section}`);
  if (target) target.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
  if (route.name === 'profil') $('#view').classList.add('profil');
  else $('#view').classList.remove('profil');
}

const SYNC_LABELS = {
  connecting: 'Connexion…', pending: 'Envoi en cours…', synced: 'Synchronisé', offline: 'Hors ligne',
  login: 'Reconnecter Google', error: 'Erreur de synchronisation',
};
/** Bouton de statut en haut à droite sur téléphone : un appui reconnecte, ou synchronise tout de suite. */
const MOBILE_SYNC = { off: 'Connecter', connecting: 'Connexion…', pending: 'Envoi…', synced: 'Synchro', offline: 'Hors ligne', login: 'Reconnecter', error: 'Erreur' };
function mobileSync() {
  if (!auth.isConfigured()) return '';
  const { phase } = sync.getStatus();
  const action = { login: 'google-reconnect', off: 'google-connect', connecting: '' }[phase] ?? 'google-sync';
  const hint = { off: 'Se connecter à Google', synced: 'Synchronisé : appuyer pour synchroniser maintenant', login: 'Session expirée : appuyer pour se reconnecter', offline: 'Hors ligne : appuyer pour réessayer', error: 'Erreur de synchronisation : appuyer pour réessayer', pending: 'Envoi en cours', connecting: 'Connexion en cours' }[phase];
  return `<button type="button" class="sync-badge mobile-sync sync-${phase}" ${action ? `data-action="${action}"` : 'disabled'} aria-label="${esc(hint)}" title="${esc(hint)}">${svg('cloud', 16, 2)}${MOBILE_SYNC[phase]}</button>`;
}

function syncBadge() {
  const { phase } = sync.getStatus();
  if (phase === 'off') return '';
  if (phase === 'login') return `<button type="button" class="sync-badge sync-login" data-action="google-reconnect" title="Reconnecter le compte Google">${svg('cloud', 16, 2)}${SYNC_LABELS[phase]}</button>`;
  return `<a class="sync-badge sync-${phase}" href="#/profil/google" title="Compte Google et Drive">${svg('cloud', 16, 2)}${SYNC_LABELS[phase]}</a>`;
}

function renderChrome(route = parseRoute()) {
  const isProfil = route.name === 'profil';
  $('#topbar').hidden = isProfil;
  $('#tabbar').hidden = isProfil;
  if (!isProfil) {
    const cur = (n) => (route.name === n ? 'aria-current="page"' : '');
    $('#topbar').innerHTML = `<div class="topbar-in">
      <div class="topbar-left">
        <div class="who">
          <button type="button" class="who-btn" data-action="toggle-menu" aria-haspopup="menu" aria-expanded="${ui.menu}">
            ${avatarHtml()}
            <span><span class="who-name" style="display:block">${esc(state.profile.name)}</span>
            <span class="who-sub">Médecine générale · suivi CA &amp; frais</span></span>
            ${svg('down', 18, 2.2)}
          </button>
          ${ui.menu ? `<div class="menu" role="menu">
            <a role="menuitem" href="#/profil/profil">${svg('user')}Modifier le profil &amp; la photo</a>
            <a role="menuitem" href="#/profil/apparence">${svg('palette')}Couleurs de l'application</a>
            <a role="menuitem" href="#/profil/categories">${svg('tag')}Catégories de frais</a>
            <a role="menuitem" href="#/profil/google">${svg('cloud')}Compte Google &amp; Drive</a>
            <a role="menuitem" href="#/profil/donnees">${svg('download')}Sauvegarde des données</a></div>` : ''}
        </div>
        <a class="btn navlink" href="#/" ${cur('dash')}>${svg('chart', 18)}Chiffres</a>
        <a class="btn navlink" href="#/export" ${cur('export')}>${svg('sheet', 18)}Export Excel</a>
      </div>
      <div class="topbar-actions">
        ${syncBadge()}
        <a class="btn btn-primary" href="#/ca">${svg('plus', 18, 2.2)}Saisir le CA du jour</a>
        <a class="btn btn-outline" href="#/frais">${svg('camera', 18)}Ajouter un frais</a>
      </div></div>`;
    const tab = (href, n, icon, label, extra = '') =>
      `<a class="tab ${extra}" href="${href}" ${cur(n)}>${svg(icon, 22)}${label}</a>`;
    $('#tabbar').innerHTML = tab('#/ca', 'ca', 'euro', 'CA') + tab('#/frais', 'frais', 'camera', 'Frais', 'cost') + tab('#/', 'dash', 'chart', 'Chiffres') + tab('#/export', 'export', 'sheet', 'Export');
  }
}

// ---------- Tableau de bord ----------
function kpi(label, value, sub, { cost = false, accent = false } = {}) {
  if (accent) return `<div class="kpi kpi-accent"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
  return `<div class="kpi"><div class="kpi-label"><span class="dot ${cost ? 'cost' : ''}"></span>${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}

function categoryBars(list) {
  if (!list.length) return '<p class="muted">Aucun frais sur cette période.</p>';
  const max = Math.max(...list.map((c) => c.total));
  return list.map((c) => `<div class="catrow"><div class="catrow-top"><span>${esc(c.name)}</span><b>${eur(c.total)}</b></div>
    <div class="track"><i style="width:${Math.round((c.total / max) * 100)}%"></i></div></div>`).join('');
}

function recentItem(r) {
  if (r.kind === 'ca') {
    return `<div class="item"><div class="item-ico">${svg('euro')}</div><div class="item-body">
      <div class="item-title">CA du jour</div><div class="item-sub">${esc(relDate(r.date))}${r.count != null ? ` · ${r.count} consultation${r.count > 1 ? 's' : ''}` : ''}</div></div>
      <div class="item-amount">+ ${eur(r.amount)}</div></div>`;
  }
  return `<button type="button" class="item item-btn" data-action="open-expense" data-id="${esc(r.id)}"><div class="item-ico cost">${svg(r.recurring ? 'repeat' : 'receipt')}</div><div class="item-body">
    <div class="item-title">${esc(r.note || r.category)}</div><div class="item-sub">${esc(relDate(r.date))} · ${esc(r.category)}${r.hasDoc ? ' · justificatif joint' : ''}${r.recurring ? ' · récurrent' : ''}</div></div>
    <div class="item-amount cost">− ${eur(r.amount)}</div></button>`;
}

// ---------- Écran principal (ordinateur) : tient dans la fenêtre, sans défilement ----------
const YEAR_TABS = [['all', '3 années'], ['prev', 'Année précédente'], ['cur', 'Année actuelle'], ['next', 'Année suivante']];
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const axisLabel = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)} k` : String(Math.round(v)));

/** Plafond de l'axe vertical : 4 graduations régulières et « rondes », au plus près du maximum. */
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v / 4));
  return 4 * ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((x) => x * 4 >= v) ?? v / 4);
}

function deskChart(tab, y, ovs) {
  const keys = tab === 'all' ? ['prev', 'cur', 'next'] : [tab];
  const yearOf = { prev: y - 1, cur: y, next: y + 1 };
  const all = ['prev', 'cur', 'next'].flatMap((k) => ovs[k].months.flatMap((m) => [m.ca, m.frais]));
  const top = niceMax(Math.max(1, ...(tab === 'all' ? all : keys.flatMap((k) => ovs[k].months.flatMap((m) => [m.ca, m.frais])))));
  const nowMonth = new Date().getMonth();
  const col = (m, k, i) => {
    const real = m.frais ? Math.round((m.fraisReel / m.frais) * 100) : 0;
    const tip = `${m.label} ${yearOf[k]} : CA ${eur(m.ca)}, frais ${eur(m.fraisReel)}${m.fraisPrevu ? ` + ${eur(m.fraisPrevu)} prévus` : ''}`;
    return `<div class="d-col ${k === 'cur' && i === nowMonth ? 'is-now' : ''}" title="${esc(tip)}">
      <div class="bar ${m.ca ? '' : 'zero'}" style="height:${(m.ca / top) * 100}%"></div>
      <div class="bar cost ${m.frais ? '' : 'zero'} ${m.fraisPrevu ? 'proj' : ''}" style="height:${(m.frais / top) * 100}%;--real:${real}%"></div></div>`;
  };
  const labels = tab === 'all' ? MONTH_INITIALS : ovs[keys[0]].months.map((m) => m.label);
  const yearTag = (k) => (k === 'cur' ? ' <em>en cours</em>' : k === 'next' ? ' <em class="fut">prévisionnel</em>' : '');
  return `<div class="d-chart">
    <div class="d-y">${[1, 0.75, 0.5, 0.25, 0].map((f) => `<span>${f ? axisLabel(top * f) : '0'}</span>`).join('')}</div>
    <div class="d-area">
      ${[0.25, 0.5, 0.75, 1].map((f) => `<i class="d-grid" style="bottom:${f * 100}%"></i>`).join('')}
      <div class="d-groups">${keys.map((k) => `<div class="d-group">${ovs[k].months.map((m, i) => col(m, k, i)).join('')}</div>`).join('')}</div>
    </div>
    <div class="d-x">${keys.map(() => `<div class="d-group d-labels">${labels.map((l) => `<span>${l}</span>`).join('')}</div>`).join('')}</div>
    ${tab === 'all' ? `<div class="d-x d-yrow">${keys.map((k) => `<div class="d-group"><b>${yearOf[k]}</b>${yearTag(k)}</div>`).join('')}</div>` : ''}
  </div>`;
}

function deskYears(y) {
  const ovs = { prev: yearOverview(state, y - 1), cur: yearOverview(state, y), next: yearOverview(state, y + 1) };
  const tab = ui.yearTab;
  const yearOf = { prev: y - 1, cur: y, next: y + 1 };
  const sum = (k) => {
    const ov = ovs[k];
    const head = `<div class="ysum-year">${yearOf[k]} <em class="${k === 'next' ? 'fut' : ''}">${{ prev: 'réalisé', cur: 'en cours', next: 'prévisionnel' }[k]}</em></div>`;
    if (k === 'next') return `<div class="ysum">${head}<div class="ysum-vals"><span><i class="dot proj"></i>Frais prévus <b>${eur(ov.frais)}</b></span></div></div>`;
    return `<div class="ysum">${head}<div class="ysum-vals"><span><i class="dot"></i>CA <b>${eur(ov.ca)}</b></span><span><i class="dot cost"></i>Frais <b>${eur(ov.frais)}</b></span>
      <span>Solde <b>${eur(ov.solde)}</b></span></div>${ov.fraisPrevu ? `<div class="ysum-sub">dont ${eur(ov.fraisPrevu)} de frais prévus</div>` : ''}</div>`;
  };
  const one = (k) => {
    const ov = ovs[k];
    if (k === 'next') return [kpi('Frais prévus', eur(ov.frais), 'frais récurrents à venir', { cost: true }), kpi('Moyenne par mois', eur(ov.frais / 12), 'frais récurrents uniquement', { cost: true })];
    return [
      kpi(k === 'cur' ? 'CA à ce jour' : 'CA', eur(ov.ca), `moy. ${eur(ov.ca / 12)} / mois`),
      kpi('Frais', eur(ov.frais), ov.fraisPrevu ? `dont ${eur(ov.fraisPrevu)} prévus (récurrents)` : `${pct(ov.frais, ov.ca)} du CA`, { cost: true }),
      kpi(k === 'cur' ? 'Solde à ce jour' : 'Solde CA − frais', eur(ov.solde), ov.fraisPrevu ? `après frais prévus : ${eur(ov.soldeProjete)}` : 'Avant charges sociales et impôts', { accent: true }),
    ];
  };
  const hasProj = ['prev', 'cur', 'next'].some((k) => ovs[k].fraisPrevu > 0);
  return `<section class="card d-years" aria-label="Années">
    <div class="d-sums ${tab === 'all' ? '' : 'd-kpis'}">${tab === 'all' ? ['prev', 'cur', 'next'].map(sum).join('') : one(tab).join('')}</div>
    <div class="d-body">
      <div class="ytabs" role="tablist" aria-label="Période du graphique">${YEAR_TABS.map(([id, label]) => `<button type="button" role="tab" class="ytab" data-action="set-year-tab" data-tab="${id}" aria-selected="${tab === id}">${label}${id === 'all' ? '' : `<small>${yearOf[{ prev: 'prev', cur: 'cur', next: 'next' }[id]]}</small>`}</button>`).join('')}</div>
      <div class="d-chartbox">
        <div class="legend"><span><i class="dot"></i>CA</span><span><i class="dot cost"></i>Frais</span>${hasProj ? '<span><i class="dot proj"></i>Frais prévus</span>' : ''}</div>
        ${deskChart(tab, y, ovs)}
      </div>
    </div>
  </section>`;
}

function deskMonth(y, mo) {
  const ms = periodStats(state, monthRange(y, mo));
  const daily = dailySeries(state, y, mo);
  const maxDay = Math.max(1, ...daily);
  const cats = categoryTotals(state, monthRange(y, mo)).slice(0, 3);
  const recent = recentEntries(state, 3);
  const mk = (label, value, sub, cls = '') => `<div class="mk ${cls}"><div class="mk-l">${label}</div><div class="mk-v">${value}</div><div class="mk-s">${sub}</div></div>`;
  return `<aside class="d-month" aria-label="Mois en cours">
    <h2 class="section-title">${esc(monthLabel(y, mo))}</h2>
    <div class="mks">
      ${mk('Chiffre d\'affaires', eur(ms.ca), `${ms.jours} j travaillé${ms.jours > 1 ? 's' : ''} · moy. ${eur(ms.moyJour)}`)}
      ${mk('Frais', eur(ms.frais), `${ms.nbFrais} ligne${ms.nbFrais > 1 ? 's' : ''} · ${pct(ms.frais, ms.ca)} du CA`, 'cost')}
      ${mk('Solde CA − frais', eur(ms.solde), 'avant charges et impôts', 'accent')}
    </div>
    <div class="card d-daily"><div class="card-title">CA par jour</div>
      <div class="bars" role="img" aria-label="CA par jour du mois, total ${eur(ms.ca)}">${daily.map((v, i) => `<div class="bar-col" title="${i + 1} : ${eur(v)}"><div class="bar ${v ? '' : 'zero'}" style="height:${Math.round((v / maxDay) * 100)}%"></div></div>`).join('')}</div></div>
    <div class="card d-cats"><div class="card-title">Frais par catégorie</div>${categoryBars(cats)}</div>
    <div class="card d-recent"><div class="card-title">Dernières saisies</div><div class="list">${recent.length ? recent.map(recentItem).join('') : '<p class="muted">Rien pour l\'instant.</p>'}</div></div>
  </aside>`;
}

function dashView() {
  const n = new Date();
  const y = n.getFullYear();
  const mo = n.getMonth() + 1;
  const ms = periodStats(state, monthRange(y, mo));
  const ys = periodStats(state, yearRange(y, mo));
  const daily = dailySeries(state, y, mo);
  const maxDay = Math.max(1, ...daily);
  const months = monthlySeries(state, y, mo);
  const maxMonth = Math.max(1, ...months.flatMap((x) => [x.ca, x.frais]));
  const nDays = daily.length;
  const monthName = monthLabel(y, mo);
  const yearTitle = `Année ${y} (${mo === 1 ? 'janvier' : `janvier – ${monthLabel(y, mo).split(' ')[0].toLowerCase()}`})`;
  const recent = recentEntries(state, 5);

  return `<div class="page dash" data-period="${ui.period}">
    ${mobileHead(ui.period === 'month' ? monthName : `Janvier – ${monthName.split(' ')[0].toLowerCase()} ${y}`, 'Chiffres')}
    <div class="page-head"><h1>Vue d'ensemble</h1><div class="muted">Mise à jour ${esc(longDate(today()).toLowerCase())} ${y}</div></div>
    <div class="desk only-desktop">${deskYears(y)}${deskMonth(y, mo)}</div>
    <div class="seg" role="group" aria-label="Période">
      <button type="button" data-action="set-period" data-period="month" aria-pressed="${ui.period === 'month'}">${esc(monthName.split(' ')[0])}</button>
      <button type="button" data-action="set-period" data-period="year" aria-pressed="${ui.period === 'year'}">Année ${y}</button>
    </div>

    <section class="period period-month stack gap-14 only-mobile">
      <h2 class="section-title">${esc(monthName)}</h2>
      <div class="kpis">
        ${kpi('Chiffre d\'affaires', eur(ms.ca), `${ms.jours} jour${ms.jours > 1 ? 's' : ''} travaillé${ms.jours > 1 ? 's' : ''} · moy. ${eur(ms.moyJour)} / jour`)}
        ${kpi('Frais déclarés', eur(ms.frais), `${ms.nbFrais} justificatif${ms.nbFrais > 1 ? 's' : ''} · ${pct(ms.frais, ms.ca)} du CA`, { cost: true })}
        ${kpi('Solde CA − frais', eur(ms.solde), 'Avant charges sociales et impôts', { accent: true })}
      </div>
      <div class="charts">
        <div class="card chart-main stack gap-14">
          <div class="card-title">CA par jour</div>
          <div class="bars" role="img" aria-label="CA par jour du mois, total ${eur(ms.ca)}">
            ${daily.map((v, i) => `<div class="bar-col" title="${i + 1} : ${eur(v)}"><div class="bar ${v ? '' : 'zero'}" style="height:${Math.round((v / maxDay) * 100)}%"></div></div>`).join('')}
          </div>
          <div class="axis"><span>1</span><span>8</span><span>15</span><span>22</span><span>${nDays}</span></div>
        </div>
        <div class="card chart-side stack gap-14"><div class="card-title">Frais par catégorie</div>${categoryBars(categoryTotals(state, monthRange(y, mo)))}</div>
      </div>
    </section>

    <section class="period period-year stack gap-14 only-mobile">
      <h2 class="section-title">${esc(yearTitle)}</h2>
      <div class="kpis">
        ${kpi('CA cumulé', eur(ys.ca), `moy. ${eur(ys.ca / mo)} / mois`)}
        ${kpi('Frais cumulés', eur(ys.frais), `${pct(ys.frais, ys.ca)} du CA`, { cost: true })}
        ${kpi('Solde CA − frais', eur(ys.solde), 'Avant charges sociales et impôts', { accent: true })}
      </div>
      <div class="card stack gap-14">
        <div class="row" style="justify-content:space-between"><div class="card-title">CA et frais par mois</div>
          <div class="legend"><span><i class="dot"></i>CA</span><span><i class="dot cost"></i>Frais</span></div></div>
        <div class="bars tall" role="img" aria-label="CA et frais par mois, année ${y}">
          ${months.map((x) => `<div class="bar-col" title="${x.label} : CA ${eur(x.ca)}, frais ${eur(x.frais)}">
            <div class="bar ${x.ca ? '' : 'zero'}" style="height:${Math.round((x.ca / maxMonth) * 100)}%"></div>
            <div class="bar cost ${x.frais ? '' : 'zero'}" style="height:${Math.round((x.frais / maxMonth) * 100)}%"></div></div>`).join('')}
        </div>
        <div class="axis-cols">${months.map((x) => `<span>${x.label}</span>`).join('')}</div>
      </div>
      <div class="card stack gap-14 only-mobile"><div class="card-title">Frais par catégorie</div>${categoryBars(categoryTotals(state, yearRange(y, mo)))}</div>
    </section>

    <section class="card only-mobile">
      <div class="card-title" style="margin-bottom:8px">Dernières saisies</div>
      <div class="list">${recent.length ? recent.map(recentItem).join('') : '<p class="muted" style="padding-top:8px">Rien pour l\'instant.</p>'}</div>
    </section>
  </div>`;
}

// ---------- Saisie ----------
function saisieView(panel) {
  const head = panel === 'ca' ? mobileHead(longDate(today()), 'CA du jour') : mobileHead('Justificatif', 'Ajouter un frais');
  return `<div class="page">${head}<div class="saisie" data-panel="${panel}">
    <section class="panel panel-ca" id="panel-ca" aria-label="Saisie du CA">${caPanel()}</section>
    <section class="panel panel-frais" id="panel-frais" aria-label="Ajouter un frais">${expPanel()}</section></div></div>`;
}

function caPanel() {
  const { y, m } = ui;
  const t = today();
  const stats = periodStats(state, monthRange(y, m));
  const series = dailySeries(state, y, m);
  const max = Math.max(1, ...series);
  const cells = [];
  for (let i = 0; i < firstWeekdayOffset(y, m); i++) cells.push('<div></div>');
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const iso = toISO(y, m, d);
    const r = state.revenues[iso];
    const future = iso > t;
    const bg = r ? `background:color-mix(in srgb, var(--accent) ${Math.round(10 + 28 * (r.amount / max))}%, white)` : '';
    cells.push(`<div><button type="button" class="day ${r || future ? '' : 'empty'} ${iso === t ? 'today' : ''}" style="${bg}"
      data-action="pick-day" data-date="${iso}" aria-pressed="${ui.sel === iso}" ${future ? 'disabled' : ''}
      aria-label="${d} ${monthLabel(y, m).split(' ')[0].toLowerCase()}, ${future ? 'à venir' : r ? eur(r.amount) : 'pas de saisie'}">
      <span class="d">${d}</span><span class="v">${r ? dayValue(r.amount) : future ? '' : '—'}</span></button></div>`);
  }
  const r = state.revenues[ui.sel];
  const lastDays = Object.entries(state.revenues).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 3);
  const ms = periodStats(state, monthRange(start.getFullYear(), start.getMonth() + 1));
  return `
    <div class="panel-title"><span class="dot"></span><h2>Saisie du CA</h2></div>
    <div class="stack gap-12">
      <div class="cal-head">
        <button type="button" class="cal-nav" data-action="cal-prev" aria-label="Mois précédent">${svg('left', 18, 2.2)}</button>
        <div class="cal-title"><b>${esc(monthLabel(y, m))}</b><span>${eur(stats.ca)} sur ${stats.jours} jour${stats.jours > 1 ? 's' : ''} travaillé${stats.jours > 1 ? 's' : ''}</span></div>
        <button type="button" class="cal-nav" data-action="cal-next" aria-label="Mois suivant">${svg('right', 18, 2.2)}</button>
      </div>
      <div class="cal-grid">${WEEKDAY_HEADS.map((h) => `<div class="cal-dow">${h}</div>`).join('')}${cells.join('')}</div>
      <div class="cal-legend"><span><i style="background:color-mix(in srgb, var(--accent) 38%, white)"></i>Journée forte</span>
        <span><i style="background:color-mix(in srgb, var(--accent) 10%, white)"></i>Journée plus calme</span>
        <span><i style="background:#fff;border:1.5px solid var(--line-strong)"></i>Pas de saisie</span></div>
    </div>
    <form class="form" id="form-ca" novalidate>
      <div class="form-title">${esc(longDate(ui.sel))}${ui.sel === t ? " (aujourd'hui)" : ''}</div>
      <div class="row">
        <div class="field" style="flex:2 1 200px"><label for="ca-amount">Total encaissé</label>
          <div class="input-money"><input id="ca-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${r ? esc(String(r.amount).replace('.', ',')) : ''}"><span>€</span></div></div>
        <div class="field" style="flex:1 1 130px"><label for="ca-count">Consultations</label>
          <input class="input" id="ca-count" type="text" inputmode="numeric" autocomplete="off" value="${r && r.count != null ? r.count : ''}" style="height:56px;font-size:20px;font-weight:600"></div>
      </div>
      <p class="error" id="err-ca" role="alert"></p>
      <button type="submit" class="btn btn-primary btn-lg">${svg('check', 20, 2.4)}Enregistrer le CA</button>
      ${r ? `<button type="button" class="btn btn-danger" data-action="del-ca">${svg('trash', 18)}Supprimer cette saisie</button>` : ''}
    </form>
    <div class="last-days stack card" style="padding:6px 14px">
      <div class="muted" style="padding:10px 0 6px;font-size:13px;font-weight:700">Derniers jours</div>
      ${lastDays.length ? lastDays.map(([d, v]) => `<div class="row" style="justify-content:space-between;padding:10px 0;border-top:1px solid var(--line-soft);font-size:15px;flex-wrap:nowrap"><span>${esc(longDate(d))}</span><b>${eur(v.amount)}</b></div>`).join('') : '<p class="muted" style="padding:6px 0 10px;font-size:14px">Aucune saisie.</p>'}
      <div class="muted" style="padding:8px 0 10px;font-size:12px;border-top:1px solid var(--line-soft)">Mois en cours : ${eur(ms.ca)} de CA · ${eur(ms.frais)} de frais</div>
    </div>`;
}

// ---------- Justificatifs et récurrence d'un frais (formulaire d'ajout « exp » et fiche de modification « ed ») ----------
const formOf = (scope) => (scope === 'ed' ? ui.edit : ui.form);

function photoTile(d, scope) {
  const hasImg = d.dataUrl || d.driveId;
  const inner = hasImg
    ? `<img data-doc="${esc(d.id)}" alt="${esc(d.name)}"${d.dataUrl ? ` src="${esc(d.dataUrl)}"` : ''}>`
    : `<span class="photo-file">${svg('file', 24)}<small>${esc(d.name)}</small></span>`;
  const pending = d.dataUrl && !d.driveId;
  return `<div class="photo">
    <button type="button" class="photo-open" ${hasImg ? `data-action="view-photo" data-scope="${scope}" data-id="${esc(d.id)}"` : 'disabled'} aria-label="${hasImg ? 'Agrandir' : ''} ${esc(d.name)}">${inner}</button>
    ${pending ? `<span class="photo-tag" title="Sera envoyée dans votre Drive dès que possible">${isSyncing() ? 'envoi…' : 'sur cet appareil'}</span>` : ''}
    <button type="button" class="photo-del" data-action="detach" data-scope="${scope}" data-id="${esc(d.id)}" aria-label="Retirer ${esc(d.name)}">${svg('x', 14, 2.6)}</button></div>`;
}

function proofBlock(scope) {
  const f = formOf(scope);
  return `<div class="photo-grid">${f.docs.map((d) => photoTile(d, scope)).join('')}</div>
    ${f.noDoc ? '<p class="muted" style="font-size:14px">Ce frais est marqué « sans justificatif » : il n\'y a pas de photo à joindre.</p>' : `<div class="btns">
      <button type="button" class="btn btn-outline" data-action="open-cam" data-scope="${scope}">${svg('camera', 20)}Prendre une photo</button>
      <button type="button" class="btn btn-outline" data-action="open-file" data-scope="${scope}">${svg('image', 20)}${f.docs.length ? 'Ajouter une autre photo' : 'Choisir des fichiers'}</button></div>`}
    <label class="check"><input type="checkbox" id="${scope}-nodoc" ${f.noDoc ? 'checked' : ''}><span>Sans justificatif <small>(rien à joindre pour ce frais)</small></span></label>`;
}

function recurBlock(scope) {
  const f = formOf(scope);
  return `<label class="check"><input type="checkbox" id="${scope}-recur" ${f.recur ? 'checked' : ''}><span>Frais récurrent <small>(crédit, abonnement, loyer…)</small></span></label>
    ${f.recur ? `<div class="row recur-row">
      <div class="field" style="flex:1 1 160px"><label for="${scope}-every">Répéter</label>
        <select class="input" id="${scope}-every">${Object.entries(EVERY).map(([k, v]) => `<option value="${k}" ${k === f.every ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field" style="flex:1 1 160px"><label for="${scope}-end">Date de fin <small>(facultatif)</small></label>
        <input class="input" type="date" id="${scope}-end" value="${esc(f.end)}"></div></div>
      <p class="muted" style="font-size:13px">Le frais est compté à chaque échéance, de la date de début jusqu'à la date de fin (ou sans fin). Les échéances à venir ne sont pas comptées.</p>` : ''}`;
}

const dateLabel = (scope) => (formOf(scope).recur ? 'Date de début' : 'Date du frais');

function renderProof(scope) {
  const el = $(`#${scope}-proof`);
  if (el) el.innerHTML = proofBlock(scope);
  hydrateImages();
}

function renderRecur(scope) {
  const el = $(`#${scope}-recur-zone`);
  if (el) el.innerHTML = recurBlock(scope);
  const lab = $(`#${scope}-date-label`);
  if (lab) lab.textContent = dateLabel(scope);
}

const findDoc = (id) => [...(ui.edit?.docs ?? []), ...ui.form.docs, ...(ui.viewer?.docs ?? [])].find((d) => d.id === id);

/** Charge les images qui ne sont pas sur l'appareil (photos prises sur un autre appareil : téléchargées depuis le Drive). */
function hydrateImages() {
  for (const img of document.querySelectorAll('img[data-doc]:not([src])')) {
    const doc = findDoc(img.dataset.doc);
    if (!doc) continue;
    photos.urlOf(doc).then((url) => { if (url) img.src = url; }).catch(() => {
      img.replaceWith(Object.assign(document.createElement('span'), { className: 'photo-file', innerHTML: `${svg('image', 24)}<small>Indisponible hors ligne</small>` }));
    });
  }
}

// ---------- Liste des frais (cliquables) ----------
const PROOF_TAGS = (e) => (e.docs.length ? `<span class="tag ok">${e.docs.length} photo${e.docs.length > 1 ? 's' : ''}</span>`
  : e.noDoc ? '<span class="tag">Sans justificatif</span>' : '<span class="tag warn">Justificatif manquant</span>');

function expRow(e) {
  const meta = e.recur
    ? `${EVERY[e.recur.every]} · depuis le ${shortDate(e.date)}${e.recur.end ? ` · jusqu'au ${shortDate(e.recur.end)}` : ' · sans fin'}`
    : `${relDate(e.date)} · ${e.category}`;
  return `<button type="button" class="item item-btn" data-action="open-expense" data-id="${esc(e.id)}" style="padding:10px 0">
    <div class="item-ico cost" style="width:36px;height:36px">${svg(e.recur ? 'repeat' : 'receipt', 18)}</div>
    <div class="item-body"><div class="item-title">${esc(e.note || e.category)}</div><div class="item-sub">${esc(meta)}</div><div class="item-tags">${PROOF_TAGS(e)}</div></div>
    <div class="item-amount cost" style="font-size:15px">− ${eur2(e.amount)}</div>${svg('right', 16, 2)}</button>`;
}

function expList() {
  const series = state.expenses.filter((e) => e.recur).sort((a, b) => (a.date < b.date ? 1 : -1));
  const single = state.expenses.filter((e) => !e.recur).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  const shown = ui.expAll ? single : single.slice(0, 5);
  return `${series.length ? `<div class="muted" style="font-size:14px;font-weight:700;margin-bottom:4px">Frais récurrents</div>${series.map(expRow).join('')}` : ''}
    <div class="muted" style="font-size:14px;font-weight:700;margin:${series.length ? '14px' : '0'} 0 4px">${ui.expAll ? 'Tous les frais' : 'Derniers frais'}</div>
    ${shown.length ? shown.map(expRow).join('') : '<p class="muted" style="font-size:14px">Aucun frais saisi.</p>'}
    ${single.length > 5 ? `<button type="button" class="btn btn-ghost" data-action="toggle-all-exp" style="margin-top:6px">${ui.expAll ? 'Réduire la liste' : `Voir les ${single.length} frais`}</button>` : ''}`;
}

function refreshExpList() {
  const el = $('#exp-list');
  if (el) el.innerHTML = expList();
}

function expPanel() {
  const cats = state.categories;
  if (!ui.cat || !cats.includes(ui.cat)) ui.cat = cats[0] ?? null;
  return `
    <div class="panel-title"><span class="dot cost"></span><h2>Ajouter un frais</h2></div>
    <form class="stack gap-18" id="form-exp" novalidate>
      <div class="stack gap-8"><div class="field-label" style="font-size:13px;font-weight:600;color:var(--muted)">Justificatifs (photos)</div>
        <div class="stack gap-8" id="exp-proof">${proofBlock('exp')}</div></div>
      <div class="row">
        <div class="field" style="flex:1 1 160px"><label for="exp-amount">Montant TTC</label>
          <div class="input-money cost"><input id="exp-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"><span>€</span></div></div>
        <div class="field" style="flex:1 1 160px"><label for="exp-date" id="exp-date-label">${dateLabel('exp')}</label>
          <input class="input" id="exp-date" type="date" value="${today()}" required></div>
      </div>
      <div class="stack gap-8" id="exp-recur-zone">${recurBlock('exp')}</div>
      <div class="stack gap-8"><div class="field-label" style="font-size:13px;font-weight:600;color:var(--muted)" id="cat-label">Catégorie</div>
        <div class="pills" role="group" aria-labelledby="cat-label">${cats.length ? cats.map((c) => `<button type="button" class="pill" data-action="pick-cat" data-name="${esc(c)}" aria-pressed="${c === ui.cat}">${esc(c)}</button>`).join('') : '<p class="muted">Aucune catégorie : ajoutez-en dans <a href="#/profil/categories">Profil</a>.</p>'}</div></div>
      <div class="field"><label for="exp-note">Note (facultatif)</label><input class="input" id="exp-note" type="text" maxlength="200" placeholder="Fournisseur, objet…" autocomplete="off"></div>
      <p class="error" id="err-exp" role="alert"></p>
      <button type="submit" class="btn btn-cost btn-lg">${svg('check', 20, 2.4)}Enregistrer le frais</button>
    </form>
    <div class="stack" style="border-top:1px solid var(--line-soft);padding-top:14px" id="exp-list">${expList()}</div>`;
}

// ---------- Fiche d'un frais (modification, photos, suppression) ----------
function openExpense(id) {
  const e = state.expenses.find((x) => x.id === id);
  if (!e) return;
  ui.edit = {
    id, date: e.date, amount: e.amount.toFixed(2).replace('.', ','), category: e.category, note: e.note,
    docs: e.docs.map((d) => ({ ...d })), orig: e.docs.map((d) => ({ ...d })), noDoc: e.noDoc,
    recur: !!e.recur, every: e.recur?.every ?? 'month', end: e.recur?.end ?? '',
  };
  renderSheet();
  $('#ed-amount')?.focus();
}

function closeSheet() {
  ui.edit = null;
  renderSheet();
}

function renderSheet() {
  const el = $('#sheet');
  if (!el) return;
  const f = ui.edit;
  el.hidden = !f;
  document.body.classList.toggle('modal-open', !!f || !!ui.viewer);
  if (!f) {
    el.innerHTML = '';
    return;
  }
  const keep = el.querySelector('.sheet-body')?.scrollTop ?? 0;
  const cats = state.categories.includes(f.category) ? state.categories : [...state.categories, f.category];
  el.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ed-title">
      <div class="sheet-head"><h2 id="ed-title">${f.recur ? 'Frais récurrent' : 'Frais'}</h2>
        <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Fermer">${svg('x', 20, 2.4)}</button></div>
      <form class="sheet-body stack gap-18" id="form-edit" novalidate>
        <div class="row">
          <div class="field" style="flex:1 1 150px"><label for="ed-amount">Montant TTC</label>
            <div class="input-money cost"><input id="ed-amount" type="text" inputmode="decimal" autocomplete="off" value="${esc(f.amount)}"><span>€</span></div></div>
          <div class="field" style="flex:1 1 150px"><label for="ed-date" id="ed-date-label">${dateLabel('ed')}</label>
            <input class="input" id="ed-date" type="date" value="${esc(f.date)}" required></div>
        </div>
        <div class="stack gap-8" id="ed-recur-zone">${recurBlock('ed')}</div>
        <div class="field"><label for="ed-cat">Catégorie</label>
          <select class="input" id="ed-cat">${cats.map((c) => `<option value="${esc(c)}" ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="ed-note">Note</label><input class="input" id="ed-note" type="text" maxlength="200" value="${esc(f.note)}" autocomplete="off"></div>
        <div class="stack gap-8"><div class="field-label" style="font-size:13px;font-weight:600;color:var(--muted)">Justificatifs (photos)</div>
          <div class="stack gap-8" id="ed-proof">${proofBlock('ed')}</div></div>
        ${f.recur ? '<p class="muted" style="font-size:13px">Les modifications valent pour toutes les échéances de ce frais.</p>' : ''}
        <p class="error" id="err-edit" role="alert"></p>
        <div class="sheet-actions">
          <button type="submit" class="btn btn-cost btn-lg">${svg('check', 20, 2.4)}Enregistrer</button>
          <button type="button" class="btn btn-danger" data-action="edit-delete">${svg('trash', 18)}Supprimer${f.recur ? ' la série' : ''}</button></div>
      </form></div>`;
  el.querySelector('.sheet-body').scrollTop = keep;
  hydrateImages();
}

// ---------- Visionneuse de photos ----------
function openViewer(docs, id) {
  const list = docs.filter((d) => d.dataUrl || d.driveId);
  const i = Math.max(0, list.findIndex((d) => d.id === id));
  ui.viewer = { docs: list, i };
  renderViewer();
}

function renderViewer() {
  const el = $('#viewer');
  if (!el) return;
  const v = ui.viewer;
  el.hidden = !v;
  document.body.classList.toggle('modal-open', !!ui.edit || !!v);
  if (!v) {
    el.innerHTML = '';
    return;
  }
  const d = v.docs[v.i];
  el.innerHTML = `<div class="viewer-backdrop" data-action="close-viewer"></div>
    <div class="viewer-box" role="dialog" aria-modal="true" aria-label="Photo du justificatif">
      <img data-doc="${esc(d.id)}" alt="${esc(d.name)}"${d.dataUrl ? ` src="${esc(d.dataUrl)}"` : ''}>
      <div class="viewer-bar"><button type="button" class="icon-btn light" data-action="viewer-prev" ${v.docs.length < 2 ? 'hidden' : ''} aria-label="Photo précédente">${svg('left', 22, 2.4)}</button>
        <span>${esc(d.name)} · ${v.i + 1}/${v.docs.length}</span>
        <button type="button" class="icon-btn light" data-action="viewer-next" ${v.docs.length < 2 ? 'hidden' : ''} aria-label="Photo suivante">${svg('right', 22, 2.4)}</button>
        <button type="button" class="icon-btn light" data-action="close-viewer" aria-label="Fermer">${svg('x', 22, 2.4)}</button></div></div>`;
  hydrateImages();
}

/** Montant d'une case du calendrier : entier en gras, centimes (jamais arrondis) en petit dessous. */
function dayValue(amount) {
  const [int, dec] = amountCompact(amount).split(',');
  return dec ? `${int}<small class="cents">,${dec}</small>` : int;
}

const renderCA = () => { $('#panel-ca').innerHTML = caPanel(); };
const renderExp = () => { $('#panel-frais').innerHTML = expPanel(); };

// ---------- Export pour le comptable ----------
const colLetter = (i) => String.fromCharCode(65 + i);

function cellText(c) {
  if (c.v === '' || c.v === null || c.v === undefined) return '';
  switch (c.fmt) {
    case 'money': return eur2(c.v);
    case 'pct': return Math.round(c.v * 100) + ' %';
    case 'date': { const [y, m, d] = c.v.split('-'); return `${d}/${m}/${y}`; }
    case 'month': { const [y, m] = c.v.split('-').map(Number); return `${MONTHS_FR[m - 1]} ${y}`; }
    case 'int': return String(c.v);
    default: return String(c.v);
  }
}

/** Aperçu d'un onglet, présenté comme une feuille de calcul (lettres de colonnes, numéros de lignes). */
function xlGrid(sheet) {
  const nCols = sheet.widths.length;
  const rows = sheet.rows.map((cells, ri) => {
    const tds = Array.from({ length: nCols }, (_, ci) => {
      const c = cells[ci];
      if (!c) return '<td></td>';
      const cls = [c.kind ?? '', ['money', 'int', 'pct'].includes(c.fmt) ? 'num' : ''].filter(Boolean).join(' ');
      const tip = c.f ? ` title="=${esc(c.f)}"` : '';
      return `<td class="${cls}"${tip}>${esc(cellText(c))}</td>`;
    }).join('');
    return `<tr><th scope="row">${ri + 1}</th>${tds}</tr>`;
  }).join('');
  return `<div class="xl-scroll"><table class="xl"><colgroup><col class="xl-rn">${sheet.widths.map((w) => `<col style="width:${Math.round(w * 8.5)}px">`).join('')}</colgroup>
    <thead><tr><th></th>${sheet.widths.map((_, i) => `<th scope="col">${colLetter(i)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function exportView() {
  const years = new Set([start.getFullYear(), ui.exp.y]);
  for (const iso of Object.keys(state.revenues)) years.add(Number(iso.slice(0, 4)));
  for (const e of state.expenses) years.add(Number(e.date.slice(0, 4)));
  const period = resolvePeriod(ui.exp.y, ui.exp.period);
  const report = buildReport(state, period);
  const sheetIdx = Math.min(ui.exp.sheet, report.sheets.length - 1);
  const sheet = report.sheets[sheetIdx];
  const fileName = reportFileName(period);
  const nOps = Object.keys(state.revenues).filter((d) => d >= `${period.y}-${String(period.m1).padStart(2, '0')}` && d.slice(0, 7) <= `${period.y}-${String(period.m2).padStart(2, '0')}`).length
    + expandExpenses(state).filter((e) => e.date.slice(0, 4) === String(period.y) && Number(e.date.slice(5, 7)) >= period.m1 && Number(e.date.slice(5, 7)) <= period.m2).length;

  return `<div class="page">
    ${mobileHead('Comptable', 'Export Excel')}
    <div class="page-head"><h1>Export pour le comptable</h1><div class="muted">Un classeur Excel mis en forme, généré à partir de vos données</div></div>
    <section class="card stack gap-14">
      <div class="row" style="align-items:flex-end;gap:14px">
        <div class="field" style="flex:1 1 140px"><label for="exp-year">Année</label>
          <select class="input" id="exp-year" data-exp="y">${[...years].sort((a, b) => b - a).map((y) => `<option value="${y}" ${y === ui.exp.y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="field" style="flex:2 1 220px"><label for="exp-period">Période</label>
          <select class="input" id="exp-period" data-exp="period">${periodOptions().map((o) => `<option value="${o.id}" ${o.id === ui.exp.period ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
        <button type="button" class="btn btn-primary" data-action="download-xlsx" style="height:52px;flex:1 1 200px">${svg('download', 18, 2.2)}Télécharger (.xlsx)</button>
      </div>
      <p class="muted" style="font-size:14px">${nOps ? `${nOps} opération${nOps > 1 ? 's' : ''} sur la période.` : 'Aucune opération sur cette période : le classeur sera généré vide.'}
        Les totaux sont de vraies formules Excel : votre comptable peut les vérifier ou les compléter.</p>
    </section>
    <section class="xl-frame" aria-label="Aperçu du classeur ${esc(fileName)}">
      <div class="xl-bar">${svg('sheet', 18, 2)}<b>${esc(fileName)}</b><span>Aperçu</span></div>
      ${xlGrid(sheet)}
      <div class="xl-tabs" role="tablist">${report.sheets.map((sh, i) => `<button type="button" role="tab" class="xl-tab" data-action="exp-sheet" data-i="${i}" aria-selected="${i === sheetIdx}">${esc(sh.name)}</button>`).join('')}</div>
    </section>
  </div>`;
}

// ---------- Compte Google ----------
function googleInner() {
  const st = sync.getStatus();
  const head = `<div><h2 style="font-size:18px">Compte Google &amp; base de données</h2>
    <p class="muted" style="font-size:14px;margin-top:4px">Vos données sont enregistrées dans un classeur « ${esc(FILE_NAME)} » de votre Drive, utilisable directement par votre comptable. Ne renommez pas ce fichier : l'application le retrouve par son nom.</p></div>`;
  if (!auth.isConfigured()) {
    return `${head}<p class="notice">La connexion Google n'est pas encore configurée sur ce site (identifiant client manquant dans <code>config.js</code>, voir le README).</p>`;
  }
  if (st.phase === 'off') {
    return `${head}<div class="row"><button type="button" class="btn btn-primary" data-action="google-connect">${svg('cloud', 18)}Se connecter avec Google</button></div>
      ${st.message ? `<p class="error">${esc(st.message)}</p>` : ''}`;
  }
  const label = { connecting: 'Connexion en cours…', pending: 'Modifications en attente d\'envoi…', synced: st.syncedAt ? `Synchronisé à ${new Date(st.syncedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Synchronisé', offline: 'Hors ligne : vos saisies sont conservées et seront envoyées au retour du réseau.', login: 'Session expirée : reconnectez-vous.', error: 'La synchronisation a échoué.' }[st.phase];
  return `${head}
    <div class="google-box">
      <div class="google-line"><span class="sync-dot sync-${st.phase}"></span><div><b>${esc(st.email || 'Compte Google')}</b><div class="muted" style="font-size:14px">${esc(label)}</div></div></div>
      ${st.message && st.phase !== 'offline' ? `<p class="error">${esc(st.message)}</p>` : ''}
      ${st.fileCount > 1 ? `<p class="notice">${st.fileCount} classeurs « ${esc(FILE_NAME)} » existent dans votre Drive : l'application utilise le plus ancien. Supprimez les autres pour éviter toute confusion.</p>` : ''}
      <p class="muted" style="font-size:12px;margin-top:8px">Classeur …${esc(String(st.fileId).slice(-6))}${st.checkedAt ? ` · dernière lecture ${new Date(st.checkedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''} · ${esc(location.host)}</p>
      ${st.ignored ? `<p class="notice">${st.ignored} ligne${st.ignored > 1 ? 's' : ''} du classeur ${st.ignored > 1 ? 'ont été ignorées' : 'a été ignorée'} (date, montant ou catégorie invalide).</p>` : ''}
    </div>
    <div class="row">
      ${st.fileId ? `<a class="btn btn-outline" href="${esc(fileUrl(st.fileId))}" target="_blank" rel="noopener">${svg('sheet', 18)}Ouvrir le classeur</a>` : ''}
      ${st.phase === 'login' ? `<button type="button" class="btn btn-primary" data-action="google-connect">Se reconnecter</button>` : `<button type="button" class="btn btn-outline" data-action="google-sync">Synchroniser maintenant</button>`}
      <button type="button" class="btn btn-danger" data-action="google-disconnect">Se déconnecter</button></div>`;
}

// ---------- Profil ----------
function profilView() {
  const p = state.profile;
  return `<div class="profile-top"><div><a class="back" href="#/" aria-label="Retour au tableau de bord">${svg('left', 20, 2.2)}</a><h1>Profil et réglages</h1></div></div>
  <form class="page page-narrow" id="form-profile" novalidate>
    <section class="card stack gap-18" id="sec-profil" style="padding:24px"><h2 style="font-size:18px">Mon profil</h2>
      <div class="row" style="gap:24px;align-items:center">
        <div class="stack gap-8" style="align-items:center">${avatarHtml('avatar-lg')}
          <button type="button" class="btn btn-outline" data-action="open-photo">${svg('camera', 18)}Changer la photo</button>
          ${p.photo ? '<button type="button" class="btn btn-ghost" data-action="remove-photo">Retirer la photo</button>' : ''}</div>
        <div class="profile-grid">
          <div class="field"><label for="p-name">Nom affiché</label><input class="input" id="p-name" type="text" value="${esc(p.name)}" style="height:48px"></div>
          <div class="field"><label for="p-cab">Nom du cabinet</label><input class="input" id="p-cab" type="text" value="${esc(p.cabinet)}" style="height:48px"></div>
          <div class="field"><label for="p-mail">E-mail</label><input class="input" id="p-mail" type="email" placeholder="docteur@exemple.fr" value="${esc(p.email)}" style="height:48px"></div>
          <div class="field"><label for="p-rpps">N° RPPS (facultatif)</label><input class="input" id="p-rpps" type="text" inputmode="numeric" placeholder="11 chiffres" value="${esc(p.rpps)}" style="height:48px"></div>
        </div></div></section>
    <section class="card stack gap-14" id="sec-apparence" style="padding:24px"><h2 style="font-size:18px">Apparence</h2>${appearanceInner()}</section>
    <section class="card stack gap-14" id="sec-categories" style="padding:24px">${categoriesInner()}</section>
    <section class="card stack gap-14" id="sec-google" style="padding:24px">${googleInner()}</section>
    <section class="card stack gap-14" id="sec-donnees" style="padding:24px"><div><h2 style="font-size:18px">Sauvegarde des données</h2>
      <p class="muted" style="font-size:14px;margin-top:4px">Les données restent dans ce navigateur, sur cet appareil. Exportez-les régulièrement, ou pour les transférer du PC vers le téléphone.</p></div>
      <div class="row">
        <button type="button" class="btn btn-outline" data-action="export-data">${svg('download', 18)}Exporter (JSON)</button>
        <button type="button" class="btn btn-outline" data-action="open-import">${svg('upload', 18)}Importer</button>
        <button type="button" class="btn btn-outline" data-action="load-sample">Données d'exemple</button>
        <button type="button" class="btn btn-danger" data-action="clear-all">${svg('trash', 18)}Tout effacer</button></div></section>
    <div class="form-actions"><a class="btn btn-outline" href="#/" style="min-height:48px">Annuler</a>
      <button type="submit" class="btn btn-primary" style="min-height:48px;padding:0 26px;font-weight:700">Enregistrer</button></div>
  </form>`;
}

function appearanceInner() {
  const cur = ui.accent ?? state.profile.accent;
  return `<div class="row" style="gap:24px;align-items:center">
    <div class="stack gap-8" style="flex:1 1 320px;min-width:0"><div class="field-label" style="font-size:13px;font-weight:600;color:var(--muted)" id="acc-label">Couleur principale</div>
      <div class="swatches" role="group" aria-labelledby="acc-label">${ACCENTS.map((a) => `<button type="button" class="swatch" style="color:${a.hex}" data-action="pick-accent" data-hex="${a.hex}" aria-label="${a.label}" aria-pressed="${a.hex === cur}"><span style="background:${a.hex}"></span></button>`).join('')}</div></div>
    <div class="preview"><div class="muted" style="font-size:12px;font-weight:600">Aperçu</div>
      <div class="row" style="align-items:center;gap:10px;flex-wrap:nowrap"><div style="width:36px;height:36px;border-radius:10px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center">${svg('plus', 20, 2.4)}</div>
        <b id="pv-name">${esc(state.profile.name)}</b></div>
      <div class="preview-btn">Saisir le CA du jour</div></div></div>`;
}

function categoriesInner() {
  return `<div><h2 style="font-size:18px">Catégories de frais</h2><p class="muted" style="font-size:14px;margin-top:4px">Elles apparaissent dans la saisie d'un frais et dans le tableau de bord.</p></div>
    <div class="row" style="gap:10px">${state.categories.map((c) => `<span class="chip">${esc(c)}<button type="button" data-action="remove-cat" data-name="${esc(c)}" aria-label="Supprimer ${esc(c)}">${svg('x', 16, 2.4)}</button></span>`).join('') || '<span class="muted">Aucune catégorie.</span>'}</div>
    <div class="row" style="gap:10px;align-items:flex-end">
      <div class="field" style="flex:1 1 240px"><label for="newcat">Nouvelle catégorie</label>
        <input class="input" id="newcat" type="text" placeholder="Ex. Assurance RCP, Cotisations…" autocomplete="off" style="height:48px"></div>
      <button type="button" class="btn btn-primary" data-action="add-cat" style="height:48px">${svg('plus', 18, 2.4)}Ajouter</button></div>
    <p class="error" id="err-cat" role="alert"></p>`;
}

// ---------- Événements ----------
function fail(id, msg) {
  const el = $(id);
  if (el) el.textContent = msg;
}

async function attachFiles(files, scope = ui.target) {
  const f = formOf(scope);
  if (!f || !files.length) return;
  let skipped = 0;
  for (const file of files) {
    try {
      if (file.type.startsWith('image/')) {
        f.docs.push({ id: newDocId(), name: file.name || 'justificatif.jpg', size: file.size, type: 'image/jpeg', dataUrl: await downscaleImage(file) });
      } else if (file.type === 'application/pdf') {
        f.docs.push({ id: newDocId(), name: file.name, size: file.size, type: file.type });
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  f.noDoc = false;
  if (skipped) toast(`${skipped} fichier${skipped > 1 ? 's' : ''} non pris en charge ou illisible${skipped > 1 ? 's' : ''} (images ou PDF uniquement).`, true);
  renderProof(scope);
}

const newDocId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const actions = {
  'toggle-menu': () => { ui.menu = !ui.menu; renderChrome(); if (ui.menu) $('.menu a')?.focus(); },
  'set-year-tab': (el) => { ui.yearTab = el.dataset.tab; render(); },
  'set-period': (el) => {
    ui.period = el.dataset.period;
    $('.dash').dataset.period = ui.period;
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === ui.period)));
    const y = start.getFullYear();
    const mo = new Date().getMonth() + 1;
    $('.mobile-head .eyebrow').textContent = ui.period === 'month' ? monthLabel(y, mo) : `Janvier – ${monthLabel(y, mo).split(' ')[0].toLowerCase()} ${y}`;
  },
  'cal-prev': () => moveMonth(-1),
  'cal-next': () => moveMonth(1),
  'pick-day': (el) => { ui.sel = el.dataset.date; renderCA(); $(`[data-date="${ui.sel}"]`)?.focus(); },
  'del-ca': () => {
    if (!confirm(`Supprimer la saisie du ${longDate(ui.sel).toLowerCase()} ?`)) return;
    commit(removeRevenue(state, ui.sel));
    toast('Saisie supprimée');
    renderCA();
  },
  'pick-cat': (el) => {
    ui.cat = el.dataset.name;
    document.querySelectorAll('.panel-frais .pill').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.name === ui.cat)));
  },
  'open-cam': (el) => { ui.target = el.dataset.scope || 'exp'; $('#in-cam').click(); },
  'open-file': (el) => { ui.target = el.dataset.scope || 'exp'; $('#in-file').click(); },
  detach: (el) => {
    const scope = el.dataset.scope || 'exp';
    const f = formOf(scope);
    f.docs = f.docs.filter((d) => d.id !== el.dataset.id);
    renderProof(scope);
  },
  'view-photo': (el) => openViewer(formOf(el.dataset.scope || 'exp').docs, el.dataset.id),
  'open-expense': (el) => openExpense(el.dataset.id),
  'close-sheet': () => closeSheet(),
  'close-viewer': () => { ui.viewer = null; renderViewer(); },
  'viewer-prev': () => { ui.viewer.i = (ui.viewer.i - 1 + ui.viewer.docs.length) % ui.viewer.docs.length; renderViewer(); },
  'viewer-next': () => { ui.viewer.i = (ui.viewer.i + 1) % ui.viewer.docs.length; renderViewer(); },
  'toggle-all-exp': () => { ui.expAll = !ui.expAll; refreshExpList(); },
  'edit-delete': () => {
    const f = ui.edit;
    const e = state.expenses.find((x) => x.id === f.id);
    if (!e) return closeSheet();
    const msg = e.recur ? 'Supprimer ce frais récurrent et toutes ses échéances ?' : 'Supprimer ce frais ?';
    if (!confirm(`${msg}${e.docs.some((d) => d.driveId) ? '\nSes photos seront aussi supprimées du Drive.' : ''}`)) return;
    commit(removeExpense(state, f.id));
    photos.removeRemote(e.docs);
    toast('Frais supprimé');
    closeSheet();
    render();
  },
  'pick-accent': (el) => {
    ui.accent = el.dataset.hex;
    applyAccent(ui.accent);
    $('#sec-apparence').innerHTML = `<h2 style="font-size:18px">Apparence</h2>${appearanceInner()}`;
    $('#pv-name').textContent = $('#p-name').value;
  },
  'open-photo': () => $('#in-photo').click(),
  'remove-photo': () => { commit(updateProfile(state, { photo: '' })); render(); },
  'add-cat': () => {
    try {
      commit(addCategory(state, $('#newcat').value));
      $('#sec-categories').innerHTML = categoriesInner();
      $('#newcat').focus();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      fail('#err-cat', e.message);
    }
  },
  'remove-cat': (el) => { commit(removeCategory(state, el.dataset.name)); $('#sec-categories').innerHTML = categoriesInner(); },
  'export-data': () => {
    downloadText(`crmedic-${today()}.json`, exportJSON(state));
    toast('Export téléchargé');
  },
  'open-import': () => $('#in-import').click(),
  'exp-sheet': (el) => { ui.exp.sheet = Number(el.dataset.i); $('#view').innerHTML = exportView(); },
  'download-xlsx': async (el) => {
    el.disabled = true;
    try {
      const period = resolvePeriod(ui.exp.y, ui.exp.period);
      const buf = await writeXlsx(await loadExcelJS(), buildReport(state, period), { accent: state.profile.accent });
      downloadBinary(reportFileName(period), buf);
      toast('Classeur téléchargé');
    } catch (e) {
      toast(e.message || 'Export impossible.', true);
    } finally {
      el.disabled = false;
    }
  },
  'google-connect': () => sync.connect(),
  'google-reconnect': () => sync.resume({ silent: false }),
  'google-sync': () => sync.syncNow(),
  'google-disconnect': () => {
    if (!confirm('Se déconnecter de Google ? Vos données restent sur cet appareil et dans le classeur du Drive.')) return;
    sync.disconnect();
    toast('Déconnecté de Google');
  },
  'load-sample': () => {
    if (isSyncing()) { toast("Déconnectez d'abord le compte Google : les données d'exemple écraseraient votre classeur.", true); return; }
    if (!isEmpty(state) && !confirm("Remplacer vos données par des données d'exemple ?")) return;
    commit({ ...sampleState(), profile: state.profile, categories: state.categories });
    toast("Données d'exemple chargées");
    render();
  },
  'clear-all': () => {
    if (!confirm(`Effacer toutes les saisies (CA et frais)${isSyncing() ? ' sur cet appareil ET dans le classeur Drive' : ''} ? Cette action est définitive.`)) return;
    commit({ ...state, revenues: {}, expenses: [] });
    toast('Données effacées');
  },
};

function moveMonth(delta) {
  const next = shiftMonth(ui.y, ui.m, delta);
  ui.y = next.y;
  ui.m = next.m;
  const t = today();
  ui.sel = t.startsWith(toISO(ui.y, ui.m, 1).slice(0, 7)) ? t : toISO(ui.y, ui.m, 1);
  renderCA();
  $(`[data-action="${delta < 0 ? 'cal-prev' : 'cal-next'}"]`)?.focus();
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    actions[el.dataset.action](el);
    return;
  }
  if (ui.menu && !ev.target.closest('.who')) {
    ui.menu = false;
    renderChrome();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ui.viewer) {
    ui.viewer = null;
    renderViewer();
  } else if (ev.key === 'Escape' && ui.edit) {
    closeSheet();
  } else if (ev.key === 'Escape' && ui.menu) {
    ui.menu = false;
    renderChrome();
    $('.who-btn')?.focus();
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const id = ev.target.id;
  if (id === 'form-ca') {
    const amount = parseAmount($('#ca-amount').value);
    const count = parseCount($('#ca-count').value);
    if (amount === null) return fail('#err-ca', 'Montant invalide : saisissez par exemple 405 ou 405,50.');
    if (Number.isNaN(count)) return fail('#err-ca', 'Le nombre de consultations doit être un entier.');
    try {
      commit(setRevenue(state, ui.sel, amount, count));
      toast(`CA du ${longDate(ui.sel).toLowerCase()} enregistré`);
      renderCA();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      fail('#err-ca', e.message);
    }
  } else if (id === 'form-exp') {
    const amount = parseAmount($('#exp-amount').value);
    if (amount === null) return fail('#err-exp', 'Montant invalide : saisissez par exemple 49 ou 49,90.');
    const f = ui.form;
    try {
      const { state: next, expense } = addExpense(state, {
        date: $('#exp-date').value, amount, category: ui.cat, note: $('#exp-note').value,
        docs: f.docs, noDoc: f.noDoc, recur: f.recur ? { every: f.every, end: f.end } : null,
      });
      if (!commit(next) && expense.docs.some((d) => d.dataUrl)) {
        const light = { ...next, expenses: next.expenses.map((e) => (e.id === expense.id ? { ...e, docs: e.docs.map((d) => ({ ...d, dataUrl: undefined })) } : e)) };
        if (commit(light)) toast('Frais enregistré, mais les photos n’ont pas pu être conservées (stockage plein).', true);
      } else {
        toast(f.recur ? 'Frais récurrent enregistré' : 'Frais enregistré');
      }
      ui.form = newProofForm();
      renderExp();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      fail('#err-exp', e.message);
    }
  } else if (id === 'form-edit') {
    const f = ui.edit;
    const amount = parseAmount($('#ed-amount').value);
    if (amount === null) return fail('#err-edit', 'Montant invalide : saisissez par exemple 49 ou 49,90.');
    try {
      const { state: next } = updateExpense(state, f.id, {
        date: $('#ed-date').value, amount, category: $('#ed-cat').value, note: $('#ed-note').value,
        docs: f.docs, noDoc: f.noDoc, recur: f.recur ? { every: f.every, end: f.end } : null,
      });
      commit(next);
      photos.removeRemote(f.orig.filter((o) => o.driveId && !f.docs.some((d) => d.id === o.id)));
      toast('Frais modifié');
      closeSheet();
      render();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      fail('#err-edit', e.message);
    }
  } else if (id === 'form-profile') {
    commit(updateProfile(state, {
      name: $('#p-name').value.trim() || 'Dr [Nom]', cabinet: $('#p-cab').value.trim(),
      email: $('#p-mail').value.trim(), rpps: $('#p-rpps').value.trim(), accent: ui.accent ?? state.profile.accent,
    }));
    toast('Profil enregistré');
    location.hash = '#/';
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'p-name') {
    const pv = $('#pv-name');
    if (pv) pv.textContent = ev.target.value;
  }
});

document.addEventListener('change', async (ev) => {
  const input = ev.target;
  if (input.dataset?.exp) {
    ui.exp[input.dataset.exp] = input.dataset.exp === 'y' ? Number(input.value) : input.value;
    $('#view').innerHTML = exportView();
    $(`[data-exp="${input.dataset.exp}"]`)?.focus();
    return;
  }
  const m = /^(exp|ed)-(nodoc|recur|every|end)$/.exec(input.id ?? '');
  if (m) {
    const [, scope, what] = m;
    const f = formOf(scope);
    if (what === 'nodoc') {
      if (input.checked && f.docs.length && !confirm('Retirer les photos déjà jointes à ce frais ?')) { input.checked = false; return; }
      f.noDoc = input.checked;
      if (input.checked) f.docs = [];
      renderProof(scope);
    } else if (what === 'recur') {
      f.recur = input.checked;
      renderRecur(scope);
    } else f[what] = input.value;
    return;
  }
  const file = input.files?.[0];
  if (!file) return;
  if (input.id === 'in-cam' || input.id === 'in-file') await attachFiles([...input.files]);
  else if (input.id === 'in-photo') {
    try {
      commit(updateProfile(state, { photo: await downscaleImage(file, 256, 0.8) }));
      render();
    } catch {
      toast('Image illisible.', true);
    }
  } else if (input.id === 'in-import') {
    try {
      if (!confirm('Importer ce fichier remplacera vos données actuelles. Continuer ?')) return;
      commit(importJSON(await readText(file)));
      toast('Données importées');
      render();
    } catch (e) {
      toast(e.message, true);
    }
  }
  input.value = '';
});

for (const type of ['dragover', 'dragleave', 'drop']) {
  document.addEventListener(type, (ev) => {
    const zone = ev.target.closest?.('#dropzone');
    if (!zone) return;
    ev.preventDefault();
    zone.classList.toggle('over', type === 'dragover');
    if (type === 'drop') attachFiles([...(ev.dataTransfer?.files ?? [])], 'exp');
  });
}

// ---------- Démarrage ----------
document.body.insertAdjacentHTML('beforeend', `
  <input type="file" id="in-cam" accept="image/*" capture="environment" hidden>
  <input type="file" id="in-file" accept="image/*,application/pdf" multiple hidden>
  <div id="sheet" hidden></div>
  <div id="viewer" hidden></div>
  <input type="file" id="in-photo" accept="image/*" hidden>
  <input type="file" id="in-import" accept="application/json,.json" hidden>`);
window.addEventListener('hashchange', render);
render();
if (auth.isConfigured()) {
  sync.resume();
  // Récupère ce qu'un autre appareil a envoyé : au retour sur l'onglet, puis toutes les 2 minutes.
  let lastRefresh = Date.now();
  const refresh = () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 15000) return;
    lastRefresh = Date.now();
    sync.refresh();
  };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  setInterval(() => { lastRefresh = 0; refresh(); }, 120000);
}
