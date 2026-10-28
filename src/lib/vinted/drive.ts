/**
 * Sauvegarde automatique dans le Google Drive de l'utilisateur, par son propre script Google (version 2).
 * Rien ne passe par un serveur tiers : l'application envoie la sauvegarde au script, qui la range dans
 * le dossier « CNG Vinted - sauvegardes » de son Drive (une par jour, les 30 dernières gardées).
 */
import { loadDataset, saveSettings } from '../actions';
import { createBackup, restoreBackup } from '../exports';
import { SyncError } from './sync';
import { decryptText, deriveKey, encryptText, isEnvelope, MIN_PASSWORD, newSalt } from '../backupCrypto';
import { newSecret } from './appsScript';

/** Fréquence des sauvegardes automatiques. */
export const AUTO_BACKUP_HOURS = 12;

export async function callScript(action: string, init: RequestInit, fetcher: typeof fetch, extra = '') {
  const { syncUrl, syncToken } = (await loadDataset()).settings;
  if (!syncUrl || !syncToken) throw new SyncError("Connecte d'abord ton Gmail (Synchro Vinted).");
  let res: Response;
  try {
    res = await fetcher(`${syncUrl}?token=${encodeURIComponent(syncToken)}&action=${action}${extra}`, { redirect: 'follow', ...init });
  } catch {
    throw new SyncError('Impossible de joindre ton script Google. Vérifie ta connexion internet.');
  }
  if (!res.ok) throw new SyncError(`Le script Google a répondu avec une erreur (${res.status}).`);
  let body: Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    throw new SyncError('Réponse illisible du script Google : mets-le à jour (version 2).');
  }
  if (body.error === 'unauthorized') throw new SyncError('Clé secrète refusée : le script et l’application n’ont pas la même clé.');
  if (body.error === 'aucune sauvegarde') throw new SyncError('Aucune sauvegarde dans ton Google Drive pour l’instant.');
  if (body.error) throw new SyncError(`Erreur du script Google : ${body.error}`);
  return body;
}

export async function driveBackup(fetcher: typeof fetch = fetch): Promise<string> {
  const s = (await loadDataset()).settings;
  const plain = await (await createBackup(true)).text();
  // chiffrée avec le mot de passe de sauvegarde, s'il y en a un
  const text = s.backupKey && s.backupSalt ? JSON.stringify(await encryptText(plain, s.backupKey, s.backupSalt)) : plain;
  if (s.syncMode === 'google') {
    const { googleDriveBackup } = await import('../google/drive');
    const name = await googleDriveBackup(text, new Date().toISOString().slice(0, 10), fetcher);
    await saveSettings({ driveBackupAt: new Date().toISOString(), lastBackupAt: new Date().toISOString() });
    return name;
  }
  // text/plain : pas de requête préalable du navigateur, accepté par Google Apps Script
  const body = await callScript('sauvegarder', { method: 'POST', body: text, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }, fetcher);
  if (!body.ok) throw new SyncError('Ton script Google ne sait pas encore sauvegarder : mets-le à jour (version 2).');
  await saveSettings({ driveBackupAt: new Date().toISOString(), lastBackupAt: new Date().toISOString() });
  return String(body.nom ?? '');
}

export class PasswordNeeded extends Error {
  constructor() { super('Cette sauvegarde est chiffrée : entre ton mot de passe de sauvegarde.'); }
}

/** Remplace toutes les données de l'application par la dernière sauvegarde du Drive. */
export async function driveRestore(fetcher: typeof fetch = fetch, password?: string) {
  let body: Record<string, unknown>;
  if ((await loadDataset()).settings.syncMode === 'google') {
    const { googleDriveLatest } = await import('../google/drive');
    const latest = await googleDriveLatest(fetcher);
    if (!latest) throw new SyncError('Aucune sauvegarde dans ton Google Drive pour l’instant.');
    body = { sauvegarde: latest.content, nom: latest.name };
  } else body = await callScript('restaurer', { method: 'GET' }, fetcher);
  if (!body.sauvegarde) throw new SyncError('Ton script Google ne sait pas encore restaurer : mets-le à jour (version 2).');
  let json = JSON.stringify(body.sauvegarde);
  if (isEnvelope(body.sauvegarde)) {
    const env = body.sauvegarde;
    const s = (await loadDataset()).settings;
    // même mot de passe que sur ce téléphone : pas besoin de le redemander
    const key = password ? await deriveKey(password, env.sel) : s.backupKey && s.backupSalt === env.sel ? s.backupKey : null;
    if (!key) throw new PasswordNeeded();
    json = await decryptText(env, key);
    const r = await restoreBackup(new Blob([json], { type: 'application/json' }));
    // ce téléphone continue de chiffrer avec le même mot de passe
    await saveSettings({ backupKey: key, backupSalt: env.sel });
    return { ...r, name: String(body.nom ?? '') };
  }
  const r = await restoreBackup(new Blob([json], { type: 'application/json' }));
  return { ...r, name: String(body.nom ?? '') };
}

/** Active (ou change) le chiffrement des sauvegardes, puis sauvegarde tout de suite. */
export async function setBackupPassword(password: string, fetcher: typeof fetch = fetch) {
  if (password.length < MIN_PASSWORD) throw new Error(`Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`);
  const salt = newSalt();
  await saveSettings({ backupKey: await deriveKey(password, salt), backupSalt: salt });
  return driveBackup(fetcher);
}

export async function removeBackupPassword(fetcher: typeof fetch = fetch) {
  await saveSettings({ backupKey: null, backupSalt: null });
  return driveBackup(fetcher);
}

/**
 * Change la clé secrète du script Google (version 4) : la nouvelle clé est envoyée au script avec
 * l'ancienne, vérifiée, puis enregistrée ici. L'ancienne clé ne fonctionne plus.
 */
export async function rotateScriptKey(fetcher: typeof fetch = fetch) {
  const s = (await loadDataset()).settings;
  if ((s.scriptVersion ?? 1) < 4) throw new SyncError('Mets d’abord ton script Google à jour (version 4).');
  const fresh = newSecret();
  const body = await callScript('changer_cle', { method: 'POST', body: fresh, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }, fetcher);
  if (!body.ok) throw new SyncError('Le script n’a pas accepté la nouvelle clé.');
  // le script a déjà la nouvelle clé : on l'enregistre ici, puis on vérifie qu'elle répond
  await saveSettings({ syncToken: fresh });
  await callScript('ping', { method: 'GET' }, fetcher);
}

export async function sendTestNotification(fetcher: typeof fetch = fetch) {
  const body = await callScript('test', { method: 'GET' }, fetcher);
  if (!body.ok) throw new SyncError('Ton script Google ne gère pas encore les notifications : mets-le à jour (version 2).');
  await saveSettings({ scriptNotifications: body.notifications === true });
  return body.notifications === true;
}

/** Sauvegarde automatique (silencieuse) si la dernière date de plus de AUTO_BACKUP_HOURS heures. */
export async function autoBackupIfDue(fetcher: typeof fetch = fetch) {
  const s = (await loadDataset()).settings;
  if (s.syncMode !== 'google' && (!s.syncUrl || (s.scriptVersion ?? 1) < 2)) return false;
  if (s.driveBackupAt && Date.now() - Date.parse(s.driveBackupAt) < AUTO_BACKUP_HOURS * 3_600_000) return false;
  await driveBackup(fetcher);
  return true;
}
