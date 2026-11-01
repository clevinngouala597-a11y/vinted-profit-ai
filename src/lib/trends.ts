/**
 * Tendances (version bêta) : articles repérés (les plus likés sur Vinted), ajoutés à la main par l'admin
 * avec une photo et leur description. La liste est rangée dans le script Google de l'admin : seul l'admin
 * (sa clé, vérifiée par le script) peut ajouter, modifier ou retirer ; les testeurs la lisent et en gardent
 * une copie sur l'appareil (consultable hors ligne).
 *
 * Ces fiches servent seulement de repères : elles ne touchent ni au stock, ni aux ventes, ni à la comptabilité.
 */
import { getDb } from './db';
import { parseEuros } from './money';
import { FEEDBACK_MAIL_URL } from './beta';
import { adminKey } from './presence';
import type { Trend } from './types';

export type TrendFields = Pick<Trend, 'title' | 'brand' | 'size' | 'condition' | 'price' | 'likes' | 'seller' | 'url'>;

/** Supprime les émojis et puces en début de ligne. */
const clean = (s: string) => s.replace(/^[^\p{L}\p{N}#]+/u, '').trim();

/** « JEANS LOW RISE Y2K » → « Jeans low rise Y2K » (les mots avec chiffres restent en majuscules). */
export function sentenceCase(s: string): string {
  const t = s.trim();
  if (!t || t !== t.toUpperCase()) return t; // déjà en minuscules : on n'y touche pas
  const low = t.toLowerCase().replace(/\b([\p{L}]*\d[\p{L}\d]*)\b/gu, (w) => w.toUpperCase());
  return low.charAt(0).toUpperCase() + low.slice(1);
}

/** « JAPAN STYLE » → « Japan Style ». */
export function titleCase(s: string): string {
  const t = s.trim();
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}

const EUROS = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/g;

/**
 * Lit une description collée (message Telegram, annonce Vinted…) et en tire ce qu'elle contient.
 * Rien n'est inventé : un champ absent du texte reste vide.
 */
export function parseTrend(text: string): TrendFields {
  const out: TrendFields = { title: '', brand: '', size: '', condition: '', price: null, likes: null, seller: '', url: '' };
  const src = text.replace(/\r/g, '');
  const url = src.match(/https?:\/\/[^\s<>"]+/i);
  if (url) out.url = url[0].replace(/[).,;]+$/, '');
  const likes = src.match(/(\d[\d\s .]*)\s*(?:❤️|❤|♥️|♥|💖|💗|likes?\b|j['’]aime|favoris)/i);
  if (likes) out.likes = Number(likes[1].replace(/[\s .]/g, '')) || null;

  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const raw of lines) {
    const l = clean(raw);
    // ligne « TOP 32 • 120 ❤️ » ou trait de séparation : déjà lue
    if (!l || /^[-_—–─━=]{3,}$/.test(l) || /^#?\d+\s*(top\b|[•·])/i.test(l)) continue;
    if (/^👤/u.test(raw)) { out.seller ||= l.split(/\s+/)[0]; continue; }
    if (/^(💶|💵|💰|💸)/u.test(raw)) { const p = l.match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*€?/); if (p) out.price = parseEuros(p[1]); continue; }
    if (/^(⭐|⏳|⌛|🔎|🔍)/u.test(raw) || /^(ajouté|voir l['’]annonce)/i.test(l)) continue;
    const parts = l.split(/\s*,\s*/);
    let used = false;
    for (const part of parts) {
      const kv = part.match(/^(marque|brand|taille|size|[ée]tat|condition|prix)\s*:\s*(.+)$/i);
      if (!kv) continue;
      used = true;
      const k = kv[1].toLowerCase();
      if (k.startsWith('marque') || k === 'brand') out.brand ||= titleCase(kv[2]);
      else if (k.startsWith('taille') || k === 'size') out.size ||= kv[2].trim();
      else if (k === 'prix') out.price ??= parseEuros(kv[2]);
      else out.condition ||= sentenceCase(kv[2]);
    }
    if (!out.title && (used || parts.length === 1) && !/^\d/.test(parts[0]) && !/:/.test(parts[0])) out.title = sentenceCase(parts[0]);
    if (out.price === null && used) {
      const m = [...l.matchAll(EUROS)];
      if (m.length) out.price = parseEuros(m[0][1]);
    }
  }
  if (out.price === null) {
    const m = [...src.matchAll(EUROS)];
    if (m.length) out.price = parseEuros(m[0][1]);
  }
  return out;
}

export interface TrendInput extends TrendFields {
  id?: string;
  text: string;
  note: string;
}

/** Article tel que rangé dans le script Google de l'admin (photo : identifiant du fichier dans son Drive). */
export interface RemoteTrend extends TrendFields {
  id: string;
  text: string;
  note: string;
  photo: string | null;
  addedAt: string;
  updatedAt: string;
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const photoKey = (remote: string) => 'tp-' + remote;

/** Vérifie une fiche reçue du script (rien d'autre que des textes et des nombres). */
export function cleanRemote(x: unknown): RemoteTrend | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = str(o.id, 64);
  if (!/^[\w-]{6,64}$/.test(id)) return null;
  const url = str(o.url, 500);
  return {
    id,
    title: str(o.title, 160) || 'Article repéré',
    brand: str(o.brand, 80),
    size: str(o.size, 40),
    condition: str(o.condition, 60),
    price: numOrNull(o.price),
    likes: numOrNull(o.likes),
    seller: str(o.seller, 60),
    url: /^https:\/\//i.test(url) ? url : '',
    text: str(o.text, 3000),
    note: str(o.note, 300),
    photo: /^[\w-]{10,100}$/.test(str(o.photo, 100)) ? str(o.photo, 100) : null,
    addedAt: str(o.addedAt, 40) || new Date(0).toISOString(),
    updatedAt: str(o.updatedAt, 40) || str(o.addedAt, 40) || new Date(0).toISOString(),
  };
}

export function checkInput(t: TrendInput, hasPhoto: boolean) {
  const title = t.title.trim() || t.text.trim().split('\n')[0]?.slice(0, 80) || '';
  if (!title && !hasPhoto) throw new Error('Ajoute au moins une photo ou une description.');
  if (t.url.trim() && !/^https:\/\//i.test(t.url.trim())) throw new Error('Le lien doit commencer par https://');
  return {
    id: t.id, title: title || 'Article repéré', brand: t.brand.trim(), size: t.size.trim(), condition: t.condition.trim(),
    price: t.price, likes: t.likes, seller: t.seller.trim(), url: t.url.trim(), text: t.text.trim(), note: t.note.trim(),
  };
}

/**
 * Remplace la copie locale par la liste reçue : les photos déjà téléchargées sont gardées,
 * celles des articles retirés sont effacées. Renvoie les photos encore à télécharger.
 */
export async function storeRemote(list: RemoteTrend[]): Promise<string[]> {
  const db = getDb();
  const before = await db.trends.toArray();
  const keep = new Set(list.filter((r) => r.photo).map((r) => photoKey(r.photo!)));
  const missing: string[] = [];
  await db.transaction('rw', db.trends, db.attachments, async () => {
    for (const b of before) if (b.photoId && !keep.has(b.photoId)) await db.attachments.delete(b.photoId);
    await db.trends.clear();
    for (const r of list) {
      const pid = r.photo ? photoKey(r.photo) : null;
      if (pid && !(await db.attachments.get(pid))) missing.push(r.photo!);
      const { photo: _p, ...rest } = r;
      await db.trends.put({ ...rest, photoId: pid });
    }
  });
  return missing;
}

function b64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function blobToB64(b: Blob): Promise<string> {
  const u = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function readJson(r: Response) {
  return (await r.json().catch(() => null)) as { ok?: boolean; erreur?: string; items?: unknown[]; data?: string; mime?: string; item?: unknown } | null;
}

/** Télécharge la liste partagée (et les photos manquantes), puis la range sur l'appareil. */
export async function syncTrends(fetcher: typeof fetch = fetch, url = FEEDBACK_MAIL_URL): Promise<number> {
  let res: Response;
  try {
    res = await fetcher(`${url}?action=tendances`, { redirect: 'follow' });
  } catch {
    throw new Error('Pas de connexion internet : la dernière liste reçue reste affichée.');
  }
  const body = await readJson(res);
  if (!body?.ok || !Array.isArray(body.items)) throw new Error('Tendances indisponibles pour le moment.');
  const list = body.items.map(cleanRemote).filter((x): x is RemoteTrend => !!x);
  const missing = await storeRemote(list);
  const db = getDb();
  await Promise.all(missing.map(async (id) => {
    try {
      const r = await readJson(await fetcher(`${url}?action=photo&id=${encodeURIComponent(id)}`, { redirect: 'follow' }));
      if (!r?.ok || !r.data || !/^image\/(jpeg|png|webp)$/.test(r.mime ?? '')) return;
      await db.attachments.put({ id: photoKey(id), blob: b64ToBlob(r.data, r.mime!), mime: r.mime!, createdAt: new Date().toISOString() });
    } catch { /* photo réessayée à la prochaine ouverture */ }
  }));
  return list.length;
}

async function adminPost(payload: Record<string, unknown>, fetcher: typeof fetch, url: string) {
  const key = adminKey();
  if (!key) throw new Error('Réservé à l’admin : débloque avec ton code admin.');
  let res: Response;
  try {
    res = await fetcher(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ app: 'cng-tendances', key, ...payload }), redirect: 'follow' });
  } catch {
    throw new Error('Pas de connexion internet.');
  }
  const body = await readJson(res);
  if (!body?.ok) throw new Error(body?.erreur === 'cle' ? 'Code admin refusé par le script.' : 'Le script n’a pas pu enregistrer : réessaie.');
  return body;
}

/** Admin : ajoute ou modifie un article (photo facultative ; sans nouvelle photo, l'ancienne est gardée). */
export async function publishTrend(t: TrendInput, photo: Blob | null, hadPhoto: boolean, fetcher: typeof fetch = fetch, url = FEEDBACK_MAIL_URL) {
  const item = checkInput(t, !!photo || hadPhoto);
  await adminPost({ op: 'save', item, photo: photo ? { data: await blobToB64(photo), mime: photo.type || 'image/jpeg' } : null }, fetcher, url);
  await syncTrends(fetcher, url);
}

/** Admin : retire un article de la liste partagée (sa photo aussi). */
export async function removeTrend(id: string, fetcher: typeof fetch = fetch, url = FEEDBACK_MAIL_URL) {
  await adminPost({ op: 'delete', id }, fetcher, url);
  await syncTrends(fetcher, url);
}

export type TrendSort = 'likes' | 'recent' | 'price';

export function sortTrends(list: Trend[], by: TrendSort): Trend[] {
  const r = [...list];
  if (by === 'likes') r.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1) || b.addedAt.localeCompare(a.addedAt));
  else if (by === 'price') r.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  else r.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return r;
}

export function filterTrends(list: Trend[], q: string): Trend[] {
  const n = q.trim().toLowerCase();
  if (!n) return list;
  return list.filter((t) => [t.title, t.brand, t.size, t.condition, t.seller, t.note, t.text].join(' ').toLowerCase().includes(n));
}
