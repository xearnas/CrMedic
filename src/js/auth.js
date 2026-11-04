// Connexion Google (Google Identity Services, flux « jeton d'accès » sans serveur). Navigateur uniquement.
// Le jeton dure environ une heure ; il est renouvelé silencieusement quand c'est possible.
import { GOOGLE_CLIENT_ID } from './config.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const SCOPES = `${DRIVE_SCOPE} openid email profile`;
const GIS_URL = 'https://accounts.google.com/gsi/client';

export class AuthError extends Error {}

export const isConfigured = () => Boolean(GOOGLE_CLIENT_ID);

let gisPromise = null;
let client = null;
let pending = null; // { resolve, reject } de la demande en cours
let token = null;
let expiresAt = 0;

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new AuthError('Impossible de joindre Google (connexion requise).'));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

async function ensureClient() {
  await loadGis();
  if (client) return client;
  client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (resp.error) return p.reject(new AuthError(resp.error_description || resp.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
        google.accounts.oauth2.revoke(resp.access_token, () => {});
        return p.reject(new AuthError("Accès au Drive non accordé : à la connexion, cochez la case « Voir, modifier, créer et supprimer uniquement les fichiers Drive utilisés avec cette application »."));
      }
      token = resp.access_token;
      expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
      p.resolve(token);
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      p?.reject(new AuthError(err?.type === 'popup_closed' ? 'Connexion annulée.' : 'Connexion Google impossible.'));
    },
  });
  return client;
}

/** Demande un jeton. `silent` : sans fenêtre (échoue si l'utilisateur doit se reconnecter). */
export async function signIn({ silent = false } = {}) {
  if (!isConfigured()) throw new AuthError("La connexion Google n'est pas configurée (config.js).");
  const c = await ensureClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken({ prompt: silent ? 'none' : '' });
  });
}

/** Jeton valide, renouvelé en silence s'il a expiré. */
export async function getToken() {
  if (token && Date.now() < expiresAt) return token;
  try {
    return await signIn({ silent: true });
  } catch {
    throw new AuthError('Session Google expirée : reconnectez-vous.');
  }
}

export async function fetchEmail() {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${await getToken()}` } });
  if (!res.ok) return '';
  return (await res.json()).email ?? '';
}

export function signOut() {
  const t = token;
  token = null;
  expiresAt = 0;
  if (t && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
}
