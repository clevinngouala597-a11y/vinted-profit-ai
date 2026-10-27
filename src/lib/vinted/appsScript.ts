/**
 * Script Google Apps Script que l'utilisateur installe UNE fois dans son propre compte Google.
 * Il tourne chez Google, avec les droits de l'utilisateur, et renvoie à l'application les e-mails
 * Vinted utiles — uniquement si la requête porte la clé secrète générée par l'application.
 */
export function newSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function appsScriptSource(secret: string): string {
  return `// CNG Vinted — synchronisation automatique des e-mails Vinted
// Ce script tourne dans TON compte Google. Il lit uniquement les e-mails envoyés par Vinted
// (ventes, paiements, mises à jour de commande, factures, reçus d'achat) et ne les renvoie
// qu'à l'application qui connaît la clé ci-dessous. Ne partage pas cette clé.
const CLE = '${secret}';

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== CLE) return reponse({ error: 'unauthorized' });
  const apres = /^\\d{4}\\/\\d{2}\\/\\d{2}$/.test(p.after || '') ? p.after : '2026/01/01';
  const requete = 'from:(vinted.fr OR vinted.com) subject:(vendu OR finalisée OR "mise à jour" OR facture OR reçu OR remboursée) after:' + apres;
  const messages = [];
  GmailApp.search(requete, 0, 300).forEach(function (fil) {
    fil.getMessages().forEach(function (m) {
      messages.push({
        id: m.getId(),
        date: m.getDate().toISOString(),
        subject: m.getSubject(),
        text: nettoyer(m.getPlainBody())
      });
    });
  });
  return reponse({ version: 1, messages: messages });
}

function nettoyer(t) {
  return String(t || '').replace(/https?:\\/\\/\\S+/g, '').replace(/\\s+/g, ' ').slice(0, 3000);
}

function reponse(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// À lancer une fois depuis l'éditeur (bouton ▷ Exécuter) pour autoriser l'accès à Gmail.
function autoriser() {
  GmailApp.search('from:vinted.fr', 0, 1);
}
`;
}
