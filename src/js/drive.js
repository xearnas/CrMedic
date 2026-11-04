// Client Google Drive / Google Sheets : retrouve (ou crée) le classeur de l'utilisateur et le lit / l'écrit.
// `fetchFn` et `getToken` sont injectés : le module n'a aucune dépendance au navigateur et se teste avec un faux serveur.
//
// Scope OAuth requis : https://www.googleapis.com/auth/drive.file (l'application ne voit que les fichiers qu'elle a créés).
import { FILE_NAME, HEADERS, TABS, stateToTables } from './sheetmodel.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';
const TAB_NAMES = Object.values(TABS);
const LAST_COL = 'H';

export class DriveError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

/** Tables ne contenant que les en-têtes : classeur « vide » à la création. */
export function emptyTables() {
  return Object.fromEntries(Object.entries(HEADERS).map(([tab, header]) => [tab, [header]]));
}

export const fileUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}`;
const quote = (tab) => `'${tab}'`;

export function createDrive({ fetchFn, getToken }) {
  async function api(url, { method = 'GET', body } = {}) {
    const token = await getToken();
    let res;
    try {
      res = await fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new DriveError('Réseau indisponible.', 0);
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.error?.message ?? '';
      } catch { /* corps non JSON */ }
      const msg = res.status === 401 ? 'Connexion Google expirée.' : res.status === 403 ? `Accès refusé par Google. ${detail}`.trim() : `Erreur Google (${res.status}). ${detail}`.trim();
      throw new DriveError(msg, res.status);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Le plus ancien fichier portant le nom fixe, parmi ceux que l'application a créés. */
  async function findFile() {
    const name = FILE_NAME.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name='${name}' and mimeType='${MIME_SHEET}' and trashed=false`;
    const data = await api(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,createdTime)')}&orderBy=createdTime&pageSize=10`);
    return data.files?.[0] ?? null;
  }

  async function createFile() {
    const created = await api(SHEETS, {
      method: 'POST',
      body: {
        properties: { title: FILE_NAME, locale: 'fr_FR' },
        sheets: TAB_NAMES.map((title, i) => ({ properties: { sheetId: i + 1, title, gridProperties: { frozenRowCount: 1 } } })),
      },
    });
    const id = created.spreadsheetId;
    await api(`${SHEETS}/${id}:batchUpdate`, {
      method: 'POST',
      body: {
        requests: TAB_NAMES.map((_, i) => ({
          repeatCell: {
            range: { sheetId: i + 1, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.92, blue: 0.89 } } },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        })),
      },
    });
    await writeTables(id, emptyTables());
    return { id, name: FILE_NAME };
  }

  /** Retrouve le classeur ; le crée (vide) s'il n'existe pas. */
  async function getOrCreate() {
    const found = await findFile();
    if (found) return { id: found.id, created: false };
    const made = await createFile();
    return { id: made.id, created: true };
  }

  /** Vérifie les onglets (crée ceux qui manquent) et agrandit la grille si besoin. */
  async function ensureTabs(id, needRows = {}) {
    const meta = await api(`${SHEETS}/${id}?fields=${encodeURIComponent('sheets.properties(sheetId,title,gridProperties)')}`);
    const present = new Map((meta.sheets ?? []).map((s) => [s.properties.title, s.properties]));
    const requests = [];
    for (const tab of TAB_NAMES) {
      const p = present.get(tab);
      if (!p) {
        requests.push({ addSheet: { properties: { title: tab, gridProperties: { rowCount: Math.max(1000, (needRows[tab] ?? 0) + 200), frozenRowCount: 1 } } } });
      } else if ((needRows[tab] ?? 0) > (p.gridProperties?.rowCount ?? 1000)) {
        requests.push({ updateSheetProperties: { properties: { sheetId: p.sheetId, gridProperties: { rowCount: needRows[tab] + 200 } }, fields: 'gridProperties.rowCount' } });
      }
    }
    if (requests.length) await api(`${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: { requests } });
  }

  async function readTables(id) {
    await ensureTabs(id);
    const ranges = TAB_NAMES.map((t) => `ranges=${encodeURIComponent(`${quote(t)}!A:${LAST_COL}`)}`).join('&');
    const data = await api(`${SHEETS}/${id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
    return Object.fromEntries(TAB_NAMES.map((t, i) => [t, data.valueRanges?.[i]?.values ?? []]));
  }

  async function writeTables(id, tables) {
    await ensureTabs(id, Object.fromEntries(TAB_NAMES.map((t) => [t, tables[t]?.length ?? 0])));
    await api(`${SHEETS}/${id}/values:batchClear`, { method: 'POST', body: { ranges: TAB_NAMES.map((t) => `${quote(t)}!A:${LAST_COL}`) } });
    await api(`${SHEETS}/${id}/values:batchUpdate`, {
      method: 'POST',
      body: {
        valueInputOption: 'RAW',
        data: TAB_NAMES.filter((t) => tables[t]?.length).map((t) => ({ range: `${quote(t)}!A1`, values: tables[t] })),
      },
    });
  }

  /** Écrit l'état complet ; renvoie l'horodatage `maj` écrit dans _meta. */
  async function saveState(id, state, now = new Date()) {
    const tables = stateToTables(state, now);
    await writeTables(id, tables);
    return tables[TABS.meta].find((r) => r[0] === 'maj')[1];
  }

  return { findFile, createFile, getOrCreate, readTables, writeTables, saveState };
}
