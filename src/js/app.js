// Interface : routage par hash, rendu des vues, gestion des événements.
import {
  WEEKDAY_HEADS, daysInMonth, escapeHtml as esc, eur, eur2, firstWeekdayOffset, initials, longDate, monthLabel,
  parseAmount, parseCount, pct, shiftMonth, shortDate, todayISO, toISO,
} from './format.js';
import {
  ACCENTS, ValidationError, addCategory, addExpense, exportJSON, importJSON, isEmpty, load, removeCategory,
  removeExpense, removeRevenue, sampleState, save, setRevenue, updateProfile,
} from './store.js';
import { categoryTotals, dailySeries, monthRange, monthlySeries, periodStats, recentEntries, yearRange } from './stats.js';
import { downloadText, downscaleImage, formatSize, readText } from './img.js';

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
const start = new Date();
const ui = {
  y: start.getFullYear(), m: start.getMonth() + 1, sel: todayISO(start),
  period: 'month', menu: false, cat: null, doc: null, accent: null,
};
const $ = (sel, root = document) => root.querySelector(sel);

function commit(next) {
  state = next;
  if (storage && !save(storage, state)) {
    toast('Stockage du navigateur plein : exportez vos données (Profil) pour ne rien perdre.', true);
    return false;
  }
  return true;
}

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
  return `<div class="mobile-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div>
    ${avatarHtml('', 'a', 'href="#/profil" aria-label="Profil et réglages"')}</div>`;
}

function applyAccent(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  $('meta[name="theme-color"]')?.setAttribute('content', hex);
}

// ---------- Routage ----------
function parseRoute() {
  const [name = '', section = ''] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'ca' || name === 'frais' || name === 'profil') return { name, section };
  return { name: 'dash', section: '' };
}

function render() {
  const route = parseRoute();
  ui.menu = false;
  ui.accent = null;
  applyAccent(state.profile.accent);
  const views = { dash: dashView, ca: () => saisieView('ca'), frais: () => saisieView('frais'), profil: profilView };
  const titles = { dash: 'Chiffres', ca: 'CA du jour', frais: 'Ajouter un frais', profil: 'Profil et réglages' };
  $('#view').innerHTML = views[route.name]();
  renderChrome(route);
  document.title = `${titles[route.name]} — Mon Cabinet`;
  const target = route.section && $(`#sec-${route.section}`);
  if (target) target.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
  if (route.name === 'profil') $('#view').classList.add('profil');
  else $('#view').classList.remove('profil');
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
            <a role="menuitem" href="#/profil/donnees">${svg('download')}Sauvegarde des données</a></div>` : ''}
        </div>
        <a class="btn navlink" href="#/" ${cur('dash')}>${svg('chart', 18)}Chiffres</a>
      </div>
      <div class="topbar-actions">
        <a class="btn btn-primary" href="#/ca">${svg('plus', 18, 2.2)}Saisir le CA du jour</a>
        <a class="btn btn-outline" href="#/frais">${svg('camera', 18)}Ajouter un frais</a>
      </div></div>`;
    const tab = (href, n, icon, label, extra = '') =>
      `<a class="tab ${extra}" href="${href}" ${cur(n)}>${svg(icon, 22)}${label}</a>`;
    $('#tabbar').innerHTML = tab('#/ca', 'ca', 'euro', 'CA') + tab('#/frais', 'frais', 'camera', 'Frais', 'cost') + tab('#/', 'dash', 'chart', 'Chiffres');
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
  return `<div class="item"><div class="item-ico cost">${svg('receipt')}</div><div class="item-body">
    <div class="item-title">${esc(r.note || r.category)}</div><div class="item-sub">${esc(relDate(r.date))} · ${esc(r.category)}${r.hasDoc ? ' · document joint' : ''}</div></div>
    <div class="item-amount cost">− ${eur(r.amount)}</div></div>`;
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

  const banner = isEmpty(state) ? `<div class="empty-banner"><div><b>Bienvenue.</b> Aucune donnée pour l'instant : saisissez votre premier CA ou découvrez l'application avec des données d'exemple.</div>
    <div class="row"><a class="btn btn-primary" href="#/ca">Saisir le CA du jour</a><button type="button" class="btn btn-outline" data-action="load-sample">Charger des données d'exemple</button></div></div>` : '';

  return `<div class="page dash" data-period="${ui.period}">
    ${mobileHead(ui.period === 'month' ? monthName : `Janvier – ${monthName.split(' ')[0].toLowerCase()} ${y}`, 'Chiffres')}
    <div class="page-head"><h1>Vue d'ensemble</h1><div class="muted">Mise à jour ${esc(longDate(today()).toLowerCase())} ${y}</div></div>
    ${banner}
    <div class="seg" role="group" aria-label="Période">
      <button type="button" data-action="set-period" data-period="month" aria-pressed="${ui.period === 'month'}">${esc(monthName.split(' ')[0])}</button>
      <button type="button" data-action="set-period" data-period="year" aria-pressed="${ui.period === 'year'}">Année ${y}</button>
    </div>

    <section class="period period-month stack gap-14">
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

    <section class="period period-year stack gap-14">
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

    <section class="card">
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
      <span class="d">${d}</span><span class="v">${r ? Math.round(r.amount) : future ? '' : '—'}</span></button></div>`);
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

function docZone() {
  const d = ui.doc;
  if (d) {
    return `<div class="attached"><div class="thumb">${d.dataUrl ? `<img src="${esc(d.dataUrl)}" alt="Aperçu du justificatif">` : svg('file', 24)}</div>
      <div class="item-body"><div class="item-title">${esc(d.name)}</div><div class="item-sub">${esc(formatSize(d.size))}${d.dataUrl ? ' · prêt à être associé au frais' : ' · PDF : seul le nom est conservé'}</div></div>
      <button type="button" class="icon-btn" data-action="detach" aria-label="Retirer le document">${svg('x', 18, 2.4)}</button></div>`;
  }
  return `<div class="dropzone" id="dropzone">
    ${svg('upload', 32, 1.8)}
    <div class="only-desktop" style="font-weight:600">Glissez un ticket ou une facture ici</div>
    <div class="muted" style="font-size:13px">Image ou PDF</div>
    <div class="btns"><button type="button" class="btn btn-primary" data-action="open-cam">${svg('camera', 20)}Prendre la photo</button>
      <button type="button" class="btn btn-outline" data-action="open-file">${svg('image', 20)}Choisir un fichier</button></div></div>`;
}

function expPanel() {
  const cats = state.categories;
  if (!ui.cat || !cats.includes(ui.cat)) ui.cat = cats[0] ?? null;
  const recent = [...state.expenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
  return `
    <div class="panel-title"><span class="dot cost"></span><h2>Ajouter un frais</h2></div>
    <form class="stack gap-18" id="form-exp" novalidate>
      <div class="stack gap-8"><div class="field-label" style="font-size:13px;font-weight:600;color:var(--muted)">Document justificatif</div><div id="doc-zone">${docZone()}</div></div>
      <div class="row">
        <div class="field" style="flex:1 1 160px"><label for="exp-amount">Montant TTC</label>
          <div class="input-money cost"><input id="exp-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00"><span>€</span></div></div>
        <div class="field" style="flex:1 1 160px"><label for="exp-date">Date du frais</label>
          <input class="input" id="exp-date" type="date" value="${today()}" required></div>
      </div>
      <div class="stack gap-8"><div class="field-label" style="font-size:13px;font-weight:600;color:var(--muted)" id="cat-label">Catégorie</div>
        <div class="pills" role="group" aria-labelledby="cat-label">${cats.length ? cats.map((c) => `<button type="button" class="pill" data-action="pick-cat" data-name="${esc(c)}" aria-pressed="${c === ui.cat}">${esc(c)}</button>`).join('') : '<p class="muted">Aucune catégorie : ajoutez-en dans <a href="#/profil/categories">Profil</a>.</p>'}</div></div>
      <div class="field"><label for="exp-note">Note (facultatif)</label><input class="input" id="exp-note" type="text" maxlength="200" placeholder="Fournisseur, objet…" autocomplete="off"></div>
      <p class="error" id="err-exp" role="alert"></p>
      <button type="submit" class="btn btn-cost btn-lg">${svg('check', 20, 2.4)}Enregistrer le frais</button>
    </form>
    <div class="stack" style="border-top:1px solid var(--line-soft);padding-top:14px">
      <div class="muted" style="font-size:14px;font-weight:700;margin-bottom:4px">Derniers frais</div>
      ${recent.length ? recent.map((e) => `<div class="item" style="padding:10px 0"><div class="item-ico cost" style="width:36px;height:36px">${svg('receipt', 18)}</div>
        <div class="item-body"><div class="item-title">${esc(e.note || e.category)}</div><div class="item-sub">${esc(relDate(e.date))} · ${esc(e.category)}${e.doc ? ' · document joint' : ''}</div></div>
        <div class="item-amount cost" style="font-size:15px">− ${eur2(e.amount)}</div>
        <button type="button" class="icon-btn" data-action="del-expense" data-id="${esc(e.id)}" aria-label="Supprimer le frais ${esc(e.note || e.category)}">${svg('trash', 18)}</button></div>`).join('') : '<p class="muted" style="font-size:14px">Aucun frais saisi.</p>'}
    </div>`;
}

const renderCA = () => { $('#panel-ca').innerHTML = caPanel(); };
const renderExp = () => { $('#panel-frais').innerHTML = expPanel(); };

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

async function attachFile(file) {
  if (!file) return;
  try {
    if (file.type.startsWith('image/')) {
      ui.doc = { name: file.name || 'justificatif.jpg', size: file.size, type: 'image/jpeg', dataUrl: await downscaleImage(file) };
    } else if (file.type === 'application/pdf') {
      ui.doc = { name: file.name, size: file.size, type: file.type };
    } else {
      toast('Format non pris en charge : choisissez une image ou un PDF.', true);
      return;
    }
    $('#doc-zone').innerHTML = docZone();
  } catch {
    toast("Impossible de lire ce fichier.", true);
  }
}

const actions = {
  'toggle-menu': () => { ui.menu = !ui.menu; renderChrome(); if (ui.menu) $('.menu a')?.focus(); },
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
  'open-cam': () => $('#in-cam').click(),
  'open-file': () => $('#in-file').click(),
  detach: () => { ui.doc = null; $('#doc-zone').innerHTML = docZone(); },
  'del-expense': (el) => {
    if (!confirm('Supprimer ce frais ?')) return;
    commit(removeExpense(state, el.dataset.id));
    toast('Frais supprimé');
    const keep = { a: $('#exp-amount')?.value, n: $('#exp-note')?.value };
    renderExp();
    $('#exp-amount').value = keep.a ?? '';
    $('#exp-note').value = keep.n ?? '';
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
  'load-sample': () => {
    if (!isEmpty(state) && !confirm("Remplacer vos données par des données d'exemple ?")) return;
    commit({ ...sampleState(), profile: state.profile, categories: state.categories });
    toast("Données d'exemple chargées");
    render();
  },
  'clear-all': () => {
    if (!confirm('Effacer toutes les saisies (CA et frais) ? Cette action est définitive.')) return;
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
  if (ev.key === 'Escape' && ui.menu) {
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
    if (amount === null) return fail('#err-exp', 'Montant invalide : saisissez par exemple 86 ou 86,40.');
    try {
      const { state: next, expense } = addExpense(state, {
        date: $('#exp-date').value, amount, category: ui.cat, note: $('#exp-note').value, doc: ui.doc,
      });
      if (!commit(next) && ui.doc?.dataUrl) {
        const light = { ...next, expenses: next.expenses.map((e) => (e.id === expense.id ? { ...e, doc: { ...e.doc, dataUrl: undefined } } : e)) };
        if (commit(light)) toast('Frais enregistré, mais la photo n’a pas pu être conservée (stockage plein).', true);
      } else {
        toast('Frais enregistré');
      }
      ui.doc = null;
      renderExp();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      fail('#err-exp', e.message);
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
  const file = input.files?.[0];
  if (!file) return;
  if (input.id === 'in-cam' || input.id === 'in-file') await attachFile(file);
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
    if (type === 'drop') attachFile(ev.dataTransfer?.files?.[0]);
  });
}

// ---------- Démarrage ----------
document.body.insertAdjacentHTML('beforeend', `
  <input type="file" id="in-cam" accept="image/*" capture="environment" hidden>
  <input type="file" id="in-file" accept="image/*,application/pdf" hidden>
  <input type="file" id="in-photo" accept="image/*" hidden>
  <input type="file" id="in-import" accept="application/json,.json" hidden>`);
window.addEventListener('hashchange', render);
render();
