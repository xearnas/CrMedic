# CrMedic — suivi du CA et des frais d'un cabinet

Application web **responsive** (PC et téléphone) pour un médecin généraliste : saisie du chiffre
d'affaires journalier, ajout de frais avec photo du justificatif, tableau de bord mensuel et annuel.
HTML/CSS/JavaScript natif, **sans étape de build ni dépendance**.

## Écrans

| Écran | PC (> 860 px) | Téléphone (≤ 860 px) |
|---|---|---|
| Chiffres (`#/`) | vue d'ensemble mois + année | bascule Octobre / Année, cartes compactes |
| CA (`#/ca`) | calendrier + formulaire, côte à côte avec les frais | page dédiée, grand champ de saisie |
| Frais (`#/frais`) | formulaire + justificatif + derniers frais | page dédiée, bouton « Prendre la photo » (appareil photo) |
| Export (`#/export`) | choix de la période + aperçu du classeur Excel + téléchargement | idem, aperçu défilant |
| Profil (`#/profil`) | profil, couleur, catégories, compte Google, sauvegarde | idem, pleine largeur |

La navigation passe par la barre du haut sur PC et par une barre d'onglets en bas sur téléphone.

## Lancer

Les modules ES nécessitent un serveur HTTP (pas d'ouverture directe en `file://`) :

```bash
npm start            # serveur Node sans dépendance (Windows, macOS, Linux) ; ou : node scripts/serve.mjs 8080
# puis ouvrir http://localhost:8080
```

Pour l'utiliser sur téléphone, publier le dossier `src/` en HTTPS : l'appareil photo n'est accessible
qu'en HTTPS ou sur `localhost`.

### Déploiement (GitHub Pages)

`.github/workflows/pages.yml` lance les tests puis publie `src/` à chaque push sur `main`.
Réglage unique : dépôt public, puis **Settings → Pages → Build and deployment → Source : GitHub Actions**.
Adresse : `https://<compte>.github.io/CrMedic/`. Ajouter `https://<compte>.github.io` (sans chemin) aux
origines JavaScript autorisées de l'ID client Google.

## Données

- Copie de travail dans le navigateur (`localStorage`) : l'application fonctionne hors ligne.
- **Base de données Google Sheets (optionnelle)** : après connexion avec Google (Profil → Compte Google),
  les données sont enregistrées dans un classeur **« CrMedic - Données »** du Drive de l'utilisateur
  (onglets `CA`, `Frais`, `Catégories`, `Profil`, `_meta`). Le nom est fixé dans le code
  (`FILE_NAME`, `src/js/sheetmodel.js`) ; s'il n'existe pas, il est créé vide. Si l'utilisateur le renomme,
  un nouveau classeur est créé : c'est de sa responsabilité.
  - scope demandé : `drive.file` uniquement (l'application ne voit que les fichiers qu'elle a créés) ;
  - chaque saisie est envoyée au classeur après ~1,5 s ; hors ligne, elle est conservée et renvoyée ensuite ;
  - au démarrage, le classeur n'est rechargé que s'il a changé depuis la dernière synchronisation
    (autre appareil) ; si les deux côtés ont des modifications, l'utilisateur choisit ;
  - dernier écrivain gagnant : pas de fusion fine entre deux appareils modifiant en même temps ;
  - les photos de justificatifs et la photo de profil **restent sur l'appareil** (seul le nom du fichier
    est écrit dans le classeur) ;
  - ne pas modifier les en-têtes de colonnes du classeur : l'application refuse de le lire plutôt que de
    risquer d'écraser des données.
- **Export pour le comptable** (`#/export`) : classeur `.xlsx` mis en forme (Synthèse mensuelle et par
  catégorie, détail du CA, détail des frais), généré dans le navigateur avec ExcelJS (chargé à la demande
  depuis jsDelivr). Les totaux sont de vraies formules Excel. L'aperçu à l'écran vient du même modèle.
- Sauvegarde manuelle : **Profil → Sauvegarde des données** (export/import JSON).
- Les photos de justificatifs sont réduites (900 px, JPEG) avant stockage local ; un PDF n'est conservé que
  par son nom.
- « Données d'exemple » (Profil, ou bandeau d'accueil) remplit l'application pour la découvrir
  (désactivé quand le compte Google est connecté, pour ne pas écraser le classeur).

### Activer la connexion Google

1. [console.cloud.google.com](https://console.cloud.google.com) → nouveau projet → activer **Google Drive API**
   et **Google Sheets API**.
2. Écran de consentement OAuth → type externe → scopes `openid`, `email`, `profile`,
   `https://www.googleapis.com/auth/drive.file` (scope non sensible : pas de vérification lourde). Publier
   l'application en production pour ouvrir l'accès à des utilisateurs hors liste de test.
3. Identifiants → ID client OAuth → **Application Web** → origines JavaScript autorisées : l'adresse du site
   (HTTPS) et `http://localhost:8080` pour les essais.
4. Coller l'ID client dans `src/js/config.js` (`GOOGLE_CLIENT_ID`). Tant qu'il est vide, le bloc Google du
   Profil indique que la connexion n'est pas configurée.

## Organisation

```
src/index.html        page unique
src/css/styles.css    styles (breakpoint 860 px)
src/js/format.js      formats, dates, montants (pur)
src/js/store.js       modèle de données, validation, persistance (pur)
src/js/stats.js       calculs du tableau de bord (pur)
src/js/sheetmodel.js  correspondance état <-> onglets du classeur Google Sheets (pur)
src/js/report.js      modèle du classeur Excel du comptable (pur)
src/js/xlsx.js        écriture du .xlsx avec ExcelJS (chargé à la demande)
src/js/drive.js       client Google Drive / Sheets (fetch et jeton injectés)
src/js/sync.js        synchronisation local <-> classeur (dépendances injectées)
src/js/auth.js        connexion Google Identity Services (navigateur)
src/js/config.js      ID client OAuth
src/js/img.js         réduction d'image, import/export de fichiers (navigateur)
src/js/app.js         vues, routage, événements
unittests/            tests unitaires (node:test)
```

## Tests

```bash
./unittests/run.sh   # Node >= 20, aucune dépendance
```
