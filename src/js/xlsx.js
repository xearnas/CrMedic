// Écriture du classeur Excel (.xlsx) à partir du modèle de report.js, avec ExcelJS.
// ExcelJS est chargé à la demande depuis un CDN (aucune étape de build) ; `writeXlsx` reçoit la
// classe en paramètre pour pouvoir être vérifiée hors navigateur.

export const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NUMFMT = {
  money: '#,##0.00 "€"',
  int: '0',
  pct: '0 %',
  date: 'dd/mm/yyyy',
  month: 'mmmm yyyy',
};

const toUtcDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

let loading = null;
/** Charge ExcelJS (une seule fois) et renvoie la classe. */
export function loadExcelJS() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = EXCELJS_URL;
      s.async = true;
      s.onload = () => (globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error('ExcelJS indisponible.')));
      s.onerror = () => {
        loading = null;
        reject(new Error('Impossible de charger le module Excel (connexion requise).'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Écrit le rapport dans un classeur ExcelJS et renvoie son contenu (ArrayBuffer ou Buffer). */
export async function writeXlsx(ExcelJS, report, { accent = '#0B6E8A', creator = 'CrMedic' } = {}) {
  const argb = 'FF' + accent.replace('#', '').toUpperCase();
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.title = report.title;
  wb.created = new Date();

  for (const sheet of report.sheets) {
    const ws = wb.addWorksheet(sheet.name, {
      views: [{ state: 'frozen', ySplit: sheet.freezeRow }],
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${sheet.freezeRow}:${sheet.freezeRow}` },
    });
    sheet.widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    sheet.rows.forEach((cells, ri) => {
      const row = ws.getRow(ri + 1);
      cells.forEach((cell, ci) => {
        const x = row.getCell(ci + 1);
        const isDate = cell.fmt === 'date' || cell.fmt === 'month';
        const value = isDate ? toUtcDate(cell.v) : cell.v === '' ? null : cell.v;
        x.value = cell.f ? { formula: cell.f, result: isDate ? toUtcDate(cell.v) : cell.v } : value;
        if (NUMFMT[cell.fmt]) x.numFmt = NUMFMT[cell.fmt];
        if (cell.fmt === 'date' || cell.fmt === 'month') x.alignment = { horizontal: 'left' };
        if (cell.kind === 'title') {
          x.font = { bold: true, size: 14 };
        } else if (cell.kind === 'sub') {
          x.font = { color: { argb: 'FF56635F' } };
        } else if (cell.kind === 'note') {
          x.font = { italic: true, color: { argb: 'FF56635F' } };
        } else if (cell.kind === 'head') {
          x.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
          x.alignment = { horizontal: ci === 0 ? 'left' : 'center', vertical: 'middle' };
        } else if (cell.kind === 'total') {
          x.font = { bold: true };
          x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEECE4' } };
          x.border = { top: { style: 'thin', color: { argb: 'FF1A2A2C' } } };
        }
      });
      if (cells[0]?.kind === 'head') row.height = 22;
    });
  }
  return wb.xlsx.writeBuffer();
}

/** Déclenche le téléchargement d'un contenu binaire (navigateur). */
export function downloadBinary(filename, data, type = XLSX_MIME) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
