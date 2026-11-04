// Synchronisation entre l'état local (localStorage) et le classeur Google Sheets.
// Toutes les dépendances sont injectées (drive, auth, persistance, confirmation) : la logique se teste sans navigateur.
//
// Principe : le stockage local reste la copie de travail (l'application fonctionne hors ligne). Chaque
// modification est envoyée au classeur après un court délai ; au démarrage, on ne recharge le classeur que
// s'il a changé depuis la dernière synchronisation (par exemple modifié depuis un autre appareil).
import { SheetFormatError, TABS, planSync, tablesAreEmpty, tablesToState } from './sheetmodel.js';
import { isEmpty } from './store.js';
import { DriveError } from './drive.js';

/** Que faire au démarrage d'une session déjà connectée ? */
export function resumeAction({ dirty, remoteMaj, lastMaj }) {
  const changed = String(remoteMaj ?? '') !== String(lastMaj ?? '');
  if (dirty && changed) return 'ask';
  if (dirty) return 'push';
  if (changed) return 'pull';
  return 'none';
}

const majOf = (tables) => tables?.[TABS.meta]?.find((r) => r[0] === 'maj')?.[1] ?? '';

/**
 * Phases : 'off' (non connecté) | 'connecting' | 'synced' | 'pending' (envoi en attente)
 *        | 'offline' | 'login' (reconnexion nécessaire) | 'error'.
 */
export function createSync({
  drive, auth, persist, getState, setState, askConflict, onStatus = () => {},
  schedule = setTimeout, cancel = clearTimeout, delay = 1500, now = () => new Date(),
}) {
  let status = { phase: 'off', email: '', fileId: '', message: '', syncedAt: null, ignored: 0 };
  let timer = null;
  let running = null;
  let again = false;

  const set = (patch) => {
    status = { ...status, ...patch };
    onStatus(status);
  };

  function fail(e) {
    if (e instanceof SheetFormatError) return set({ phase: 'error', message: e.message });
    if (e instanceof DriveError && e.status === 0) return set({ phase: 'offline', message: e.message });
    if ((e instanceof DriveError && e.status === 401) || e?.name === 'AuthError' || /expirée|reconnect/i.test(e?.message ?? '')) {
      return set({ phase: 'login', message: e.message || 'Reconnexion nécessaire.' });
    }
    return set({ phase: 'error', message: e?.message || 'Erreur inattendue.' });
  }

  async function pushState(id) {
    const maj = await drive.saveState(id, getState(), now());
    persist.write({ ...persist.read(), fileId: id, lastMaj: maj, dirty: false });
    set({ phase: 'synced', message: '', syncedAt: now().toISOString() });
  }

  function pullState(id, tables) {
    const { state, ignored } = tablesToState(tables, getState());
    setState(state);
    persist.write({ ...persist.read(), fileId: id, lastMaj: majOf(tables), dirty: false });
    set({ phase: 'synced', message: '', syncedAt: now().toISOString(), ignored });
  }

  /** Première rencontre entre cet appareil et ce classeur : choisir le sens. */
  async function reconcile(id, tables) {
    tablesToState(tables, getState()); // lève SheetFormatError si les en-têtes ont été modifiés, avant toute décision
    const plan = planSync({ localEmpty: isEmpty(getState()), remoteEmpty: tablesAreEmpty(tables) });
    if (plan === 'none') return pullState(id, tables);
    if (plan === 'pull') return pullState(id, tables);
    if (plan === 'push') return pushState(id);
    const choice = await askConflict();
    if (choice === 'pull') return pullState(id, tables);
    if (choice === 'push') return pushState(id);
    throw Object.assign(new Error('Connexion annulée.'), { cancelled: true });
  }

  async function connect() {
    set({ phase: 'connecting', message: '' });
    try {
      await auth.signIn({ silent: false });
      const email = await auth.fetchEmail();
      persist.write({ email, fileId: '', lastMaj: '', dirty: false });
      set({ email });
      const { id } = await drive.getOrCreate();
      set({ fileId: id });
      await reconcile(id, await drive.readTables(id));
    } catch (e) {
      if (e.cancelled) {
        await disconnect();
        return;
      }
      if (!persist.read()?.fileId) persist.write(null);
      fail(e);
      if (!persist.read()) set({ phase: e.name === 'AuthError' ? 'off' : status.phase });
    }
  }

  /** Au démarrage : reprend la session si l'utilisateur était connecté. */
  async function resume() {
    const saved = persist.read();
    if (!saved) return;
    set({ phase: 'connecting', email: saved.email, fileId: saved.fileId, message: '' });
    try {
      await auth.signIn({ silent: true });
    } catch {
      return set({ phase: 'login', message: 'Reconnectez-vous pour synchroniser.' });
    }
    try {
      const { id } = await drive.getOrCreate();
      set({ fileId: id });
      const tables = await drive.readTables(id);
      tablesToState(tables, getState()); // valide les en-têtes avant de décider du sens
      if (id !== saved.fileId) return await reconcile(id, tables);
      const action = resumeAction({ dirty: saved.dirty, remoteMaj: majOf(tables), lastMaj: saved.lastMaj });
      if (action === 'pull') return pullState(id, tables);
      if (action === 'push') return await pushState(id);
      if (action === 'ask') {
        const choice = await askConflict();
        if (choice === 'pull') return pullState(id, tables);
        if (choice === 'push') return await pushState(id);
      }
      set({ phase: 'synced', message: '', syncedAt: now().toISOString() });
    } catch (e) {
      fail(e);
    }
  }

  async function flush() {
    timer = null;
    const saved = persist.read();
    if (!saved) return;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        const id = saved.fileId || status.fileId;
        if (!id) throw new Error('Fichier Drive introuvable.');
        await pushState(id);
      } catch (e) {
        fail(e);
      } finally {
        running = null;
        if (again) {
          again = false;
          await flush();
        }
      }
    })();
    return running;
  }

  /** À appeler après chaque modification locale. */
  function pushSoon() {
    const saved = persist.read();
    if (!saved) return;
    persist.write({ ...saved, dirty: true });
    set({ phase: 'pending' });
    if (timer) cancel(timer);
    timer = schedule(flush, delay);
  }

  async function disconnect() {
    if (timer) cancel(timer);
    timer = null;
    auth.signOut();
    persist.write(null);
    set({ phase: 'off', email: '', fileId: '', message: '', syncedAt: null });
  }

  return { connect, resume, pushSoon, flush, disconnect, getStatus: () => status };
}
