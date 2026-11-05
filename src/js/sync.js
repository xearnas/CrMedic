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

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fusion à trois voies : `base` = état local au début de la synchronisation, `local` = état local à la fin
 * (l'utilisateur a pu modifier pendant l'attente), `remote` = état lu sur le Drive.
 * Toute modification locale faite pendant la synchronisation est conservée par-dessus l'état du Drive.
 */
export function mergeLocalEdits(base, local, remote) {
  const profile = { ...remote.profile };
  for (const k of Object.keys(local.profile ?? {})) if (!same(local.profile[k], base.profile?.[k])) profile[k] = local.profile[k];

  const revenues = { ...remote.revenues };
  for (const d of new Set([...Object.keys(base.revenues), ...Object.keys(local.revenues)])) {
    if (same(base.revenues[d], local.revenues[d])) continue;
    if (local.revenues[d]) revenues[d] = local.revenues[d];
    else delete revenues[d];
  }

  const baseExp = new Map(base.expenses.map((e) => [e.id, e]));
  const localExp = new Map(local.expenses.map((e) => [e.id, e]));
  const expenses = new Map(remote.expenses.map((e) => [e.id, e]));
  for (const id of new Set([...baseExp.keys(), ...localExp.keys()])) {
    if (same(baseExp.get(id), localExp.get(id))) continue;
    if (localExp.has(id)) expenses.set(id, localExp.get(id));
    else expenses.delete(id);
  }

  const categories = [...remote.categories];
  for (const c of local.categories) if (!categories.includes(c)) categories.push(c);

  return { ...remote, profile, revenues, expenses: [...expenses.values()], categories };
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
  let refreshing = false;

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

  function pullState(id, tables, base) {
    const local = getState();
    const { state, ignored } = tablesToState(tables, local);
    const edited = base && local !== base && !same(base, local); // modifié pendant l'attente : ne pas l'écraser
    setState(edited ? mergeLocalEdits(base, local, state) : state);
    persist.write({ ...persist.read(), fileId: id, lastMaj: majOf(tables), dirty: false });
    set({ phase: 'synced', message: '', syncedAt: now().toISOString(), ignored });
    if (edited) pushSoon();
  }

  /** Première rencontre entre cet appareil et ce classeur : choisir le sens. */
  async function reconcile(id, tables, base) {
    tablesToState(tables, getState()); // lève SheetFormatError si les en-têtes ont été modifiés, avant toute décision
    const plan = planSync({ localEmpty: isEmpty(getState()), remoteEmpty: tablesAreEmpty(tables) });
    if (plan === 'none') return pullState(id, tables, base);
    if (plan === 'pull') return pullState(id, tables, base);
    if (plan === 'push') return pushState(id);
    const choice = await askConflict();
    if (choice === 'pull') return pullState(id, tables, base);
    if (choice === 'push') return pushState(id);
    throw Object.assign(new Error('Connexion annulée.'), { cancelled: true });
  }

  async function connect() {
    const base = getState();
    set({ phase: 'connecting', message: '' });
    try {
      await auth.signIn({ silent: false });
      const email = await auth.fetchEmail();
      persist.write({ email, fileId: '', lastMaj: '', dirty: false });
      set({ email });
      const { id } = await drive.getOrCreate();
      set({ fileId: id });
      await reconcile(id, await drive.readTables(id), base);
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

  /** Au démarrage (silencieux) ou sur clic « Reconnecter » (`silent: false`) : reprend la session existante. */
  async function resume({ silent = true } = {}) {
    const saved = persist.read();
    if (!saved) return;
    const base = getState();
    set({ phase: 'connecting', email: saved.email, fileId: saved.fileId, message: '' });
    try {
      await auth.signIn({ silent });
    } catch {
      return set({ phase: 'login', message: silent ? 'Reconnectez-vous pour synchroniser.' : 'Connexion Google annulée ou refusée.' });
    }
    try {
      const { id } = await drive.getOrCreate();
      set({ fileId: id });
      const tables = await drive.readTables(id);
      tablesToState(tables, getState()); // valide les en-têtes avant de décider du sens
      if (id !== saved.fileId) return await reconcile(id, tables, base);
      // l'utilisateur a pu modifier pendant l'attente : relire l'indicateur, pas la valeur lue au démarrage
      const dirty = Boolean(persist.read()?.dirty);
      const action = resumeAction({ dirty, remoteMaj: majOf(tables), lastMaj: saved.lastMaj });
      if (action === 'pull') return pullState(id, tables, base);
      if (action === 'push') return await pushState(id);
      if (action === 'ask') {
        const choice = await askConflict();
        if (choice === 'pull') return pullState(id, tables, base);
        if (choice === 'push') return await pushState(id);
      }
      set({ phase: 'synced', message: '', syncedAt: now().toISOString() });
    } catch (e) {
      fail(e);
    }
  }

  /**
   * Relit le classeur en cours de session (retour sur l'onglet, minuteur) : récupère ce qu'un autre appareil
   * a envoyé. Ne fait rien si une session n'est pas active ou si un envoi est en cours / en attente.
   */
  async function refresh() {
    const saved = persist.read();
    const { phase } = status;
    if (!saved?.fileId || running || refreshing || timer) return;
    if (!['synced', 'offline', 'error'].includes(phase)) return;
    refreshing = true;
    const base = getState();
    try {
      const id = saved.fileId;
      const tables = await drive.readTables(id);
      tablesToState(tables, getState());
      const cur = persist.read() ?? saved;
      const action = resumeAction({ dirty: Boolean(cur.dirty), remoteMaj: majOf(tables), lastMaj: cur.lastMaj });
      if (action === 'pull') return pullState(id, tables, base);
      if (action === 'ask') {
        const choice = await askConflict();
        if (choice === 'pull') return pullState(id, tables, base);
        if (choice === 'push') return await pushState(id);
      }
      if (phase !== 'synced') set({ phase: 'synced', message: '' });
    } catch (e) {
      fail(e);
    } finally {
      refreshing = false;
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

  return { connect, resume, refresh, pushSoon, flush, disconnect, getStatus: () => status };
}
