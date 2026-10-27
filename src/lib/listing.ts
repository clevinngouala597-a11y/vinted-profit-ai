/**
 * Annonces : rédaction par IA à partir des photos (Claude, avec la clé de l'utilisateur, appelée
 * directement depuis le téléphone) et conseil de prix calculé UNIQUEMENT à partir de l'historique de
 * ventes de l'utilisateur (l'IA ne donne aucun chiffre).
 */
import { DEFAULT_CATEGORIES, SELLABLE, type Dataset, type Item } from './types';
import { saleBreakdown } from './engine';
import { detectBrand } from './stats';
import type { Cents } from './money';

export const AI_MODEL = 'claude-sonnet-5-5';
export const CONDITIONS = ['Neuf avec étiquette', 'Neuf sans étiquette', 'Très bon état', 'Bon état', 'Satisfaisant'] as const;

export interface ListingDraft {
  title: string;
  description: string;
  brand: string | null;
  size: string | null;
  condition: (typeof CONDITIONS)[number] | null;
  category: string;
  color: string | null;
  hashtags: string[];
  /** défauts visibles à signaler honnêtement */
  defects: string[];
}

export function listingPrompt(categories: string[], notes: string) {
  return `Tu rédiges une annonce Vinted en français pour un vendeur de vêtements de seconde main, à partir des photos.
Règles :
- N'invente rien : marque, taille, matière ou défaut seulement s'ils sont lisibles sur les photos ou donnés par le vendeur, sinon null / liste vide.
- Aucun prix, aucun chiffre de vente.
- Titre accrocheur, 60 caractères maximum, format « Type Marque Détail clé couleur - Taille X » (sans la taille si inconnue).
- Description courte et honnête (4 à 7 lignes) : ce que c'est, style, état, défauts éventuels, conseil de taille si visible ; ton simple et chaleureux, tutoiement, pas d'emojis excessifs.
- 5 à 8 hashtags pertinents sans espaces.
- Catégorie parmi : ${categories.join(', ')}.
- État parmi : ${CONDITIONS.join(', ')}.
${notes.trim() ? `Infos du vendeur (fiables) : ${notes.trim()}\n` : ''}Réponds UNIQUEMENT avec un objet JSON : {"title":"","description":"","brand":null,"size":null,"condition":null,"category":"","color":null,"hashtags":[],"defects":[]}`;
}

/** Interprète la réponse du modèle (JSON, éventuellement entouré de texte). */
export function parseDraft(text: string, categories: string[]): ListingDraft {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("L'IA n'a pas renvoyé d'annonce lisible. Réessaie.");
  const j = JSON.parse(m[0]) as Partial<ListingDraft>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    title: (str(j.title) ?? 'Article').slice(0, 80),
    description: str(j.description) ?? '',
    brand: str(j.brand),
    size: str(j.size),
    condition: CONDITIONS.find((c) => c === j.condition) ?? null,
    category: categories.find((c) => c === j.category) ?? 'Autres vêtements',
    color: str(j.color),
    hashtags: Array.isArray(j.hashtags) ? j.hashtags.filter((h): h is string => typeof h === 'string').map((h) => `#${h.replace(/^#/, '').replace(/\s+/g, '')}`).slice(0, 10) : [],
    defects: Array.isArray(j.defects) ? j.defects.filter((d): d is string => typeof d === 'string') : [],
  };
}

/** Appel direct à l'API Claude depuis le navigateur, avec la clé de l'utilisateur. */
export async function draftListing(key: string, imagesBase64Jpeg: string[], notes: string, categories = DEFAULT_CATEGORIES, fetcher: typeof fetch = fetch): Promise<ListingDraft> {
  if (!key.trim()) throw new Error('Ajoute ta clé API Claude (Réglages de l’annonce IA).');
  if (!imagesBase64Jpeg.length) throw new Error('Ajoute au moins une photo.');
  let res: Response;
  try {
    res = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            ...imagesBase64Jpeg.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
            { type: 'text', text: listingPrompt(categories, notes) },
          ],
        }],
      }),
    });
  } catch {
    throw new Error('Impossible de joindre Claude : vérifie ta connexion internet.');
  }
  const body = await res.json().catch(() => null) as { content?: { type: string; text?: string }[]; error?: { message?: string } } | null;
  if (res.status === 401) throw new Error('Clé API refusée : vérifie-la dans les réglages de l’annonce IA.');
  if (res.status === 429) throw new Error('Trop de demandes d’un coup : réessaie dans une minute.');
  if (!res.ok || !body?.content) throw new Error(`Erreur de Claude${body?.error?.message ? ` : ${body.error.message}` : ''}.`);
  return parseDraft(body.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), categories);
}

// ---------------------------------------------------------------------------
// Conseil de prix (historique de l'utilisateur uniquement)
// ---------------------------------------------------------------------------

export interface PriceAdvice {
  /** prix de vente médian des ventes comparables */
  median: Cents | null;
  low: Cents | null;
  high: Cents | null;
  count: number;
  basis: string | null;
  /** prix minimum pour atteindre le bénéfice minimum par article */
  minimum: Cents | null;
}

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2); };
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

export function priceAdvice(ds: Dataset, target: { brand: string | null; category: string }, cost: Cents | null): PriceAdvice {
  const items = new Map(ds.items.map((i) => [i.id, i]));
  const sold = ds.sales.map((s) => saleBreakdown(ds, s)).filter((b) => !b.cancelled && b.refunded < b.revenue && b.lines.length === 1)
    .map((b) => ({ price: b.netRevenue, it: items.get(b.lines[0].itemId) }))
    .filter((x): x is { price: number; it: Item } => !!x.it);
  const norm = (s: string | null) => (s ?? '').toLowerCase();
  const tries: [string, typeof sold][] = [
    [`${target.brand} · ${target.category}`, sold.filter((x) => target.brand && norm(detectBrand(x.it)) === norm(target.brand) && x.it.category === target.category)],
    [`${target.brand}`, sold.filter((x) => target.brand && norm(detectBrand(x.it)) === norm(target.brand))],
    [target.category, sold.filter((x) => x.it.category === target.category)],
  ];
  const [basis, list] = tries.find(([, l]) => l.length >= 3) ?? [null, [] as typeof sold];
  const prices = list.map((x) => x.price);
  const minimum = cost === null ? null : cost + (ds.settings.minProfitPerItem || 0);
  return {
    median: prices.length ? med(prices) : null,
    low: prices.length ? q(prices, 0.25) : null,
    high: prices.length ? q(prices, 0.75) : null,
    count: prices.length,
    basis,
    minimum,
  };
}

// ---------------------------------------------------------------------------
// Republication
// ---------------------------------------------------------------------------

export interface RepublishRow { item: Item; days: number; suggested: Cents | null; floor: Cents }

/** Articles en vente sans bouger depuis `republishDays` jours, avec une baisse de prix qui reste rentable. */
export function republishList(ds: Dataset, today: string): RepublishRow[] {
  const days = (a: string) => Math.round((Date.parse(today) - Date.parse(a)) / 86_400_000);
  return ds.items
    .filter((i) => SELLABLE.includes(i.status) && i.status !== 'reserve')
    .map((item) => {
      const d = days(item.listedAt ?? item.purchaseDate);
      const cost = item.purchasePrice + item.directFees;
      const floor = Math.max(item.minPrice ?? 0, cost + (ds.settings.minProfitPerItem || 0));
      const suggested = item.targetPrice ? Math.max(floor, Math.round((item.targetPrice * 0.9) / 50) * 50) : null;
      return { item, days: d, suggested: suggested !== null && item.targetPrice && suggested < item.targetPrice ? suggested : null, floor };
    })
    .filter((r) => r.days >= (ds.settings.republishDays || 7))
    .sort((a, b) => b.days - a.days || a.item.name.localeCompare(b.item.name));
}
