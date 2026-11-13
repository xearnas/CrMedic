// Photos de justificatifs : envoi en arrière-plan dans le Drive, affichage (cache mémoire) et suppression.
// Les dépendances sont injectées : le module se teste sans navigateur.
import { patchDoc, pendingDocs } from './store.js';

export function createPhotos({ drive, getState, setState, canUpload, toUrl, onChange = () => {} }) {
  const cache = new Map(); // driveId -> URL affichable (data URL ou URL d'objet)
  let uploading = null;
  let again = false;

  /** Envoie les photos en attente, une par une ; chaque succès est enregistré aussitôt. Renvoie le nombre envoyé. */
  async function uploadPending() {
    if (uploading) {
      again = true;
      return uploading;
    }
    uploading = (async () => {
      await null; // laisse `uploading` être renseigné avant la fin éventuelle (rien à envoyer)
      let sent = 0;
      try {
        for (const { expenseId, doc } of pendingDocs(getState())) {
          if (!canUpload()) break;
          let driveId;
          try {
            driveId = await drive.uploadImage({ name: doc.name, dataUrl: doc.dataUrl });
          } catch {
            break; // hors ligne / session expirée : on réessaiera plus tard, la photo reste sur l'appareil
          }
          cache.set(driveId, doc.dataUrl);
          setState(patchDoc(getState(), expenseId, doc.id, { driveId, dataUrl: undefined }));
          sent += 1;
        }
      } finally {
        uploading = null;
      }
      if (sent) onChange();
      if (again) {
        again = false;
        return sent + (await uploadPending());
      }
      return sent;
    })();
    return uploading;
  }

  /** URL affichable d'un justificatif : sur l'appareil, en cache, ou téléchargé depuis le Drive. */
  async function urlOf(doc) {
    if (doc.dataUrl) return doc.dataUrl;
    if (!doc.driveId) return null;
    if (cache.has(doc.driveId)) return cache.get(doc.driveId);
    const url = toUrl(await drive.downloadImage(doc.driveId));
    cache.set(doc.driveId, url);
    return url;
  }

  /** Supprime les fichiers Drive correspondants (sans bloquer l'utilisateur si le réseau est absent). */
  async function removeRemote(docs) {
    for (const d of docs) {
      if (!d.driveId) continue;
      cache.delete(d.driveId);
      try {
        await drive.deleteFile(d.driveId);
      } catch { /* fichier déjà supprimé ou hors ligne : sans conséquence pour les données */ }
    }
  }

  return { uploadPending, urlOf, removeRemote, cache };
}
