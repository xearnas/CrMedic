// Configuration de la connexion Google.
//
// Renseigner l'identifiant client OAuth (type « Application Web ») créé dans la Google Cloud Console :
//   1. console.cloud.google.com -> nouveau projet -> activer « Google Drive API » et « Google Sheets API »
//   2. Écran de consentement OAuth -> externe -> scopes : openid, email, profile, .../auth/drive.file
//   3. Identifiants -> ID client OAuth -> Application Web -> « Origines JavaScript autorisées » :
//      l'adresse du site (ex. https://xearnas.github.io) et http://localhost:8080 pour les essais
//   4. Coller l'ID client ci-dessous.
// L'ID client n'est pas un secret : il est public par conception.
export const GOOGLE_CLIENT_ID = '60506795151-sgrm4243qlcm0m3rfnpldd7hehp6s8k3.apps.googleusercontent.com';
