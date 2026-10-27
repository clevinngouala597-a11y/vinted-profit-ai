/**
 * Sauvegarde automatique dans le Google Drive de l'utilisateur, par son propre script Google (version 2).
 * Rien ne passe par un serveur tiers : l'application envoie la sauvegarde au script, qui la range dans
 * le dossier « CNG Vinted - sauvegardes » de son Drive (une par jour, les 30 dernières gardées).
 */
import { loadDataset, saveSettings } from '../actions';
import { createBackup, restoreBackup } from '../exports';
import { SyncError } from './sync';

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
  const text = await (await createBackup(true)).text();
  // text/plain : pas de requête préalable du navigateur, accepté par Google Apps Script
  const body = await callScript('sauvegarder', { method: 'POST', body: text, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }, fetcher);
  if (!body.ok) throw new SyncError('Ton script Google ne sait pas encore sauvegarder : mets-le à jour (version 2).');
  await saveSettings({ driveBackupAt: new Date().toISOString(), lastBackupAt: new Date().toISOString() });
  return String(body.nom ?? '');
}

/** Remplace toutes les données de l'application par la dernière sauvegarde du Drive. */
export async function driveRestore(fetcher: typeof fetch = fetch) {
  const body = await callScript('restaurer', { method: 'GET' }, fetcher);
  if (!body.sauvegarde) throw new SyncError('Ton script Google ne sait pas encore restaurer : mets-le à jour (version 2).');
  const r = await restoreBackup(new Blob([JSON.stringify(body.sauvegarde)], { type: 'application/json' }));
  return { ...r, name: String(body.nom ?? '') };
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
  if (!s.syncUrl || (s.scriptVersion ?? 1) < 2) return false;
  if (s.driveBackupAt && Date.now() - Date.parse(s.driveBackupAt) < AUTO_BACKUP_HOURS * 3_600_000) return false;
  await driveBackup(fetcher);
  return true;
}
