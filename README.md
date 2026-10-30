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
| Profil (`#/profil`) | profil, couleur, catégories, sauvegarde | idem, pleine largeur |

La navigation passe par la barre du haut sur PC et par une barre d'onglets en bas sur téléphone.

## Lancer

Les modules ES nécessitent un serveur HTTP (pas d'ouverture directe en `file://`) :

```bash
npm start            # ou : python3 -m http.server 8080 -d src
# puis ouvrir http://localhost:8080
```

Pour l'utiliser sur téléphone, publier le dossier `src/` en HTTPS (GitHub Pages, Netlify…) :
l'appareil photo n'est accessible qu'en HTTPS ou sur `localhost`.

## Données

- Stockées dans le navigateur (`localStorage`), **sur l'appareil**. Le PC et le téléphone ne se
  synchronisent pas : utiliser **Profil → Sauvegarde des données** (export/import JSON).
- Les photos de justificatifs sont réduites (900 px, JPEG) avant stockage ; un PDF n'est conservé que
  par son nom. Un vrai stockage des pièces et une synchronisation demanderaient un serveur.
- « Données d'exemple » (Profil, ou bandeau d'accueil) remplit l'application pour la découvrir.

## Organisation

```
src/index.html        page unique
src/css/styles.css    styles (breakpoint 860 px)
src/js/format.js      formats, dates, montants (pur)
src/js/store.js       modèle de données, validation, persistance (pur)
src/js/stats.js       calculs du tableau de bord (pur)
src/js/img.js         réduction d'image, import/export de fichiers (navigateur)
src/js/app.js         vues, routage, événements
unittests/            tests unitaires (node:test)
```

## Tests

```bash
./unittests/run.sh   # Node >= 20, aucune dépendance
```
