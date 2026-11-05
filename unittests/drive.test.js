import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, DriveError, emptyTables } from '../src/js/drive.js';
import { FILE_NAME, TABS, stateToTables, tablesToState } from '../src/js/sheetmodel.js';
import { sampleState } from '../src/js/store.js';

/** Faux serveur Google : un seul classeur en mémoire, avec la grille de chaque onglet. */
function fakeGoogle({ files = [], failWith = null, failMessage = 'boom' } = {}) {
  const srv = { files: [...files], book: null, calls: [] };
  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
  srv.fetchFn = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    srv.calls.push(`${method} ${url.replace(/\?.*/, '')}`);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    if (failWith) return json({ error: { message: failMessage } }, failWith);
    const u = new URL(url);
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q');
      assert.ok(q.includes(`name='${FILE_NAME}'`) && q.includes('trashed=false'));
      return json({ files: srv.files });
    }
    if (u.pathname === '/v4/spreadsheets' && method === 'POST') {
      srv.book = { id: 'book1', tabs: new Map(body.sheets.map((s) => [s.properties.title, { rows: 1000, values: [] }])) };
      srv.files.push({ id: 'book1', name: FILE_NAME });
      return json({ spreadsheetId: 'book1' });
    }
    const m = u.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);
    assert.ok(m, `URL inattendue ${url}`);
    const book = srv.book;
    if (m[2] === '' && method === 'GET') {
      return json({ sheets: [...book.tabs].map(([title, t], i) => ({ properties: { sheetId: i + 1, title, gridProperties: { rowCount: t.rows } } })) });
    }
    if (m[2] === ':batchUpdate') {
      for (const r of body.requests) {
        if (r.addSheet) book.tabs.set(r.addSheet.properties.title, { rows: r.addSheet.properties.gridProperties.rowCount, values: [] });
        if (r.updateSheetProperties) {
          const title = [...book.tabs.keys()][r.updateSheetProperties.properties.sheetId - 1];
          book.tabs.get(title).rows = r.updateSheetProperties.properties.gridProperties.rowCount;
        }
      }
      return json({});
    }
    if (m[2] === '/values:batchClear') {
      for (const t of book.tabs.values()) t.values = [];
      return json({});
    }
    if (m[2] === '/values:batchUpdate') {
      for (const d of body.data) {
        const tab = d.range.match(/^'(.+)'!A1$/)[1];
        const t = book.tabs.get(tab);
        assert.ok(d.values.length <= t.rows, `grille trop petite pour ${tab}`);
        t.values = d.values;
      }
      assert.equal(body.valueInputOption, 'RAW');
      return json({});
    }
    if (m[2] === '/values:batchGet') {
      const names = u.searchParams.getAll('ranges').map((r) => r.match(/^'(.+)'!/)[1]);
      return json({ valueRanges: names.map((n) => ({ values: book.tabs.get(n).values })) });
    }
    throw new Error(`Route non gérée ${method} ${url}`);
  };
  return srv;
}

const mk = (srv) => createDrive({ fetchFn: srv.fetchFn, getToken: async () => 'tok' });

test('fichier absent : il est créé, vide, avec tous les onglets', async () => {
  const srv = fakeGoogle();
  const res = await mk(srv).getOrCreate();
  assert.deepEqual(res, { id: 'book1', created: true, count: 1 });
  assert.deepEqual([...srv.book.tabs.keys()], Object.values(TABS));
  assert.deepEqual(srv.book.tabs.get('CA').values, emptyTables()['CA']);
});

test('fichier présent : il est retrouvé par son nom, sans création', async () => {
  const srv = fakeGoogle({ files: [{ id: 'abc', name: FILE_NAME }, { id: 'zzz', name: FILE_NAME }] });
  const res = await mk(srv).getOrCreate();
  assert.deepEqual(res, { id: 'abc', created: false, count: 2 });
  assert.ok(!srv.calls.some((c) => c.startsWith('POST')));
});

test('écriture puis relecture : l’état est restitué', async () => {
  const srv = fakeGoogle();
  const drive = mk(srv);
  const { id } = await drive.getOrCreate();
  const state = sampleState(new Date(2026, 9, 29));
  const maj = await drive.saveState(id, state, new Date('2026-10-29T10:00:00Z'));
  assert.equal(maj, '2026-10-29T10:00:00.000Z');
  const { state: back, ignored } = tablesToState(await drive.readTables(id), null);
  assert.equal(ignored, 0);
  assert.deepEqual(back.revenues, state.revenues);
  assert.equal(back.expenses.length, state.expenses.length);
});

test('la grille est agrandie quand il y a plus de 1000 lignes', async () => {
  const srv = fakeGoogle();
  const drive = mk(srv);
  const { id } = await drive.getOrCreate();
  const tables = stateToTables(sampleState(new Date(2026, 9, 29)));
  tables[TABS.ca] = [tables[TABS.ca][0], ...Array.from({ length: 1500 }, (_, i) => [`2020-01-01`, i + 1, ''])];
  await drive.writeTables(id, tables);
  assert.ok(srv.book.tabs.get('CA').rows >= 1500);
});

test('un onglet supprimé par l’utilisateur est recréé', async () => {
  const srv = fakeGoogle();
  const drive = mk(srv);
  const { id } = await drive.getOrCreate();
  srv.book.tabs.delete('Frais');
  const tables = await drive.readTables(id);
  assert.ok(srv.book.tabs.has('Frais'));
  assert.deepEqual(tables['Frais'], []);
});

test('les erreurs Google deviennent des DriveError lisibles', async () => {
  await assert.rejects(mk(fakeGoogle({ failWith: 401 })).getOrCreate(), (e) => e instanceof DriveError && e.status === 401 && /expirée/.test(e.message));
  await assert.rejects(mk(fakeGoogle({ failWith: 403 })).getOrCreate(), (e) => e.status === 403 && /refusé/.test(e.message));
  const noScope = fakeGoogle({ failWith: 403, failMessage: 'Request had insufficient authentication scopes.' });
  await assert.rejects(mk(noScope).getOrCreate(), (e) => e.status === 403 && /cochez la case/.test(e.message));
  const offline = createDrive({ fetchFn: async () => { throw new TypeError('fetch failed'); }, getToken: async () => 'tok' });
  await assert.rejects(offline.getOrCreate(), (e) => e.status === 0 && /Réseau/.test(e.message));
});
