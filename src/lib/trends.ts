/**
 * Tendances : articles repérés (les plus likés sur Vinted, par exemple depuis un canal Telegram),
 * ajoutés à la main avec une photo et leur description.
 *
 * Ces fiches servent seulement de repères : elles ne touchent ni au stock, ni aux ventes, ni à la comptabilité.
 */
import { getDb } from './db';
import { parseEuros } from './money';
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
  photoId: string | null;
}

export async function saveTrend(t: TrendInput): Promise<string> {
  const title = t.title.trim() || t.text.trim().split('\n')[0]?.slice(0, 80) || '';
  if (!title && !t.photoId) throw new Error('Ajoute au moins une photo ou une description.');
  if (t.url && !/^https?:\/\//i.test(t.url.trim())) throw new Error('Le lien doit commencer par https://');
  const db = getDb();
  const at = new Date().toISOString();
  const old = t.id ? await db.trends.get(t.id) : undefined;
  const row: Trend = {
    id: old?.id ?? crypto.randomUUID(),
    title: title || 'Article repéré',
    brand: t.brand.trim(),
    size: t.size.trim(),
    condition: t.condition.trim(),
    price: t.price,
    likes: t.likes,
    seller: t.seller.trim(),
    url: t.url.trim(),
    text: t.text.trim(),
    note: t.note.trim(),
    photoId: t.photoId,
    addedAt: old?.addedAt ?? at,
    updatedAt: at,
  };
  await db.transaction('rw', db.trends, db.attachments, async () => {
    await db.trends.put(row);
    // photo remplacée : l'ancienne est effacée
    if (old?.photoId && old.photoId !== row.photoId) await db.attachments.delete(old.photoId);
  });
  return row.id;
}

export async function deleteTrend(id: string) {
  const db = getDb();
  await db.transaction('rw', db.trends, db.attachments, async () => {
    const t = await db.trends.get(id);
    if (!t) return;
    await db.trends.delete(id);
    if (t.photoId) await db.attachments.delete(t.photoId);
  });
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
