/**
 * Utilisateurs de l'appli, pour l'admin.
 *
 * À l'ouverture (puis toutes les 5 minutes tant que l'appli est affichée), l'appareil envoie au script
 * Google du créateur un signal anonyme : un identifiant tiré au hasard sur cet appareil, la version
 * (officielle ou bêta), le code testeur en bêta, le type d'appareil et si la connexion Google est
 * active. Aucune donnée de vente, aucun nom, aucune adresse e-mail. L'utilisateur peut le désactiver.
 *
 * L'admin débloque la liste avec son code : l'appareil garde une empreinte du code, que le script
 * vérifie avant de répondre.
 */
import { BETA, BUILD, deviceSummary, FEEDBACK_MAIL_URL } from './beta';
import { ACCESS, ADMIN, checkCode, normalizeCode, storedAccess } from './betaAccess';

export const PRESENCE_EVERY_MS = 5 * 60_000;
export const ONLINE_MS = 6 * 60_000;
const ID_KEY = 'cng-appareil';
const AT_KEY = 'cng-presence-at';
const ADMIN_KEY = 'cng-admin-stats';

const ls = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function deviceId(): string {
  const s = ls();
  let id = s?.getItem(ID_KEY) ?? null;
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).toLowerCase();
    try { s?.setItem(ID_KEY, id); } catch { /* navigation privée */ }
  }
  return id;
}

export interface PresencePing {
  app: 'cng-presence';
  id: string;
  v: 'officielle' | 'beta';
  build: string;
  tester: string | null;
  device: string;
  google: boolean;
}

export function presencePing(google: boolean): PresencePing {
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  return {
    app: 'cng-presence',
    id: deviceId(),
    v: BETA ? 'beta' : 'officielle',
    build: BUILD,
    tester: BETA ? storedAccess()?.tester ?? null : null,
    device: deviceSummary(typeof navigator === 'undefined' ? '' : navigator.userAgent, standalone, typeof innerWidth === 'number' ? innerWidth : 0),
    google,
  };
}

/** Envoie le signal de présence (au plus toutes les 5 minutes). Ne bloque jamais l'appli. */
export async function sendPresence(opts: { google: boolean; enabled: boolean }, fetcher: typeof fetch = fetch, url = FEEDBACK_MAIL_URL, now = Date.now()): Promise<boolean> {
  if (!opts.enabled || !url) return false;
  const s = ls();
  const last = Number(s?.getItem(AT_KEY) ?? 0);
  if (now - last < PRESENCE_EVERY_MS - 5000) return false;
  try { s?.setItem(AT_KEY, String(now)); } catch { /* ignore */ }
  try {
    await fetcher(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(presencePing(opts.google)) });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Accès admin
// ---------------------------------------------------------------------------

export async function sha256hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const adminKey = () => ls()?.getItem(ADMIN_KEY) ?? null;
export const isStatsAdmin = () => !!adminKey();

/** Débloque la liste des utilisateurs avec le code admin. */
export async function unlockAdmin(code: string, list: Record<string, string> = ACCESS): Promise<boolean> {
  const ok = await checkCode(code, list);
  if (ok?.tester !== ADMIN) return false;
  const key = await sha256hex('cng-stats:' + normalizeCode(code));
  try { ls()?.setItem(ADMIN_KEY, key); } catch { /* ignore */ }
  return true;
}

export function lockAdmin() {
  try { ls()?.removeItem(ADMIN_KEY); } catch { /* ignore */ }
}

export interface DeviceRow {
  id: string;
  v: 'officielle' | 'beta';
  build: string;
  tester: string | null;
  device: string;
  google: boolean;
  first: string;
  last: string;
  opens: number;
}

export async function fetchUsers(fetcher: typeof fetch = fetch, url = FEEDBACK_MAIL_URL): Promise<DeviceRow[]> {
  const key = adminKey();
  if (!key) throw new Error('Accès admin requis.');
  let res: Response;
  try {
    res = await fetcher(`${url}?action=presence&key=${encodeURIComponent(key)}`, { redirect: 'follow' });
  } catch {
    throw new Error('Pas de connexion internet.');
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; devices?: DeviceRow[]; erreur?: string } | null;
  if (!body?.ok) throw new Error(body?.erreur === 'cle' ? 'Code admin refusé par le script.' : 'Liste indisponible pour le moment.');
  return body.devices ?? [];
}

export function summarize(rows: DeviceRow[], now = Date.now()) {
  const age = (r: DeviceRow) => now - Date.parse(r.last);
  const day = 86_400_000;
  return {
    online: rows.filter((r) => age(r) < ONLINE_MS).length,
    today: rows.filter((r) => age(r) < day).length,
    week: rows.filter((r) => age(r) < 7 * day).length,
    total: rows.length,
    beta: rows.filter((r) => r.v === 'beta').length,
    google: rows.filter((r) => r.google).length,
  };
}
