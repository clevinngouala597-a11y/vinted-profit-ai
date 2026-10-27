/**
 * Script Google Apps Script que l'utilisateur installe UNE fois dans son propre compte Google.
 * Il tourne chez Google, avec les droits de l'utilisateur :
 *  - il renvoie à l'application les e-mails Vinted utiles (uniquement avec la clé secrète) ;
 *  - il range les sauvegardes de l'application dans son Google Drive (version 2) ;
 *  - il vérifie Gmail toutes les 5 minutes et envoie une notification à chaque vente, même appli fermée,
 *    via l'appli ntfy et un sujet secret (version 2).
 */
export const SCRIPT_VERSION = 2;

export function newSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sujet ntfy : secret (n'importe qui connaissant le nom pourrait lire les notifications). */
export function newTopic(): string {
  return `cng-vinted-${newSecret().slice(0, 20)}`;
}

export function appsScriptSource(secret: string, topic: string): string {
  return `// CNG Vinted — script Google (version ${SCRIPT_VERSION})
// Ce script tourne dans TON compte Google. Il :
//  - renvoie à l'application les e-mails envoyés par Vinted (ventes, paiements, commandes, factures, achats) ;
//  - range les sauvegardes de l'application dans ton Google Drive (dossier « CNG Vinted - sauvegardes ») ;
//  - te prévient à chaque vente, même appli fermée (appli ntfy, sujet secret ci-dessous).
// Il ne répond qu'à l'application qui connaît la clé ci-dessous. Ne partage ni la clé ni le sujet.
const CLE = '${secret}';
const SUJET = '${topic}';
const VERSION = ${SCRIPT_VERSION};
const DOSSIER = 'CNG Vinted - sauvegardes';
const RECHERCHE = 'from:(vinted.fr OR vinted.com) subject:(vendu OR finalisée OR "mise à jour" OR facture OR reçu OR remboursée)';

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== CLE) return reponse({ error: 'unauthorized' });
  if (p.action === 'restaurer') return reponse(derniereSauvegarde());
  if (p.action === 'test') {
    notifier('Test CNG Vinted', 'Les notifications fonctionnent : tu seras prévenu à chaque vente.', ['white_check_mark']);
    return reponse({ version: VERSION, ok: true, notifications: notificationsActives() });
  }
  const apres = /^\\d{4}\\/\\d{2}\\/\\d{2}$/.test(p.after || '') ? p.after : '2026/01/01';
  const messages = [];
  GmailApp.search(RECHERCHE + ' after:' + apres, 0, 300).forEach(function (fil) {
    fil.getMessages().forEach(function (m) {
      messages.push({ id: m.getId(), date: m.getDate().toISOString(), subject: m.getSubject(), text: nettoyer(m.getPlainBody()) });
    });
  });
  return reponse({ version: VERSION, messages: messages, notifications: notificationsActives(), sujet: SUJET });
}

// Sauvegarde envoyée par l'application : un fichier par jour, les 30 derniers sont gardés.
function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== CLE) return reponse({ error: 'unauthorized' });
  if (p.action !== 'sauvegarder') return reponse({ error: 'action inconnue' });
  const contenu = e.postData && e.postData.contents;
  if (!contenu || contenu.charAt(0) !== '{') return reponse({ error: 'sauvegarde vide' });
  const dossier = dossierSauvegardes();
  const nom = 'cng-vinted-' + Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd') + '.json';
  const anciens = dossier.getFilesByName(nom);
  while (anciens.hasNext()) anciens.next().setTrashed(true);
  dossier.createFile(Utilities.newBlob(contenu, 'application/json', nom));
  const fichiers = listeSauvegardes(dossier);
  fichiers.slice(30).forEach(function (f) { f.setTrashed(true); });
  return reponse({ version: VERSION, ok: true, nom: nom });
}

function derniereSauvegarde() {
  const fichiers = listeSauvegardes(dossierSauvegardes());
  if (!fichiers.length) return { version: VERSION, error: 'aucune sauvegarde' };
  return { version: VERSION, nom: fichiers[0].getName(), sauvegarde: JSON.parse(fichiers[0].getBlob().getDataAsString()) };
}

function listeSauvegardes(dossier) {
  const out = [];
  const it = dossier.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^cng-vinted-\\d{4}-\\d{2}-\\d{2}\\.json$/.test(f.getName())) out.push(f);
  }
  return out.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
}

function dossierSauvegardes() {
  const it = DriveApp.getFoldersByName(DOSSIER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DOSSIER);
}

// Lancé automatiquement toutes les 5 minutes : une notification par nouvelle vente ou paiement.
function verifierVentes() {
  const props = PropertiesService.getScriptProperties();
  const deja = JSON.parse(props.getProperty('notifies') || '[]');
  const vus = {};
  deja.forEach(function (id) { vus[id] = true; });
  const nouveaux = [];
  // peu de lectures Gmail : seulement les fils du jour (Gmail limite le nombre de lectures quotidiennes)
  GmailApp.search('from:(vinted.fr OR vinted.com) subject:(vendu OR finalisée) newer_than:1d', 0, 15).forEach(function (fil) {
    fil.getMessages().forEach(function (m) { if (!vus[m.getId()]) nouveaux.push(m); });
  });
  nouveaux.sort(function (a, b) { return a.getDate() - b.getDate(); }).forEach(function (m) {
    const sujet = m.getSubject();
    const texte = nettoyer(m.getPlainBody()).replace(/\\[image:[^\\]]*\\]/g, ' ');
    if (/vendu/i.test(sujet)) {
      const v = texte.match(/a achet[ée]\\s+(.+?)\\s+(\\d[\\d\\s.]*,\\d{2})\\s*€/);
      notifier('Nouvelle vente !', v ? v[1] + ' — ' + v[2] + ' €' : 'Un article vient de se vendre sur Vinted.', ['moneybag']);
    } else if (/finalis/i.test(sujet)) {
      const t = texte.match(/La vente de (.+?) a été réalisée/);
      const a = texte.match(/Viré sur ton compte Vinted\\s*:?\\s*(\\d[\\d\\s.]*,\\d{2})\\s*€/);
      notifier('Paiement reçu', (t ? t[1] : 'Vente finalisée') + (a ? ' — ' + a[1] + ' €' : ''), ['dollar']);
    }
    deja.push(m.getId());
  });
  props.setProperty('notifies', JSON.stringify(deja.slice(-200)));
}

function notifier(titre, message, tags) {
  UrlFetchApp.fetch('https://ntfy.sh/', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ topic: SUJET, title: titre, message: message, tags: tags, priority: 4 }),
    muteHttpExceptions: true
  });
}

function notificationsActives() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'verifierVentes'; });
}

function nettoyer(t) {
  return String(t || '').replace(/https?:\\/\\/\\S+/g, '').replace(/\\s+/g, ' ').slice(0, 3000);
}

function reponse(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// À lancer une fois depuis l'éditeur (bouton ▷ Exécuter) : autorise Gmail, Drive et les notifications,
// et active la vérification automatique toutes les 5 minutes.
function installer() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'verifierVentes') ScriptApp.deleteTrigger(t);
  });
  // les ventes déjà reçues ne sont pas notifiées (pas de rafale à l'installation)
  const ids = [];
  GmailApp.search('from:(vinted.fr OR vinted.com) subject:(vendu OR finalisée) newer_than:2d', 0, 30).forEach(function (fil) {
    fil.getMessages().forEach(function (m) { ids.push(m.getId()); });
  });
  PropertiesService.getScriptProperties().setProperty('notifies', JSON.stringify(ids.slice(-200)));
  ScriptApp.newTrigger('verifierVentes').timeBased().everyMinutes(5).create();
  dossierSauvegardes();
  notifier('CNG Vinted', 'Notifications activées : tu seras prévenu à chaque vente.', ['white_check_mark']);
}

// Ancien nom, gardé pour compatibilité.
function autoriser() { installer(); }
`;
}
