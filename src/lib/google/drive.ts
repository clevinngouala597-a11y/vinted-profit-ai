/**
 * Sauvegardes dans Google Drive avec l'accès « fichiers créés par l'appli » (drive.file) :
 * l'appli ne voit QUE ses propres sauvegardes, rien d'autre du Drive.
 */
import { SyncError } from '../vinted/errors';
import { getSession, tokenValid } from './auth';
import { GoogleAuthNeeded } from './gmail';

const NAME = (d: string) => `cng-vinted-${d}.json`;

async function req(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Response> {
  const s = getSession();
  if (!tokenValid(s)) throw new GoogleAuthNeeded();
  let res: Response;
  try {
    res = await fetcher(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${s!.token}` } });
  } catch {
    throw new SyncError('Impossible de joindre Google Drive : vérifie ta connexion internet.');
  }
  if (res.status === 401) throw new GoogleAuthNeeded();
  if (!res.ok) throw new SyncError(`Google Drive a répondu avec une erreur (${res.status}).`);
  return res;
}

async function listBackups(fetcher: typeof fetch) {
  const q = encodeURIComponent("name contains 'cng-vinted-' and trashed = false");
  const r = await req(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=name desc&fields=files(id,name)&pageSize=100`, { method: 'GET' }, fetcher);
  return ((await r.json()) as { files?: { id: string; name: string }[] }).files ?? [];
}

/** Un fichier par jour (celui du jour est remplacé), les 30 derniers gardés. */
export async function googleDriveBackup(text: string, day: string, fetcher: typeof fetch = fetch) {
  const files = await listBackups(fetcher);
  for (const f of files.filter((x) => x.name === NAME(day))) await req(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' }, fetcher);
  const boundary = 'cng' + Math.random().toString(36).slice(2);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: NAME(day), mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  await req('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, fetcher);
  const rest = (await listBackups(fetcher)).slice(30);
  for (const f of rest) await req(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' }, fetcher);
  return NAME(day);
}

export async function googleDriveLatest(fetcher: typeof fetch = fetch): Promise<{ name: string; content: unknown } | null> {
  const files = await listBackups(fetcher);
  if (!files.length) return null;
  const r = await req(`https://www.googleapis.com/drive/v3/files/${files[0].id}?alt=media`, { method: 'GET' }, fetcher);
  return { name: files[0].name, content: await r.json() };
}
