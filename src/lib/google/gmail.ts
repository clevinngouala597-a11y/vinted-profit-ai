/**
 * Lecture des e-mails Vinted avec l'API Gmail, directement depuis le téléphone (jeton de l'utilisateur).
 * Produit exactement le même format que le script Google, pour que toute la suite (analyse, ventes,
 * bordereaux) reste identique.
 */
import type { RawEmail } from '../vinted/parse';
import { SyncError, TransientSyncError, withRetry } from '../vinted/errors';
import { getSession, tokenValid } from './auth';
import { GMAIL_QUERY } from './config';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GoogleAuthNeeded extends SyncError {
  constructor() { super('Ta connexion Google a expiré : touche « Se reconnecter ».'); }
}

/** Appel à l'API Gmail, retenté automatiquement en cas de coupure ou de surcharge passagère. */
const call = <T,>(path: string, fetcher: typeof fetch): Promise<T> => withRetry(() => callOnce<T>(path, fetcher));

async function callOnce<T>(path: string, fetcher: typeof fetch): Promise<T> {
  const s = getSession();
  if (!tokenValid(s)) throw new GoogleAuthNeeded();
  let res: Response;
  try {
    res = await fetcher(`${API}${path}`, { headers: { Authorization: `Bearer ${s!.token}` } });
  } catch {
    throw new TransientSyncError('Impossible de joindre Gmail : vérifie ta connexion internet.');
  }
  if (res.status === 401) throw new GoogleAuthNeeded();
  if (res.status === 403) throw new SyncError('Gmail refuse l’accès : reconnecte-toi et accepte la lecture de tes e-mails.');
  if (res.status === 429) throw new TransientSyncError('Trop de lectures Gmail d’un coup : réessaie dans quelques minutes.');
  if (res.status >= 500) throw new TransientSyncError(`Gmail est momentanément indisponible (${res.status}) : réessaie dans quelques minutes.`);
  if (!res.ok) throw new SyncError(`Gmail a répondu avec une erreur (${res.status}).`);
  return res.json() as Promise<T>;
}

interface Part { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[]; headers?: { name: string; value: string }[] }
interface Msg { id: string; internalDate?: string; payload?: Part }

export const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64urlToText = (s: string) => new TextDecoder().decode(b64urlToBytes(s));

const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', rsquo: '’', laquo: '«', raquo: '»', hellip: '…' };

/** HTML → texte lisible, proche de ce que Gmail donne au script (cellules séparées par « | »). */
export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, a) => (a ? ` [image: ${a}] ` : ' '))
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

/** Même nettoyage que le script : liens retirés, espaces regroupés, 3000 caractères. */
export const nettoyer = (t: string) => String(t || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').slice(0, 3000);

function findPart(p: Part | undefined, mime: string): Part | null {
  if (!p) return null;
  if (p.mimeType === mime && p.body?.data) return p;
  for (const c of p.parts ?? []) {
    const f = findPart(c, mime);
    if (f) return f;
  }
  return null;
}

export function messageToRaw(m: Msg): RawEmail {
  const headers = m.payload?.headers ?? [];
  const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
  const plain = findPart(m.payload, 'text/plain');
  const html = findPart(m.payload, 'text/html');
  const text = plain ? b64urlToText(plain.body!.data!) : html ? htmlToText(b64urlToText(html.body!.data!)) : '';
  return { id: m.id, date: new Date(Number(m.internalDate ?? Date.now())).toISOString(), subject, text: nettoyer(text) };
}

export interface GmailFetch {
  emails: RawEmail[];
  /** e-mails trouvés mais pas encore lus (coupure en cours de route) : ils seront relus à la prochaine synchro */
  failed: number;
  /** e-mails déjà enregistrés, pas relus */
  skipped: number;
}

/**
 * Tous les e-mails Vinted utiles depuis `since` (AAAA-MM-JJ).
 * Les e-mails déjà enregistrés (`known`) ne sont pas retéléchargés. Si la lecture d'un e-mail échoue
 * malgré les nouvelles tentatives, les autres sont quand même rendus : la synchro reprend là où elle
 * s'est arrêtée au lieu de tout perdre.
 */
export async function fetchGmailVinted(since: string, fetcher: typeof fetch = fetch, max = 500, known: Set<string> = new Set()): Promise<GmailFetch> {
  const ids: string[] = [];
  let page: string | undefined;
  const q = encodeURIComponent(`${GMAIL_QUERY} after:${since.replace(/-/g, '/')}`);
  do {
    const r = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?q=${q}&maxResults=100${page ? `&pageToken=${page}` : ''}`, fetcher);
    ids.push(...(r.messages ?? []).map((m) => m.id));
    page = r.nextPageToken;
  } while (page && ids.length < max);
  const todo = [...new Set(ids)].filter((id) => !known.has(id));
  const out: RawEmail[] = [];
  let failed = 0;
  // 5 lectures à la fois : rapide sans dépasser les limites de Gmail
  for (let i = 0; i < todo.length; i += 5) {
    const batch = await Promise.allSettled(todo.slice(i, i + 5).map((id) => call<Msg>(`/messages/${id}?format=full`, fetcher)));
    for (const b of batch) {
      if (b.status === 'fulfilled') out.push(messageToRaw(b.value));
      else if (b.reason instanceof GoogleAuthNeeded) throw b.reason;
      else failed++;
    }
  }
  return { emails: out, failed, skipped: ids.length - todo.length };
}

/** PDF des bordereaux (même réponse que l'action « bordereaux » du script). */
export async function fetchGmailLabels(ids: string[], fetcher: typeof fetch = fetch): Promise<{ id: string; pdf?: string; error?: string }[]> {
  const out: { id: string; pdf?: string; error?: string }[] = [];
  for (const id of ids) {
    try {
      const m = await call<Msg>(`/messages/${encodeURIComponent(id)}?format=full`, fetcher);
      const subject = (m.payload?.headers ?? []).find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
      if (!/bordereau/i.test(subject)) { out.push({ id, error: 'pas un bordereau Vinted' }); continue; }
      const pdfPart = (function find(p?: Part): Part | null {
        if (!p) return null;
        if ((/pdf/i.test(p.mimeType ?? '') || /\.pdf$/i.test(p.filename ?? '')) && p.body?.attachmentId) return p;
        for (const c of p.parts ?? []) { const f = find(c); if (f) return f; }
        return null;
      })(m.payload);
      if (!pdfPart) { out.push({ id, error: 'pas de PDF (QR code ?)' }); continue; }
      const att = await call<{ data: string }>(`/messages/${encodeURIComponent(id)}/attachments/${pdfPart.body!.attachmentId}`, fetcher);
      // base64 classique, comme le script
      out.push({ id, pdf: att.data.replace(/-/g, '+').replace(/_/g, '/') });
    } catch (e) {
      if (e instanceof GoogleAuthNeeded) throw e;
      out.push({ id, error: e instanceof Error ? e.message : 'erreur' });
    }
  }
  return out;
}
