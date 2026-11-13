// Client Google Drive / Google Sheets : retrouve (ou crée) le classeur de l'utilisateur et le lit / l'écrit.
// `fetchFn` et `getToken` sont injectés : le module n'a aucune dépendance au navigateur et se teste avec un faux serveur.
//
// Scope OAuth requis : https://www.googleapis.com/auth/drive.file (l'application ne voit que les fichiers qu'elle a créés).
import { FILE_NAME, HEADERS, TABS, stateToTables } from './sheetmodel.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';
const MIME_FOLDER = 'application/vnd.google-apps.folder';
/** Dossier du Drive qui reçoit les photos de justificatifs. */
export const FOLDER_NAME = 'CrMedic - Justificatifs';
const TAB_NAMES = Object.values(TABS);
const LAST_COL = 'J';

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

/** Convertit une data URL (« data:image/jpeg;base64,… ») en Blob. */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Image invalide.');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

export const fileUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}`;
const quote = (tab) => `'${tab}'`;

export function createDrive({ fetchFn, getToken }) {
  async function api(url, { method = 'GET', body, rawBody, contentType, blob = false } = {}) {
    const token = await getToken();
    let res;
    try {
      res = await fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(rawBody ? { 'Content-Type': contentType } : {}) },
        body: rawBody ?? (body ? JSON.stringify(body) : undefined),
      });
    } catch (cause) {
      throw Object.assign(new DriveError('Réseau indisponible.', 0), { cause });
    }
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.json())?.error?.message ?? '';
      } catch { /* corps non JSON */ }
      const scopeMissing = res.status === 403 && /insufficient authentication scopes|insufficientPermissions/i.test(detail);
      const msg = scopeMissing
        ? "Autorisation Drive manquante : reconnectez-vous et cochez la case d'accès aux fichiers de l'application (Voir, modifier, créer et supprimer uniquement les fichiers Drive utilisés avec cette application)."
        : res.status === 401 ? 'Connexion Google expirée.' : res.status === 403 ? `Accès refusé par Google. ${detail}`.trim() : `Erreur Google (${res.status}). ${detail}`.trim();
      throw new DriveError(msg, res.status);
    }
    if (blob) return res.blob();
    return res.status === 204 ? null : res.json();
  }

  /** Le plus ancien fichier portant le nom fixe, parmi ceux que l'application a créés. */
  async function findFiles() {
    const name = FILE_NAME.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name='${name}' and mimeType='${MIME_SHEET}' and trashed=false`;
    const data = await api(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,createdTime)')}&orderBy=createdTime&pageSize=10`);
    return data.files ?? [];
  }

  async function findFile() {
    return (await findFiles())[0] ?? null;
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
    const all = await findFiles();
    if (all[0]) return { id: all[0].id, created: false, count: all.length };
    const made = await createFile();
    return { id: made.id, created: true, count: 1 };
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

  // --- Photos de justificatifs ---------------------------------------------

  let folderId = null;

  /** Dossier des justificatifs : retrouvé par son nom, créé s'il n'existe pas. */
  async function ensureFolder() {
    if (folderId) return folderId;
    const q = `name='${FOLDER_NAME}' and mimeType='${MIME_FOLDER}' and trashed=false`;
    const data = await api(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id)')}&orderBy=createdTime&pageSize=1`);
    folderId = data.files?.[0]?.id ?? (await api(`${DRIVE}/files?fields=id`, { method: 'POST', body: { name: FOLDER_NAME, mimeType: MIME_FOLDER } })).id;
    return folderId;
  }

  /** Envoie une image (data URL) dans le dossier des justificatifs ; renvoie l'identifiant du fichier Drive. */
  async function uploadImage({ name, dataUrl }) {
    const media = dataUrlToBlob(dataUrl);
    const send = async () => {
      const boundary = `crmedic${Math.random().toString(36).slice(2)}`;
      const meta = JSON.stringify({ name, parents: [await ensureFolder()] });
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${media.type}\r\n\r\n`, media, `\r\n--${boundary}--`]);
      return api(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', rawBody: body, contentType: `multipart/related; boundary=${boundary}` });
    };
    try {
      return (await send()).id;
    } catch (e) {
      if (e.status !== 404) throw e;
      folderId = null; // dossier supprimé depuis : on le recrée une fois
      return (await send()).id;
    }
  }

  const downloadImage = (id) => api(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`, { blob: true });
  const deleteFile = (id) => api(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });

  return { findFile, findFiles, createFile, uploadImage, downloadImage, deleteFile, ensureFolder, getOrCreate, readTables, writeTables, saveState };
}
